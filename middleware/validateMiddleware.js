// middleware/validateMiddleware.js
export const validateBody = (schema) => {
  return (req, res, next) => {
    // 🔄 FIX: Destructure BOTH error and value from Joi
    const { error, value } = schema.validate(req.body, { 
      abortEarly: false, 
      stripUnknown: true 
    });

    if (error) {
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        errors: errorMessages
      });
    }

    // 🔄 FIX: Assign the sanitized value directly to req.body
    req.body = value; 
    next();
  };
};