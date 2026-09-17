import express from 'express';
import crypto from 'crypto'; 
import { protect, protectAdmin } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validateMiddleware.js'; 
import { createOrderSchema } from '../validators/orderValidator.js'; 
import prisma from '../src/config/db.js';
import { initializePaystackPayment, verifyPaystackPayment } from '../services/paystackService.js'; 

const router = express.Router();

// ==========================================
// 1. PUBLIC WEBHOOKS & CALLBACKS (NO AUTH REQUIRED)
// ==========================================

// @route   POST /api/orders/webhook
// @desc    Secure webhook receiver to catch payment updates straight from Paystack
// @access  Public (Cryptographically verified)
router.post('/webhook', express.text({ type: '*/*' }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    let rawPayload = req.body;

    if (typeof rawPayload === 'object') {
      rawPayload = JSON.stringify(req.body);
    }

    if (!rawPayload) {
      console.warn('⚠️ Webhook received an empty body stream.');
      return res.status(400).send('Empty body');
    }
    
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawPayload) 
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('⚠️ Unauthorized webhook signature detected!');
      return res.status(401).send('Invalid signature');
    }

    // Acknowledge Paystack receipt immediately
    res.status(200).send('Webhook received');

    const event = typeof req.body === 'object' ? req.body : JSON.parse(rawPayload);

    console.log(`📡 Incoming Webhook Event Type Caught: ${event.event}`);

   if (event.event === 'charge.success') {
  const transactionData = event.data;
  const orderId = transactionData.metadata?.orderId;
  const reference = transactionData.reference;

  if (!orderId) {
    console.warn(`⚠️ Paystack Webhook missing orderId in metadata (Ref: ${reference})`);
    return;
  }

  const numericOrderId = parseInt(orderId, 10);

  const existingOrder = await prisma.order.findUnique({
    where: { id: numericOrderId },
    include: { orderItems: true }
  });

  if (!existingOrder) {
    console.warn(`⚠️ Webhook: Order #${numericOrderId} not found (Ref: ${reference})`);
    return;
  }

  // Idempotency guard — never decrement stock twice for the same order,
  // in case both the webhook and /verify-payment fire for it.
  if (existingOrder.paymentStatus === 'PAID') {
    console.log(`ℹ️ Order #${numericOrderId} already marked PAID — skipping duplicate stock decrement.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const orderItem of existingOrder.orderItems) {
      await tx.variant.update({
        where: { id: orderItem.variantId },
        data: { stock: { decrement: orderItem.quantity } }
      });
    }

    await tx.order.update({
      where: { id: numericOrderId },
      data: {
        paymentStatus: 'PAID',
        status: 'PROCESSING',
        paymentReference: reference
      }
    });
  });

  console.log(`✅ Order ID #${numericOrderId} marked PAID and stock decremented via Webhook sync.`);
}
  } catch (error) {
    console.error('❌ Webhook Processing Error:', error.message);
  }
});

// @route   GET /api/orders/verify-payment
// @desc    Verify Paystack transaction status and return JSON payload to React SPA
// @access  Public (Redirect callback)
router.get('/verify-payment', async (req, res, next) => {
  try {
    const { reference } = req.query; 

    if (!reference) {
      return res.status(400).json({ 
        success: false, 
        error: 'Transaction reference is missing.' 
      });
    }

    const transactionData = await verifyPaystackPayment(reference);

    if (transactionData && transactionData.status === 'success') {
      const orderId = transactionData.metadata?.orderId || reference.split('_')[1];

      if (!orderId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Order metadata not found on payment verification.' 
        });
      }

      const numericOrderId = parseInt(orderId, 10);

      const existingOrder = await prisma.order.findUnique({
        where: { id: numericOrderId }
      });

      if (!existingOrder) {
        return res.status(404).json({
          success: false,
          error: `Associated Order #${numericOrderId} could not be found.`
        });
      }

      // Idempotency: Return success if already marked as PAID (e.g. via Webhook)
      if (existingOrder.paymentStatus === 'PAID') {
        return res.status(200).json({
          success: true,
          message: 'Payment verified successfully (already synced).',
          order: existingOrder
        });
      }

      // Update Order in Prisma DB
     // Fetch order items so we know which variants to decrement
const orderWithItems = await prisma.order.findUnique({
  where: { id: numericOrderId },
  include: { orderItems: true }
});

const updatedOrder = await prisma.$transaction(async (tx) => {
  for (const orderItem of orderWithItems.orderItems) {
    await tx.variant.update({
      where: { id: orderItem.variantId },
      data: { stock: { decrement: orderItem.quantity } }
    });
  }

  return tx.order.update({
    where: { id: numericOrderId },
    data: {
      paymentStatus: 'PAID',
      status: 'PROCESSING',
      paymentReference: reference
    }
  });
});

      return res.status(200).json({
        success: true,
        message: 'Payment verified and order updated successfully.',
        order: updatedOrder
      });

    } else {
      return res.status(400).json({
        success: false,
        error: `Gateway verification failed: ${transactionData?.gateway_response || 'Declined'}`
      });
    }

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
// @desc    Create a new order, calculate totals, decrement variant stock, and initialize Paystack checkout link
// @access  Private (Customer/Admin)
router.post('/', protect, validateBody(createOrderSchema), async (req, res, next) => {
  try {
    const { items, shippingAddress, phone, deliveryFee = 3000 } = req.body; 

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
          deliveryFee: parseFloat(deliveryFee),
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

    return res.status(201).json({
      success: true,
      message: 'Order created and payment initialized successfully.',
      paymentUrl: paymentData.authorization_url, 
      reference: paymentData.reference,
      order: newOrder
    });

  } catch (error) {
    if (error.message && error.message.includes('Insufficient stock')) {
      return res.status(400).json({ success: false, error: error.message });
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