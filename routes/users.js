const axios   = require('axios');
const bcrypt  = require('bcryptjs');
const express = require('express');
const router  = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { signToken, requireAuth, requireRole } = require('../middleware/adminAuth');

// เกณฑ์เช็คว่าค่าที่เก็บไว้เป็น bcrypt hash แล้วหรือยัง (hash ของ bcrypt ขึ้นต้นด้วย $2a$/$2b$/$2y$ เสมอ)
const isBcryptHash = (val) => typeof val === 'string' && /^\$2[aby]\$/.test(val);

// เขียน hash ใหม่ทับรหัสผ่าน plaintext เดิมในชีต (ใช้ตอน migrate อัตโนมัติเมื่อ user login สำเร็จ)
async function upgradePasswordHash(username, plainPassword) {
  try {
    const result   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Users!A2:J1000' });
    const rows     = result.data.values || [];
    const rowIndex = rows.findIndex(r => String(r[0]) === String(username));
    if (rowIndex === -1) return;
    const newHash = await bcrypt.hash(plainPassword, 10);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Users!B${rowIndex + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newHash]] },
    });
    console.log(`[users] อัปเกรดรหัสผ่านเป็น bcrypt hash ให้ ${username} แล้ว`);
  } catch (err) {
    console.error('[users] upgradePasswordHash error:', err.message);
  }
}

const ADMIN_ACCOUNT = {
  username:   process.env.ADMIN_USERNAME,
  password:   process.env.ADMIN_PASSWORD,
  role:       'admin',
  fullname:   'ผู้ดูแลระบบ',
  dept:       'MTN',
  status:     'active',
  is_chief:   'TRUE',
  avatar_url: '',
};

// บัญชีกลางของทีมช่างซ่อมบำรุง — กำหนด username/password ไว้เองผ่าน env var
// (ไม่ต้องผ่านระบบสมัครสมาชิก/ไม่มีแถวใน Users sheet) ใช้ร่วมกันหน้างานบนเครื่องเดียว
// แล้วให้แต่ละคนเลือกชื่อ+กรอกรหัสพนักงานตอนรับงาน (ดู routes/techprofiles.js)
//
// ต้องตั้งค่า TE_SHARED_USERNAME / TE_SHARED_PASSWORD ใน Render เอง — ไม่มี default
// ในซอร์สโค้ดแล้ว (เดิมมี default 'eng_team'/'Sfca2026' ฝังไว้ ซึ่งเป็นช่องโหว่ความปลอดภัย
// เทียบเท่ากับ SEC-001) ถ้ายังไม่ได้ตั้งค่า บัญชีนี้จะถูกปิดใช้งานโดยอัตโนมัติ (login ไม่ได้)
const TE_SHARED_ACCOUNT = {
  username:   (process.env.TE_SHARED_USERNAME || '').trim(),
  password:   (process.env.TE_SHARED_PASSWORD || '').trim(),
  role:       'technician',
  fullname:   'ทีมช่างซ่อมบำรุง',
  dept:       'ENG',
  status:     'active',
  is_chief:   'FALSE',
  avatar_url: '',
};

// เดิม: เคยแยก role ช่างซ่อม (แผนก MTN) และวิศวกร (แผนก ENG) ออกจากกัน
// ตอนนี้: รวมเป็นบทบาทเดียวคือ "ช่าง" (role = 'technician') เพราะหน้าที่เหมือนกันทุกอย่าง
// มอบให้เฉพาะบัญชีกลาง TE_SHARED_ACCOUNT เท่านั้น ใครสมัครสมาชิกเอง (ไม่ว่าจะเลือกแผนกไหน)
// จะได้ role 'user' เสมอ
function resolveRole(role, dept, username) {
  if (username === ADMIN_ACCOUNT.username) return 'admin';
  if (TE_SHARED_ACCOUNT.username && username === TE_SHARED_ACCOUNT.username) return 'technician';
  return 'user';
}

async function getAllUsers() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Users!A2:J1000',
  });
  const rows = res.data.values || [];
 return rows.map(row => ({
  username:     String(row[0] || ''),
    password:     row[1] || '',
    role:         row[2] || '',
    fullname:     row[3] || '',
    dept:         row[4] || '',
    contact:      row[5] || '',
    status:       row[6] || '',
    is_chief:     row[7] || '',
    avatar_url:   row[8] || '',
    line_user_id: row[9] || '',
  }));
}

// ─────────────────────────────────────────────────────────────
// POST /api/users/login
// ─────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();

    if (username === ADMIN_ACCOUNT.username) {
      if (password !== ADMIN_ACCOUNT.password) {
        return res.json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
      }
      const token = signToken({ username: ADMIN_ACCOUNT.username, role: 'admin', dept: ADMIN_ACCOUNT.dept });
     return res.json({
        success:  true,
        token,
        username: ADMIN_ACCOUNT.username,
        name:     ADMIN_ACCOUNT.fullname,
        role:    'admin',
        dept:    ADMIN_ACCOUNT.dept,
        avatar:  ADMIN_ACCOUNT.avatar_url,
        isChief: true,
      });
    }

    // บัญชีกลางทีมช่าง/วิศวกร (username/password กำหนดไว้เองผ่าน env var)
    if (TE_SHARED_ACCOUNT.username && username === TE_SHARED_ACCOUNT.username) {
      if (password !== TE_SHARED_ACCOUNT.password) {
        return res.json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
      }
      const token = signToken({ username: TE_SHARED_ACCOUNT.username, role: TE_SHARED_ACCOUNT.role, dept: TE_SHARED_ACCOUNT.dept });
      return res.json({
        success:    true,
        token,
        username:   TE_SHARED_ACCOUNT.username,
        name:       TE_SHARED_ACCOUNT.fullname,
        role:       TE_SHARED_ACCOUNT.role,
        dept:       TE_SHARED_ACCOUNT.dept,
        avatar:     TE_SHARED_ACCOUNT.avatar_url,
        isChief:    false,
        lineLinked: false,
      });
    }

    const users = await getAllUsers();
    const user  = users.find(u => u.username === username);

    if (!user) {
      return res.json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
    }

    // รองรับทั้งรหัสผ่านแบบเก่า (plaintext) และแบบ bcrypt hash
    // ถ้ายังเป็น plaintext อยู่ จะ hash แล้วอัปเดตกลับเข้าชีตให้อัตโนมัติตอน login สำเร็จ (migrate แบบไม่ต้องหยุดระบบ)
    let passwordOk = false;
    if (isBcryptHash(user.password)) {
      passwordOk = await bcrypt.compare(password, user.password);
    } else {
      passwordOk = password === user.password;
      if (passwordOk) await upgradePasswordHash(username, password);
    }

    if (!passwordOk) {
      return res.json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
    }
    if (user.status !== 'active') {
      return res.json({ success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' });
    }

    const effectiveRole = resolveRole(user.role, user.dept, user.username);
    const token = signToken({ username: user.username, role: effectiveRole, dept: user.dept });

   res.json({
      success:      true,
      token,
      username:     user.username,
      name:         user.fullname,
      role:         effectiveRole,
      dept:         user.dept,
      avatar:       user.avatar_url,
      isChief:      user.is_chief === 'TRUE' || user.is_chief === 'true' || user.is_chief === '1',
      lineLinked:   !!user.line_user_id,   // ← บอก frontend ว่าผูก LINE ไว้แล้วไหม
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/users/register
// ─────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, password, fullname, dept, contact, lineUserId } = req.body;

    if (username.toLowerCase() === ADMIN_ACCOUNT.username.toLowerCase()) {
      return res.json({ success: false, message: 'ไม่สามารถใช้ username นี้ได้' });
    }
    if (TE_SHARED_ACCOUNT.username && username.toLowerCase() === TE_SHARED_ACCOUNT.username.toLowerCase()) {
      return res.json({ success: false, message: 'ไม่สามารถใช้ username นี้ได้' });
    }

    // สมัครสมาชิกได้เฉพาะ role 'user' (ผู้แจ้งซ่อม) เท่านั้น
    // ช่าง/วิศวกร ใช้บัญชีกลาง (TE_SHARED_ACCOUNT) ที่กำหนดไว้ล่วงหน้าเท่านั้น ไม่เปิดให้สมัครเอง
    const role   = 'user';
    const users  = await getAllUsers();
    const exists = users.find(u => u.username === username);
    if (exists) {
      return res.json({ success: false, message: 'Username นี้มีอยู่แล้ว' });
    }

    // ถ้าส่ง lineUserId มาด้วย ให้เช็คว่าถูกผูกกับคนอื่นไปแล้วหรือยัง
    if (lineUserId) {
      const alreadyLinked = users.find(u => u.line_user_id === lineUserId);
      if (alreadyLinked) {
        return res.json({ success: false, message: 'LINE account นี้ถูกผูกกับบัญชีอื่นแล้ว' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          username, passwordHash, role, fullname, dept, contact,
          'active', 'FALSE', '', lineUserId || '',
        ]],
      },
    });

    res.json({ success: true, message: 'ลงทะเบียนสำเร็จ', role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/users  (list all)
// ─────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const users     = await getAllUsers();
    const safeUsers = users.map(u => ({
      username:   u.username,
      fullname:   u.fullname,
      role:       u.role,
      dept:       u.dept,
      contact:    u.contact,
      status:     u.status,
      avatar:     u.avatar_url,
      lineLinked: !!u.line_user_id,
    }));
    res.json({ success: true, users: safeUsers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// LINE OAuth  (ต้องอยู่ก่อน /:username เสมอ)
// ─────────────────────────────────────────────────────────────

// Step 1 — ขอ URL ไป LINE Login
router.get('/line/auth-url', (req, res) => {
  const channelId   = process.env.LINE_CLIENT_ID;
  const redirectUri = process.env.LINE_REDIRECT_URI;
  // mode=popup → ใช้ state พิเศษเพื่อให้ server รู้ว่ามาจาก popup
  const state = req.query.mode === 'popup'
    ? 'popup_register'
    : Math.random().toString(36).slice(2);

  if (!channelId || channelId === 'your_channel_id') {
    return res.status(500).json({
      success: false,
      message: 'กรุณาตั้งค่า LINE_CLIENT_ID ใน .env ก่อน',
    });
  }

  const url = 'https://access.line.me/oauth2/v2.1/authorize'
    + '?response_type=code'
    + `&client_id=${channelId}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&state=${state}`
    + '&scope=profile%20openid';

  res.json({ url, state });
});

// Step 2 — รับ code แลกเป็น token + ดึง profile
router.post('/line/callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'ไม่พบ code จาก LINE' });
    }

    const tokenRes = await axios.post(
      'https://api.line.me/oauth2/v2.1/token',
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.LINE_REDIRECT_URI,
        client_id:     process.env.LINE_CLIENT_ID,
        client_secret: process.env.LINE_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) {
      console.error('LINE token error:', tokenRes.data);
      return res.status(500).json({ success: false, message: 'ได้รับ token จาก LINE ไม่สำเร็จ' });
    }

    const profileRes = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { userId: lineUserId, displayName, pictureUrl } = profileRes.data;

    // ค้นหาว่ามีผูกบัญชีไว้แล้วไหม → login ทันที
    const users  = await getAllUsers();
    const linked = users.find(u => u.line_user_id === lineUserId);

    if (linked) {
      if (linked.status !== 'active') {
        return res.json({ success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' });
      }
      const effectiveRole = resolveRole(linked.role, linked.dept, linked.username);
      return res.json({
        success: true,
        linked:  true,
        name:    linked.fullname,
        role:    effectiveRole,
        dept:    linked.dept,
        avatar:  linked.avatar_url || pictureUrl,
        isChief: linked.is_chief === 'TRUE',
        lineLinked: true,
      });
    }

    // ยังไม่ผูก → ส่งข้อมูล LINE กลับให้ frontend เพื่อผูกบัญชี
    res.json({
      success:     true,
      linked:      false,
      lineUserId,
      displayName,
      pictureUrl,
    });

  } catch (err) {
    console.error('LINE callback error:', err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: 'LINE authentication ล้มเหลว: ' + (err.response?.data?.error_description || err.message),
    });
  }
});

// Step 3 — ผูก lineUserId กับ username ที่มีอยู่ (login แล้ว)
router.post('/line/link', async (req, res) => {
  try {
    const { username, password, lineUserId } = req.body;
    if (!username || !password || !lineUserId) {
      return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
    }

    const users = await getAllUsers();
    const user  = users.find(u => u.username === username);
    if (!user) {
      return res.json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
    }

    // รองรับทั้งรหัสผ่านแบบเก่า (plaintext) และแบบ bcrypt hash เหมือนกับ /login
    // (เดิม endpoint นี้เทียบ plaintext ตรงๆ ซึ่งพังทันทีที่ password ของ user ถูก
    // auto-migrate เป็น bcrypt hash ตอน login สำเร็จครั้งแรก ทำให้ผูก LINE ผ่านหน้านี้ไม่ได้อีกเลย)
    let passwordOk = false;
    if (isBcryptHash(user.password)) {
      passwordOk = await bcrypt.compare(password, user.password);
    } else {
      passwordOk = password === user.password;
      if (passwordOk) await upgradePasswordHash(username, password);
    }
    if (!passwordOk) {
      return res.json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
    }
    if (user.status !== 'active') {
      return res.json({ success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' });
    }

    const alreadyLinked = users.find(u => u.line_user_id === lineUserId);
    if (alreadyLinked && alreadyLinked.username !== username) {
      return res.json({ success: false, message: 'LINE account นี้ถูกผูกกับบัญชีอื่นไปแล้ว' });
    }

    const result   = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A2:J1000',
    });
    const rows     = result.data.values || [];
   const rowIndex = rows.findIndex(r => String(r[0]) === String(username));
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบ user ใน Sheets' });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Users!J${rowIndex + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[lineUserId]] },
    });

    const effectiveRole = resolveRole(user.role, user.dept, user.username);
    res.json({
      success:    true,
      name:       user.fullname,
      role:       effectiveRole,
      dept:       user.dept,
      avatar:     user.avatar_url,
      isChief:    user.is_chief === 'TRUE',
      lineLinked: true,
    });

  } catch (err) {
    console.error('LINE link error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/users/:username/link-line  (ผูก LINE หลัง register)
// ─────────────────────────────────────────────────────────────
router.post('/:username/link-line', async (req, res) => {
  try {
    const { username }  = req.params;
    const { lineUserId } = req.body;
    if (!lineUserId) {
      return res.status(400).json({ success: false, message: 'ไม่พบ lineUserId' });
    }

    const result   = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A2:J1000',
    });
    const rows     = result.data.values || [];
    const rowIndex = rows.findIndex(r => String(r[0]) === String(username));
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบ user' });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Users!J${rowIndex + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[lineUserId]] },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// /:username routes  ← ต้องอยู่หลัง /line/* เสมอ
// ─────────────────────────────────────────────────────────────

// POST /api/users/:username/status  (admin เท่านั้น — ระงับ/เปิดใช้งานบัญชี)
router.post('/:username/status', requireRole('admin'), async (req, res) => {
  try {
    const { username } = req.params;
    const { status }   = req.body;

    const result   = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A2:J1000',
    });
    const rows     = result.data.values || [];
    const rowIndex = rows.findIndex(r => String(r[0]) === String(username));
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบ user' });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Users!G${rowIndex + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/users/:username  (admin เท่านั้น)
router.delete('/:username', requireRole('admin'), async (req, res) => {
  try {
    const { username } = req.params;

    if (username === ADMIN_ACCOUNT.username) {
      return res.json({ success: false, message: 'ไม่สามารถลบ admin ได้' });
    }

    const result   = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A2:J1000',
    });
    const rows     = result.data.values || [];
   const rowIndex = rows.findIndex(r => String(r[0]) === String(username));
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบ user' });

    const sheetRow = rowIndex + 2;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId:    0,
              dimension:  'ROWS',
              startIndex: sheetRow - 1,
              endIndex:   sheetRow,
            },
          },
        }],
      },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/technicians — ดึงรายชื่อช่างทั้งหมด (ใช้ populate dropdown เลือกช่าง)
router.get('/technicians', async (req, res) => {
  try {
    const users = await getAllUsers();
    // เก็บ role 'engineer'/'technician'/'tech' จาก Users sheet ไว้เผื่อมี user เก่า (ก่อนย้ายมาใช้
    // บัญชีกลาง) ที่ยังมีแถวค้างอยู่ — ไม่ใช่ role ที่ใช้งานจริงแล้วในระบบปัจจุบัน
    const legacyNames = users
      .filter(u => ['engineer', 'technician', 'tech'].includes((u.role || '').toLowerCase()))
      .map(u => u.fullname || u.username);

    // ดึงชื่อช่างจากบัญชีกลาง (TechProfiles) — ที่นี่คือ roster หลักของช่างตอนนี้
    let profileNames = [];
    try {
      const profRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'TechProfiles!A2:H1000',
      });
      const rows = profRes.data.values || [];
      profileNames = rows
        .filter(r => (r[6] || 'active') === 'active') // column G = status
        .map(r => r[1] || '') // column B = fullname
        .filter(Boolean);
    } catch (e) {
      // Sheet TechProfiles อาจยังไม่ถูกสร้าง — ไม่ต้อง fail ทั้ง endpoint
      console.warn('[technicians] TechProfiles sheet not found or empty:', e.message);
    }

    const technicians = [...new Set([...profileNames, ...legacyNames])];
    res.json({ success: true, data: technicians });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;