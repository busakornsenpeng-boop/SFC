// routes/forkliftcheck.js
// ─────────────────────────────────────────────────────────────
// ตรวจเช็คก่อนเริ่มผลิต — รถโฟล์คลิฟท์ (เฟส 1: แผนก ENG)
// ดิจิไทซ์จากฟอร์มกระดาษ "Forklift Daily Check Sheet" 2 แบบ:
//   - รถไฟฟ้า (Electric / LINDE)  → 18 รายการ
//   - รถเครื่องยนต์ (Engine / KOMATSU) → 17 รายการ
// แต่ละคันเช็ค "ทุกวันที่เปิดใช้งาน" (ดู /today สำหรับสถานะรายวัน)
//
// Google Sheet ที่ต้องสร้างเพิ่ม:
//
// ForkliftMaster!A2:F1000  (รายชื่อรถ/เครื่องจักรหลัก)
//   A id | B code | C template (electric|engine) | D model | E department | F status (active|inactive)
//
// ForkliftCheck!A2:L1000  (ผลตรวจเช็คประจำวัน)
//   A id | B date | C time | D code | E department | F template
//   G checkerRole | H checkerName | I hourMeter | J overallResult | K items(JSON) | L remarks
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/adminAuth');

const MASTER_RANGE = 'ForkliftMaster!A2:F1000';
const CHECK_RANGE  = 'ForkliftCheck!A2:L1000';

// ── เทมเพลตรายการตรวจเช็ค — คงที่ตามฟอร์มกระดาษเดิม ──
const CHECKLIST_TEMPLATES = {
  electric: {
    label: 'รถโฟล์คลิฟท์ไฟฟ้า (Electric Forklift)',
    frequencyNote: 'ตรวจทุกวันก่อนใช้งาน (ข้อ 14 ตรวจเดือนละครั้ง)',
    items: [
      { key: 'e1',  label: 'ตรวจระดับน้ำกลั่นในแบตเตอรี่', standard: 'อยู่ในระดับปกติ', method: 'ดูด้วยตา' },
      { key: 'e2',  label: 'ประจุไฟฟ้าแบตเตอรี่ให้เต็มก่อนนำไปใช้งาน', standard: 'ต้องเต็มทุกครั้ง', method: 'ดูหน้าจอกระแสไฟ' },
      { key: 'e3',  label: 'ขั้วต่อสายแบตเตอรี่', standard: 'ต้องแน่น', method: 'ใช้มือจับขั้ว' },
      { key: 'e4',  label: 'สวิทช์ควบคุมเดินหน้า-ถอยหลัง', standard: 'ต้องทำงานปกติ', method: 'ใช้งานจริง' },
      { key: 'e5',  label: 'การเคลื่อนที่ของรถและการบังคับเลี้ยว', standard: 'ทำงานคล่องไม่ติดขัด', method: 'ขับจริง' },
      { key: 'e6',  label: 'การหยุดรถ ระบบเบรค', standard: 'หยุดทุกครั้ง, มีเสียงคลิก', method: 'เบรคจริง' },
      { key: 'e7',  label: 'ตัวรถด้านใน, ด้านนอก, เบรค', standard: 'สภาพดี, ไม่มีฝุ่น', method: 'ดูด้วยตาและใช้ลมเป่า' },
      { key: 'e8',  label: 'ระบบไฟสัญญาณต่างๆ ไฟไซเรน สัญญาณถอยหลัง และแตร', standard: 'ต้องทำงานปกติ', method: 'เปิดระบบทำงาน' },
      { key: 'e9',  label: 'ความตึงของโซ่', standard: 'ต้องตึงหย่อนน้อย 5 ซม.', method: 'ใช้มือกดที่โซ่' },
      { key: 'e10', label: 'สภาพยาง, กระทะล้อ, น็อตล้อ', standard: 'สภาพดี, หมุนไม่มีเสียง', method: 'ดูด้วยตา, ขับจริง' },
      { key: 'e11', label: 'กระจกมองข้างหรือมองหลัง', standard: 'สภาพดี, ไม่สกปรก, ไม่แตกร้าว, ปรับองศาได้', method: 'ดูด้วยตา' },
      { key: 'e12', label: 'การยกงาขึ้น และตรวจสภาพงา', standard: 'ยกขึ้นได้, งาไม่ชำรุด', method: 'ดูด้วยตาและยกงา' },
      { key: 'e13', label: 'ระบบไฮโดรลิกและกระบอกไฮโดรลิก', standard: 'ทำงานปกติ, ไม่รั่วซึม', method: 'ดูด้วยตา, ยกงาขึ้น-ลง' },
      { key: 'e14', label: 'การปรับสภาพแบตเตอรี่ประจำเดือน', standard: 'ไฟเต็มทุกครั้ง', method: 'ดูหน้าจอกระแสไฟ (1 ครั้ง/เดือน)' },
      { key: 'e15', label: 'ตรวจสภาพถังดับเพลิง', standard: 'เกจวัดแรงดันอยู่ในเกณฑ์ปกติ', method: 'ดูด้วยตา, เขย่าถัง' },
      { key: 'e16', label: 'ตรวจเช็คกล้องติดรถยนต์', standard: 'ต้องทำงานปกติ', method: 'ดูด้วยตา, ปิดเปิดกุญแจรถ' },
      { key: 'e17', label: 'ตรวจเช็คชั่วโมงการทำงานของตัวรถ', standard: 'ดูที่จอแสดงชั่วโมงที่ตัวรถ', method: 'ดูด้วยตา' },
      { key: 'e18', label: 'บันทึกเลขชั่วโมงการใช้รถ', standard: 'จดบันทึกทุกครั้ง', method: 'ดูด้วยตาและจดบันทึก' },
    ],
  },
  engine: {
    label: 'รถโฟล์คลิฟท์เครื่องยนต์ (Engine Forklift)',
    frequencyNote: 'ตรวจทุกวันก่อนใช้งาน',
    items: [
      { key: 'g1',  label: 'ระดับน้ำมันเครื่อง', standard: 'Engine fluid\'s level', method: 'ดูด้วยตา' },
      { key: 'g2',  label: 'ระดับน้ำในหม้อน้ำ', standard: 'Radiator\'s water level', method: 'ดูด้วยตา' },
      { key: 'g3',  label: 'ความสะอาดของกรองอากาศ', standard: 'Air filter cleans', method: 'ดูด้วยตา' },
      { key: 'g4',  label: 'น้ำกลั่นในแบตเตอรี่', standard: 'Distill water checks', method: 'ดูด้วยตา' },
      { key: 'g5',  label: 'ระดับน้ำมันเบรค', standard: 'Brake fluid checks', method: 'ดูด้วยตา' },
      { key: 'g6',  label: 'สภาพยาง', standard: 'Tire condition', method: 'ดูด้วยตา' },
      { key: 'g7',  label: 'สภาพกะทะล้อ', standard: 'The condition of wheel cover', method: 'ดูด้วยตา' },
      { key: 'g8',  label: 'ระบบไฮดรอลิค - สายไฮดรอลิค', standard: 'Hydraulic system condition', method: 'ดูด้วยตา' },
      { key: 'g9',  label: 'ระบบแสงสว่าง - สายไฟต่างๆ (ไฟหน้า ไฟเลี้ยว ไฟเบรค ไฟหรี่ ไฟถอยหลัง แตร ไฟไซเรน)', standard: 'All lighting\'s condition', method: 'ดูด้วยตา, ใช้งานจริง' },
      { key: 'g10', label: 'สภาพงา - การยกขึ้นลง', standard: 'Fork\'s lift up/down\'s condition', method: 'ดูด้วยตาและยกงา' },
      { key: 'g11', label: 'ระบบเบรค - คลัชท์', standard: 'Brake and clutch system', method: 'เบรคจริง' },
      { key: 'g12', label: 'โครงหลังคา น็อตยึดโครงหลังคา กระจกมองหลัง', standard: 'สภาพดี ไม่หลวม', method: 'ดูด้วยตา' },
      { key: 'g13', label: 'สภาพความพร้อมของถังดับเพลิงที่ติดรถ', standard: 'พร้อมใช้งาน', method: 'ดูด้วยตา, เขย่าถัง' },
      { key: 'g14', label: 'ตรวจสอบสภาพเข็มขัดนิรภัยและเบาะคนขับ', standard: 'สภาพดี ใช้งานได้', method: 'ดูด้วยตา' },
      { key: 'g15', label: 'สภาพความสะอาด', standard: 'F/L\'s cleans condition', method: 'ดูด้วยตา' },
      { key: 'g16', label: 'กล้องติดรถยนต์', standard: 'ต้องทำงานปกติ', method: 'ดูด้วยตา, ปิดเปิดกุญแจรถ' },
      { key: 'g17', label: 'บันทึกเลขชั่วโมงการใช้รถ', standard: 'จดบันทึกทุกครั้ง', method: 'ดูด้วยตาและจดบันทึก' },
    ],
  },
};

// ── รายชื่อรถตั้งต้น (seed) — ใช้ตอน ForkliftMaster ว่างเปล่า ──
// มาจากไฟล์ที่แผนก ENG ส่งมา: รถเช่าไฟฟ้า LINDE FE-01..FE-19 (ไม่มีรหัสแผนกต่อท้าย — ใช้ร่วมกันหลายแผนก
// จึงลงเป็น ENG ผู้ดูแลกลาง) และรถเครื่องยนต์ KOMATSU ที่มีรหัสแผนกต่อท้ายชัดเจน
const SEED_MASTER = [
  ...Array.from({ length: 19 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { code: `FE-${n}`, template: 'electric', model: 'LINDE Electric Forklift', department: 'ENG' };
  }),
  { code: 'FDG04-WFG', template: 'engine', model: 'KOMATSU FD20T-14', department: 'WFG' },
  { code: 'FDB06-PDB', template: 'engine', model: 'KOMATSU FD25C-16', department: 'PDB' },
  { code: 'FDG07-WFG', template: 'engine', model: 'KOMATSU FD20T-16', department: 'WFG' },
  { code: 'FOG08-WFG', template: 'engine', model: 'KOMATSU FD25T-17', department: 'WFG' },
  { code: 'FDG09-WFG', template: 'engine', model: 'KOMATSU FD20T-17', department: 'WFG' },
  { code: 'FOW10-WRM', template: 'engine', model: 'KOMATSU FD20T-17', department: 'WRM' },
  { code: 'FDF11-PDF', template: 'engine', model: 'KOMATSU FD25T-17', department: 'PDF' },
];

async function getMaster() {
  const res  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: MASTER_RANGE });
  const rows = res.data.values || [];
  return rows.filter(r => r[0]).map((r, i) => ({
    rowIndex:   i + 2,
    id:         r[0] || '',
    code:       r[1] || '',
    template:   r[2] || 'electric',
    model:      r[3] || '',
    department: r[4] || '',
    status:     r[5] || 'active',
  }));
}

// GET /api/forklift-check/templates — เทมเพลตรายการตรวจเช็คทั้งหมด
router.get('/templates', (req, res) => {
  res.json({ success: true, templates: CHECKLIST_TEMPLATES });
});

// GET /api/forklift-check/master?department=ENG — รายชื่อรถ (เฉพาะ active)
router.get('/master', async (req, res) => {
  try {
    const { department } = req.query;
    let list = await getMaster();
    list = list.filter(m => m.status === 'active');
    if (department) list = list.filter(m => m.department === department);
    res.json({ success: true, data: list.map(({ rowIndex, ...safe }) => safe) });
  } catch (err) {
    console.error('[ForkliftCheck] master list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/forklift-check/master/seed (เฉพาะแอดมิน) — โหลดรายชื่อรถตั้งต้นเข้า Sheet ครั้งแรก
router.post('/master/seed', requireRole('admin'), async (req, res) => {
  try {
    const existing = await getMaster();
    const existingCodes = new Set(existing.map(m => m.code));
    const rows = SEED_MASTER
      .filter(m => !existingCodes.has(m.code))
      .map(m => ['FL-' + Date.now() + '-' + m.code, m.code, m.template, m.model, m.department, 'active']);

    if (rows.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'ForkliftMaster!A:F',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
      });
    }
    res.json({ success: true, added: rows.length, skipped: SEED_MASTER.length - rows.length });
  } catch (err) {
    console.error('[ForkliftCheck] seed error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/forklift-check/master (เฉพาะแอดมิน) — เพิ่มรถคันใหม่
router.post('/master', requireRole('admin'), async (req, res) => {
  try {
    const { code, template, model, department } = req.body;
    if (!code || !template || !department) {
      return res.json({ success: false, message: 'กรุณากรอกรหัสรถ, เทมเพลต และแผนกให้ครบ' });
    }
    if (!CHECKLIST_TEMPLATES[template]) {
      return res.json({ success: false, message: 'เทมเพลตไม่ถูกต้อง (ต้องเป็น electric หรือ engine)' });
    }
    const existing = await getMaster();
    if (existing.some(m => m.code === code)) {
      return res.json({ success: false, message: `รหัสรถ "${code}" มีอยู่แล้ว` });
    }
    const id = 'FL-' + Date.now();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'ForkliftMaster!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[id, code, template, model || '', department, 'active']] },
    });
    res.json({ success: true, id });
  } catch (err) {
    console.error('[ForkliftCheck] master create error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/forklift-check/master/:id (เฉพาะแอดมิน) — ปิดใช้งานรถ (ไม่ลบแถวจริง เพื่อรักษาประวัติ)
router.delete('/master/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const list = await getMaster();
    const unit = list.find(m => m.id === id);
    if (!unit) return res.json({ success: false, message: 'ไม่พบรถคันนี้' });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `ForkliftMaster!F${unit.rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['inactive']] },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[ForkliftCheck] master delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/forklift-check/today?department=ENG&date=YYYY-MM-DD
// สถานะรายวัน: รถคันไหนเช็คแล้ว / ยังไม่เช็ค (ใช้ทำ "รายการที่ต้องตรวจวันนี้")
router.get('/today', async (req, res) => {
  try {
    const { department } = req.query;
    const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD

    let master = (await getMaster()).filter(m => m.status === 'active');
    if (department) master = master.filter(m => m.department === department);

    const checkRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: CHECK_RANGE });
    const checkRows = checkRes.data.values || [];
    const checkedToday = new Set(
      checkRows.filter(r => r[1] === date).map(r => r[3]) // r[3] = code
    );

    const data = master.map(m => ({
      code:       m.code,
      template:   m.template,
      model:      m.model,
      department: m.department,
      checked:    checkedToday.has(m.code),
    }));

    res.json({ success: true, date, data });
  } catch (err) {
    console.error('[ForkliftCheck] today status error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/forklift-check — บันทึกผลตรวจเช็ค 1 คัน (ต้อง login)
// body: { code, department, template, checkerRole, checkerName, hourMeter, overallResult, items:[{key,status,note}], remarks }
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      code, department, template,
      checkerRole, checkerName, hourMeter,
      overallResult, items, remarks,
    } = req.body;

    if (!code || !template || !checkerRole || !checkerName) {
      return res.json({ success: false, message: 'กรุณาระบุรถ, ผู้ตรวจ (บทบาท+ชื่อ) ให้ครบ' });
    }
    if (!CHECKLIST_TEMPLATES[template]) {
      return res.json({ success: false, message: 'เทมเพลตไม่ถูกต้อง' });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.json({ success: false, message: 'กรุณากรอกรายการตรวจเช็คให้ครบ' });
    }

    const now  = new Date();
    const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const time = now.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
    const id   = 'FC-' + Date.now();

    // ถ้ามีข้อใดเป็น "need_improvement" ให้ overall เป็น "ต้องปรับปรุง" โดยอัตโนมัติ เว้นแต่ระบุมาแล้ว
    const hasIssue = items.some(it => it.status === 'need_improvement');
    const finalOverall = overallResult || (hasIssue ? 'ต้องปรับปรุง' : 'ปกติ');

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'ForkliftCheck!A:L',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          id, date, time, code, department || '', template,
          checkerRole, checkerName, hourMeter || '', finalOverall,
          JSON.stringify(items), remarks || '',
        ]],
      },
    });

    res.json({ success: true, id, overall: finalOverall, hasIssue });
  } catch (err) {
    console.error('[ForkliftCheck] submit error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/forklift-check/history?department=ENG&code=FE-01&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { department, code, from, to } = req.query;
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: CHECK_RANGE });
    const rows = result.data.values || [];

    let data = rows.filter(r => r[0]).map(r => ({
      id:            r[0]  || '',
      date:          r[1]  || '',
      time:          r[2]  || '',
      code:          r[3]  || '',
      department:    r[4]  || '',
      template:      r[5]  || '',
      checkerRole:   r[6]  || '',
      checkerName:   r[7]  || '',
      hourMeter:     r[8]  || '',
      overallResult: r[9]  || '',
      items:         (() => { try { return JSON.parse(r[10] || '[]'); } catch { return []; } })(),
      remarks:       r[11] || '',
    }));

    if (department) data = data.filter(d => d.department === department);
    if (code)       data = data.filter(d => d.code === code);
    if (from)       data = data.filter(d => d.date >= from);
    if (to)         data = data.filter(d => d.date <= to);

    data.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[ForkliftCheck] history error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;