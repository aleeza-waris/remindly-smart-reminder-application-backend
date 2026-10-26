import mongoose from 'mongoose';
import ApiError from '../utils/ApiError.js';
import Reminder from '../models/Reminder.js';
import User from '../models/User.js';
import normalizeReminderTitle from '../utils/normalizeReminderTitle.js';

const NOT_FOUND = 'Reminder not found.';
const DUPLICATE_TITLE_MESSAGE =
  'A reminder with this title already exists. Please choose a different title.';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getOwnedReminder = async (reminderId, userId) => {
  if (!mongoose.isValidObjectId(reminderId)) {
    throw new ApiError(400, 'Invalid reminder ID.');
  }

  const reminder = await Reminder.findOne({ _id: reminderId, userId });
  if (!reminder) {
    throw new ApiError(404, NOT_FOUND);
  }
  return reminder;
};

const throwDuplicateTitleError = () => {
  throw new ApiError(409, DUPLICATE_TITLE_MESSAGE, [
    { field: 'title', message: DUPLICATE_TITLE_MESSAGE },
  ]);
};

const isDuplicateTitleIndexError = (error) =>
  error?.code === 11000 &&
  (error.keyPattern?.normalizedTitle !== undefined ||
    error.message?.includes('unique_user_normalized_reminder_title'));

const assertUniqueReminderTitle = async (userId, title, excludeReminderId) => {
  const normalizedTitle = normalizeReminderTitle(title);
  const ownershipFilter = {
    userId,
    ...(excludeReminderId ? { _id: { $ne: excludeReminderId } } : {}),
  };

  const normalizedConflict = await Reminder.exists({
    ...ownershipFilter,
    normalizedTitle,
  }).collation({ locale: 'en', strength: 2 });
  if (normalizedConflict) {
    throwDuplicateTitleError();
  }

  // During a rolling migration, legacy reminders may not have normalizedTitle yet.
  const legacyConflict = await Reminder.findOne({
    ...ownershipFilter,
    normalizedTitle: { $exists: false },
    $expr: {
      $eq: [{ $trim: { input: '$title' } }, title.trim()],
    },
  })
    .collation({ locale: 'en', strength: 2 })
    .select('_id')
    .lean();

  if (legacyConflict) {
    throwDuplicateTitleError();
  }
};

export const createReminder = async (input, userId) => {
  await assertUniqueReminderTitle(userId, input.title);
  const dueDate = new Date(input.dueDate);

  let advanceNoticeMinutes = input.advanceNoticeMinutes;

  if (advanceNoticeMinutes === undefined) {
    const user = await User.findById(userId).select('defaultAdvanceNotice');

    advanceNoticeMinutes = user?.defaultAdvanceNotice ?? 0;
  }

  const notifyAt = new Date(
    dueDate.getTime() - advanceNoticeMinutes * 60 * 1000
  );

  try {
    return await Reminder.create({
      ...input,
      userId,
      normalizedTitle: normalizeReminderTitle(input.title),
      dueDate,
      advanceNoticeMinutes,
      notifyAt,
    });
  } catch (error) {
    if (isDuplicateTitleIndexError(error)) {
      throwDuplicateTitleError();
    }
    throw error;
  }
};

export const listReminders = async (userId, {
  status,
  category,
  priority,
  search,
  dueFrom,
  dueTo,
  page,
  limit,
}) => {
  const filter = { userId };
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;
  if (dueFrom || dueTo) {
    filter.dueDate = {
      ...(dueFrom ? { $gte: dueFrom } : {}),
      ...(dueTo ? { $lte: dueTo } : {}),
    };
  }
  if (search) {
    filter.$or = [
      { title: { $regex: escapeRegExp(search), $options: 'i' } },
      { description: { $regex: escapeRegExp(search), $options: 'i' } },
    ];
  }

  const [reminders, total] = await Promise.all([
    Reminder.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Reminder.countDocuments(filter),
  ]);

  return {
    reminders,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

export const getReminder = async (reminderId, userId) =>
  getOwnedReminder(reminderId, userId);

export const updateReminder = async (reminderId, userId, input) => {
  const reminder = await getOwnedReminder(reminderId, userId);
  if (input.title !== undefined) {
    await assertUniqueReminderTitle(userId, input.title, reminder._id);
    reminder.normalizedTitle = normalizeReminderTitle(input.title);
  }
  if (
    input.dueDate !== undefined &&
    input.dueDate.getTime() !== reminder.dueDate.getTime() &&
    input.dueDate.getTime() <= Date.now()
  ) {
    throw new ApiError(400, 'Due date and time must be in the future.', [
      { field: 'dueDate', message: 'Due date and time must be in the future.' },
    ]);
  }

  const schedulingChanged =
    input.dueDate !== undefined || input.advanceNoticeMinutes !== undefined;

  Object.assign(reminder, input);

  if (schedulingChanged) {
    reminder.notifyAt = new Date(
      reminder.dueDate.getTime() - reminder.advanceNoticeMinutes * 60 * 1000
    );
    reminder.isNotified = false;
    reminder.notifiedAt = null;
    reminder.notificationError = null;
  }

  try {
    await reminder.save();
  } catch (error) {
    if (isDuplicateTitleIndexError(error)) {
      throwDuplicateTitleError();
    }
    throw error;
  }
  return reminder;
};

export const deleteReminder = async (reminderId, userId) => {
  const reminder = await getOwnedReminder(reminderId, userId);
  await reminder.deleteOne();
};

export const setReminderCompletion = async (reminderId, userId, completed) => {
  const reminder = await getOwnedReminder(reminderId, userId);
  reminder.status = completed ? 'completed' : 'pending';
  reminder.completedAt = completed ? new Date() : null;
  await reminder.save();
  return reminder;
};

export const getReminderStats = async (userId) => {
  const now = new Date();
  const [total, completed, upcoming, overdue, categoryCounts] = await Promise.all([
    Reminder.countDocuments({ userId }),
    Reminder.countDocuments({ userId, status: 'completed' }),
    Reminder.countDocuments({ userId, status: 'pending', dueDate: { $gte: now } }),
    Reminder.countDocuments({ userId, status: 'pending', dueDate: { $lt: now } }),
    Reminder.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    total,
    upcoming,
    completed,
    overdue,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    byCategory: Object.fromEntries(categoryCounts.map(({ _id, count }) => [_id, count])),
  };
};
