import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/config/env.js';

// 🛡️ Middleware 1: Verify JWT & Attach Payload
export const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;

  console.log('\n--- 🛡️ Auth Middleware Debug ---');
  console.log('Incoming Authorization Header:', authHeader);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ Auth Check Failed: Missing or malformed Authorization header.');
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const token = authHeader.split(' ')[1];
    console.log('Extracted Token:', token);

    const decoded = jwt.verify(token, JWT_SECRET);

    console.log('✅ Token Verified Successfully. Decoded User Payload:', decoded);

    // Attach decoded token payload (id, email, role, etc.)
    req.user = decoded;
    next();
  } catch (error) {
    console.error('❌ Token verification failed:', error.message);
    return res.status(401).json({ error: `Invalid or expired token: ${error.message}` });
  }
};

// 👑 Middleware 2: Role Authorization
export const requireAdmin = (req, res, next) => {
  console.log('\n--- 👑 Admin Middleware Check ---');
  console.log('Current User Object:', req.user);

  if (!req.user) {
    console.log('❌ Role Check Failed: req.user is undefined.');
    return res.status(401).json({ error: 'Authentication required before role check.' });
  }

  if (req.user.role !== 'ADMIN') {
    console.log(`❌ Access Denied: User role "${req.user.role}" is not ADMIN.`);
    return res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
  }

  console.log('✅ Admin Check Passed. Granting access.');
  next();
};

// 🔄 Alias export to prevent breaking existing route files expecting protectAdmin
export const protectAdmin = requireAdmin;