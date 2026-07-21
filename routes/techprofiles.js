// routes/techprofiles.js
// ─────────────────────────────────────────────────────────────
// จัดการ "โปรไฟล์ช่าง" ที่ผูกอยู่ใต้บัญชี login กลาง (parent_account)
// ใช้ตอนกดรับงาน/เซ็นชื่อ PM เพื่อระบุตัวจริงที่ทำงาน โดยไม่ต้องแยก
// บัญชี login รายคน — ยืนยันตัวตนด้วยรหัสพนักงาน (employee_code)
//
// Google Sheet: TechProfiles!A2:H1000
// A id | B fullname | C employee_code | D phone | E avatar_url
// F is_chief | G status | H parent_account
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { requireRole } = require('../middleware/adminAuth');

const RANGE = 'TechProfiles!A2:H1000';

async function getAllProfiles() {
  const res  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
  const rows = res.data.values || [];
  return rows.map((r, i) => ({
    rowIndex:       i + 2, // แถวจริงใน Sheet (สำหรับ update/delete)
    id:             r[0] || '',
    fullname:       r[1] || '',
    employee_code:  r[2] || '',
    phone:          r[3] || '',
    avatar_url:     r[4] || '',
    is_chief:       r[5] || 'FALSE',
    status:         r[6] || 'active',
    parent_account: r[7] || '',
  }));
}

// ─────────────────────────────────────────────────────────────
// GET /api/tech-profiles?account=xxx
// ดึงรายชื่อโปรไฟล์ (active) ของบัญชี login ที่ระบุ — ใช้ populate dropdown
// เลือกชื่อตอนกดรับงาน ไม่ต้องยืนยันรหัสพนักงานในขั้นนี้
// ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { account } = req.query;
    let profiles = await getAllProfiles();
    if (account) {
      profiles = profiles.filter(p => p.parent_account === account);
    }

    // เช็คสิทธิ์จาก token จริง แทนการเชื่อ query string ที่ client ส่งมาเอง
    const auth  = req.headers['authorization'];
    let isAdmin = false;
    if (auth && auth.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const { getJwtSecret } = require('../middleware/adminAuth');
        const payload = jwt.verify(auth.split(' ')[1], getJwtSecret());
        isAdmin = payload.role === 'admin';
      } catch (e) {
        // token ไม่ถูกต้อง/หมดอายุ — ถือว่าไม่ใช่ admin
      }
    }

    if (isAdmin) {
      // แอดมิน — เห็นครบทุกฟิลด์ (รวมรหัสพนักงาน) และเห็นคนที่ปิดใช้งานแล้วด้วย (สำหรับหน้าจัดการ)
      profiles = profiles.map(({ rowIndex, ...safe }) => safe);
    } else {
      // ใช้ populate dropdown ตอนกดรับงาน — เห็นแค่คน active และไม่ส่งรหัสพนักงานกลับ
      profiles = profiles
        .filter(p => p.status === 'active')
        .map(({ rowIndex, employee_code, ...safe }) => safe);
    }
    res.json({ success: true, data: profiles });
  } catch (err) {
    console.error('[TechProfiles] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/tech-profiles/verify
// ยืนยันตัวตนก่อนบันทึกชื่อลงในใบงาน/เซ็นชื่อ PM
// body: { id, employee_code }
// ─────────────────────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const { id, employee_code } = req.body;
    if (!id || !employee_code) {
      return res.json({ success: false, message: 'กรุณาเลือกชื่อและกรอกรหัสพนักงาน' });
    }
    const profiles = await getAllProfiles();
    const profile   = profiles.find(p => p.id === id);
    if (!profile || profile.status !== 'active') {
      return res.json({ success: false, message: 'ไม่พบโปรไฟล์นี้ หรือถูกปิดใช้งานแล้ว' });
    }
    if (String(profile.employee_code).trim() !== String(employee_code).trim()) {
      return res.json({ success: false, message: 'รหัสพนักงานไม่ถูกต้อง' });
    }
    const { rowIndex, ...safe } = profile;
    res.json({ success: true, profile: safe });
  } catch (err) {
    console.error('[TechProfiles] verify error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/tech-profiles  (แอดมินเท่านั้น — เพิ่มโปรไฟล์ช่างใหม่)
// body: { fullname, employee_code, phone, avatar_url, is_chief, parent_account }
// ─────────────────────────────────────────────────────────────
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { fullname, employee_code, phone, avatar_url, is_chief, parent_account } = req.body;

    if (!fullname || !employee_code || !parent_account) {
      return res.json({ success: false, message: 'กรุณากรอกชื่อ, รหัสพนักงาน และบัญชีที่สังกัดให้ครบ' });
    }

    const profiles = await getAllProfiles();
    const dupCode = profiles.find(p =>
      p.parent_account === parent_account &&
      String(p.employee_code).trim() === String(employee_code).trim()
    );
    if (dupCode) {
      return res.json({ success: false, message: 'รหัสพนักงานนี้มีอยู่แล้วในบัญชีนี้' });
    }

    const id = 'TP-' + Date.now();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'TechProfiles!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          id, fullname, employee_code, phone || '', avatar_url || '',
          is_chief ? 'TRUE' : 'FALSE', 'active', parent_account,
        ]],
      },
    });

    res.json({ success: true, id });
  } catch (err) {
    console.error('[TechProfiles] create error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/tech-profiles/:id  (แอดมินเท่านั้น — แก้ไขโปรไฟล์)
// body: { fullname, employee_code, phone, avatar_url, is_chief, status }
// ─────────────────────────────────────────────────────────────
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { fullname, employee_code, phone, avatar_url, is_chief, status } = req.body;

    const profiles = await getAllProfiles();
    const profile   = profiles.find(p => p.id === id);
    if (!profile) return res.json({ success: false, message: 'ไม่พบโปรไฟล์นี้' });

    const updated = {
      fullname:      fullname      ?? profile.fullname,
      employee_code: employee_code ?? profile.employee_code,
      phone:         phone         ?? profile.phone,
      avatar_url:    avatar_url    ?? profile.avatar_url,
      is_chief:      (is_chief !== undefined) ? (is_chief ? 'TRUE' : 'FALSE') : profile.is_chief,
      status:        status        ?? profile.status,
    };

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `TechProfiles!B${profile.rowIndex}:G${profile.rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          updated.fullname, updated.employee_code, updated.phone,
          updated.avatar_url, updated.is_chief, updated.status,
        ]],
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[TechProfiles] update error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/tech-profiles/:id  (แอดมินเท่านั้น — ปิดใช้งานโปรไฟล์)
// ใช้วิธีเปลี่ยน status เป็น inactive แทนการลบแถวจริง เพื่อรักษาประวัติงานเก่า
// ที่อ้างอิงชื่อนี้ไว้ (เช่นในใบงานซ่อม/PM ที่ผ่านมา) ไม่ให้ข้อมูลขาดหาย
// ─────────────────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const profiles = await getAllProfiles();
    const profile   = profiles.find(p => p.id === id);
    if (!profile) return res.json({ success: false, message: 'ไม่พบโปรไฟล์นี้' });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `TechProfiles!G${profile.rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['inactive']] },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[TechProfiles] delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;