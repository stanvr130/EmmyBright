import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/config/env.js';

// 🛡️ Middleware 1: Verify JWT & Attach Payload
export const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Attach decoded token payload (id, email, role, etc.)
    req.user = decoded;
    next();
  } catch (error) {
    // 🔄 FIX: log only the failure reason, never the raw header, token, or
    // decoded payload — those are bearer credentials and would otherwise
    // sit in plaintext in production logs on every single request.
    console.error('❌ Token verification failed:', error.message);
    return res.status(401).json({ error: `Invalid or expired token: ${error.message}` });
  }
};

// 👑 Middleware 2: Role Authorization
export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required before role check.' });
  }

  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
  }

  next();
};

// 🔄 Alias export to prevent breaking existing route files expecting protectAdmin
export const protectAdmin = requireAdmin;