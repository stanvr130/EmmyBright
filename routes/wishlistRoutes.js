import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import prisma from '../src/config/db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Wishlist
 *     description: Save and manage a customer's wishlisted products
 */

/**
 * @swagger
 * /api/wishlist:
 *   get:
 *     summary: Get the logged-in user's wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of wishlisted products
 */
router.get('/', protect, async (req, res, next) => {
  try {
    const wishlistEntries = await prisma.wishlist.findMany({
      where: { userId: req.user.id },
      include: {
        product: {
          include: { variants: true, categoryRef: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const products = wishlistEntries.map(entry => entry.product);

    return res.status(200).json(products);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/wishlist:
 *   post:
 *     summary: Add a product to the logged-in user's wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId]
 *             properties:
 *               productId:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Product added to wishlist
 *       400:
 *         description: Missing or invalid productId
 *       404:
 *         description: Product does not exist
 *       409:
 *         description: Product already in wishlist
 */
router.post('/', protect, async (req, res, next) => {
  try {
    const { productId } = req.body;
    const productIdAsInt = parseInt(productId, 10);

    if (!productId || isNaN(productIdAsInt)) {
      return res.status(400).json({ success: false, error: 'A valid productId is required.' });
    }

    const productExists = await prisma.product.findUnique({ where: { id: productIdAsInt } });
    if (!productExists) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    const existingEntry = await prisma.wishlist.findUnique({
      where: {
        userId_productId: {
          userId: req.user.id,
          productId: productIdAsInt
        }
      }
    });

    if (existingEntry) {
      return res.status(409).json({ success: false, error: 'Product is already in your wishlist.' });
    }

    await prisma.wishlist.create({
      data: {
        userId: req.user.id,
        productId: productIdAsInt
      }
    });

    return res.status(201).json({ success: true, message: 'Product added to wishlist.' });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/wishlist/{productId}:
 *   delete:
 *     summary: Remove a product from the logged-in user's wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Product removed from wishlist
 *       404:
 *         description: Product was not in the wishlist
 */
router.delete('/:productId', protect, async (req, res, next) => {
  try {
    const productIdAsInt = parseInt(req.params.productId, 10);

    if (isNaN(productIdAsInt)) {
      return res.status(400).json({ success: false, error: 'Invalid product ID parameter provided.' });
    }

    await prisma.wishlist.delete({
      where: {
        userId_productId: {
          userId: req.user.id,
          productId: productIdAsInt
        }
      }
    });

    return res.status(200).json({ success: true, message: 'Product removed from wishlist.' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Product was not found in your wishlist.' });
    }
    next(error);
  }
});

export default router;