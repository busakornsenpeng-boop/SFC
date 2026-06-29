const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET, verifyAdminToken } = require('../middleware/adminAuth');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });
  }
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'username หรือ password ไม่ถูกต้อง' });
  }
  const token = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token, expiresIn: '8h' });
});

router.get('/me', verifyAdminToken, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'logout สำเร็จ' });
});

module.exports = router;