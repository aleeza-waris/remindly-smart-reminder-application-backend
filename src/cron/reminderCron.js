import cron from 'node-cron';
import Reminder from '../models/Reminder.js';
import User from '../models/User.js';
import { sendReminderEmail } from '../services/gmailService.js';

let isCronRunning = false;
let scheduledTask;

const safeErrorName = (error) =>
  typeof error?.name === 'string' &&
  (error.name === 'Error' || /^[A-Za-z]+Error$/.test(error.name))
    ? error.name
    : 'DeliveryError';

const safeErrorContext = (error) => {
  const parts = [];
  if (typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(error.code)) {
    parts.push(`code=${error.code}`);
  }
  const status = error?.response?.status;
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    parts.push(`httpStatus=${status}`);
  }
  return parts.length ? ` (${parts.join(', ')})` : '';
};

const logWorkerError = (message, error) => {
  console.error(`${message}: ${safeErrorName(error)}${safeErrorContext(error)}`);
};

export const runReminderSweep = async (sendEmail = sendReminderEmail) => {
  if (isCronRunning) {
    return { skipped: true, processed: 0 };
  }

  isCronRunning = true;
  let processed = 0;

  try {
    const dueReminders = await Reminder.find({
      status: 'pending',
      isNotified: false,
      notifyAt: { $lte: new Date() },
    }).sort({ notifyAt: 1 });

    for (const reminder of dueReminders) {
      try {
        const user = await User.findById(reminder.userId).select(
          'name email emailAlertsEnabled timezone'
        );
        if (!user) {
          logWorkerError(`Reminder recipient is unavailable for ${reminder._id}`, new Error());
          await Reminder.updateOne(
            { _id: reminder._id, status: 'pending', isNotified: false },
            { $set: { notificationError: 'RecipientUnavailable' } }
          );
          continue;
        }
        if (user.emailAlertsEnabled === false) {
          continue;
        }

        try {
          await sendEmail(reminder, user);
        } catch (error) {
          logWorkerError(`Reminder email delivery failed for ${reminder._id}`, error);
          try {
            await Reminder.updateOne(
              { _id: reminder._id, status: 'pending', isNotified: false },
              { $set: { notificationError: safeErrorName(error) } }
            );
          } catch (updateError) {
            logWorkerError(`Could not record notification failure for ${reminder._id}`, updateError);
          }
          continue;
        }

        await Reminder.updateOne(
          { _id: reminder._id, status: 'pending', isNotified: false },
          {
            $set: {
              isNotified: true,
              notifiedAt: new Date(),
              notificationError: null,
            },
          }
        );
        processed += 1;
      } catch (error) {
        logWorkerError(`Could not process reminder ${reminder._id}`, error);
      }
    }

    return { skipped: false, processed };
  } catch (error) {
    logWorkerError('Reminder notification sweep failed', error);
    return { skipped: false, processed, failed: true };
  } finally {
    isCronRunning = false;
  }
};

export const startReminderCron = () => {
  if (!scheduledTask) {
    scheduledTask = cron.schedule('* * * * *', () => {
      void runReminderSweep();
    });
  }
  return scheduledTask;
};

export const stopReminderCron = () => {
  scheduledTask?.stop();
  scheduledTask = undefined;
};
