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
  //
  // 🔄 FIX: err.meta.target is not always a string. Depending on the Prisma
  // version and whether the violated constraint maps cleanly to a known
  // model field, it can be an array (e.g. ['name']), a plain string, or
  // sometimes missing entirely (err.meta.target === undefined) — which is
  // what was previously rendering as the literal text "undefined" in the
  // error message. This now handles all three cases and never surfaces
  // raw Prisma internals to the client.
  if (err.code === 'P2002') {
    statusCode = 400;

    let fieldName = null;
    if (Array.isArray(err.meta?.target)) {
      fieldName = err.meta.target[0];
    } else if (typeof err.meta?.target === 'string') {
      fieldName = err.meta.target;
    }

    message = fieldName
      ? `A record with that ${fieldName} already exists. Please use a different ${fieldName}.`
      : 'A record with one of these unique values already exists.';
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