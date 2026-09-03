import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_REFRESH_SECRET } from '../src/config/env.js'; // Adjust relative path if needed

// 🔑 1. LOGIN CONTROLLER
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // TODO: Replace with your actual database user lookup and password check logic
    // Example: const user = await prisma.user.findUnique({ where: { email } });
    
    // Demo user payload (replace with your DB user object):
    const user = { id: 1, email, name: 'Customer', role: 'USER' };

    // A. Generate Short-Lived Access Token (15 minutes) using central JWT_SECRET
    const accessToken = jwt.sign(
      { id: user.id, userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    // B. Generate Long-Lived Refresh Token (7 days) using central JWT_REFRESH_SECRET
    const refreshToken = jwt.sign(
      { id: user.id, userId: user.id },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // C. Attach Refresh Token inside httpOnly Cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true, // Prevents client-side JS access (XSS defense)
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
    });

    // D. Return Access Token and basic User data in response body
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken,
      user
    });
  } catch (error) {
    next(error);
  }
};

// 🔄 2. REFRESH TOKEN CONTROLLER
export const refreshToken = async (req, res, next) => {
  try {
    // Read the refresh token from cookies (parsed by cookie-parser)
    const tokenFromCookie = req.cookies?.refreshToken;

    if (!tokenFromCookie) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token missing. Please log in again.'
      });
    }

    // Verify token signature using central JWT_REFRESH_SECRET
    jwt.verify(
      tokenFromCookie,
      JWT_REFRESH_SECRET,
      (err, decoded) => {
        if (err) {
          return res.status(403).json({
            success: false,
            message: 'Invalid or expired refresh token.'
          });
        }

        // Generate new Access Token using central JWT_SECRET
        const newAccessToken = jwt.sign(
          { id: decoded.id || decoded.userId, userId: decoded.userId || decoded.id, role: decoded.role },
          JWT_SECRET,
          { expiresIn: '15m' }
        );

        return res.status(200).json({
          success: true,
          accessToken: newAccessToken
        });
      }
    );
  } catch (error) {
    next(error);
  }
};

// 🚪 3. LOGOUT CONTROLLER
export const logout = async (req, res, next) => {
  try {
    // Clear the httpOnly cookie on logout
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};