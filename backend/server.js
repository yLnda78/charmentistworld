require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');

const app = express();

// ============================================================
// CORS
// ============================================================

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

// GitHub Pages storefront
const githubPagesOrigin = 'https://ylnda78.github.io';

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests without an Origin header
    // (for example server-to-server requests or health checks)
    if (!origin) {
      return cb(null, true);
    }

    const normalizedOrigin = origin.replace(/\/$/, '');

    // Allow configured origins OR the GitHub Pages origin
    if (
      allowedOrigins.includes(normalizedOrigin) ||
      normalizedOrigin === githubPagesOrigin
    ) {
      return cb(null, true);
    }

    console.error('CORS rejected origin:', origin);
    console.error('Allowed origins:', allowedOrigins);

    cb(new Error('Not allowed by CORS'));
  }
}));

// ============================================================
// BODY PARSER
// ============================================================

app.use(express.json());

// ============================================================
// AUTH RATE LIMIT
// ============================================================

// Basic brute-force protection on authentication endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30
});

app.use('/api/auth', authLimiter, authRoutes);

// ============================================================
// API ROUTES
// ============================================================

app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: 'Something went wrong. Please try again.'
  });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`CHARMENTIST API running on http://localhost:${PORT}`);
});
