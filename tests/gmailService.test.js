import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRawMessage, sendReminderEmail } from '../src/services/gmailService.js';

const decodeBodies = (raw) =>
  [...raw.matchAll(
    /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g
  )].map(([, body]) => Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'));

describe('reminder email date formatting', () => {
  it('formats the stored instant in the recipient timezone', () => {
    const raw = createRawMessage(
      {
        title: 'Pakistan reminder',
        dueDate: new Date('2030-04-05T10:00:00.000Z'),
      },
      {
        name: 'Remindly User',
        email: 'user@example.test',
        timezone: 'Asia/Karachi',
      },
      'sender@example.test'
    );
    const [text, html] = decodeBodies(raw);

    assert.match(text, /Due: Friday, April 5, 2030 at 3:00 PM \(Asia\/Karachi\)/);
    assert.match(html, /Due:<\/strong> Friday, April 5, 2030 at 3:00 PM \(Asia\/Karachi\)/);
    assert.doesNotMatch(text, /10:00 AM \(UTC\)/);
  });

  it('falls back to UTC for an invalid saved timezone', () => {
    const raw = createRawMessage(
      {
        title: 'UTC fallback reminder',
        dueDate: new Date('2030-04-05T10:00:00.000Z'),
      },
      {
        name: 'Remindly User',
        email: 'user@example.test',
        timezone: 'Invalid/Timezone',
      },
      'sender@example.test'
    );
    const [text] = decodeBodies(raw);

    assert.match(text, /Due: Friday, April 5, 2030 at 10:00 AM \(UTC\)/);
  });
});

describe('Gmail configuration errors', () => {
  it('reports a safe diagnostic code when required configuration is missing', async () => {
    const keys = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GMAIL_REFRESH_TOKEN',
      'GMAIL_SENDER_EMAIL',
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);

    try {
      await assert.rejects(
        sendReminderEmail({}, {}),
        (error) => error.code === 'GMAIL_CONFIGURATION_INCOMPLETE'
      );
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
});
