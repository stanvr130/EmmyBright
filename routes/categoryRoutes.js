import express from 'express';
import Joi from 'joi';
import { protect, protectAdmin } from '../middleware/authMiddleware.js';
import prisma from '../src/config/db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Categories
 *     description: Public category listing and admin category management
 */

// ==========================================
//          JOI VALIDATION SCHEMAS
// ==========================================

const createCategorySchema = Joi.object({
  name: Joi.string().trim().min(2).required().messages({
    'string.empty': 'Category name cannot be empty.',
    'string.min': 'Category name must be at least 2 characters long.',
    'any.required': 'Category name is a required field.'
  })
});

const updateCategorySchema = Joi.object({
  name: Joi.string().trim().min(2).required().messages({
    'string.empty': 'Category name cannot be empty.',
    'string.min': 'Category name must be at least 2 characters long.',
    'any.required': 'Category name is a required field.'
  })
});

// ==========================================
//                  ROUTES
// ==========================================

/**
 * @swagger
 * /api/categories:
 *   get:
 *     summary: Get all categories (Public)
 *     tags: [Categories]
 *     responses:
 *       200:
 *         description: Array of all categories, including product count
 */
router.get('/', async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: { products: true }
        }
      },
      orderBy: { name: 'asc' }
    });
    return res.status(200).json(categories);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/{id}:
 *   get:
 *     summary: Get a single category with its products (Public)
 *     tags: [Categories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Category with nested products
 *       404:
 *         description: Category not found
 */
router.get('/:id', async (req, res, next) => {
  try {
    const idAsInt = parseInt(req.params.id, 10);
    if (isNaN(idAsInt)) {
      return res.status(400).json({ error: 'Invalid category ID parameter provided.' });
    }

    const category = await prisma.category.findUnique({
      where: { id: idAsInt },
      include: { products: { include: { variants: true } } }
    });

    if (!category) {
      return res.status(404).json({ error: `Category with ID ${idAsInt} not found.` });
    }

    return res.status(200).json(category);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories:
 *   post:
 *     summary: Create a new category (Admin Only)
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Accessories
 *     responses:
 *       201:
 *         description: Category created successfully
 *       400:
 *         description: Validation error or duplicate name
 *       403:
 *         description: Forbidden (Admin privileges required)
 */
router.post('/', protect, protectAdmin, async (req, res, next) => {
  try {
    const { error, value } = createCategorySchema.validate(req.body, { abortEarly: false });

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map((err) => err.message)
      });
    }

    const existing = await prisma.category.findUnique({ where: { name: value.name } });
    if (existing) {
      return res.status(400).json({ error: `A category named "${value.name}" already exists.` });
    }

    const newCategory = await prisma.category.create({
      data: { name: value.name }
    });

    return res.status(201).json(newCategory);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/{id}:
 *   put:
 *     summary: Rename an existing category (Admin Only)
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Footwear
 *     responses:
 *       200:
 *         description: Category updated successfully
 *       400:
 *         description: Validation error or duplicate name
 *       404:
 *         description: Category not found
 */
router.put('/:id', protect, protectAdmin, async (req, res, next) => {
  try {
    const idAsInt = parseInt(req.params.id, 10);
    if (isNaN(idAsInt)) {
      return res.status(400).json({ error: 'Invalid category ID parameter provided.' });
    }

    const { error, value } = updateCategorySchema.validate(req.body, { abortEarly: false });

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map((err) => err.message)
      });
    }

    const duplicate = await prisma.category.findUnique({ where: { name: value.name } });
    if (duplicate && duplicate.id !== idAsInt) {
      return res.status(400).json({ error: `A category named "${value.name}" already exists.` });
    }

    const updatedCategory = await prisma.category.update({
      where: { id: idAsInt },
      data: { name: value.name }
    });

    return res.status(200).json(updatedCategory);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: `Category with ID ${req.params.id} not found.` });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/{id}:
 *   delete:
 *     summary: Delete a category (Admin Only). Fails if products still reference it.
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Category deleted successfully
 *       400:
 *         description: Cannot delete — products still assigned to this category
 *       404:
 *         description: Category not found
 */
router.delete('/:id', protect, protectAdmin, async (req, res, next) => {
  try {
    const idAsInt = parseInt(req.params.id, 10);
    if (isNaN(idAsInt)) {
      return res.status(400).json({ error: 'Invalid category ID parameter provided.' });
    }

    const productCount = await prisma.product.count({ where: { categoryId: idAsInt } });

    if (productCount > 0) {
      return res.status(400).json({
        error: `Cannot delete this category — ${productCount} product(s) are still assigned to it. Reassign them first.`
      });
    }

    await prisma.category.delete({ where: { id: idAsInt } });

    return res.status(200).json({
      success: true,
      message: `Category ID ${idAsInt} has been successfully removed.`
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: `Category with ID ${req.params.id} not found.` });
    }
    next(error);
  }
});

export default router;