import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/db/db.js';
import Reminder from '../src/models/Reminder.js';
import normalizeReminderTitle from '../src/utils/normalizeReminderTitle.js';

const BATCH_SIZE = 500;
const applyMigration = process.argv.includes('--apply');
mongoose.set('autoIndex', false);

const main = async () => {
  await connectDB();

  const groups = new Map();
  let reminderCount = 0;
  const cursor = Reminder.find({})
    .select('_id userId title')
    .lean()
    .cursor();

  for await (const reminder of cursor) {
    reminderCount += 1;
    const normalizedTitle = normalizeReminderTitle(reminder.title);
    const key = `${reminder.userId}:${normalizedTitle}`;
    const group = groups.get(key) ?? {
      userId: String(reminder.userId),
      reminderIds: [],
    };
    group.reminderIds.push(String(reminder._id));
    groups.set(key, group);
  }

  const conflicts = [...groups.values()].filter(({ reminderIds }) => reminderIds.length > 1);
  if (conflicts.length) {
    console.error(
      `Found ${conflicts.length} duplicate-title group(s). No reminders were changed. Resolve these groups manually, then rerun the migration.`
    );
    for (const conflict of conflicts) {
      console.error(JSON.stringify(conflict));
    }
    process.exitCode = 1;
    return;
  }

  if (!applyMigration) {
    console.log(
      `Preflight passed for ${reminderCount} reminder(s). No data was changed. Rerun with --apply while reminder writes are paused to backfill the normalized keys and create the unique index.`
    );
    return;
  }

  console.warn(
    'Applying the reminder title index migration. Ensure reminder writes are paused until this command completes.'
  );

  let operations = [];
  const updateCursor = Reminder.find({})
    .select('_id userId title')
    .lean()
    .cursor();

  for await (const reminder of updateCursor) {
    operations.push({
      updateOne: {
        filter: { _id: reminder._id },
        update: { $set: { normalizedTitle: normalizeReminderTitle(reminder.title) } },
      },
    });

    if (operations.length === BATCH_SIZE) {
      await Reminder.collection.bulkWrite(operations, { ordered: true });
      operations = [];
    }
  }

  if (operations.length) {
    await Reminder.collection.bulkWrite(operations, { ordered: true });
  }

  await Reminder.collection.createIndex(
    { userId: 1, normalizedTitle: 1 },
    {
      unique: true,
      partialFilterExpression: { normalizedTitle: { $type: 'string' } },
      name: 'unique_user_normalized_reminder_title',
    }
  );

  console.log(`Backfilled ${reminderCount} reminder(s) and created the unique title index.`);
};

try {
  await main();
} catch (error) {
  console.error(`Reminder title migration failed: ${error?.name || 'UnknownError'}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
