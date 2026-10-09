const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function validateEmail(req, res, next) {
  const email = req.body?.email;

  if (typeof email !== 'string' || email.length > 254 || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({
      success: false,
      error: 'A valid email address is required',
      message: 'A valid email address is required'
    });
  }

  // Trim only. Lowercasing here could stop matching existing accounts
  // that were saved with mixed-case emails.
  req.body.email = email.trim();
  next();
}