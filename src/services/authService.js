import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import ApiError from '../utils/ApiError.js';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { initializeUserTimeZone } from '../utils/timezone.js';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_SALT_ROUNDS = 12;

const issueSession = async (user, request) => {
  const token = randomBytes(32).toString('base64url');
  await Session.create({
    userId: user._id,
    token,
    userAgent: request.get('user-agent')?.slice(0, 512) || 'Unknown',
    ipAddress: request.ip || 'Unknown',
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
  });

  return token;
};

const authenticate = async (user, request) => {
  const token = await issueSession(user, request);
  return { user: user.toJSON(), token };
};

export const register = async ({ name, email, password, timezone }, request) => {
  if (await User.exists({ email })) {
    throw new ApiError(409, 'An account with this email already exists.');
  }

  const hashedPassword = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    ...(timezone ? { timezone, timezoneConfigured: true } : {}),
  });

  return authenticate(user, request);
};

export const login = async ({ email, password, timezone }, request) => {
  const user = await User.findOne({ email }).select('+password');
  const passwordMatches = user?.password && await bcrypt.compare(password, user.password);

  if (!passwordMatches) {
    throw new ApiError(401, 'Email or password is incorrect.');
  }

  await initializeUserTimeZone(user, timezone);
  return authenticate(user, request);
};

const verifyGoogleCredential = async (credential) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new ApiError(503, 'Google Sign-In is not configured.');
  }

  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified !== true || !payload.name) {
      throw new ApiError(401, 'Google did not provide a verified account profile.');
    }

    return {
      googleId: payload.sub,
      name: payload.name,
      email: payload.email,
      avatar: payload.picture || null,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(401, 'Google credential is invalid or expired.');
  }
};

export const signInWithGoogle = async (credential, request, timezone) => {
  const profile = await verifyGoogleCredential(credential);
  const email = profile.email.trim().toLowerCase();
  let user = await User.findOne({ googleId: profile.googleId });

  if (!user) {
    user = await User.findOne({ email });
    if (user?.googleId && user.googleId !== profile.googleId) {
      throw new ApiError(409, 'This email is already linked to another Google account.');
    }

    if (user) {
      user.googleId = profile.googleId;
      if (profile.avatar) {
        user.avatar = profile.avatar;
      }
      await user.save();
    } else {
      user = await User.create({
        name: profile.name,
        email,
        googleId: profile.googleId,
        avatar: profile.avatar,
        ...(timezone ? { timezone, timezoneConfigured: true } : {}),
      });
    }
  }

  await initializeUserTimeZone(user, timezone);
  return authenticate(user, request);
};

export const listSessions = async (userId, currentSessionId) => {
  const now = new Date();
  const sessions = await Session.find({
    userId,
    expiresAt: { $gt: now },
  })
    .select('_id userAgent ipAddress createdAt expiresAt')
    .sort({ createdAt: -1 })
    .lean();

  return sessions.map(({ _id, ...session }) => ({
    ...session,
    current: _id.equals(currentSessionId),
  }));
};

export const revokeOtherSessions = async (userId, currentSessionId) => {
  const result = await Session.deleteMany({
    userId,
    _id: { $ne: currentSessionId },
  });
  return result.deletedCount;
};

export const revokeSession = async (sessionId, userId) => {
  await Session.deleteOne({ _id: sessionId, userId });
};

export const updateCurrentUser = async (userId, input) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  Object.assign(user, input);

  // An explicitly selected timezone should not be replaced by automatic detection.
  if (input.timezone !== undefined) {
    user.timezoneConfigured = true;
  }

  await user.save();

  return user.toJSON();
};