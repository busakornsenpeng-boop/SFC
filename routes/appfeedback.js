// routes/appfeedback.js
// ─────────────────────────────────────────────────────────────
// แบบประเมินความพึงพอใจ "ในการใช้งานเว็บแอพ" โดยรวม — คนละอันกับ satisfaction.js
// ที่ประเมินเป็นรายงานซ่อม (ไฟล์นี้ไม่ผูกกับ JobID ใดๆ ผู้ใช้กดประเมินได้เรื่อยๆ ไม่จำกัดจำนวนครั้ง)
//
// อัปเดต: ขยายจากแบบประเมิน 6 ข้อ (คะแนน 1-5 ล้วน) เป็นแบบสำรวจ 4 ส่วน ตามฟอร์ม
// "แบบสำรวจการใช้งานและปัญหาที่พบในแอปพลิเคชัน":
//   ส่วนที่ 1: ข้อมูลทั่วไป (แผนก/อุปกรณ์/ความถี่การใช้งาน)
//   ส่วนที่ 2: ประเมินความพึงพอใจ 6 ข้อ (q1-q6 เดิม — คงคำถาม/ตำแหน่งคอลัมน์เดิมไว้ทั้งหมด)
//   ส่วนที่ 3: ปัญหาที่พบ (เลือกได้หลายข้อ + ระบุอื่นๆ)
//   ส่วนที่ 4: ข้อเสนอแนะและความต้องการเพิ่มเติม (คำตอบเปิด 3 ข้อ)
//
// หมายเหตุ: คอลัมน์ L (comment) เป็นฟิลด์เดิมก่อนขยายฟอร์ม — เลิกใช้แล้ว (deprecated)
// เก็บไว้เฉยๆ เพื่อไม่ให้ข้อมูลเก่าที่เคยกรอกก่อนหน้านี้หายไป entry ใหม่จะปล่อยว่าง
// และใช้คอลัมน์ T (additional_comment / ข้อ 4.3) แทน
//
// Google Sheet: AppFeedback!A2:T1000  (ต้องขยาย header แถวที่ 1 ของ sheet "AppFeedback" เพิ่ม
// คอลัมน์ M-T ตามด้านล่างนี้ — คอลัมน์ A-L ของเดิมไม่ต้องแก้ไข)
// A id | B username | C requesterName | D role | E date
// F q1_easy | G q2_speed | H q3_design | I q4_accuracy | J q5_stability | K q6_overall
// L comment (เดิม — deprecated ไม่ใช้แล้ว)
// M department | N device | O frequency
// P problems (รายการปัญหาที่เลือก คั่นด้วย ";") | Q problems_other
// R improve_most (4.1) | S new_feature (4.2) | T additional_comment (4.3)
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/adminAuth');

const RANGE = 'AppFeedback!A2:T1000';

// ส่วนที่ 2 — ประเมินความพึงพอใจ (คงเดิมทุกคำ ไม่เปลี่ยนตำแหน่งคอลัมน์)
const QUESTIONS = [
  { key: 'q1', label: 'ความง่ายในการใช้งาน (เมนูชัดเจน ไม่งงขั้นตอน)' },
  { key: 'q2', label: 'ความเร็วในการทำงาน (การโหลดหน้าเว็บ/บันทึกข้อมูล)' },
  { key: 'q3', label: 'ความสวยงามและการจัดวาง (ตัวหนังสืออ่านง่าย ปุ่มชัดเจน)' },
  { key: 'q4', label: 'ความถูกต้องของข้อมูล (ระบบคำนวณและแสดงผลถูกต้อง)' },
  { key: 'q5', label: 'ความเสถียรของระบบ (ไม่ค่อยค้าง หรือเด้งหลุด)' },
  { key: 'q6', label: 'ภาพรวมความพึงพอใจในการใช้งาน' },
];

// ส่วนที่ 1 — ตัวเลือกอ้างอิง (ฝั่ง client เป็นคนโชว์ radio แต่ฝั่ง server อิงชุดนี้ตอนสรุปผล)
const DEPARTMENTS = [
  'ฝ่ายผลิต / ปฏิบัติการ',
  'ฝ่ายคลังสินค้า / สต็อก',
  'ฝ่ายซ่อมบำรุง / วางแผน',
  'ฝ่ายควบคุมคุณภาพ (QA/QC)',
  'ฝ่ายบริหาร / สำนักงาน',
  'อื่นๆ',
];

const DEVICES = [
  'สมาร์ทโฟนระบบ Android (เช่น Samsung, OPPO, Vivo, Xiaomi)',
  'สมาร์ทโฟนระบบ iOS (iPhone)',
  'แท็บเล็ต / iPad',
  'คอมพิวเตอร์ / เว็บเบราว์เซอร์ (Web Application)',
];

const FREQUENCIES = [
  'ทุกวัน (หลายครั้งต่อวัน)',
  'ทุกวัน (วันละ 1 ครั้ง)',
  '2-3 ครั้งต่อสัปดาห์',
  'สัปดาห์ละ 1 ครั้ง',
  'นานๆ ครั้ง / นานกว่า 1 สัปดาห์ครั้ง',
];

// ส่วนที่ 3 — ปัญหาที่พบ (เลือกได้หลายข้อ)
const PROBLEMS = [
  { key: 'p1', label: 'ไม่เคยพบปัญหาใดๆ (ใช้งานได้ราบรื่นดี)' },
  { key: 'p2', label: 'แอปพลิเคชันช้า / โหลดนาน ขณะเปิดหน้าหรือบันทึกข้อมูล' },
  { key: 'p3', label: 'แอปหลุด / เด้งออกอัตโนมัติ ขณะกำลังใช้งาน' },
  { key: 'p4', label: 'แนบรูปภาพหรือสแกนไฟล์ไม่ได้ / ล่าช้า' },
  { key: 'p5', label: 'ข้อมูลไม่บันทึก / ข้อมูลสูญหาย หลังกดส่ง' },
  { key: 'p6', label: 'การแสดงผลผิดเพี้ยน (ตัวหนังสือซ้อน ปุ่มกดทับกัน)' },
  { key: 'p7', label: 'สับสนขั้นตอนการใช้งาน ไม่รู้ว่าต้องกดตรงไหนต่อ' },
  { key: 'p8', label: 'การแจ้งเตือน (Notification) ไม่ทำงาน หรือล่าช้า' },
  { key: 'p9', label: 'ระบบคำนวณหรือแสดงผลสถิติผิดพลาด' },
];
const PROBLEM_KEYS = PROBLEMS.map(p => p.key);

async function getAllFeedback() {
  const res  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
  const rows = res.data.values || [];
  return rows
    .filter(r => r[0])
    .map(r => {
      const q1 = Number(r[5]) || 0, q2 = Number(r[6]) || 0, q3 = Number(r[7]) || 0,
            q4 = Number(r[8]) || 0, q5 = Number(r[9]) || 0, q6 = Number(r[10]) || 0;
      const avg = (q1 + q2 + q3 + q4 + q5 + q6) / 6;
      return {
        id:            r[0]  || '',
        username:      r[1]  || '',
        requesterName: r[2]  || '',
        role:          r[3]  || '',
        date:          r[4]  || '',
        q1, q2, q3, q4, q5, q6,
        avg: Math.round(avg * 100) / 100,
        comment:            r[11] || '', // เดิม — deprecated
        department:         r[12] || '',
        device:             r[13] || '',
        frequency:          r[14] || '',
        problems:           r[15] ? r[15].split(';').filter(Boolean) : [],
        problemsOther:      r[16] || '',
        improveMost:        r[17] || '',
        newFeature:         r[18] || '',
        additionalComment:  r[19] || '',
      };
    });
}

// GET /api/app-feedback (เฉพาะแอดมิน) — รายการทั้งหมด + สรุปผลทุกส่วน
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const data = await getAllFeedback();
    const n = data.length;
    const avgOf = key => n ? Math.round((data.reduce((s, d) => s + d[key], 0) / n) * 100) / 100 : 0;

    const countBy = values => {
      const counts = {};
      values.filter(Boolean).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
      return counts;
    };

    const problemCounts = {};
    PROBLEM_KEYS.forEach(k => { problemCounts[k] = 0; });
    data.forEach(d => d.problems.forEach(k => {
      if (problemCounts[k] === undefined) problemCounts[k] = 0;
      problemCounts[k]++;
    }));

    const summary = {
      total: n,
      avgOverall: n ? Math.round((data.reduce((s, d) => s + d.avg, 0) / n) * 100) / 100 : 0,
      q1: avgOf('q1'), q2: avgOf('q2'), q3: avgOf('q3'), q4: avgOf('q4'), q5: avgOf('q5'), q6: avgOf('q6'),
      byDepartment: countBy(data.map(d => d.department)),
      byDevice:     countBy(data.map(d => d.device)),
      byFrequency:  countBy(data.map(d => d.frequency)),
      problemCounts,
    };

    res.json({
      success: true,
      data,
      summary,
      questions: QUESTIONS,
      departments: DEPARTMENTS,
      devices: DEVICES,
      frequencies: FREQUENCIES,
      problems: PROBLEMS,
    });
  } catch (err) {
    console.error('[AppFeedback] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/app-feedback (ต้อง login — ทุก role) — ส่งแบบประเมิน ไม่จำกัดจำนวนครั้ง
// body: {
//   username, requesterName, role,
//   department, device, frequency,        // ส่วนที่ 1 — บังคับกรอกทุกข้อ
//   q1, q2, q3, q4, q5, q6,                // ส่วนที่ 2 — บังคับให้คะแนนทุกข้อ (1-5)
//   problems: string[], problemsOther,     // ส่วนที่ 3 — บังคับเลือกอย่างน้อย 1 ข้อ
//   improveMost, newFeature, additionalComment, // ส่วนที่ 4 — กรอกหรือไม่ก็ได้
// }
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      username, requesterName, role,
      department, device, frequency,
      q1, q2, q3, q4, q5, q6,
      problems, problemsOther,
      improveMost, newFeature, additionalComment,
    } = req.body;

    // ส่วนที่ 1 — บังคับกรอกครบ
    if (!department || !device || !frequency) {
      return res.json({ success: false, message: 'กรุณากรอกข้อมูลทั่วไปให้ครบ (แผนก, อุปกรณ์, ความถี่การใช้งาน)' });
    }

    // ส่วนที่ 2 — บังคับให้คะแนนครบ 1-5
    const scores = [q1, q2, q3, q4, q5, q6].map(Number);
    if (scores.some(s => !Number.isFinite(s) || s < 1 || s > 5)) {
      return res.json({ success: false, message: 'กรุณาให้คะแนนความพึงพอใจครบทุกข้อ (1-5)' });
    }

    // ส่วนที่ 3 — บังคับเลือกอย่างน้อย 1 ข้อ
    const selectedProblems = Array.isArray(problems) ? problems.filter(Boolean) : [];
    if (!selectedProblems.length) {
      return res.json({ success: false, message: 'กรุณาเลือกอย่างน้อย 1 ข้อในหัวข้อปัญหาที่พบ (เลือก "ไม่เคยพบปัญหาใดๆ" ได้ถ้าไม่มีปัญหา)' });
    }

    const id = 'AF-' + Date.now();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'AppFeedback!A:T',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          id, username || '', requesterName || '', role || '',
          new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
          scores[0], scores[1], scores[2], scores[3], scores[4], scores[5],
          '', // L comment — deprecated ไม่ใช้แล้ว ปล่อยว่างสำหรับ entry ใหม่
          department, device, frequency,
          selectedProblems.join(';'), problemsOther || '',
          improveMost || '', newFeature || '', additionalComment || '',
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