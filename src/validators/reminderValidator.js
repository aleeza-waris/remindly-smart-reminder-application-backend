import { z } from 'zod';

const categories = ['work', 'personal', 'health', 'study', 'finance', 'urgent', 'other'];
const priorities = ['low', 'medium', 'high', 'urgent'];
const advanceNoticeOptions = [0, 5, 10, 15, 30, 60, 1440];
const dueDateSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const futureDueDateSchema = dueDateSchema.refine(
  (value) => value.getTime() > Date.now(),
  'Due date and time must be in the future.'
);

export const createReminderSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a reminder title.')
    .max(120, 'Reminder titles must be 120 characters or fewer.'),
  description: z.string().trim().max(2000, 'Descriptions must be 2,000 characters or fewer.').optional(),
  category: z.enum(categories).optional(),
  priority: z.enum(priorities).optional(),
  dueDate: futureDueDateSchema,
  advanceNoticeMinutes: z.number().int().refine((value) => advanceNoticeOptions.includes(value), {
    message: 'Advance notice must be 0, 5, 10, 15, 30, 60, or 1440 minutes.',
  }).optional(),
}).strict();

export const updateReminderSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Enter a reminder title.')
      .max(120, 'Reminder titles must be 120 characters or fewer.')
      .optional(),
    description: z.string().trim().max(2000, 'Descriptions must be 2,000 characters or fewer.').optional(),
    category: z.enum(categories).optional(),
    priority: z.enum(priorities).optional(),
    dueDate: dueDateSchema.optional(),
    advanceNoticeMinutes: z.number().int().refine((value) => advanceNoticeOptions.includes(value), {
      message: 'Advance notice must be 0, 5, 10, 15, 30, 60, or 1440 minutes.',
    }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one reminder field must be provided.',
  })
  .strict();

export const completeReminderSchema = z.object({
  completed: z.boolean(),
}).strict();

export const listRemindersSchema = z.object({
  status: z.enum(['pending', 'completed']).optional(),
  category: z.enum(categories).optional(),
  priority: z.enum(priorities).optional(),
  search: z.string().trim().max(100).optional(),
  dueFrom: dueDateSchema.optional(),
  dueTo: dueDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(
  ({ dueFrom, dueTo }) => dueFrom === undefined || dueTo === undefined || dueFrom <= dueTo,
  { message: 'The dueFrom date must be earlier than or equal to dueTo.' }
);

export const reminderIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid reminder ID.');
