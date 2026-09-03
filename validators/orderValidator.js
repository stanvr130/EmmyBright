import Joi from 'joi';

// Normalizes Nigerian phone numbers to E.164 format (+234XXXXXXXXXX)
function normalizeNigerianPhone(value, helpers) {
  let digits = value.replace(/[\s\-()]/g, ''); // strip spaces, dashes, parens

  if (digits.startsWith('+234')) {
    // already in correct international format
  } else if (digits.startsWith('234')) {
    digits = `+${digits}`;
  } else if (digits.startsWith('0')) {
    digits = `+234${digits.slice(1)}`;
  } else if (/^[789]\d{9}$/.test(digits)) {
    // bare 10-digit number without leading 0, e.g. 8012345678
    digits = `+234${digits}`;
  }

  if (!/^\+234[789]\d{9}$/.test(digits)) {
    return helpers.error('string.pattern.base');
  }

  return digits; // sanitized value Joi passes downstream
}

export const createOrderSchema = Joi.object({
  shippingAddress: Joi.string()
    .trim()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.empty': 'Shipping address cannot be empty.',
      'string.min': 'Please provide a complete shipping address (minimum 10 characters).',
      'any.required': 'Shipping address is required.'
    }),

  phone: Joi.string()
    .trim()
    .custom(normalizeNigerianPhone, 'Nigerian phone normalization')
    .required()
    .messages({
      'string.empty': 'Phone number cannot be empty.',
      'string.pattern.base': 'Please provide a valid Nigerian phone number (e.g., 08012345678 or +2348012345678).',
      'any.required': 'Contact phone number is required.'
    }),

  deliveryFee: Joi.number()
    .min(0)
    .default(3000)
    .messages({
      'number.base': 'Delivery fee must be a number.',
      'number.min': 'Delivery fee cannot be negative.'
    }),

  items: Joi.array()
    .items(
      Joi.object({
        variantId: Joi.number()
          .integer()
          .positive()
          .required()
          .messages({
            'number.base': 'Variant ID must be a number.',
            'number.positive': 'Invalid variant identifier.',
            'any.required': 'Variant ID is required.'
          }),
        quantity: Joi.number()
          .integer()
          .min(1) // Block malicious 0 or negative items completely
          .required()
          .messages({
            'number.base': 'Quantity must be a number.',
            'number.min': 'Quantity must be at least 1 item.',
            'any.required': 'Quantity is required.'
          })
      })
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'Your shopping cart cannot be empty.',
      'any.required': 'Order items are required.'
    })
});