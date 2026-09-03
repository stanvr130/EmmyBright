import 'dotenv/config';

const PAYSTACK_API_URL = 'https://api.paystack.co';
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

/**
 * Initializes a payment transaction with Paystack
 * @param {string} email - The customer's email address
 * @param {number} amountInNaira - The total amount to charge (in Naira, including items + delivery)
 * @param {number} orderId - The corresponding database Order ID
 * @returns {Promise<Object>} - Contains checkout authorization_url and reference
 */
export const initializePaystackPayment = async (email, amountInNaira, orderId) => {
  try {
    // Paystack expects amounts in KOBO (lowest currency unit). 
    // Multiply totalAmount by 100
    const amountInKobo = Math.round(amountInNaira * 100);

    // Dynamic Client URL (defaults to Vite's standard local dev port 5173)
    const CLIENT_FRONTEND_URL = process.env.CLIENT_URL || 'http://localhost:5173';

    const response = await fetch(`${PAYSTACK_API_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountInKobo,
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
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
      },
    });

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