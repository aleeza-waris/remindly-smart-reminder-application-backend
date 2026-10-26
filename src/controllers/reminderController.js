import {
  createReminder,
  deleteReminder,
  getReminder,
  getReminderStats,
  listReminders,
  setReminderCompletion,
  updateReminder,
} from '../services/reminderService.js';
import ApiResponse from '../utils/ApiResponse.js';

export const list = async (request, response) => {
  const result = await listReminders(request.user._id, request.validatedQuery);
  response.status(200).json(new ApiResponse(200, result, 'Reminders retrieved successfully.'));
};

export const create = async (request, response) => {
  const reminder = await createReminder(request.body, request.user._id);
  response.status(201).json(new ApiResponse(201, { reminder }, 'Reminder created successfully.'));
};

export const getById = async (request, response) => {
  const reminder = await getReminder(request.params.id, request.user._id);
  response.status(200).json(new ApiResponse(200, { reminder }, 'Reminder retrieved successfully.'));
};

export const update = async (request, response) => {
  const reminder = await updateReminder(request.params.id, request.user._id, request.body);
  response.status(200).json(new ApiResponse(200, { reminder }, 'Reminder updated successfully.'));
};

export const remove = async (request, response) => {
  await deleteReminder(request.params.id, request.user._id);
  response.status(200).json(new ApiResponse(200, null, 'Reminder deleted successfully.'));
};

export const complete = async (request, response) => {
  const reminder = await setReminderCompletion(
    request.params.id,
    request.user._id,
    request.body.completed
  );
  response.status(200).json(new ApiResponse(200, { reminder }, 'Reminder status updated successfully.'));
};

export const stats = async (request, response) => {
  const result = await getReminderStats(request.user._id);
  response.status(200).json(new ApiResponse(200, result, 'Reminder statistics retrieved successfully.'));
};
