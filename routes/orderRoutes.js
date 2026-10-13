import express from 'express';
import { protect, protectAdmin } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validateMiddleware.js'; 
import { createOrderSchema } from '../validators/orderValidator.js'; 
import prisma from '../src/config/db.js';
import {
  initializePaystackPayment,
  verifyPaystackPayment,
  checkPaymentMatchesOrder,
  isValidPaystackSignature,
} from '../services/paystackService.js'; 

const router = express.Router();

// Delivery fee is decided on the server, never taken from the request body
const FLAT_DELIVERY_FEE = Number(process.env.DELIVERY_FEE) || 3000;

// Only the fields the payment-return page needs (no address/phone/user id)
function toPublicOrder(order) {
  return {
    id: order.id,
    totalAmount: order.totalAmount,
    deliveryFee: order.deliveryFee,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentReference: order.paymentReference,
    createdAt: order.createdAt,
  };
}

/**
 * Shared by the webhook and /verify-payment.
 * Takes VERIFIED transaction data from Paystack, finds the matching order,
 * checks reference/amount/currency, then marks it PAID exactly once.
 */
async function settlePaidOrder(transactionData) {
  const reference = transactionData?.reference;
  if (!reference) {
    return { ok: false, status: 400, error: 'Transaction reference is missing.' };
  }

  // 1. Find the order by the reference we saved at checkout
  let order = await prisma.order.findUnique({ where: { paymentReference: reference } });

  // 2. Fallback for orders created before references were saved:
  //    use metadata.orderId, but only for orders with no reference yet.
  if (!order) {
    const metaId = parseInt(transactionData.metadata?.orderId, 10);
    if (Number.isInteger(metaId)) {
      const candidate = await prisma.order.findUnique({ where: { id: metaId } });
      if (candidate && candidate.paymentReference === null) order = candidate;
    }
  }

  if (!order) {
    return { ok: false, status: 404, error: 'No order matches this payment.' };
  }

  // 3. Status, reference, currency and exact amount must all match this order
  const check = checkPaymentMatchesOrder(transactionData, {
    reference,
    amountInNaira: order.totalAmount + order.deliveryFee,
  });
  if (!check.ok) {
    return { ok: false, status: 400, error: check.reason, order };
  }

  if (order.paymentStatus === 'PAID') {
    return { ok: true, order, alreadyPaid: true };
  }

  // 4. Claim the order atomically. If the webhook and the verify route fire at
  //    the same moment, only one of them gets count === 1 and subtracts stock.
  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, paymentStatus: { not: 'PAID' } },
      data: { paymentStatus: 'PAID', status: 'PROCESSING', paymentReference: reference },
    });

    if (claimed.count === 0) return { alreadyPaid: true };

    const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
    for (const item of items) {
      const variant = await tx.variant.update({
        where: { id: item.variantId },
        data: { stock: { decrement: item.quantity } },
        select: { id: true, stock: true },
      });
      if (variant.stock < 0) {
        console.warn(
          `⚠️ OVERSOLD: variant #${variant.id} stock is ${variant.stock} after order #${order.id}. Needs manual follow-up or refund.`
        );
      }
    }

    return { alreadyPaid: false };
  });

  const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
  return { ok: true, order: freshOrder, alreadyPaid: outcome.alreadyPaid };
}

// ==========================================
// 1. PUBLIC WEBHOOKS & CALLBACKS (NO AUTH REQUIRED)
// ==========================================

// @route   POST /api/orders/webhook
// @desc    Secure webhook receiver to catch payment updates straight from Paystack
// @access  Public (Cryptographically verified)
// Needs req.rawBody, which the server file captures for this exact path.
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];

    if (!req.rawBody || !isValidPaystackSignature(req.rawBody, signature)) {
      console.warn('⚠️ Unauthorized or malformed webhook rejected.');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;
    console.log(`📡 Incoming Webhook Event Type Caught: ${event?.event}`);

    if (event?.event === 'charge.success') {
      const result = await settlePaidOrder(event.data);

      if (!result.ok) {
        // Acknowledge anyway so Paystack doesn't retry forever, but log loudly
        console.warn(`⚠️ Webhook could not settle payment (Ref: ${event.data?.reference}): ${result.error}`);
      } else if (result.alreadyPaid) {
        console.log(`ℹ️ Order #${result.order.id} already PAID — no duplicate stock change.`);
      } else {
        console.log(`✅ Order ID #${result.order.id} marked PAID and stock decremented via Webhook sync.`);
      }
    }

    return res.status(200).send('Webhook received');
  } catch (error) {
    console.error('❌ Webhook Processing Error:', error.message);
    // 500 tells Paystack to retry later
    return res.status(500).send('Webhook processing failed');
  }
});

// @route   GET /api/orders/verify-payment
// @desc    Verify Paystack transaction status and return JSON payload to React SPA
// @access  Public (Redirect callback). Safe because it only settles a payment
//          that Paystack confirms for a reference saved on an order, for the exact amount.
router.get('/verify-payment', async (req, res) => {
  try {
    const { reference } = req.query; 

    if (typeof reference !== 'string' || !reference) {
      return res.status(400).json({ 
        success: false, 
        error: 'Transaction reference is missing.' 
      });
    }

    const transactionData = await verifyPaystackPayment(reference);

    if (transactionData?.status !== 'success') {
      return res.status(400).json({
        success: false,
        error: `Gateway verification failed: ${transactionData?.gateway_response || 'Declined'}`
      });
    }

    const result = await settlePaidOrder(transactionData);

    if (!result.ok) {
      console.warn(`⚠️ Verify route rejected payment (Ref: ${reference}): ${result.error}`);
      return res.status(result.status).json({ success: false, error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: result.alreadyPaid
        ? 'Payment verified successfully (already synced).'
        : 'Payment verified and order updated successfully.',
      order: toPublicOrder(result.order)
    });

  } catch (error) {
    console.error('❌ Verification Route Failure:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message || 'An internal server error occurred while validating transaction.'
    });
  }
});

// ==========================================
// 2. CUSTOMER & SHARED PROTECTED ROUTES
// ==========================================

// @route   POST /api/orders
// @desc    Create a new order, calculate totals, and initialize Paystack checkout link
//          (stock is decremented when payment is confirmed, not here)
// @access  Private (Customer/Admin)
router.post('/', protect, validateBody(createOrderSchema), async (req, res, next) => {
  try {
    const { items, shippingAddress, phone } = req.body; 

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Your order has no items.' });
    }

    for (const item of items) {
      if (!Number.isInteger(item.variantId) || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        return res.status(400).json({ success: false, error: 'Each item needs a valid variant and a positive whole quantity.' });
      }
    }

    const newOrder = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const orderItemsToCreate = [];

      for (const item of items) {
        const variant = await tx.variant.findUniqueOrThrow({
          where: { id: item.variantId },
          include: { product: true }
        });

        if (variant.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${variant.product.name} (${variant.color || 'Default'} - Size ${variant.size || 'Default'}). Only ${variant.stock} left.`);
        }

        const itemPrice = variant.product.price;
        totalAmount += itemPrice * item.quantity;

        orderItemsToCreate.push({
          variantId: item.variantId,
          quantity: item.quantity,
          price: itemPrice
        });
      }

      return await tx.order.create({
        data: {
          userId: req.user.id,
          totalAmount,
          deliveryFee: FLAT_DELIVERY_FEE,
          shippingAddress,
          phone, 
          orderItems: {
            create: orderItemsToCreate
          }
        },
        include: {
          orderItems: true
        }
      });
    });

    const customer = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { email: true }
    });

    if (!customer || !customer.email) {
      return res.status(404).json({ 
        success: false, 
        error: "Customer account email could not be resolved." 
      });
    }

    // Combine items subtotal + delivery fee for the Paystack charge
    const grandTotal = newOrder.totalAmount + newOrder.deliveryFee;

    const paymentData = await initializePaystackPayment(
      customer.email,
      grandTotal,
      newOrder.id
    );

    // Save the reference on the order so payments can only settle THIS order
    await prisma.order.update({
      where: { id: newOrder.id },
      data: { paymentReference: paymentData.reference }
    });

    return res.status(201).json({
      success: true,
      message: 'Order created and payment initialized successfully.',
      paymentUrl: paymentData.authorization_url, 
      reference: paymentData.reference,
      order: { ...newOrder, paymentReference: paymentData.reference }
    });

  } catch (error) {
    if (error.message && error.message.includes('Insufficient stock')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    if (error.code === 'P2025') {
      return res.status(400).json({ success: false, error: 'One of the items in your cart is no longer available.' });
    }
    next(error);
  }
});

// @route   GET /api/orders/myorders
// @desc    Get order history for the currently logged-in customer
// @access  Private (Customer/Admin)
router.get('/myorders', protect, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        orderItems: {
          include: {
            variant: {
              include: { product: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json(orders);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 3. ADMIN-ONLY MANAGEMENT ROUTES
// ==========================================

// @route   GET /api/orders
// @desc    Get all orders across all users with pagination and filtering
// @access  Private (Admin Only)
router.get('/', protect, protectAdmin, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const where = status ? { status: status } : {};

    const [orders, totalOrders] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: parseInt(limit, 10),
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true }
          },
          orderItems: {
            include: {
              variant: {
                include: { product: { select: { name: true, image: true, price: true } } }
              }
            }
          }
        }
      }),
      prisma.order.count({ where })
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        totalOrders,
        currentPage: parseInt(page, 10),
        totalPages: Math.ceil(totalOrders / limit)
      },
      data: orders
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/orders/:id
// @desc    Get a single order by ID with full item and user breakdown
// @access  Private (Admin Only)
router.get('/:id', protect, protectAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const orderId = parseInt(id, 10);

    if (isNaN(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID format. Must be an integer.' });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        orderItems: {
          include: {
            variant: {
              include: { product: { select: { name: true, image: true, price: true } } }
            }
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: `Order #${id} not found.` });
    }

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

// @route   PUT /api/orders/:id/status
// @desc    Update order lifecycle status (PENDING -> PROCESSING -> SHIPPED -> DELIVERED -> CANCELLED)
// @access  Private (Admin Only)
router.put('/:id/status', protect, protectAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const orderIdAsInt = parseInt(id, 10);

    if (isNaN(orderIdAsInt)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID format. Must be an integer.' });
    }

    const allowedStatuses = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` 
      });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderIdAsInt },
      data: { status },
      include: {
        orderItems: true
      }
    });

    return res.status(200).json({
      success: true,
      message: `Order ID ${id} status successfully changed to ${status}.`,
      order: updatedOrder
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: `Order with ID ${req.params.id} could not be found.` });
    }
    next(error);
  }
});

// @route   PATCH /api/orders/:id/status
// @desc    Alias route for HTTP PATCH updates from the Admin dashboard
// @access  Private (Admin Only)
router.patch('/:id/status', protect, protectAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const orderIdAsInt = parseInt(id, 10);

    if (isNaN(orderIdAsInt)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid order ID format. Must be an integer.' 
      });
    }

    const allowedStatuses = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` 
      });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderIdAsInt },
      data: { status },
      include: {
        orderItems: true
      }
    });

    return res.status(200).json({
      success: true,
      message: `Order ID ${id} status successfully changed to ${status}.`,
      order: updatedOrder
    });

  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        error: `Order with ID ${req.params.id} could not be found.` 
      });
    }
    next(error);
  }
});

export default router;