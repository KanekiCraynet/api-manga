const express = require('express');
const path = require('path');
const app = express();
const cors = require('cors');
const helmet = require('helmet').default;
const compression = require('compression');
const { router } = require('./router');
require('dotenv').config();

// Detect Vercel environment
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;

// Trust proxy for rate limiting (if behind reverse proxy)
app.set('trust proxy', 1);

// Middleware
app.use(cors());

// Compression middleware - optimize for faster responses
app.use(compression({
  threshold: 512, // Only compress responses > 512 bytes
  level: isVercel ? 1 : 6, // Lower compression level for Vercel (faster)
  filter: (req, res) => {
    // Don't compress if client doesn't support it
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
    },
  },
}));
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve dashboard static files
app.use('/dashboard', express.static(path.join(__dirname, '../public/dashboard')));

// Routes
app.use(router);

// Vercel serverless function handler
module.exports = app;

// Start server only if not in Vercel environment
if (process.env.VERCEL !== '1' && !process.env.VERCEL_ENV) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
