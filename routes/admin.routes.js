import { Router } from 'express';
import { protect, protectAdmin } from '../middleware/auth.middleware.js'; // or requireAdmin
import {
  getDashboardStats,
  getAllUsers,
  updateUserStatus,
  deleteUser,
} from '../src/controllers/admin.controller.js';

const router = Router();

// Protect every route below with authentication & admin role check
router.use(protect, protectAdmin);

router.get('/stats', getDashboardStats);
router.get('/users', getAllUsers);
router.patch('/users/:id', updateUserStatus);
router.delete('/users/:id', deleteUser);

export default router;