import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';

const htmlEscape = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });

const encodeBase64Url = (value) =>
  Buffer.from(value, 'utf8').toString('base64url');

const encodeMimeBody = (value) =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n')
    .trimEnd();

const encodeHeader = (value) =>
  `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const formatDate = (date, timeZone = 'UTC') => {
  let resolvedTimeZone = 'UTC';
  try {
    resolvedTimeZone = new Intl.DateTimeFormat('en', { timeZone })
      .resolvedOptions()
      .timeZone;
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    // An invalid saved timezone must not prevent reminder delivery.
  }

  const formattedDate = new Intl.DateTimeFormat('en', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: resolvedTimeZone,
    hour12: true,
  }).format(date);
  return `${formattedDate} (${resolvedTimeZone})`;
};

const createRawMessage = (reminder, user, senderEmail) => {
  const boundary = `remindly-${randomUUID()}`;
  const safeTitle = htmlEscape(reminder.title);
  const safeDescription = htmlEscape(reminder.description || '').replace(/\r?\n/g, '<br>');
  const dueDate = formatDate(reminder.dueDate, user.timezone);
  const text = [
    `Reminder: ${reminder.title}`,
    reminder.description ? `\n${reminder.description}` : '',
    `\nDue: ${dueDate}`,
  ].join('');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#334155"><main style="max-width:600px;margin:24px auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px"><h1 style="color:#4f46e5">Remindly reminder</h1><p>Hello ${htmlEscape(user.name)},</p><h2>${safeTitle}</h2>${safeDescription ? `<p>${safeDescription}</p>` : ''}<p><strong>Due:</strong> ${htmlEscape(dueDate)}</p><p style="color:#64748b">This is your scheduled one-time reminder.</p></main></body></html>`;

  return [
    `From: Remindly <${senderEmail}>`,
    `To: ${user.email}`,
    `Subject: ${encodeHeader(`Reminder: ${reminder.title}`)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(html),
    `--${boundary}--`,
  ].join('\r\n');
};

export const sendReminderEmail = async (reminder, user) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER_EMAIL } =
    process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_SENDER_EMAIL) {
    throw Object.assign(new Error('Gmail API configuration is incomplete.'), {
      code: 'GMAIL_CONFIGURATION_INCOMPLETE',
    });
  }
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(GMAIL_SENDER_EMAIL)) {
    throw Object.assign(new Error('Gmail sender email is invalid.'), {
      code: 'GMAIL_SENDER_INVALID',
    });
  }

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodeBase64Url(createRawMessage(reminder, user, GMAIL_SENDER_EMAIL)),
    },
  });
};

export { createRawMessage };
