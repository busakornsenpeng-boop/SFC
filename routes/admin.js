const express = require('express');
const router  = express.Router();
const { getRequiredEnv, signToken, verifyAdminToken } = require('../middleware/adminAuth');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });
  }
  if (username !== getRequiredEnv('ADMIN_USERNAME') || password !== getRequiredEnv('ADMIN_PASSWORD')) {
    return res.status(401).json({ success: false, message: 'username หรือ password ไม่ถูกต้อง' });
  }
  const token = signToken({ role: 'admin', username });
  res.json({ success: true, token, expiresIn: '8h' });
});

router.get('/me', verifyAdminToken, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'logout สำเร็จ' });
});

module.exports = router;
