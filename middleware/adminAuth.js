const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sfc-secret-key-change-this';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sfc@2025';

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

module.exports = { ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET, verifyAdminToken };