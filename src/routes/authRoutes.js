import { Router } from 'express';
import {
  deleteOtherSessions,
  getCurrentUser,
  getSessions,
  googleSignIn,
  login,
  logout,
  register,
  updateCurrentUser,
} from '../controllers/authController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import asyncHandler from '../utils/asyncHandler.js';
import { googleAuthSchema, loginSchema, registerSchema,  updateCurrentUserSchema, } from '../validators/authValidator.js';

const router = Router();

const validateBody = (schema) => (request, _response, next) => {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    return next(result.error);
  }
  request.body = result.data;
  next();
};

router.post('/register', validateBody(registerSchema), asyncHandler(register));
router.post('/login', validateBody(loginSchema), asyncHandler(login));
router.post('/google', validateBody(googleAuthSchema), asyncHandler(googleSignIn));
router.get('/me', authMiddleware, asyncHandler(getCurrentUser));
router.patch(
  '/me',
  authMiddleware,
  validateBody(updateCurrentUserSchema),
  asyncHandler(updateCurrentUser)
);
router.post('/logout', authMiddleware, asyncHandler(logout));
router.get('/sessions', authMiddleware, asyncHandler(getSessions));
router.delete('/sessions', authMiddleware, asyncHandler(deleteOtherSessions));

export default router;
