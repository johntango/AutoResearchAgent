import { logger } from '../utils/logger.js';

export const errorHandler = (error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  logger.error('http.error', { statusCode, message: error.message, stack: error.stack });
  res.status(statusCode).json({
    error: {
      message: error.message || 'Unexpected server error.',
      statusCode,
    },
  });
};
