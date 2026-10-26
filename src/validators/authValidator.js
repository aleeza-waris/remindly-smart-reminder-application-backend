import { z } from 'zod';
import { isValidTimeZone } from '../utils/timezone.js';

const emailSchema = z
  .string()
  .trim()
  .email('Enter a valid email address.')
  .max(254, 'Email addresses must be 254 characters or fewer.')
  .transform((email) => email.toLowerCase());
const passwordSchema = z
  .string({ error: 'Please enter your password.' })
  .superRefine((password, context) => {
    if (password.length === 0) {
      context.addIssue({ code: 'custom', message: 'Please enter your password.' });
      return;
    }

    if (password.length < 8) {
      context.addIssue({
        code: 'custom',
        message: 'Password must be at least 8 characters long.',
      });
    }

    if (Buffer.byteLength(password, 'utf8') > 72) {
      context.addIssue({
        code: 'custom',
        message: 'Password is too long. Please use a shorter password.',
      });
    }
  });
const loginPasswordSchema = z
  .string({ error: 'Please enter your password.' })
  .min(1, 'Please enter your password.')
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, {
    message: 'Password is too long. Please use a shorter password.',
  });
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, 'Timezone must be a valid IANA timezone.');

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(100, 'Names must be 100 characters or fewer.'),
  email: emailSchema,
  password: passwordSchema,
  timezone: timezoneSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
  timezone: timezoneSchema.optional(),
});

export const googleAuthSchema = z.object({
  credential: z.string().min(1),
  timezone: timezoneSchema.optional(),
});

const advanceNoticeOptions = [0, 5, 10, 15, 30, 60, 1440];

export const updateCurrentUserSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required.')
      .max(100, 'Names must be 100 characters or fewer.')
      .optional(),
    timezone: timezoneSchema.optional(),
    defaultAdvanceNotice: z
      .number()
      .int()
      .refine((value) => advanceNoticeOptions.includes(value), {
        message: 'Default advance notice must be 0, 5, 10, 15, 30, 60, or 1440 minutes.',
      })
      .optional(),
    emailAlertsEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one settings field must be provided.',
  })
  .strict();
