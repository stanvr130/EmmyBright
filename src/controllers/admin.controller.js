import prisma from '../config/db.js';

// 📊 1. Get System & Admin Dashboard Stats
export const getDashboardStats = async (req, res) => {
  try {
    const [totalUsers, activeUsers, adminCount] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { role: 'ADMIN' } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        adminCount,
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({ error: 'Failed to retrieve dashboard metrics.' });
  }
};

// 👥 2. Get All Users with Pagination & Basic Filtering
export const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count(),
    ]);

    return res.status(200).json({
      success: true,
      data: users,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to retrieve user list.' });
  }
};

// 🔄 3. Update User Role or Status (Suspend / Promote)
export const updateUserStatus = async (req, res) => {
  const { id } = req.params;
  const { role, isActive } = req.body;

  try {
    // Prevent admin from accidentally changing their own role/status
    if (req.user.id === id) {
      return res.status(400).json({ error: 'You cannot alter your own admin privileges.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(role !== undefined && { role }),
        ...(isActive !== undefined && { isActive }),
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'User successfully updated.',
      data: updatedUser,
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(400).json({ error: 'Failed to update user record.' });
  }
};

// 🗑️ 4. Delete User Account
export const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    if (req.user.id === id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    await prisma.user.delete({ where: { id } });

    return res.status(200).json({
      success: true,
      message: 'User account permanently removed.',
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(400).json({ error: 'Failed to delete user account.' });
  }
};