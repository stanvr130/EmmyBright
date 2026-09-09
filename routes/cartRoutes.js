import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import prisma from '../src/config/db.js';

const router = express.Router();

// GET /api/cart — fetch the logged-in user's saved cart
router.get('/cart', protect, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { cartData: true }
    });
    return res.status(200).json({ success: true, cartItems: user?.cartData || [] });
  } catch (error) {
    next(error);
  }
});

// POST /api/cart — save/overwrite the logged-in user's cart
router.post('/cart', protect, async (req, res, next) => {
  try {
    const { cartItems } = req.body;
    await prisma.user.update({
      where: { id: req.user.id },
      data: { cartData: cartItems ?? [] }
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/delivery — fetch the logged-in user's saved delivery preferences
router.get('/delivery', protect, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { deliveryData: true }
    });
    return res.status(200).json({ success: true, deliveryData: user?.deliveryData || null });
  } catch (error) {
    next(error);
  }
});

// POST /api/delivery — save/overwrite the logged-in user's delivery preferences
router.post('/delivery', protect, async (req, res, next) => {
  try {
    const { deliveryData } = req.body;
    await prisma.user.update({
      where: { id: req.user.id },
      data: { deliveryData: deliveryData ?? null }
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;