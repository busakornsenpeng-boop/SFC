// routes/satisfaction.js
// ─────────────────────────────────────────────────────────────
// แบบประเมินความพึงพอใจในการซ่อม — ผู้แจ้งซ่อมทำได้ทุกสถานะงาน (ตั้งแต่แจ้งซ่อมเข้ามาเลย ไม่ต้องรอปิดงาน)
// ทำได้ครั้งเดียวต่องาน (กันประเมินซ้ำจาก repairId เดิม)
//
// Google Sheet: Satisfaction!A2:J1000
// A id | B repairId | C requesterName | D machine | E date
// F q1_convenience | G q2_speed | H q3_advice | I q4_overall | J comment
// (คะแนนแต่ละข้อ 1-5, คะแนนรวม = เฉลี่ยของ q1-q4 คำนวณตอนอ่านออก ไม่ได้เก็บลง sheet)
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { requireAuth } = require('../middleware/adminAuth');

const RANGE = 'Satisfaction!A2:J1000';

// หัวข้อคำถามมาตรฐาน 4 ข้อ (ให้ frontend ใช้ label เดียวกันได้ ไม่ต้อง hardcode ซ้ำสองที่)
const QUESTIONS = [
  { key: 'q1', label: 'ความสะดวกในการติดต่อแจ้งซ่อม' },
  { key: 'q2', label: 'ความรวดเร็วในการให้บริการ' },
  { key: 'q3', label: 'การให้คำแนะนำ และการอธิบายอาการ/วิธีแก้ไขปัญหา' },
  { key: 'q4', label: 'ความพึงพอใจโดยรวมต่อการซ่อม/บริการในครั้งนี้' },
];

async function getAllSurveys() {
  const res  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
  const rows = res.data.values || [];
  return rows
    .filter(r => r[0])
    .map(r => {
      const q1 = Number(r[5]) || 0, q2 = Number(r[6]) || 0, q3 = Number(r[7]) || 0, q4 = Number(r[8]) || 0;
      const avg = (q1 + q2 + q3 + q4) / 4;
      return {
        id:            r[0] || '',
        repairId:      r[1] || '',
        requesterName: r[2] || '',
        machine:       r[3] || '',
        date:          r[4] || '',
        q1, q2, q3, q4,
        avg: Math.round(avg * 100) / 100,
        comment: r[9] || '',
      };
    });
}

// GET /api/satisfaction (ต้อง login — ทุก role) — รายการทั้งหมด + สรุปคะแนนเฉลี่ยแต่ละข้อ
// (ใช้ทำหน้าสรุปฝั่งแอดมิน/เล่มโครงงาน และฝั่งผู้แจ้งซ่อมใช้เช็คว่างานไหนเคยประเมินแล้วบ้าง
// เพื่อสลับปุ่ม "ให้คะแนน" ในตารางติดตามงาน — ไม่จำกัดเฉพาะแอดมิน)
router.get('/', requireAuth, async (req, res) => {
  try {
    const data = await getAllSurveys();
    const n = data.length;
    const avgOf = key => n ? Math.round((data.reduce((s, d) => s + d[key], 0) / n) * 100) / 100 : 0;
    const summary = {
      total: n,
      avgOverall: n ? Math.round((data.reduce((s, d) => s + d.avg, 0) / n) * 100) / 100 : 0,
      q1: avgOf('q1'), q2: avgOf('q2'), q3: avgOf('q3'), q4: avgOf('q4'),
    };
    res.json({ success: true, data, summary, questions: QUESTIONS });
  } catch (err) {
    console.error('[Satisfaction] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/satisfaction/:repairId — เช็คว่างานนี้เคยถูกประเมินไปแล้วหรือยัง (ใช้ทั้งฝั่งผู้ใช้และแอดมิน)
router.get('/:repairId', requireAuth, async (req, res) => {
  try {
    const data  = await getAllSurveys();
    const found = data.find(d => d.repairId === req.params.repairId);
    res.json({ success: true, exists: !!found, data: found || null, questions: QUESTIONS });
  } catch (err) {
    console.error('[Satisfaction] get error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/satisfaction (ต้อง login) — ผู้แจ้งซ่อมส่งแบบประเมิน
// body: { repairId, requesterName, machine, q1, q2, q3, q4, comment }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { repairId, requesterName, machine, q1, q2, q3, q4, comment } = req.body;
    if (!repairId) return res.json({ success: false, message: 'ไม่พบรหัสงานซ่อม' });

    const scores = [q1, q2, q3, q4].map(Number);
    if (scores.some(s => !Number.isFinite(s) || s < 1 || s > 5)) {
      return res.json({ success: false, message: 'กรุณาให้คะแนนครบทุกข้อ (1-5)' });
    }

    // เช็คว่างานนี้มีอยู่จริง และยังไม่เคยถูกประเมิน (ประเมินได้ทุกสถานะ ไม่ต้องรอปิดงาน)
    const repRes  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:W1000' });
    const repRows = repRes.data.values || [];
    const repRow  = repRows.find(r => r[0] === repairId);
    if (!repRow) return res.json({ success: false, message: 'ไม่พบใบแจ้งซ่อมนี้' });

    const existing = await getAllSurveys();
    if (existing.some(d => d.repairId === repairId)) {
      return res.json({ success: false, message: 'งานนี้เคยถูกประเมินไปแล้ว' });
    }

    const id = 'SV-' + Date.now();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Satisfaction!A:J',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          id, repairId, requesterName || '', machine || '',
          new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
          scores[0], scores[1], scores[2], scores[3], comment || '',
        ]],
      },
    });

    res.json({ success: true, id });
  } catch (err) {
    console.error('[Satisfaction] create error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;