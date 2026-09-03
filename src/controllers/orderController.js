import prisma from '../src/config/db.js';
import axios from 'axios';

// 📋 1. Get All Orders (Admin Only)
export const getAllOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const where = status ? { status: status.toUpperCase() } : {};

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
          orderItems: { // Correct relation name in Prisma schema
            include: {
              variant: {
                include: {
                  product: { select: { name: true, image: true, price: true } }
                }
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
};

// 🔍 2. Get Single Order by ID
export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const orderId = parseInt(id, 10);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        orderItems: {
          include: {
            variant: {
              include: {
                product: { select: { name: true, image: true, price: true } }
              }
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
};

// 🔄 3. Update Order Fulfillment Status
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const orderId = parseInt(id, 10);

    const validStatuses = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { status: status.toUpperCase() },
      include: {
        user: { select: { name: true, email: true } }
      }
    });

    return res.status(200).json({
      success: true,
      message: `Order #${id} status updated to ${updatedOrder.status}`,
      data: updatedOrder
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: `Order #${req.params.id} does not exist.` });
    }
    next(error);
  }
};

// 🛒 4. Create New Order & Initialize Payment (With Delivery Fee)
export const createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, phone } = req.body;
    const userId = req.user.id;

    const DELIVERY_FEE = 3000;

    // 1. Calculate items subtotal and build items array
    let itemsSubtotal = 0;
    const orderItemsData = [];

    for (const item of items) {
      const variant = await prisma.variant.findUnique({
        where: { id: item.variantId },
        include: { product: true }
      });

      if (!variant) {
        return res.status(404).json({ success: false, message: `Variant #${item.variantId} not found.` });
      }

      const itemPrice = Number(variant.product.price);
      itemsSubtotal += itemPrice * item.quantity;

      orderItemsData.push({
        variantId: item.variantId,
        quantity: item.quantity,
        price: itemPrice
      });
    }

    // 2. Add delivery fee to compute Grand Total
    const grandTotal = itemsSubtotal + DELIVERY_FEE;

    // 3. Create Order record in database via Prisma
    const newOrder = await prisma.order.create({
      data: {
        userId,
        totalAmount: grandTotal,       // Grand Total (Subtotal + Delivery Fee)
        deliveryFee: DELIVERY_FEE,     // Explicit delivery fee field
        shippingAddress,
        phone,
        paymentStatus: 'UNPAID',
        status: 'PENDING',
        orderItems: {
          create: orderItemsData
        }
      }
    });

    // 4. Initialize Paystack transaction with full Grand Total (converted to Kobo)
    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: req.user.email,
        amount: Math.round(grandTotal * 100), // Kobo conversion
        callback_url: `${process.env.FRONTEND_URL}/account?payment_verify=true`,
        metadata: {
          orderId: newOrder.id,
          userId: userId
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(201).json({
      success: true,
      data: {
        order: newOrder,
        authorization_url: paystackResponse.data.data.authorization_url,
        reference: paystackResponse.data.data.reference
      }
    });
  } catch (error) {
    next(error);
  }
};