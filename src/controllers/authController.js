import {
  listSessions,
  login as authenticateWithPassword,
  register as registerAccount,
  revokeOtherSessions,
  revokeSession,
  signInWithGoogle,
   updateCurrentUser as updateUserSettings,
} from '../services/authService.js';
import ApiResponse from '../utils/ApiResponse.js';

export const register = async (request, response) => {
  const data = await registerAccount(request.body, request);
  response.status(201).json(new ApiResponse(201, data, 'Account registered successfully.'));
};

export const login = async (request, response) => {
  const data = await authenticateWithPassword(request.body, request);
  response.status(200).json(new ApiResponse(200, data, 'Signed in successfully.'));
};

export const googleSignIn = async (request, response) => {
  const data = await signInWithGoogle(
    request.body.credential,
    request,
    request.body.timezone
  );
  response.status(200).json(new ApiResponse(200, data, 'Signed in with Google successfully.'));
};

export const getCurrentUser = async (request, response) => {
  response.status(200).json(
    new ApiResponse(200, { user: request.user.toJSON() }, 'Current user retrieved successfully.')
  );
};

export const logout = async (request, response) => {
  await revokeSession(request.sessionId, request.user._id);
  response.status(200).json(new ApiResponse(200, null, 'Signed out successfully.'));
};

export const getSessions = async (request, response) => {
  const sessions = await listSessions(request.user._id, request.sessionId);
  response.status(200).json(new ApiResponse(200, { sessions }, 'Sessions retrieved successfully.'));
};

export const deleteOtherSessions = async (request, response) => {
  const revokedCount = await revokeOtherSessions(request.user._id, request.sessionId);
  response.status(200).json(
    new ApiResponse(200, { revokedCount }, 'Other sessions revoked successfully.')
  );
};


export const updateCurrentUser = async (request, response) => {
  const user = await updateUserSettings(
    request.user._id,
    request.body
  );

  response.status(200).json(
    new ApiResponse(200, { user }, 'Settings updated successfully.')
  );
};
