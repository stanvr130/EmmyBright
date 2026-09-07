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
import paymentRoutes from './routes/payment.js'; 
import categoryRoutes from './routes/categoryRoutes.js';
import errorHandler from './middleware/errorMiddleware.js';

// Setup ES Module equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 🛡️ Trust Proxy (Crucial for Rate Limiting behind Ngrok/Localtunnel proxies)
app.set('trust proxy', 1);

// 🛡️ 1. HELMET: Infrastructure Header Hardening
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// 🛡️ 2. CORS: Cross-Origin Resource Sharing
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
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

// 🛡️ 3. RATE LIMITER: Brute-Force & Denial-of-Service Defense
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

app.use('/api/', apiLimiter);

// 📦 Global Body & Cookie Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ⚡ ANTI-CACHE MIDDLEWARE
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
app.use('/api/payments', paymentRoutes); 
app.use('/api/categories', categoryRoutes);

// 🚨 Global Error Handler Middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running securely on http://localhost:${PORT}`);
  console.log(`📚 Swagger UI live at http://localhost:${PORT}/api-docs`);
});