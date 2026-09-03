// middleware/errorMiddleware.js

const errorHandler = (err, req, res, next) => {
  // Log the full error to your server console for debugging
  console.error('❌ Global Error Handler Caught:', err);

  // 1. Identify common Prisma errors and assign clean statuses/messages
  let statusCode = err.statusCode || 500;
  let message = err.message || 'An unexpected server error occurred.';

  // Prisma Error: Record Not Found
  if (err.code === 'P2025') {
    statusCode = 404;
    message = 'The requested database record could not be found.';
  }
  
  // Prisma Error: Unique constraint violation (e.g., duplicate email/slug)
  if (err.code === 'P2002') {
    statusCode = 400;
    message = `A record with that unique field already exists. Duplicate field: ${err.meta?.target}`;
  }

  // 2. Send a unified response structure back to the client
  return res.status(statusCode).json({
    success: false,
    error: message,
    // Hide the ugly details if you are in production mode
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

export default errorHandler;