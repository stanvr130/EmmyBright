import dns from 'dns';
dns.setDefaultResultOrder('ipv4first'); // Forces IPv4 first globally to prevent connection timeouts

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

// 📚 Swagger Imports
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './src/config/swagger.js';

// 🔀 Route Imports
import productRoutes from './routes/productsRoutes.js'; 
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import cartDeliveryRoutes from './routes/cartRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import wishlistRoutes from './routes/wishlistRoutes.js';
import errorHandler from './middleware/errorMiddleware.js';
import validateEmail from './middleware/validateEmail.js';

// Setup ES Module equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 🛡️ Trust Proxy (Crucial for Rate Limiting behind Ngrok/Localtunnel proxies)
// NOTE: when you deploy, "1" must match the number of proxies in front of
// your app (e.g. 1 for most hosts). If it's wrong, every user can appear
// to share one IP, or the limiter can be bypassed.
app.set('trust proxy', 1);

// 🛡️ 1. HELMET: Infrastructure Header Hardening
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// 🛡️ 2. CORS: Cross-Origin Resource Sharing
// Local dev origins are always allowed. Production/staging origins come from
// CLIENT_URL (and optional ADDITIONAL_ORIGINS, comma-separated) in .env —
// so adding a real domain later is just an env var change, no code edit.
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
  ...(process.env.ADDITIONAL_ORIGINS ? process.env.ADDITIONAL_ORIGINS.split(',').map(o => o.trim()) : [])
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS transport security policy.'));
    }
  },
  credentials: true
}));

// 🛡️ 3. RATE LIMITERS: Brute-Force & Denial-of-Service Defense

// General limiter for the whole API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,                 
  standardHeaders: 'draft-7', 
  legacyHeaders: false,     
  message: {
    success: false,
    message: 'Too many requests from this IP address. Please wait 15 minutes before trying again.'
  }
});

// Strict limiter for routes that SEND EMAIL (protects your Resend quota and
// domain reputation). Per IP, regardless of which email address is submitted.
const emailSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many verification requests from this network. Please wait 15 minutes and try again.',
    message: 'Too many verification requests from this network. Please wait 15 minutes and try again.'
  }
});

// Limiter for credential-guessing routes (login, OTP check, password reset)
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many attempts from this network. Please wait 15 minutes and try again.',
    message: 'Too many attempts from this network. Please wait 15 minutes and try again.'
  }
});

app.use('/api/', apiLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 📧 Email-sending routes: rate limit first, then validate the email format.
// These must be registered BEFORE app.use('/api/auth', authRoutes) below.
// If your register route is not /api/auth/register, change the path here.
app.use('/api/auth/send-otp', emailSendLimiter, validateEmail);
app.use('/api/auth/forgot-password', emailSendLimiter, validateEmail);
app.use('/api/auth/register', emailSendLimiter, validateEmail);

// 🔐 Credential-guessing routes
app.use('/api/auth/login', credentialLimiter);
app.use('/api/auth/verify-otp', credentialLimiter);
app.use('/api/auth/reset-password', credentialLimiter);

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// 🖼️ STATIC IMAGES & UPLOADS ROUTES
app.use('/public-images', express.static(path.join(__dirname, 'public-images')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 📚 SWAGGER UI DOCUMENTATION ROUTE
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// 🔀 Distinct API Base Paths
app.use('/api/products', productRoutes); 
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api', cartDeliveryRoutes);
app.use('/api/wishlist', wishlistRoutes);

// 🚨 Global Error Handler Middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running securely on http://localhost:${PORT}`);
  console.log(`📚 Swagger UI live at http://localhost:${PORT}/api-docs`);
});