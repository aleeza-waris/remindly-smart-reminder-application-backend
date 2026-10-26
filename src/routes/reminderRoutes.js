import { Router } from 'express';
import {
  complete,
  create,
  getById,
  list,
  remove,
  stats,
  update,
} from '../controllers/reminderController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  completeReminderSchema,
  createReminderSchema,
  listRemindersSchema,
  reminderIdSchema,
  updateReminderSchema,
} from '../validators/reminderValidator.js';

const router = Router();

const validateBody = (schema) => (request, _response, next) => {
  const result = schema.safeParse(request.body);
  if (!result.success) return next(result.error);
  request.body = result.data;
  next();
};

const validateReminderId = (request, _response, next) => {
  const result = reminderIdSchema.safeParse(request.params.id);
  if (!result.success) return next(result.error);
  next();
};

const validateListQuery = (request, _response, next) => {
  const result = listRemindersSchema.safeParse(request.query);
  if (!result.success) return next(result.error);
  request.validatedQuery = result.data;
  next();
};

router.use(authMiddleware);
router.get('/stats', asyncHandler(stats));
router.get('/', validateListQuery, asyncHandler(list));
router.post('/', validateBody(createReminderSchema), asyncHandler(create));
router.get('/:id', validateReminderId, asyncHandler(getById));
router.put('/:id', validateReminderId, validateBody(updateReminderSchema), asyncHandler(update));
router.delete('/:id', validateReminderId, asyncHandler(remove));
router.patch(
  '/:id/complete',
  validateReminderId,
  validateBody(completeReminderSchema),
  asyncHandler(complete)
);

export default router;
