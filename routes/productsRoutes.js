import express from 'express';
import Joi from 'joi';
import { protect, protectAdmin } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validateMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';
import prisma from '../src/config/db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Products
 *     description: Public product catalog and category filters
 *   - name: Admin - Products
 *     description: Product creation, variant updates, and deletion (Admin Only)
 */

// ==========================================
//          JOI VALIDATION SCHEMAS
// ==========================================

const createProductSchema = Joi.object({
  name: Joi.string().trim().min(2).required().messages({
    'string.empty': 'Product name cannot be empty.',
    'string.min': 'Product name must be at least 2 characters long.',
    'any.required': 'Product name is a required field.'
  }),
  description: Joi.string().trim().allow('', null),
  price: Joi.number().positive().required().messages({
    'number.base': 'Price must be a valid number.',
    'number.positive': 'Price must be a positive numerical value.',
    'any.required': 'Price is a required field.'
  }),
  categoryId: Joi.number().integer().positive().required().messages({
    'number.base': 'Category must be a valid category ID.',
    'any.required': 'Category is a required field.'
  }),
  image: Joi.string().trim().allow('', null).optional().messages({
    'string.base': 'Image path must be a valid text string.'
  }),
  variants: Joi.array().items(
    Joi.object({
      id: Joi.any(),
      size: Joi.string().trim().allow('', null),
      color: Joi.string().trim().allow('', null),
      stock: Joi.number().integer().min(0).default(0).messages({
        'number.min': 'Stock level cannot drop below 0.'
      })
    })
  ).optional()
});

const bulkCreateProductSchema = Joi.array().items(createProductSchema);

const updateProductSchema = Joi.object({
  name: Joi.string().trim().min(2).optional(),
  description: Joi.string().trim().allow('', null).optional(),
  price: Joi.number().positive().optional(),
  categoryId: Joi.number().integer().positive().optional(),
  image: Joi.string().trim().allow('', null).optional(),
  variants: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().optional().messages({
        'number.base': 'Variant ID must be a valid integer.'
      }),
      size: Joi.string().trim().allow('', null).optional(),
      color: Joi.string().trim().allow('', null).optional(),
      stock: Joi.number().integer().min(0).optional()
    })
  ).optional()
});

// ==========================================
//             HELPER MIDDLEWARE
// ==========================================

// Parse multipart/form-data fields (from Multer) into native types before Joi validation
const parseFormDataFields = (req, res, next) => {
   if (req.file) {
    req.body.image = req.file.path;
  }
  if (typeof req.body.price === 'string' && req.body.price !== '') {
    req.body.price = parseFloat(req.body.price);
  }
  if (typeof req.body.categoryId === 'string' && req.body.categoryId !== '') {
    req.body.categoryId = parseInt(req.body.categoryId, 10);
  }
  if (typeof req.body.variants === 'string') {
    try {
      req.body.variants = JSON.parse(req.body.variants);
    } catch (e) {
      req.body.variants = [];
    }
  }
  next();
};

// ==========================================
//                  ROUTES
// ==========================================

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get all products (Public)
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: Array of all products with nested variants and category
 */
router.get('/', async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      include: { variants: true, categoryRef: true }
    });
    return res.status(200).json(products);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/products/category/{categoryId}:
 *   get:
 *     summary: Get products by category ID (Public)
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Filtered product list with variants
 *       400:
 *         description: Invalid category ID
 */
router.get('/category/:categoryId', async (req, res, next) => {
  try {
    const idAsInt = parseInt(req.params.categoryId, 10);
    if (isNaN(idAsInt)) {
      return res.status(400).json({ error: 'Invalid category ID parameter provided.' });
    }

    const filteredProducts = await prisma.product.findMany({
      where: { categoryId: idAsInt },
      include: { variants: true, categoryRef: true }
    });

    return res.status(200).json(filteredProducts);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create single product or bulk array of products (Admin Only)
 *     tags: [Admin - Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               categoryId:
 *                 type: integer
 *               variants:
 *                 type: string
 *                 description: JSON stringified array of variants
 *     responses:
 *       201:
 *         description: Product(s) created successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden (Admin privileges required)
 */
router.post(
  '/',
  protect,
  protectAdmin,
  upload.single('image'),
  parseFormDataFields,
  async (req, res, next) => {
    try {
      const isArray = Array.isArray(req.body);

      const { error, value } = isArray 
        ? bulkCreateProductSchema.validate(req.body, { abortEarly: false, stripUnknown: true })
        : createProductSchema.validate(req.body, { abortEarly: false, stripUnknown: true });

      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: error.details.map(err => err.message)
        });
      }

      if (isArray) {
        const createdProducts = await prisma.$transaction(
          value.map(item =>
            prisma.product.create({
              data: {
                name: item.name,
                description: item.description || null,
                price: parseFloat(item.price),
                categoryId: item.categoryId,
                image: item.image || null,
                variants: item.variants && item.variants.length > 0 ? {
                  create: item.variants.map(v => ({
                    size: v.size ? String(v.size) : null,
                    color: v.color || null,
                    stock: v.stock !== undefined ? parseInt(v.stock, 10) : 0
                  }))
                } : undefined
              },
              include: {
                variants: true,
                categoryRef: true
              }
            })
          )
        );

        return res.status(201).json({
          success: true,
          message: `${createdProducts.length} products successfully seeded with variants.`,
          count: createdProducts.length,
          data: createdProducts
        });
      }

      const { name, description, price, categoryId, image, variants } = value;

      const newProduct = await prisma.product.create({
        data: {
          name,
          description: description || null,
          price: parseFloat(price),
          categoryId,
          image: image || null,
          variants: variants && variants.length > 0 ? {
            create: variants.map(v => ({
              size: v.size ? String(v.size) : null,
              color: v.color || null,
              stock: v.stock !== undefined ? parseInt(v.stock, 10) : 0
            }))
          } : undefined
        },
        include: {
          variants: true,
          categoryRef: true
        }
      });

      return res.status(201).json(newProduct);
    } catch (error) {
      if (error.code === 'P2003') {
        return res.status(400).json({ error: 'The specified category does not exist.' });
      }
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: Update product details and variant stock levels (Admin Only)
 *     tags: [Admin - Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Numeric product ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               name:
 *                 type: string
 *               price:
 *                 type: number
 *               categoryId:
 *                 type: integer
 *               variants:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       400:
 *         description: Invalid parameters
 *       404:
 *         description: Product target does not exist
 */
router.put(
  '/:id',
  protect,
  protectAdmin,
  upload.single('image'),
  parseFormDataFields,
  validateBody(updateProductSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { name, description, price, categoryId, image, variants } = req.body;
      const productIdAsInt = parseInt(id, 10);

      if (isNaN(productIdAsInt)) {
        return res.status(400).json({ error: 'Invalid product ID parameter provided.' });
      }

      const finalProduct = await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: productIdAsInt },
          data: {
            name: name !== undefined ? name : undefined,
            description: description !== undefined ? description : undefined,
            price: price !== undefined ? parseFloat(price) : undefined,
            categoryId: categoryId !== undefined ? categoryId : undefined,
            image: image !== undefined ? image : undefined,
          },
        });

        if (variants && variants.length > 0) {
          for (const variant of variants) {
            if (variant.id) { 
              await tx.variant.update({
                where: { id: parseInt(variant.id, 10) },
                data: {
                  stock: variant.stock !== undefined ? parseInt(variant.stock, 10) : undefined,
                  size: variant.size !== undefined ? String(variant.size) : undefined,
                  color: variant.color !== undefined ? variant.color : undefined
                }
              });
            } else {
              await tx.variant.create({
                data: {
                  productId: productIdAsInt,
                  size: variant.size ? String(variant.size) : null,
                  color: variant.color || null,
                  stock: variant.stock !== undefined ? parseInt(variant.stock, 10) : 0
                }
              });
            }
          }
        }

        return tx.product.findUniqueOrThrow({
          where: { id: productIdAsInt },
          include: { variants: true, categoryRef: true }
        });
      });

      return res.status(200).json(finalProduct);
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: `Product target with ID ${req.params.id} does not exist.` });
      }
      if (error.code === 'P2003') {
        return res.status(400).json({ error: 'The specified category does not exist.' });
      }
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete a product and all its variants (Admin Only)
 *     tags: [Admin - Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Numeric product ID
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *       400:
 *         description: Invalid parameters
 *       404:
 *         description: Product target could not be located
 */
router.delete('/:id', protect, protectAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const idAsInt = parseInt(id, 10);

    if (isNaN(idAsInt)) {
      return res.status(400).json({ error: 'Invalid product ID parameter provided.' });
    }

    await prisma.$transaction([
      prisma.variant.deleteMany({
        where: { productId: idAsInt }
      }),
      prisma.product.delete({
        where: { id: idAsInt }
      })
    ]);

    return res.status(200).json({ 
      success: true, 
      message: `Product ID ${id} and its options have been successfully removed.` 
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: `Product target with ID ${req.params.id} could not be located.` });
    }
    next(error);
  }
});

export default router;