import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import connectDB from '../src/db/db.js';
import Session from '../src/models/Session.js';
import User from '../src/models/User.js';

const testMongoUri =
  process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/remindly_phase2_test';
const emailPrefix = `phase2-${Date.now()}`;
const emails = [];
const originalMongoUri = process.env.MONGODB_URI;
const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const authorization = (token) => `Bearer ${token}`;

const registerUser = async (overrides = {}) => {
  const email = `${emailPrefix}-${emails.length}@example.test`;
  emails.push(email);
  const response = await request(app).post('/api/auth/register').send({
    name: 'Phase Two Test',
    email,
    password: 'phase2-StrongPassword-123',
    ...overrides,
  });
  return { response, email };
};

before(async () => {
  process.env.MONGODB_URI = testMongoUri;
  process.env.GOOGLE_CLIENT_ID = 'phase2-test-client-id';
  await connectDB();
});

after(async () => {
  const users = await User.find({ email: { $in: emails } }).select('_id');
  const userIds = users.map(({ _id }) => _id);
  await Session.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  await mongoose.disconnect();

  if (originalMongoUri === undefined) {
    delete process.env.MONGODB_URI;
  } else {
    process.env.MONGODB_URI = originalMongoUri;
  }

  if (originalGoogleClientId === undefined) {
    delete process.env.GOOGLE_CLIENT_ID;
  } else {
    process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
  }
});

describe('Phase 2 authentication and sessions', () => {
  it('preserves the Phase 1 health-check response', async () => {
    const response = await request(app).get('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
  });

  it('validates registration fields before creating an account', async () => {
    const response = await request(app).post('/api/auth/register').send({
      name: 'Invalid Test',
      email: 'invalid-email',
      password: '123',
    });

    assert.equal(response.status, 400);
    assert.ok(response.body.errors.some(({ field }) => field === 'email'));
    assert.ok(response.body.errors.some(({ field }) => field === 'password'));

    const longName = await request(app).post('/api/auth/register').send({
      name: 'n'.repeat(101),
      email: `long-name-${emailPrefix}@example.test`,
      password: 'phase2-StrongPassword-123',
    });
    assert.equal(longName.status, 400);
    assert.ok(longName.body.errors.some(({ field }) => field === 'name'));

    const longEmail = await request(app).post('/api/auth/register').send({
      name: 'Length Test',
      email: `${'a'.repeat(242)}@example.test`,
      password: 'phase2-StrongPassword-123',
    });
    assert.equal(longEmail.status, 400);
    assert.ok(longEmail.body.errors.some(({ field }) => field === 'email'));

    const longPassword = await request(app).post('/api/auth/register').send({
      name: 'Length Test',
      email: `long-password-${emailPrefix}@example.test`,
      password: 'p'.repeat(73),
    });
    assert.equal(longPassword.status, 400);
    assert.ok(longPassword.body.errors.some(({ field }) => field === 'password'));
  });

  it('returns user-friendly password validation messages and enforces the bcrypt byte limit', async () => {
    const passwordMessage = (response) =>
      response.body.errors.find(({ field }) => field === 'password')?.message;

    const emptyRegistration = await request(app).post('/api/auth/register').send({
      name: 'Password Test',
      email: `empty-password-${emailPrefix}@example.test`,
      password: '',
    });
    assert.equal(emptyRegistration.status, 400);
    assert.equal(passwordMessage(emptyRegistration), 'Please enter your password.');

    const shortRegistration = await request(app).post('/api/auth/register').send({
      name: 'Password Test',
      email: `short-password-${emailPrefix}@example.test`,
      password: 'short7',
    });
    assert.equal(shortRegistration.status, 400);
    assert.equal(
      passwordMessage(shortRegistration),
      'Password must be at least 8 characters long.'
    );

    const emptyLogin = await request(app).post('/api/auth/login').send({
      email: `missing-${emailPrefix}@example.test`,
      password: '',
    });
    assert.equal(emptyLogin.status, 400);
    assert.equal(passwordMessage(emptyLogin), 'Please enter your password.');

    const validAtByteLimit = await registerUser({ password: '😀'.repeat(18) });
    assert.equal(validAtByteLimit.response.status, 201);

    const tooLongRegistration = await request(app).post('/api/auth/register').send({
      name: 'Password Test',
      email: `over-limit-${emailPrefix}@example.test`,
      password: '😀'.repeat(19),
    });
    assert.equal(tooLongRegistration.status, 400);
    assert.equal(
      passwordMessage(tooLongRegistration),
      'Password is too long. Please use a shorter password.'
    );

    const tooLongLogin = await request(app).post('/api/auth/login').send({
      email: `missing-${emailPrefix}@example.test`,
      password: '😀'.repeat(19),
    });
    assert.equal(tooLongLogin.status, 400);
    assert.equal(
      passwordMessage(tooLongLogin),
      'Password is too long. Please use a shorter password.'
    );
  });

  it('accepts numeric display names and enforces model-level name and email maxima', async () => {
    const { response } = await registerUser({ name: '1234' });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.user.name, '1234');

    const oversizedUser = new User({
      name: 'n'.repeat(101),
      email: 'oversized-name@example.test',
      password: 'hashed-password',
    });
    await assert.rejects(oversizedUser.validate(), /100/);

    const oversizedEmailUser = new User({
      name: 'Valid Name',
      email: `${'a'.repeat(242)}@example.test`,
      password: 'hashed-password',
    });
    await assert.rejects(oversizedEmailUser.validate(), /254/);
  });

  it('registers safely and persists an opaque seven-day session', async () => {
    const { response, email } = await registerUser();

    assert.equal(response.status, 201);
    assert.equal(response.body.data.user.email, email);
    assert.equal(response.body.data.user.password, undefined);
    assert.equal(response.body.data.user.googleId, undefined);
    assert.equal(response.body.data.user._id, undefined);
    assert.match(response.body.data.token, /^[A-Za-z0-9_-]{43}$/);

    const user = await User.findOne({ email }).select('+password');
    assert.notEqual(user.password, 'phase2-StrongPassword-123');
    assert.equal(await bcrypt.compare('phase2-StrongPassword-123', user.password), true);

    const session = await Session.findOne({ userId: user._id }).select('+token');
    assert.equal(session.token, response.body.data.token);
    assert.ok(session.expiresAt.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);
    assert.ok(session.expiresAt.getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000);
  });

  it('saves the browser timezone on registration and initializes legacy UTC accounts once', async () => {
    const { response, email } = await registerUser({ timezone: 'Asia/Karachi' });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.user.timezone, 'Asia/Karachi');
    assert.equal(response.body.data.user.timezoneConfigured, undefined);
    const registeredUser = await User.findOne({ email });
    assert.equal(registeredUser.timezone, 'Asia/Karachi');
    assert.equal(registeredUser.timezoneConfigured, true);

    const legacyEmail = `${emailPrefix}-legacy-timezone@example.test`;
    emails.push(legacyEmail);
    const legacyUser = await User.create({
      name: 'Legacy User',
      email: legacyEmail,
      password: await bcrypt.hash('phase2-StrongPassword-123', 4),
      timezone: 'UTC',
    });
    const legacyToken = 't'.repeat(43);
    await Session.create({
      userId: legacyUser._id,
      token: legacyToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const profile = await request(app)
      .get('/api/auth/me')
      .set('Authorization', authorization(legacyToken))
      .set('X-Timezone', 'Asia/Karachi');

    assert.equal(profile.status, 200);
    assert.equal(profile.body.data.user.timezone, 'Asia/Karachi');
    assert.equal((await User.findById(legacyUser._id)).timezoneConfigured, true);

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', authorization(legacyToken))
      .set('X-Timezone', 'America/Chicago');
    assert.equal((await User.findById(legacyUser._id)).timezone, 'Asia/Karachi');
  });

  it('rejects duplicate registrations and invalid passwords without exposing account details', async () => {
    const { response, email } = await registerUser();
    assert.equal(response.status, 201);

    const duplicate = await request(app).post('/api/auth/register').send({
      name: 'Duplicate',
      email,
      password: 'phase2-StrongPassword-123',
    });
    assert.equal(duplicate.status, 409);

    const badLogin = await request(app).post('/api/auth/login').send({
      email,
      password: 'wrong-password',
    });
    assert.equal(badLogin.status, 401);
    assert.equal(badLogin.body.message, 'Email or password is incorrect.');
  });

  it('logs in and protects profile, session-list, and session-revocation routes', async () => {
    const { response, email } = await registerUser();
    const token = response.body.data.token;

    const login = await request(app).post('/api/auth/login').send({
      email,
      password: 'phase2-StrongPassword-123',
    });
    assert.equal(login.status, 200);
    assert.notEqual(login.body.data.token, token);

    const user = await User.findOne({ email });
    const otherSession = await Session.create({
      userId: user._id,
      token: 'x'.repeat(43),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const profile = await request(app)
      .get('/api/auth/me')
      .set('Authorization', authorization(token));
    assert.equal(profile.status, 200);
    assert.equal(profile.body.data.user.password, undefined);
    assert.equal(profile.body.data.user._id, undefined);

    const sessions = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', authorization(token));
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.data.sessions.length, 3);
    assert.equal(JSON.stringify(sessions.body).includes(token), false);
    assert.equal(sessions.body.data.sessions.filter((session) => session.current).length, 1);
    assert.equal(sessions.body.data.sessions.some((session) => '_id' in session), false);

    const revoked = await request(app)
      .delete('/api/auth/sessions')
      .set('Authorization', authorization(token));
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.revokedCount, 2);
    assert.equal(await Session.exists({ _id: otherSession._id }), null);
  });

  it('rejects missing, malformed, and expired bearer sessions and invalidates logout', async () => {
    const { response, email } = await registerUser();
    const token = response.body.data.token;
    const user = await User.findOne({ email });
    const expiredToken = 'e'.repeat(43);

    await Session.create({
      userId: user._id,
      token: expiredToken,
      expiresAt: new Date(Date.now() - 1_000),
    });

    assert.equal((await request(app).get('/api/auth/me')).status, 401);
    assert.equal(
      (await request(app).get('/api/auth/me').set('Authorization', 'Bearer malformed')).status,
      401
    );
    assert.equal(
      (
        await request(app)
          .get('/api/auth/me')
          .set('Authorization', authorization(expiredToken))
      ).status,
      401
    );

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', authorization(token));
    assert.equal(logout.status, 200);
    assert.equal(await Session.exists({ token }), null);
    assert.equal(
      (
        await request(app)
          .get('/api/auth/me')
          .set('Authorization', authorization(token))
      ).status,
      401
    );
  });

  it('uses only Google-verified claims and issues a session', async (context) => {
    const email = `${emailPrefix}-google@example.test`;
    emails.push(email);
    const verifyIdToken = context.mock.method(
      OAuth2Client.prototype,
      'verifyIdToken',
      async () => ({
        getPayload: () => ({
          sub: 'verified-google-subject',
          email,
          email_verified: true,
          name: 'Verified Google Name',
          picture: 'https://example.test/verified-avatar.png',
        }),
      })
    );

    const response = await request(app).post('/api/auth/google').send({
      credential: 'credential-from-google-client',
      name: 'Untrusted Client Name',
      email: 'untrusted@example.test',
    });

    assert.deepEqual(verifyIdToken.mock.calls[0].arguments[0], {
      idToken: 'credential-from-google-client',
      audience: 'phase2-test-client-id',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.user.name, 'Verified Google Name');
    assert.equal(response.body.data.user.email, email);
    assert.equal(response.body.data.user.password, undefined);
    assert.equal(response.body.data.user.googleId, undefined);
    assert.match(response.body.data.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(await User.exists({ email, googleId: 'verified-google-subject' }), null);
  });

  it('rejects Google credentials when the Google verifier rejects them', async (context) => {
    const email = `${emailPrefix}-rejected-google@example.test`;
    emails.push(email);
    context.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => {
      throw new Error('Invalid token');
    });

    const response = await request(app).post('/api/auth/google').send({
      credential: 'invalid-google-credential',
      email,
      name: 'Untrusted Client Name',
    });

    assert.equal(response.status, 401);
    assert.equal(await User.exists({ email }), null);
  });
});
