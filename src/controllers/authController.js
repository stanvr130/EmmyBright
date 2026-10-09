import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import prisma from '../src/config/db.js'; // Adjust if your file lives somewhere else
import { JWT_SECRET, JWT_REFRESH_SECRET } from '../src/config/env.js'; // Adjust relative path if needed

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true, // Prevents client-side JS access (XSS defense)
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
};

// Used to burn the same time as a real check when the email doesn't exist,
// so response timing doesn't reveal which emails are registered
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { id: user.id, userId: user.id },
    JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
}

// Never send the password hash to the client
function toSafeUser(user) {
  const { password, ...safeUser } = user;
  return safeUser;
}

// 🔑 1. LOGIN CONTROLLER
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // A. Look up the user (case-insensitive email match)
    const user = await prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } }
    });

    // B. Check the password. Always run a compare, even for unknown emails.
    const passwordMatches = await bcrypt.compare(
      password,
      user?.password || DUMMY_HASH
    );

    if (!user || !passwordMatches) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // C. Block suspended accounts (only reached with the correct password)
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account has been suspended. Please contact support.'
      });
    }

    // D. Block unverified accounts (only reached with the correct password)
    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email before logging in.',
        email: user.email
      });
    }

    // E. Generate tokens
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    // F. Attach Refresh Token inside httpOnly Cookie
    res.cookie('refreshToken', refreshToken, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
    });

    // G. Return Access Token and user data (without the password hash)
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken,
      user: toSafeUser(user)
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
    let decoded;
    try {
      decoded = jwt.verify(tokenFromCookie, JWT_REFRESH_SECRET);
    } catch {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired refresh token.'
      });
    }

    // Re-fetch the user so the new access token carries the real, current
    // role/email (the refresh token doesn't contain them) and so deleted,
    // suspended or unverified accounts can't keep refreshing
    const user = await prisma.user.findUnique({
      where: { id: decoded.id || decoded.userId }
    });

    if (!user || !user.emailVerified || user.isActive === false) {
      res.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS);
      return res.status(401).json({
        success: false,
        message: 'Account not available. Please log in again.'
      });
    }

    return res.status(200).json({
      success: true,
      accessToken: signAccessToken(user)
    });
  } catch (error) {
    next(error);
  }
};

// 🚪 3. LOGOUT CONTROLLER
export const logout = async (req, res, next) => {
  try {
    // Clear the httpOnly cookie on logout
    res.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS);

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};