
// Wraps an async route handler to forward errors to Express error middleware.
// requestHandler is the controller function passed in, such as login.
// It receives request, response, and next, and its Promise is monitored for errors.
const asyncHandler = (requestHandler) => (request, response, next) => {
  Promise.resolve(requestHandler(request, response, next)).catch(next);
};

export default asyncHandler;
