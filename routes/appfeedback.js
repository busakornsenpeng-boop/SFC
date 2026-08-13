// routes/appfeedback.js
// ─────────────────────────────────────────────────────────────
// แบบประเมินความพึงพอใจ "ในการใช้งานเว็บแอพ" โดยรวม — คนละอันกับ satisfaction.js
// ที่ประเมินเป็นรายงานซ่อม (ไฟล์นี้ไม่ผูกกับ JobID ใดๆ ผู้ใช้กดประเมินได้เรื่อยๆ ไม่จำกัดจำนวนครั้ง)
//
// Google Sheet: AppFeedback!A2:I1000  (ต้องสร้าง sheet/tab ชื่อ "AppFeedback" ก่อนใช้งาน
// พร้อมหัวตาราง แถวที่ 1: id | username | requesterName | role | date | q1_easy | q2_speed | q3_design | q4_overall | comment)
// A id | B username | C requesterName | D role | E date
// F q1_easy (ใช้ง่าย) | G q2_speed (เร็ว) | H q3_design (หน้าตา) | I q4_overall (โดยรวม) | J comment
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/adminAuth');

const RANGE = 'AppFeedback!A2:J1000';

const QUESTIONS = [
  { key: 'q1', label: 'ความง่ายในการใช้งาน' },
  { key: 'q2', label: 'ความรวดเร็วของระบบ' },
  { key: 'q3', label: 'หน้าตา/การออกแบบ' },
  { key: 'q4', label: 'ความพึงพอใจโดยรวม' },
];

async function getAllFeedback() {
  const res  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
  const rows = res.data.values || [];
  return rows
    .filter(r => r[0])
    .map(r => {
      const q1 = Number(r[5]) || 0, q2 = Number(r[6]) || 0, q3 = Number(r[7]) || 0, q4 = Number(r[8]) || 0;
      const avg = (q1 + q2 + q3 + q4) / 4;
      return {
        id:            r[0] || '',
        username:      r[1] || '',
        requesterName: r[2] || '',
        role:          r[3] || '',
        date:          r[4] || '',
        q1, q2, q3, q4,
        avg: Math.round(avg * 100) / 100,
        comment: r[9] || '',
      };
    });
}

// GET /api/app-feedback (เฉพาะแอดมิน) — รายการทั้งหมด + สรุปคะแนนเฉลี่ยแต่ละข้อ
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const data = await getAllFeedback();
    const n = data.length;
    const avgOf = key => n ? Math.round((data.reduce((s, d) => s + d[key], 0) / n) * 100) / 100 : 0;
    const summary = {
      total: n,
      avgOverall: n ? Math.round((data.reduce((s, d) => s + d.avg, 0) / n) * 100) / 100 : 0,
      q1: avgOf('q1'), q2: avgOf('q2'), q3: avgOf('q3'), q4: avgOf('q4'),
    };
    res.json({ success: true, data, summary, questions: QUESTIONS });
  } catch (err) {
    console.error('[AppFeedback] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/app-feedback (ต้อง login — ทุก role) — ส่งแบบประเมิน ไม่จำกัดจำนวนครั้ง
// body: { username, requesterName, role, q1, q2, q3, q4, comment }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { username, requesterName, role, q1, q2, q3, q4, comment } = req.body;

    const scores = [q1, q2, q3, q4].map(Number);
    if (scores.some(s => !Number.isFinite(s) || s < 1 || s > 5)) {
      return res.json({ success: false, message: 'กรุณาให้คะแนนครบทุกข้อ (1-5)' });
    }

    const id = 'AF-' + Date.now();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'AppFeedback!A:J',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          id, username || '', requesterName || '', role || '',
          new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
          scores[0], scores[1], scores[2], scores[3], comment || '',
        ]],
      },
    });

    res.json({ success: true, id });
  } catch (err) {
    console.error('[AppFeedback] create error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;