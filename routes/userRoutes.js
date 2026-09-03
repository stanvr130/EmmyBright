import express from 'express';
import { protect } from '../middleware/authMiddleware.js'; 
import prisma from '../src/config/db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: User Profile
 *   description: Authenticated user profile retrieval and management
 */

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get current logged-in user profile details
 *     tags: [User Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved user profile information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 name:
 *                   type: string
 *                   example: Stanley Okafor
 *                 email:
 *                   type: string
 *                   example: stanley@example.com
 *                 phone:
 *                   type: string
 *                   example: "+2348012345678"
 *                 address:
 *                   type: string
 *                   example: "123 Commercial Ave, Yaba, Lagos"
 *                 role:
 *                   type: string
 *                   example: "ADMIN"
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized - Token missing or invalid
 *       404:
 *         description: User profile not found
 */
router.get('/profile', protect, async (req, res, next) => {
  try {
    // req.user.id comes directly from your decoded JWT token middleware
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        role: true,
        createdAt: true,
      }
    });

    return res.status(200).json(user);
  } catch (error) {
    next(error); // Passes profile search errors directly to global handler
  }
});

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Update user profile data
 *     tags: [User Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Stanley Okafor
 *               phone:
 *                 type: string
 *                 example: "+2348012345678"
 *               address:
 *                 type: string
 *                 example: "123 Commercial Ave, Yaba, Lagos"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized - Token missing or invalid
 *       500:
 *         description: Failed to update profile details
 */
router.put('/profile', protect, async (req, res, next) => {
  try {
    const { name, phone, address } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        name: name !== undefined ? name : undefined,
        phone: phone !== undefined ? phone : undefined,
        address: address !== undefined ? address : undefined, 
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        role: true,
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
});

export default router;