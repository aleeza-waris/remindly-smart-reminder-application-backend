import Session from '../models/Session.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { initializeUserTimeZone } from '../utils/timezone.js';

const authMiddleware = asyncHandler(async (request, _response, next) => {
  const authorization = request.get('authorization');
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i); // The regex pattern matches a string that starts with "Bearer " followed by a token consisting of 43 characters, which can include uppercase and lowercase letters, digits, underscores, and hyphens. This pattern is commonly used for validating JWT tokens or similar authentication tokens.

  if (!match) {
    throw new ApiError(401, 'Authentication is required.');
  }

  const token = match[1];
  const session = await Session.findOne({
    token,
    expiresAt: { $gt: new Date() },
  }).select('+token');

  if (!session) {
    throw new ApiError(401, 'The session is invalid or has expired.');
  }

  const user = await User.findById(session.userId);
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    throw new ApiError(401, 'The session is invalid or has expired.');
  }

  await initializeUserTimeZone(user, request.get('x-timezone'));
  request.user = user;
  request.session = session;
  request.sessionId = session._id;
  next();
});

export default authMiddleware;
