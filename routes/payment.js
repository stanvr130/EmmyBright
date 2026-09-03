import express from 'express';
import axios from 'axios';
import https from 'https';
import prisma from '../src/config/db.js';

const router = express.Router();

// ⚡ Dedicated Paystack Axios Client (Handles Keep-Alive and Timeouts)
const paystackClient = axios.create({
  baseURL: 'https://api.paystack.co',
  timeout: 10000, // 10-second request safeguard
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  },
  // Re-uses TCP sockets to prevent Cloudflare/Windows socket drops
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: true })
});

// POST /api/payments/verify
router.post('/verify', async (req, res) => {
  try {
    const { reference, cartItems, shippingAddress, phone } = req.body;

    if (!reference || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid payload processing data.' });
    }

    // 1. Handshake verification request directly with Paystack via persistent client
    const paystackResponse = await paystackClient.get(`/transaction/verify/${reference}`);
    const { status, data } = paystackResponse.data;

    if (status && data.status === 'success') {
      
      // 2. Server-side price verification
      let calculatedTotal = 0;
      cartItems.forEach(item => {
        calculatedTotal += Number(item.price) * Number(item.quantity);
      });

      const amountPaidInNaira = data.amount / 100;

      if (amountPaidInNaira < calculatedTotal) {
        return res.status(400).json({ 
          success: false, 
          message: 'Security Alert: Payment amount discrepancy caught.' 
        });
      }

      // 3. User Lookup
      const customerEmail = data.customer.email;
      let userRecord = await prisma.user.findUnique({
        where: { email: customerEmail }
      });

      if (!userRecord) {
        return res.status(404).json({ success: false, message: 'User account not found for payment owner.' });
      }

      // 4. Atomic database commit — uses uppercase enum values to match schema.prisma's
      //    OrderStatus / PaymentStatus enums (PENDING/PROCESSING/... and UNPAID/PAID/...)
      const completedOrder = await prisma.$transaction(async (tx) => {
        
        const newOrder = await tx.order.create({
          data: {
            userId: userRecord.id,
            totalAmount: amountPaidInNaira,
            status: "PROCESSING",
            paymentStatus: "PAID",
            paymentReference: reference,
            shippingAddress: shippingAddress || "No address provided", 
            phone: phone || userRecord.phone || null
          }
        });

        // Write order items mapping to variants
        for (const item of cartItems) {
          let targetVariantId = Number(item.variantId || item.selectedVariantId);

          // Check if variant exists
          let variantExists = null;
          if (targetVariantId) {
            variantExists = await tx.variant.findUnique({ where: { id: targetVariantId } });
          }

          // Fallback to default variant if item only supplied base product ID
          if (!variantExists) {
            const baseProductId = Number(item.id || item.productId || item._id);
            const defaultVariant = await tx.variant.findFirst({
              where: { productId: baseProductId }
            });

            if (defaultVariant) {
              targetVariantId = defaultVariant.id;
            } else {
              // Auto-create a default variant if none exists so order NEVER fails
              const createdVariant = await tx.variant.create({
                data: {
                  productId: baseProductId,
                  price: Number(item.price),
                  stock: 999
                }
              });
              targetVariantId = createdVariant.id;
            }
          }

          await tx.orderItem.create({
            data: {
              orderId: newOrder.id,
              variantId: targetVariantId,
              quantity: Number(item.quantity),
              price: Number(item.price)
            }
          });
        }

        return newOrder;
      });

      return res.json({ 
        success: true, 
        message: 'Payment verified and relational order logs committed successfully.', 
        order: completedOrder 
      });

    } else {
      return res.status(400).json({ success: false, message: 'Transaction unapproved by provider platform.' });
    }

  } catch (error) {
    console.error('Paystack Gateway Error Code:', error.code);
    console.error('Paystack Gateway Message:', error.message);

    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ success: false, message: 'Paystack connection timed out. Please try again.' });
    }

    return res.status(500).json({ success: false, message: 'Internal payment gateway network failure.' });
  }
});

export default router;