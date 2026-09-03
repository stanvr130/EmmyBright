// src/config/swagger.js
import swaggerJSDoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'LaFamilia E-Commerce & Admin API',
      version: '1.0.0',
      description: 'Complete API documentation for Auth, Product Catalog, Customer Orders, and Admin Dashboard routes.',
      contact: {
        name: 'Okafor Stanley Rotanna',
        email: 'admin@lafamilia.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Local Development Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token here. Format: Bearer ',
        },
      },
    },
    // Allows tagging endpoints as Admin or Public across the UI
    tags: [
      { name: 'Authentication', description: 'User registration, login, and token management' },
      { name: 'Products', description: 'Public catalog, variants, and product search' },
      { name: 'Cart', description: 'User shopping cart management' },
      { name: 'Orders', description: 'Checkout, Paystack payments, and order tracking' },
      { name: 'Admin - Products', description: 'Product inventory management (Admin Only)' },
      { name: 'Admin - Orders', description: 'Fulfillment and status updates (Admin Only)' },
      { name: 'Admin - Users', description: 'User account management (Admin Only)' },
    ],
  },
  // Automatically scan all JS files inside routes/ and src/routes/
  apis: ['./routes/*.js', './src/routes/*.js', './routes/**/*.js', './src/routes/**/*.js'],
};

export const swaggerSpec = swaggerJSDoc(options);