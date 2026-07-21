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

// ตัดเครื่องหมาย "/" ท้าย URL ออก เพื่อกันปัญหา CORS_ORIGIN ตั้งค่าไม่ตรงเป๊ะ
// เช่น "https://example.com/" กับ "https://example.com" ควรถือว่าเป็น origin เดียวกัน
function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function createCorsOptions() {
  const origins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  if (!origins.length) {
    console.warn('[CORS] ⚠️  ไม่ได้ตั้งค่า CORS_ORIGIN ไว้ — จะไม่มี origin ไหนถูกอนุญาต (ยกเว้น request ที่ไม่มี Origin header เช่น server-to-server หรือ curl)');
  }

  return {
    origin(origin, callback) {
      // request ที่ไม่มี Origin header (เช่น curl, server-to-server, LINE webhook) ให้ผ่านเสมอ
      if (!origin) return callback(null, true);

      const normalizedIncoming = normalizeOrigin(origin);
      if (origins.includes(normalizedIncoming)) return callback(null, true);

      console.warn(`[CORS] ❌ ปฏิเสธ origin: "${origin}" (ไม่อยู่ใน CORS_ORIGIN ที่ตั้งไว้: ${origins.join(', ') || '(ว่างเปล่า)'})`);
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
  app.use(express.json({ limit: '10mb' }));
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