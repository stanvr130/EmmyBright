import 'dotenv/config';
import crypto from 'crypto';

const PAYSTACK_API_URL = 'https://api.paystack.co';
const REQUEST_TIMEOUT_MS = 15000;

function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error('PAYSTACK_SECRET_KEY is not set on the server.');
  }
  return key;
}

/**
 * Initializes a payment transaction with Paystack
 * @param {string} email - The customer's email address
 * @param {number} amountInNaira - The total amount to charge (in Naira, including items + delivery)
 * @param {number} orderId - The corresponding database Order ID
 * @returns {Promise<Object>} - Contains checkout authorization_url, access_code and reference
 */
export const initializePaystackPayment = async (email, amountInNaira, orderId) => {
  try {
    // Paystack expects amounts in KOBO (lowest currency unit).
    const amountInKobo = Math.round(amountInNaira * 100);

    if (!Number.isInteger(amountInKobo) || amountInKobo <= 0) {
      throw new Error('Invalid payment amount.');
    }

    // Dynamic Client URL (defaults to Vite's standard local dev port 5173)
    const CLIENT_FRONTEND_URL = process.env.CLIENT_URL || 'http://localhost:5173';

    const response = await fetch(`${PAYSTACK_API_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        currency: 'NGN',
        reference: `order_${orderId}_${Date.now()}`, // Unique transaction identifier
        callback_url: `${CLIENT_FRONTEND_URL}/account?payment_verify=true&order_id=${orderId}`, // Redirect back to React SPA
        metadata: {
          orderId: orderId, // Pass the order ID so record can be updated later
        }
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.status) {
      throw new Error(result.message || 'Paystack initialization failed.');
    }

    return result.data;

  } catch (error) {
    console.error('❌ Paystack Service Error:', error.message);
    throw new Error(`Payment processing failed: ${error.message}`);
  }
};

/**
 * Verifies a transaction status with Paystack using its unique reference string
 * @param {string} reference - The transaction reference to check
 * @returns {Promise<Object>} - The verified transaction data payload
 */
export const verifyPaystackPayment = async (reference) => {
  try {
    if (typeof reference !== 'string' || !reference) {
      throw new Error('A payment reference is required.');
    }

    const response = await fetch(
      `${PAYSTACK_API_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${getSecretKey()}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    // 1. Get the raw response text first
    const responseText = await response.text();

    // 2. Safely check if response body is completely empty
    if (!responseText) {
      throw new Error('Paystack returned an empty response.');
    }

    // 3. Attempt to parse as JSON safely
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error('Paystack response was not valid JSON.');
    }

    if (!response.ok || !result.status) {
      throw new Error(result.message || 'Paystack transaction verification failed.');
    }

    return result.data;
  } catch (error) {
    console.error('❌ Paystack Verification Service Error:', error.message);
    throw new Error(`Verification failed: ${error.message}`);
  }
};

/**
 * Checks a verified Paystack transaction against YOUR order before you mark it paid.
 * Call this with the data returned by verifyPaystackPayment.
 *
 * @param {Object} data - The verified transaction data from Paystack
 * @param {Object} expected
 * @param {string} expected.reference - The reference stored on your Order (paymentReference)
 * @param {number} expected.amountInNaira - The order total you expect to have been paid
 * @returns {{ ok: boolean, reason?: string }}
 */
export const checkPaymentMatchesOrder = (data, { reference, amountInNaira }) => {
  if (!data) return { ok: false, reason: 'No transaction data.' };
  if (data.status !== 'success') return { ok: false, reason: `Payment status is "${data.status}".` };
  if (data.reference !== reference) return { ok: false, reason: 'Reference does not match this order.' };
  if (data.currency && data.currency !== 'NGN') return { ok: false, reason: 'Unexpected currency.' };

  const expectedKobo = Math.round(amountInNaira * 100);
  if (data.amount !== expectedKobo) {
    return { ok: false, reason: 'Amount paid does not match the order total.' };
  }

  return { ok: true };
};

/**
 * Verifies that a webhook request really came from Paystack.
 * Paystack signs the RAW request body with your secret key (HMAC SHA512)
 * and sends the result in the x-paystack-signature header.
 *
 * @param {Buffer|string} rawBody - The exact raw body, not re-serialized JSON
 * @param {string} signature - The x-paystack-signature header value
 * @returns {boolean}
 */
export const isValidPaystackSignature = (rawBody, signature) => {
  if (!rawBody || !signature) return false;

  const expected = crypto
    .createHmac('sha512', getSecretKey())
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');

  return a.length === b.length && crypto.timingSafeEqual(a, b);
};