import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_REFRESH_SECRET } from '../src/config/env.js';
import prisma from '../src/config/db.js';
import { sendOtp, verifyOtp, forgotPassword, resetPassword } from '../src/controllers/otpController.js';

const router = express.Router();

console.log('--- AuthRoutes Debugging ---');
console.log('Imported prisma value:', prisma);
console.log('----------------------------');

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new customer account
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Stanley Okafor
 *               email:
 *                 type: string
 *                 example: customer@example.com
 *               password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       201:
 *         description: Customer account registered successfully
 *       400:
 *         description: Email already exists or missing required fields
 *       500:
 *         description: Server registration error
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 🔄 FIX: public signups must never grant admin access. This route is
    // unauthenticated, so `role` is never taken from req.body either —
    // it's always hardcoded here, server-side, to the least-privileged value.
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'USER'
      }
    });

    const { password: _, ...userWithoutPassword } = newUser;

    // A. Issue short-lived Access Token (15 minutes)
    const accessToken = jwt.sign(
      { id: newUser.id, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    // B. Issue long-lived Refresh Token (7 days)
    const refreshToken = jwt.sign(
      { id: newUser.id, role: newUser.role },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // C. Store Refresh Token inside httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
    });

    return res.status(201).json({
      success: true,
      message: 'Account registered successfully!',
      accessToken: accessToken,
      token: accessToken, // Backward compatibility alias
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ message: 'Failed to create account.' });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Authenticate user & receive Access Token + httpOnly Refresh Cookie
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@lafamilia.com
 *               password:
 *                 type: string
 *                 example: admin123
 *     responses:
 *       200:
 *         description: Login successful. Access token returned in body, Refresh token in httpOnly cookie.
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server authentication error
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide both email and password.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // A. Issue short-lived Access Token (15 minutes)
    const accessToken = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    // B. Issue long-lived Refresh Token (7 days)
    const refreshToken = jwt.sign(
      { id: user.id, role: user.role },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // C. Set Refresh Token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
    });

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      accessToken: accessToken,
      token: accessToken, // Backward compatibility alias
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server authentication failed.' });
  }
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Obtain a fresh Access Token using httpOnly Refresh Cookie
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Returns new short-lived access token
 *       401:
 *         description: Missing or unreadable refresh token cookie
 *       403:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token cookie missing. Please log in again.'
      });
    }

    jwt.verify(refreshToken, JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(403).json({
          success: false,
          message: 'Invalid or expired refresh token.'
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, role: true }
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User account no longer exists.'
        });
      }

      const newAccessToken = jwt.sign(
        { id: user.id, role: user.role },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      return res.status(200).json({
        success: true,
        accessToken: newAccessToken,
        token: newAccessToken // Backward compatibility alias
      });
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ message: 'Failed to refresh access token.' });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user and clear httpOnly Refresh Token cookie
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Refresh token cookie cleared successfully
 */
router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * @swagger
 * /api/auth/send-otp:
 *   post:
 *     summary: Send a 6-digit OTP code to the user's email for verification
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 example: customer@example.com
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Missing email
 *       500:
 *         description: Failed to send OTP
 */
router.post('/send-otp', sendOtp);

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify a submitted OTP code against the stored code for that email
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email:
 *                 type: string
 *                 example: customer@example.com
 *               code:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid, expired, or missing OTP
 *       429:
 *         description: Too many failed attempts
 *       500:
 *         description: Failed to verify OTP
 */
router.post('/verify-otp', verifyOtp);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request a password reset code sent to the user's email
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 example: customer@example.com
 *     responses:
 *       200:
 *         description: If the email exists, a reset code has been sent (response is identical either way)
 *       400:
 *         description: Missing email
 *       429:
 *         description: Cooldown — too many requests in a short window
 *       500:
 *         description: Failed to process request
 */
router.post('/forgot-password', forgotPassword);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset a user's password using a verified reset code
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code, newPassword]
 *             properties:
 *               email:
 *                 type: string
 *                 example: customer@example.com
 *               code:
 *                 type: string
 *                 example: "123456"
 *               newPassword:
 *                 type: string
 *                 example: newpassword123
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid, expired, or missing code/password
 *       500:
 *         description: Failed to reset password
 */
router.post('/reset-password', resetPassword);

export default router;