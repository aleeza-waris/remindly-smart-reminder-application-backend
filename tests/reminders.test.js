import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import connectDB from '../src/db/db.js';
import { runReminderSweep } from '../src/cron/reminderCron.js';
import { createRawMessage } from '../src/services/gmailService.js';
import Reminder from '../src/models/Reminder.js';
import Session from '../src/models/Session.js';
import User from '../src/models/User.js';
import normalizeReminderTitle from '../src/utils/normalizeReminderTitle.js';

const testMongoUri =
  process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/remindly_phase2_test';
const testPrefix = `phase3-${Date.now()}`;
const users = [];
const sessionTokens = [];
const originalMongoUri = process.env.MONGODB_URI;
const authorization = (token) => `Bearer ${token}`;

const createTestUser = async (label = 'primary') => {
  const user = await User.create({
    name: `Phase Three ${label}`,
    email: `${testPrefix}-${label}-${users.length}@example.test`,
    emailAlertsEnabled: true,
  });
  users.push(user);

  const token = randomBytes(32).toString('base64url');
  sessionTokens.push(token);
  await Session.create({
    userId: user._id,
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  return { user, token };
};

const createDueReminder = async (userId, overrides = {}) =>
  Reminder.create({
    userId,
    title: 'Due reminder',
    dueDate: new Date(Date.now() - 2 * 60 * 1000),
    advanceNoticeMinutes: 0,
    notifyAt: new Date(Date.now() - 60 * 1000),
    ...overrides,
  });

before(async () => {
  process.env.MONGODB_URI = testMongoUri;
  await connectDB();
  await Reminder.init();
});

after(async () => {
  const userIds = users.map(({ _id }) => _id);
  await Reminder.deleteMany({ userId: { $in: userIds } });
  await Session.deleteMany({ token: { $in: sessionTokens } });
  await User.deleteMany({ _id: { $in: userIds } });
  await mongoose.disconnect();

  if (originalMongoUri === undefined) {
    delete process.env.MONGODB_URI;
  } else {
    process.env.MONGODB_URI = originalMongoUri;
  }
});

describe('Phase 3 reminders and notifications', () => {
  it('requires authentication and validates one-time reminder input', async () => {
    const unauthenticated = await request(app).get('/api/reminders');
    assert.equal(unauthenticated.status, 401);

    const { token } = await createTestUser('validation');
    const invalid = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({
        title: '   ',
        dueDate: '2030-01-01T12:00:00',
        advanceNoticeMinutes: 7,
        recurrence: 'daily',
      });

    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.errors.some(({ field }) => field === 'title'));
    assert.ok(invalid.body.errors.some(({ field }) => field === 'dueDate'));
    assert.ok(invalid.body.errors.some(({ field }) => field === 'advanceNoticeMinutes'));

    const oversizedFields = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({
        title: 't'.repeat(121),
        description: 'd'.repeat(2001),
        dueDate: '2030-01-01T12:00:00Z',
      });
    assert.equal(oversizedFields.status, 400);
    assert.ok(oversizedFields.body.errors.some(({ field }) => field === 'title'));
    assert.ok(oversizedFields.body.errors.some(({ field }) => field === 'description'));

    const recurrence = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({
        title: 'Recurring is unsupported',
        dueDate: '2030-01-01T12:00:00Z',
        recurrence: 'daily',
      });
    assert.equal(recurrence.status, 400);
  });

  it('rejects trimmed case-insensitive duplicate titles per user and allows another user to reuse the title', async () => {
    const { token } = await createTestUser('duplicate-title-owner');
    const { token: otherToken } = await createTestUser('duplicate-title-other');
    const dueDate = '2030-01-01T12:00:00.000Z';

    const first = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({ title: '  Buy groceries  ', dueDate });
    assert.equal(first.status, 201);
    assert.equal(first.body.data.reminder.title, 'Buy groceries');
    assert.equal(first.body.data.reminder.normalizedTitle, undefined);

    const duplicate = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({ title: 'buy GROCERIES', dueDate });
    assert.equal(duplicate.status, 409);
    assert.equal(
      duplicate.body.message,
      'A reminder with this title already exists. Please choose a different title.'
    );
    assert.ok(duplicate.body.errors.some(({ field }) => field === 'title'));

    const otherUserReminder = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(otherToken))
      .send({ title: 'BUY GROCERIES', dueDate });
    assert.equal(otherUserReminder.status, 201);
  });

  it('allows a reminder to keep its own title and rejects a conflicting edit', async () => {
    const { user, token } = await createTestUser('duplicate-title-edit');
    const first = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({ title: 'Morning routine', dueDate: '2030-01-01T12:00:00.000Z' });
    const second = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({ title: 'Evening routine', dueDate: '2030-01-02T12:00:00.000Z' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    const retainOwnTitle = await request(app)
      .put(`/api/reminders/${first.body.data.reminder._id}`)
      .set('Authorization', authorization(token))
      .send({ title: '  MORNING ROUTINE  ' });
    assert.equal(retainOwnTitle.status, 200);
    assert.equal(retainOwnTitle.body.data.reminder.title, 'MORNING ROUTINE');

    const conflictingEdit = await request(app)
      .put(`/api/reminders/${second.body.data.reminder._id}`)
      .set('Authorization', authorization(token))
      .send({ title: ' morning routine ' });
    assert.equal(conflictingEdit.status, 409);
    assert.equal(
      conflictingEdit.body.message,
      'A reminder with this title already exists. Please choose a different title.'
    );

    const storedTitles = await Reminder.find({ userId: user._id }).select('title');
    assert.deepEqual(storedTitles.map(({ title }) => title).sort(), [
      'Evening routine',
      'MORNING ROUTINE',
    ]);
  });

  it('uses the unique database index to reject concurrent duplicate creates', async () => {
    const { token } = await createTestUser('duplicate-title-race');
    const createWithTitle = (title) =>
      request(app)
        .post('/api/reminders')
        .set('Authorization', authorization(token))
        .send({ title, dueDate: '2030-01-01T12:00:00.000Z' });

    const responses = await Promise.all([
      createWithTitle('Race condition reminder'),
      createWithTitle(' race CONDITION reminder '),
    ]);
    assert.deepEqual(
      responses.map(({ status }) => status).sort(),
      [201, 409]
    );

    const index = (await Reminder.collection.indexes()).find(
      ({ name }) => name === 'unique_user_normalized_reminder_title'
    );
    assert.equal(index?.unique, true);
    assert.deepEqual(index?.key, { userId: 1, normalizedTitle: 1 });
    assert.deepEqual(index?.partialFilterExpression, {
      normalizedTitle: { $type: 'string' },
    });
  });

  it('checks legacy reminders without normalized keys before allowing a duplicate', async () => {
    const { user, token } = await createTestUser('legacy-title');
    await Reminder.collection.insertOne({
      userId: user._id,
      title: '  Legacy Task  ',
      description: '',
      category: 'personal',
      priority: 'medium',
      dueDate: new Date('2030-01-01T12:00:00.000Z'),
      advanceNoticeMinutes: 0,
      notifyAt: new Date('2030-01-01T12:00:00.000Z'),
      status: 'pending',
      isNotified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await Reminder.collection.insertOne({
      userId: user._id,
      title: 'Test duplicate',
      normalizedTitle: 'Test duplicate',
      description: '',
      category: 'personal',
      priority: 'medium',
      dueDate: new Date('2030-01-02T12:00:00.000Z'),
      advanceNoticeMinutes: 0,
      notifyAt: new Date('2030-01-02T12:00:00.000Z'),
      status: 'pending',
      isNotified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const duplicate = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({ title: 'legacy task', dueDate: '2030-01-03T12:00:00.000Z' });
    assert.equal(duplicate.status, 409);

    const differentlyCasedKey = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({ title: 'test duplicate', dueDate: '2030-01-04T12:00:00.000Z' });
    assert.equal(differentlyCasedKey.status, 409);
  });

  it('returns newest reminders first with deterministic pagination regardless of due date', async () => {
    const { user, token } = await createTestUser('created-order');
    const base = {
      userId: user._id,
      description: '',
      category: 'personal',
      priority: 'medium',
      advanceNoticeMinutes: 0,
      status: 'pending',
      isNotified: false,
      notifiedAt: null,
      notificationError: null,
    };
    await Reminder.collection.insertMany([
      {
        ...base,
        title: 'Oldest created',
        normalizedTitle: normalizeReminderTitle('Oldest created'),
        dueDate: new Date('2040-01-01T12:00:00.000Z'),
        notifyAt: new Date('2040-01-01T12:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        ...base,
        title: 'Middle created',
        normalizedTitle: normalizeReminderTitle('Middle created'),
        dueDate: new Date('2030-01-01T12:00:00.000Z'),
        notifyAt: new Date('2030-01-01T12:00:00.000Z'),
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        ...base,
        title: 'Newest created',
        normalizedTitle: normalizeReminderTitle('Newest created'),
        dueDate: new Date('2035-01-01T12:00:00.000Z'),
        notifyAt: new Date('2035-01-01T12:00:00.000Z'),
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);

    const firstPage = await request(app)
      .get('/api/reminders?page=1&limit=2')
      .set('Authorization', authorization(token));
    assert.deepEqual(
      firstPage.body.data.reminders.map(({ title }) => title),
      ['Newest created', 'Middle created']
    );
    assert.equal(firstPage.body.data.pagination.total, 3);

    const secondPage = await request(app)
      .get('/api/reminders?page=2&limit=2')
      .set('Authorization', authorization(token));
    assert.deepEqual(
      secondPage.body.data.reminders.map(({ title }) => title),
      ['Oldest created']
    );
  });

  it('rejects past create and reschedule dates while allowing edits to existing overdue reminders', async () => {
    const { user, token } = await createTestUser('past-dates');
    const pastDate = new Date(Date.now() - 60_000).toISOString();

    const pastCreate = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({ title: 'Past task', dueDate: pastDate });
    assert.equal(pastCreate.status, 400);
    assert.ok(pastCreate.body.errors.some(({ field }) => field === 'dueDate'));

    const overdueReminder = await createDueReminder(user._id);
    await User.updateOne({ _id: user._id }, { $set: { emailAlertsEnabled: false } });
    const existingDate = overdueReminder.dueDate.toISOString();
    const editWithoutRescheduling = await request(app)
      .put(`/api/reminders/${overdueReminder._id}`)
      .set('Authorization', authorization(token))
      .send({ title: 'Updated overdue reminder', dueDate: existingDate });
    assert.equal(editWithoutRescheduling.status, 200);
    assert.equal(editWithoutRescheduling.body.data.reminder.status, 'pending');
    assert.equal(editWithoutRescheduling.body.data.reminder.title, 'Updated overdue reminder');

    const pastReschedule = await request(app)
      .put(`/api/reminders/${overdueReminder._id}`)
      .set('Authorization', authorization(token))
      .send({ dueDate: new Date(overdueReminder.dueDate.getTime() - 60_000).toISOString() });
    assert.equal(pastReschedule.status, 400);
    assert.ok(pastReschedule.body.errors.some(({ field }) => field === 'dueDate'));
  });

  it('enforces the description maximum at the model layer', async () => {
    const invalidReminder = new Reminder({
      userId: new mongoose.Types.ObjectId(),
      title: 'Valid title',
      description: 'd'.repeat(2001),
      dueDate: new Date(Date.now() + 60_000),
      notifyAt: new Date(Date.now() + 60_000),
    });

    await assert.rejects(invalidReminder.validate(), /2000/);
  });

  it('creates UTC dates and calculates the planned advance notification time', async () => {
    const { user, token } = await createTestUser('create');
    user.timezone = 'Asia/Karachi';
    user.timezoneConfigured = true;
    await user.save();
    const dueDate = '2030-04-05T16:33:00+05:00';
    const response = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({
        title: 'Prepare report',
        description: 'Send it to the team',
        category: 'work',
        priority: 'high',
        dueDate,
        advanceNoticeMinutes: 15,
      });

    assert.equal(response.status, 201);
    const reminder = response.body.data.reminder;
    assert.equal(reminder.dueDate, new Date(dueDate).toISOString());
    assert.equal(
      reminder.notifyAt,
      new Date(new Date(dueDate).getTime() - 15 * 60 * 1000).toISOString()
    );
    assert.equal(reminder.userId, String(user._id));
    assert.equal(reminder.status, 'pending');
    assert.equal(reminder.isNotified, false);

    const fromDatabase = await Reminder.findById(reminder._id);
    assert.equal(fromDatabase.dueDate.toISOString(), '2030-04-05T11:33:00.000Z');

    const listed = await request(app)
      .get('/api/reminders')
      .set('Authorization', authorization(token));
    assert.equal(listed.status, 200);
    assert.equal(
      listed.body.data.reminders.find(({ _id }) => _id === reminder._id).dueDate,
      '2030-04-05T11:33:00.000Z'
    );

    const rawEmail = createRawMessage(fromDatabase, user, 'sender@example.test');
    const emailBodies = [...rawEmail.matchAll(
      /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g
    )].map(([, body]) => Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'));
    assert.equal(emailBodies.length, 2);
    assert.match(emailBodies[0], /Friday, April 5, 2030 at 4:33 PM \(Asia\/Karachi\)/);
    assert.match(emailBodies[1], /Friday, April 5, 2030 at 4:33 PM \(Asia\/Karachi\)/);
  });

  it('supports owned list, filtering, search, pagination, detail, update, and delete', async () => {
    const { user, token } = await createTestUser('crud');
    const other = await createTestUser('other');
    const createResponse = await request(app)
      .post('/api/reminders')
      .set('Authorization', authorization(token))
      .send({
        title: 'Alpha task',
        description: 'Need to call the dentist',
        dueDate: '2030-01-01T12:00:00Z',
        advanceNoticeMinutes: 5,
      });
    assert.equal(createResponse.status, 201);

    const secondReminder = await Reminder.create({
      userId: user._id,
      title: 'Beta task',
      dueDate: new Date('2030-01-02T12:00:00Z'),
      notifyAt: new Date('2030-01-02T11:55:00Z'),
    });
    const otherReminder = await Reminder.create({
      userId: other.user._id,
      title: 'Private task',
      dueDate: new Date('2030-01-03T12:00:00Z'),
      notifyAt: new Date('2030-01-03T12:00:00Z'),
    });

    const listResponse = await request(app)
      .get('/api/reminders?search=dentist&page=1&limit=1')
      .set('Authorization', authorization(token));
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.data.reminders.length, 1);
    assert.equal(listResponse.body.data.pagination.total, 1);
    assert.equal(listResponse.body.data.reminders[0].title, 'Alpha task');

    const dateFiltered = await request(app)
      .get(
        '/api/reminders?dueFrom=2030-01-01T18%3A00%3A00.000Z&dueTo=2030-01-03T00%3A00%3A00.000Z'
      )
      .set('Authorization', authorization(token));
    assert.equal(dateFiltered.status, 200);
    assert.deepEqual(
      dateFiltered.body.data.reminders.map(({ title }) => title),
      ['Beta task']
    );

    const invalidDateRange = await request(app)
      .get('/api/reminders?dueFrom=2030-01-03T00%3A00%3A00Z&dueTo=2030-01-01T00%3A00%3A00Z')
      .set('Authorization', authorization(token));
    assert.equal(invalidDateRange.status, 400);

    const detail = await request(app)
      .get(`/api/reminders/${secondReminder._id}`)
      .set('Authorization', authorization(token));
    assert.equal(detail.status, 200);

    const updatedDueDate = '2031-02-03T09:30:00-04:00';
    const update = await request(app)
      .put(`/api/reminders/${secondReminder._id}`)
      .set('Authorization', authorization(token))
      .send({
        dueDate: updatedDueDate,
        advanceNoticeMinutes: 30,
        title: 'Updated beta',
      });
    assert.equal(update.status, 200);
    assert.equal(update.body.data.reminder.title, 'Updated beta');
    assert.equal(
      update.body.data.reminder.notifyAt,
      new Date(new Date(updatedDueDate).getTime() - 30 * 60 * 1000).toISOString()
    );

    const ownerCannotReadOther = await request(app)
      .get(`/api/reminders/${otherReminder._id}`)
      .set('Authorization', authorization(token));
    const ownerCannotUpdateOther = await request(app)
      .put(`/api/reminders/${otherReminder._id}`)
      .set('Authorization', authorization(token))
      .send({ title: 'Attempted access' });
    const ownerCannotDeleteOther = await request(app)
      .delete(`/api/reminders/${otherReminder._id}`)
      .set('Authorization', authorization(token));
    const ownerCannotCompleteOther = await request(app)
      .patch(`/api/reminders/${otherReminder._id}/complete`)
      .set('Authorization', authorization(token))
      .send({ completed: true });
    assert.equal(ownerCannotReadOther.status, 404);
    assert.equal(ownerCannotUpdateOther.status, 404);
    assert.equal(ownerCannotDeleteOther.status, 404);
    assert.equal(ownerCannotCompleteOther.status, 404);

    const ownerList = await request(app)
      .get('/api/reminders')
      .set('Authorization', authorization(token));
    assert.equal(ownerList.body.data.pagination.total, 2);
    assert.equal(
      ownerList.body.data.reminders.some((item) => String(item._id) === String(otherReminder._id)),
      false
    );

    const remove = await request(app)
      .delete(`/api/reminders/${secondReminder._id}`)
      .set('Authorization', authorization(token));
    assert.equal(remove.status, 200);
    assert.equal(await Reminder.exists({ _id: secondReminder._id }), null);
  });

  it('completes and reopens a reminder and returns dashboard statistics', async () => {
    const { user, token } = await createTestUser('status');
    const reminder = await Reminder.create({
      userId: user._id,
      title: 'Future task',
      dueDate: new Date(Date.now() + 60 * 60 * 1000),
      notifyAt: new Date(Date.now() + 45 * 60 * 1000),
    });

    const complete = await request(app)
      .patch(`/api/reminders/${reminder._id}/complete`)
      .set('Authorization', authorization(token))
      .send({ completed: true });
    assert.equal(complete.status, 200);
    assert.equal(complete.body.data.reminder.status, 'completed');
    assert.ok(complete.body.data.reminder.completedAt);

    const reopen = await request(app)
      .patch(`/api/reminders/${reminder._id}/complete`)
      .set('Authorization', authorization(token))
      .send({ completed: false });
    assert.equal(reopen.status, 200);
    assert.equal(reopen.body.data.reminder.status, 'pending');
    assert.equal(reopen.body.data.reminder.completedAt, null);

    await createDueReminder(user._id, {
      dueDate: new Date(Date.now() - 60 * 1000),
      notifyAt: new Date(Date.now() - 120 * 1000),
      category: 'health',
    });
    const stats = await request(app)
      .get('/api/reminders/stats')
      .set('Authorization', authorization(token));
    assert.equal(stats.status, 200);
    assert.equal(stats.body.data.total, 2);
    assert.equal(stats.body.data.upcoming, 1);
    assert.equal(stats.body.data.overdue, 1);
    assert.equal(stats.body.data.completed, 0);
    assert.equal(stats.body.data.byCategory.personal, 1);
    assert.equal(stats.body.data.byCategory.health, 1);
    await User.updateOne({ _id: user._id }, { $set: { emailAlertsEnabled: false } });
  });

  it('sends due and downtime-missed notifications and only marks successful delivery', async () => {
    const { user } = await createTestUser('worker');
    const reminder = await createDueReminder(user._id);
    let sendCount = 0;

    const result = await runReminderSweep(async (sentReminder, sentUser) => {
      sendCount += 1;
      assert.equal(String(sentReminder._id), String(reminder._id));
      assert.equal(String(sentUser._id), String(user._id));
    });

    assert.deepEqual(result, { skipped: false, processed: 1 });
    assert.equal(sendCount, 1);
    const delivered = await Reminder.findById(reminder._id);
    assert.equal(delivered.isNotified, true);
    assert.ok(delivered.notifiedAt instanceof Date);
    assert.equal(delivered.notificationError, null);
  });

  it('skips delivery cleanly when Email Alerts are disabled', async () => {
    const { user } = await createTestUser('alerts-disabled');
    const reminder = await createDueReminder(user._id);
    await User.updateOne({ _id: user._id }, { $set: { emailAlertsEnabled: false } });
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...values) => loggedErrors.push(values.join(' '));

    try {
      const result = await runReminderSweep(async () => {
        assert.fail('Email sender must not run when Email Alerts are disabled.');
      });
      assert.deepEqual(result, { skipped: false, processed: 0 });
    } finally {
      console.error = originalConsoleError;
    }

    const skippedReminder = await Reminder.findById(reminder._id);
    assert.equal(skippedReminder.isNotified, false);
    assert.equal(skippedReminder.notificationError, null);
    assert.deepEqual(loggedErrors, []);
  });

  it('keeps failed deliveries retryable and prevents overlapping worker runs', async () => {
    const { user } = await createTestUser('worker-failure');
    const reminder = await createDueReminder(user._id);
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...values) => loggedErrors.push(values.join(' '));

    try {
      const failed = await runReminderSweep(async () => {
        throw Object.assign(new Error('provider response contains sensitive details'), {
          code: 'GMAIL_API_UNAVAILABLE',
        });
      });
      assert.deepEqual(failed, { skipped: false, processed: 0 });
    } finally {
      console.error = originalConsoleError;
    }

    const retryable = await Reminder.findById(reminder._id);
    assert.equal(retryable.isNotified, false);
    assert.equal(retryable.notifiedAt, null);
    assert.equal(retryable.notificationError, 'Error');
    assert.ok(loggedErrors.some((message) => message.includes('code=GMAIL_API_UNAVAILABLE')));
    assert.equal(loggedErrors.some((message) => message.includes('sensitive details')), false);

    let markStarted;
    let releaseSend;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const blockedSend = new Promise((resolve) => {
      releaseSend = resolve;
    });
    const firstRun = runReminderSweep(async () => {
      markStarted();
      await blockedSend;
    });
    await started;
    const overlappingRun = await runReminderSweep(async () => {
      assert.fail('A concurrent sweep must not send a notification.');
    });

    assert.deepEqual(overlappingRun, { skipped: true, processed: 0 });
    releaseSend();
    assert.deepEqual(await firstRun, { skipped: false, processed: 1 });
  });

  it('escapes reminder content in the generated Gmail message', () => {
    const raw = createRawMessage(
      {
        title: '<script>alert("x")</script>',
        description: '<b>unsafe</b>',
        dueDate: new Date('2030-01-01T12:00:00Z'),
      },
      { name: '<img src=x>', email: 'remindly-test@example.test' },
      'sender@example.test'
    );
    assert.match(raw, /multipart\/alternative/);
    const decodedBodies = [...raw.matchAll(
      /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g
    )]
      .map(([, body]) => Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'));
    assert.equal(decodedBodies.length, 2);
    assert.equal(decodedBodies[1].includes('<script>'), false);
    assert.equal(decodedBodies[1].includes('<b>unsafe<\/b>'), false);
    assert.equal(decodedBodies[1].includes('&lt;script&gt;'), true);
    assert.equal(decodedBodies[1].includes('&lt;img src=x&gt;'), true);
  });
});
