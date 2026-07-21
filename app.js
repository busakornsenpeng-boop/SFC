const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const repairRoutes = require('./routes/repairs');
const userRoutes = require('./routes/users');
const pmRoutes = require('./routes/pm');
const masterDataRoutes = require('./routes/masterdata');
const dailyPMRoutes = require('./routes/dailypm');
const adminRoutes = require('./routes/admin');
const lineWebhookRoutes = require('./routes/linewebhook');
const techProfileRoutes = require('./routes/techprofiles');
const { verifyAdminToken } = require('./middleware/adminAuth');
const { broadcastToAdmins } = require('./routes/notify');

function createCorsOptions() {
  const origins = (process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
  return {
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  };
}

function createApp() {
  const app = express();
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT || 20),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts. Please try again later.' },
  });

  app.disable('x-powered-by');
  // CSP is configured by the deployment proxy because this page loads trusted CDN assets.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors(createCorsOptions()));
  app.use(express.json({
    limit: '10mb',
    // เก็บ raw body ไว้ใช้ verify LINE webhook signature (HMAC ต้องคำนวณจาก raw bytes เท่านั้น)
    verify: (req, res, buf) => { req.rawBody = buf; },
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/api/users/login', authLimiter);
  app.use('/api/admin/login', authLimiter);
  app.use('/api/repairs', repairRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/pm', pmRoutes);
  app.use('/api/masterdata', masterDataRoutes);
  app.use('/api/daily-pm', dailyPMRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/line/webhook', lineWebhookRoutes);
  app.use('/api/tech-profiles', techProfileRoutes);

  if (process.env.ENABLE_LINE_TEST_ENDPOINT === 'true') {
    app.post('/api/test-line-notify', verifyAdminToken, async (req, res, next) => {
      try {
        await broadcastToAdmins('TEST-001', 'System test', 'Test machine', 'LINE notification test', 'pending');
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((err, req, res, next) => {
    if (err.message === 'Origin is not allowed by CORS') return res.status(403).json({ success: false, message: 'Origin is not allowed.' });
    console.error('[api] unexpected error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  });
  return app;
}

module.exports = { createApp, createCorsOptions };