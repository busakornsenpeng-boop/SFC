const jwt = require('jsonwebtoken');

const JWT_SECRET     = process.env.JWT_SECRET || 'sfc-secret-key-change-this';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sfc@2025';

// ── เดิม: ใช้เฉพาะกับ /api/admin/* (เช็คว่าเป็น admin เท่านั้น) ──
function verifyAdminToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'ไม่มี token' });
  }
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'ไม่ใช่ admin' });
    }
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'token หมดอายุหรือไม่ถูกต้อง' });
  }
}

// ── ใหม่: เซ็น token ให้ user ทั่วไป (ใช้ตอน login ใน routes/users.js) ──
function signToken(payload, expiresIn = '8h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// ── ใหม่: เช็คแค่ว่า login แล้ว ไม่สนใจ role (ใช้ทั่วไป เช่น POST /api/repairs) ──
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'กรุณา login' });
  }
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user  = payload;
    req.admin = payload; // เผื่อโค้ดเก่าบางจุดอ้าง req.admin
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'token หมดอายุหรือไม่ถูกต้อง' });
  }
}

// ── ใหม่: เช็คว่า login แล้ว และ role อยู่ใน list ที่อนุญาต ──
// ใช้แบบ requireRole('engineer', 'admin') หรือ requireRole('admin')
function requireRole(...roles) {
  return (req, res, next) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'กรุณา login' });
    }
    const token = auth.split(' ')[1];
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (!roles.includes(payload.role)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' });
      }
      req.user  = payload;
      req.admin = payload;
      next();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'token หมดอายุหรือไม่ถูกต้อง' });
    }
  };
}

module.exports = {
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  JWT_SECRET,
  verifyAdminToken,
  signToken,
  requireAuth,
  requireRole,
};