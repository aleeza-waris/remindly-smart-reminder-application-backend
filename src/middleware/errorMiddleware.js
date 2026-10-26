import mongoose from 'mongoose';
import { ZodError } from 'zod';
import ApiError from '../utils/ApiError.js';

const safeErrorContext = (error) => {
  const code = error?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code)
    ? ` (code=${code})`
    : '';
};

const errorMiddleware = (error, _request, response, next) => {
  if (response.headersSent) {
    return next(error);
  }

  let statusCode = 500;
  let message = 'An unexpected error occurred.';
  let errors = [];

  if (error instanceof ApiError) {
    statusCode = error.statusCode;
    message = error.message;
    errors = error.errors;
  } else if (error instanceof ZodError) {
    statusCode = 400;
    message = 'Request validation failed.';
    errors = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (error?.code === 11000) {
    statusCode = 409;
    message = 'An account with this email already exists.';
  } else if (error instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = 'The request contains an invalid value.';
  } else {
    console.error(`API request failed: ${error?.name || 'UnknownError'}${safeErrorContext(error)}`);
  }

  response.status(statusCode).json({
    statusCode,
    success: false,
    message,
    data: null,
    errors,
    ...(process.env.NODE_ENV === 'production' ? {} : { stack: error?.stack }),
  });
};

export default errorMiddleware;
