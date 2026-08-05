const express    = require('express');
const router     = express.Router();
const cloudinary = require('cloudinary').v2;
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { sendLineMessage, getLineUserIdByName, broadcastToTechGroup, sendFlexMessage } = require('./notify');
const { requireAuth, requireRole } = require('../middleware/adminAuth');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log('[repairs.js] loaded — DOWNTIME_DEBUG_BUILD v1');

const LOCKED_STATUSES = ['ปิดงาน', 'ตีกลับ', 'แก้ไข (ตีกลับ)'];
const DONE_STATUSES   = ['ซ่อมเสร็จ', 'ปิดงาน', 'รอตรวจรับ'];

// ── สถานะ "ตีกลับ" ทั้งสองแบบ ──
// - 'ตีกลับ'            → ช่างตีกลับขอข้อมูลเพิ่ม (route /:id/reject)
// - 'แก้ไข (ตีกลับ)'     → ตรวจรับไม่ผ่าน (route /:id/qc)
// ทั้งสองแบบต้องเดิน flow "ส่งกลับให้ผู้แจ้งแก้ไข → resubmit เข้าคิวใหม่" เหมือนกัน
// จึงต้องเช็คคู่กันเสมอ ห้ามเช็คแค่ 'ตีกลับ' เพราะจะทำให้งานตรวจรับไม่ผ่านค้าง ไม่มีทางแก้ไขต่อ
const BOUNCED_STATUSES = ['ตีกลับ', 'แก้ไข (ตีกลับ)'];

// (เดิมมีการจับเวลา "รออะไหล่/ขอหยุดเครื่อง" อัตโนมัติ — คอลัมน์ X (เคยรอ), Y (ระยะเวลาซ่อม
// กรอกเอง), Z (เวลาเริ่มรอ), AA (นาทีรอสะสม) — ตัดทิ้งทั้งหมดแล้วตามที่ทีมงานแจ้งว่าไม่ต้องการ
// ติดตามเวลารอ/เวลาที่ใช้ซ่อมแบบนี้อีกต่อไป สถานะ "รออะไหล่"/"ขอหยุดเครื่อง" ยังเลือกได้ตามปกติ
// แค่ไม่มีการจับเวลา/คำนวณสะสมข้างหลังแล้ว)

// ── สถานะที่จะแจ้งเตือน "ผู้แจ้งงาน" เท่านั้น (ตัดสถานะระหว่างทางที่ไม่จำเป็นออก) ──
// ปรับลิสต์นี้ได้ตามที่คิดว่าสำคัญจริงกับผู้แจ้งงาน
const NOTIFY_REQUESTER_STATUSES = ['ซ่อมเสร็จ', 'ซ่อมเสร็จแล้ว'];

// ── สร้าง JobID format: PDF-001-300626 ──
// เลขรัน (001, 002, 003...) นับรวมทุกแผนกในเดือน+ปีเดียวกัน
// เมื่อขึ้นเดือนใหม่ เลขจะรีเซ็ตกลับมาเริ่มที่ 001 อัตโนมัติ
// ── แปลง string วันที่แบบ Thai locale (พ.ศ.) ที่เก็บไว้ในชีท กลับเป็น Date object (ค.ศ.) ──
// รูปแบบที่ new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) คืนมา
// คือ "D/M/BBBB, HH:mm:ss" โดยปีเป็น พ.ศ. (ค.ศ. + 543) ต้อง -543 กลับก่อนสร้าง Date
function parseThaiDateString(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyyBE, hh, mi, ss] = m;
  const yyyyCE = parseInt(yyyyBE, 10) - 543;
  // ── แก้บั๊ก timezone ──
  // สตริงนี้เก็บเวลา Bangkok local time (UTC+7) อยู่แล้ว (มาจาก toLocaleString('th-TH', {timeZone:'Asia/Bangkok'}))
  // เดิมใช้ `new Date(y, m, d, h, mi, s)` ซึ่งตีความตัวเลขตาม timezone ของเซิร์ฟเวอร์ (Render = UTC)
  // ทำให้เวลาที่ parse ได้เพี้ยนไปเร็วกว่าความจริง 7 ชม. → ค่าที่คำนวณได้ (closed - doneDate ฯลฯ)
  // น้อยกว่าความเป็นจริงไป 420 นาทีทุกครั้ง จึงต้องตีความเป็น UTC+7 แล้วแปลงกลับเป็น UTC instant จริงแทน
  const utcMs = Date.UTC(yyyyCE, parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mi, 10), parseInt(ss, 10)) - 7 * 60 * 60 * 1000;
  const d = new Date(utcMs);
  return isNaN(d.getTime()) ? null : d;
}

// ── เช็คว่าเป็นงาน "ซ่อมฉุกเฉิน (Break Down)" หรือไม่ ──
// ทีมงานแจ้งว่า Downtime ให้นับเฉพาะงานซ่อมฉุกเฉินเท่านั้น (ประเภทอื่น เช่น ซ่อมตามอาการ/
// ปรับปรุงประสิทธิภาพ เครื่องไม่ได้หยุดทำงานจริง จึงไม่นับเป็น Downtime)
// เช็คจากคำว่า "ฉุกเฉิน" แทนการเทียบ string เป๊ะๆ กันเผื่อ label เปลี่ยนคำในวงเล็บ (Break Down) ในอนาคต
function isEmergencyRepairType(opType) {
  return String(opType || '').includes('ฉุกเฉิน');
}

// ── คำนวณ Downtime (นาที) = เวลาซ่อมเสร็จ (คอลัมน์ L) - วันที่แจ้งซ่อม (คอลัมน์ R) ──
// (เดิมคำนวณจาก "เวลาปิดงาน (W) - เวลาซ่อมเสร็จ (L)" — ทีมงานแจ้งให้เปลี่ยนมานับตั้งแต่ตอนแจ้งซ่อม
// จนถึงตอนซ่อมเสร็จแทน เพื่อสะท้อนเวลาที่เครื่องหยุดทำงานจริงตั้งแต่แจ้งซ่อมจนซ่อมเสร็จ)
// นับเฉพาะงาน "ซ่อมฉุกเฉิน (Break Down)" เท่านั้นตามที่ทีมงานแจ้ง — ประเภทอื่นคืนค่า '' เสมอ
// คืนค่าเป็นจำนวนเต็ม (นาที) หรือ '' ถ้าคำนวณไม่ได้/ค่าติดลบ (ข้อมูลผิดปกติ) หรือไม่ใช่งานฉุกเฉิน
function calcDowntimeMinutes(reportDateStr, doneDate, opType) {
  if (!isEmergencyRepairType(opType)) return '';
  const reportDate = parseThaiDateString(reportDateStr);
  if (!reportDate || !doneDate) return '';
  const diffMs = doneDate.getTime() - reportDate.getTime();
  if (diffMs < 0) return '';
  return Math.round(diffMs / 60000);
}

async function writeRepairUpdate(updateData) {
  if (!updateData.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: updateData },
  });
}

async function generateJobId(dept) {
  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yy   = String(now.getFullYear()).slice(-2);
  const dateStr    = `${dd}${mm}${yy}`;   // 300626
  const deptPrefix = (dept || 'GEN').replace(/\s+/g, '').slice(0, 3).toUpperCase();

  // หาเลขรันสูงสุดที่เคยออกไปแล้วในเดือน+ปีนี้ (รวมทุกแผนก) แล้ว +1
  // ── เดิมใช้วิธี "นับจำนวนแถวที่เหลืออยู่ในชีต" +1 ซึ่งผิด เพราะ DELETE ใช้ soft delete
  // (เคลียร์ค่าทั้งแถว) พองานถูกลบ จำนวนแถวจะลดลง แต่เลขรันที่เคยออกไปแล้วของงานอื่นที่ยังไม่ถูกลบ
  // ยังคงค้างอยู่ในชีต ทำให้คำนวณ count+1 ได้เลขที่ซ้ำกับงานที่มีอยู่แล้วจริง (เช่น 008 ออกซ้ำหลายครั้ง
  // และ 007 หายไปเพราะถูกลบ) — ใช้ max(เลขรันที่มีอยู่จริง) แทน จะไม่มีทางออกเลขซ้ำจากการลบงานอีก
  const res  = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:A5000',
  });
  const rows = res.data.values || [];
  let maxRunning = 0;
  rows.forEach(r => {
    const parts = (r[0] || '').split('-');
    if (parts.length < 3) return;
    const datePart = parts[parts.length - 1]; // DDMMYY
    if (datePart.slice(2, 4) !== mm || datePart.slice(4, 6) !== yy) return;
    const n = parseInt(parts[parts.length - 2], 10); // ตัวเลขรัน (001, 002, ...)
    if (!isNaN(n) && n > maxRunning) maxRunning = n;
  });

  const running = String(maxRunning + 1).padStart(3, '0');
  return `${deptPrefix}-${running}-${dateStr}`; // PDF-001-300626
}
async function uploadBase64Image(base64String, filename = 'repair') {
  const result = await cloudinary.uploader.upload(base64String, {
    folder:        'sfc-repair',
    public_id:     `${filename}_${Date.now()}`,
    quality:       'auto:good',   // บีบอัดคุณภาพอัตโนมัติ ยังดูดีอยู่
    fetch_format:  'auto',        // เลือก format ที่เบาที่สุดอัตโนมัติ
    width:         1600,          // ย่อรูปที่กว้างเกิน 1600px ลงมา
    crop:          'limit',       // ย่อแบบไม่ครอบตัด ไม่เสียสัดส่วน
  });
  return result.secure_url;
}

async function processImages(images, prefix = 'img') {
  if (!Array.isArray(images) || !images.length) return [];
  const urls = await Promise.all(
    images.map(async (img, i) => {
      if (!img) return null;
      if (img.startsWith('http'))  return img;
      if (img.startsWith('data:')) return await uploadBase64Image(img, `${prefix}_${i}`);
      return null;
    })
  );
  return urls.filter(Boolean);
}
async function getAllRepairs() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:X1000',
  });
  const rows = res.data.values || [];
  return rows.map(row => ({
    id:           row[0]  || '',
    name:         row[1]  || '',
    dept:         row[2]  || '',
    machine:      row[3]  || '',
    side:         row[4]  || '',
    opType:       row[5]  || '',
    detail:       row[6]  || '',
    img:          row[7]  || '',
    imgAfter:     row[8]  || '',
    status:       row[9]  || '',
    technician:   row[10] || '',
    doneDate:     row[11] || '', // เวลาที่ช่างแจ้งว่าซ่อมเสร็จ ("ซ่อมเสร็จ/ซ่อมเสร็จแล้ว/รอตรวจรับ")
    reporterPhone: row[12] || '', // ← เบอร์โทรผู้แจ้ง (M) — เดิมคอลัมน์นี้เก็บ "กำหนดเสร็จ (เดิม)" ที่เลิกใช้แล้ว นำมาใช้เก็บเบอร์โทรแทน
    note:         row[13] || '',
    productionLine: row[18] || '', // ← สถานที่ปฏิบัติงาน (S) — เดิมคอลัมน์นี้เก็บ jobType (ฟีเจอร์อนุมัติงานโครงการที่เลิกใช้แล้ว) นำมาใช้เก็บสถานที่ปฏิบัติงานแทน
    qcResult:     row[14] || '',
    qcBy:         row[15] || '',
    qcNote:       row[16] || '',
    date:         row[17] || '',
    actionBy:     row[20] || '', // ← ชื่อคนล่าสุดที่ update/reject งานนี้
    acceptedDate: row[21] || '', // ← เวลาที่ช่างกดรับงาน (V)
    closedDate:   row[22] || '', // ← เวลาที่ปิดงานจริง หลังตรวจรับผ่าน/แอดมินปิดงาน (W)
    downtimeMinutes: row[23] || '', // ← Downtime รวม (นาที) = ปิดงาน (W) - เวลาซ่อมเสร็จ (L) (X)
  }));
}

// GET /api/repairs
router.get('/', async (req, res) => {
  try {
    let data = await getAllRepairs();
    if (req.query.status) data = data.filter(r => r.status === req.query.status);
    if (req.query.dept)   data = data.filter(r => r.dept === req.query.dept);
    if (req.query.date_from || req.query.date_to) {
      const from = req.query.date_from ? new Date(req.query.date_from) : null;
      const to   = req.query.date_to   ? new Date(req.query.date_to)   : null;
      data = data.filter(r => {
        const d = new Date(r.date);
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
    }
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      data = data.filter(r =>
        r.machine.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
      );
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── กันแจ้งซ่อมซ้ำจากการกดปุ่มรัวๆ (เช่น ตอน request ค้างแล้วผู้ใช้เข้าใจว่าไม่สำเร็จ) ──
// เก็บ key ล่าสุดไว้ในหน่วยความจำ ถ้ามีคนส่งข้อมูลเดียวกันซ้ำภายใน 15 วิ ให้ตอบ jobId เดิมกลับไปแทนที่จะสร้างใหม่
// หมายเหตุ: กันได้เฉพาะใน process เดียวกัน (เพียงพอสำหรับเคสกดซ้ำระยะสั้นๆ ซึ่งเป็นสาเหตุหลัก)
const _recentSubmits = new Map(); // key → { jobId, expiresAt }
const DUP_GUARD_MS = 15000;
function _dupKey({ requester, dept, machine, detail }) {
  return [requester, dept, machine, detail].map(v => String(v || '').trim()).join('|');
}
function _cleanupDupGuard() {
  const now = Date.now();
  for (const [k, v] of _recentSubmits) if (v.expiresAt < now) _recentSubmits.delete(k);
}

// POST /api/repairs — แจ้งซ่อมใหม่ (ต้อง login ก่อน)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { requester, dept, machine, side, op_type, detail, img, phone, line } = req.body;
    let imgArr = [];
    if (Array.isArray(img)) imgArr = img;
    else if (typeof img === 'string') {
      try { imgArr = JSON.parse(img); } catch { imgArr = [img]; }
    }

    _cleanupDupGuard();
    const dupKey = _dupKey({ requester, dept, machine, detail });
    const existing = _recentSubmits.get(dupKey);
    if (existing) {
      // ส่งซ้ำภายในเวลาสั้นๆ — ถือว่าเป็นการกดซ้ำ ไม่ใช่งานใหม่ ตอบ jobId เดิมกลับไปเลย
      return res.json({ success: true, jobId: existing.jobId, duplicate: true });
    }

    const dateStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); // ✅ บรรทัดเดียว

    // ── รันขนาน: หา jobId (อ่าน Sheet) กับอัปโหลดรูปไป Cloudinary พร้อมกัน ──
    // เดิมทำทีละอย่าง (jobId ก่อน แล้วค่อยรอรูปอัปโหลดเสร็จ) ทำให้ request รวมช้า
    // จนชนกับ watchdog timeout ฝั่ง frontend (20 วิ) โดยเฉพาะตอนแนบรูปจากมือถือ
    // ใช้ prefix ชั่วคราวสำหรับชื่อไฟล์ (ไม่ต้องพึ่ง jobId เพราะยังไม่รู้ตอนนี้)
    const tempPrefix = `${(dept || 'GEN').replace(/\s+/g, '')}_${Date.now()}`;
    const [jobId, imgUrls] = await Promise.all([
      generateJobId(dept),                          // ✅ PDF-001-300626
      processImages(imgArr, `${tempPrefix}_before`),
    ]);
    const imgStr = JSON.stringify(imgUrls);

    _recentSubmits.set(dupKey, { jobId, expiresAt: Date.now() + DUP_GUARD_MS });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Repairs!A:T',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          jobId, requester, dept, machine, side, op_type,
          detail, imgStr, '', 'รอซ่อม', '', '', phone || '', '', '', '', '',
          dateStr, line || '', '', // S = สถานที่ปฏิบัติงาน (เดิมคอลัมน์นี้เก็บ jobType/approval ที่เลิกใช้แล้ว), T ยังไม่ได้ใช้งาน
        ]],
      },
    });

    // ── ตอบกลับ client ทันทีที่บันทึกลง Sheet เสร็จ ──
    // ไม่ต้องรอ LINE notification (เดิม await ก่อน res.json ทำให้ผู้ใช้รอนานขึ้นโดยไม่จำเป็น
    // และถ้า LINE API ช้า/ล่ม จะดันไปชนกับ watchdog timeout ฝั่ง frontend)
    res.json({ success: true, jobId });

    // ── ส่งแจ้งเตือน LINE แบบไม่บล็อก response (fire-and-forget) ──
    (async () => {
      try {
        const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requester);
        if (requesterLineId) {
          await sendLineMessage(requesterLineId,
            `✅ รับแจ้งซ่อมเรียบร้อย!\n` +
            `📋 รหัสงาน: ${jobId}\n` +
            `🔧 เครื่องจักร: ${machine}\n` +
            `📌 สถานะ: รอช่างรับงาน\n` +
            `📅 วันที่แจ้ง: ${dateStr}`
          );
        }
        // แจ้ง admin ผ่าน LINE — แอดมินเป็นผู้กระจายงานให้ช่างเอง (ไม่แจ้งช่างผ่านระบบ)
        await broadcastToTechGroup(jobId, requester, machine, detail, 'รอซ่อม');
      } catch (notifyErr) {
        console.error('[Repairs] LINE notify error (ไม่กระทบการบันทึกงาน):', notifyErr.message);
      }
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/accept — ช่างรับงาน (เฉพาะช่าง/วิศวกร/แอดมิน)
router.post('/:id/accept', requireRole('technician', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { technician } = req.body;
    if (!technician) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อช่าง' });

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:W1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (LOCKED_STATUSES.includes(currentStatus))
      return res.json({ success: false, message: `งานนี้ถูกปิดแล้ว (${currentStatus})` });

    const requesterName    = rows[rowIndex][1]  || '';
    const machine          = rows[rowIndex][3]  || '';
    const alreadyAcceptedAt = rows[rowIndex][21] || ''; // V — กันไม่ให้เวลารับงานถูกเขียนทับถ้าเคยรับไปแล้ว
    const sheetRow          = rowIndex + 2;

    const acceptData = [
      { range: `Repairs!J${sheetRow}`, values: [['กำลังซ่อม']] },
      { range: `Repairs!K${sheetRow}`, values: [[technician]] },
      { range: `Repairs!U${sheetRow}`, values: [[technician]] },
    ];
    // บันทึก "เวลารับงาน" ครั้งแรกเท่านั้น — ใช้คำนวณ "ใช้เวลาแก้ไข" (รับงาน → เสร็จซ่อม) ภายหลัง
    if (!alreadyAcceptedAt) {
      acceptData.push({ range: `Repairs!V${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: acceptData },
    });

    // ตัดแจ้งเตือน requester ตอนช่างรับงาน — เช็คสถานะเองผ่าน LINE bot ได้ (พิมพ์รหัสงาน)
    // ตัดแจ้งเตือน admin ตอนช่างรับงาน — แอดมินรู้ตอนเปิดงาน/ปิดงานพอ

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/update — ช่างอัปเดตสถานะ (เฉพาะช่าง/วิศวกร/แอดมิน)
router.post('/:id/update', requireRole('technician', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, imgAfter, updatedBy } = req.body;
    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:W1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (LOCKED_STATUSES.includes(currentStatus))
      return res.json({ success: false, message: `งานนี้ถูกปิดแล้ว (${currentStatus})` });
    if (DONE_STATUSES.includes(currentStatus) && currentStatus !== 'กำลังซ่อม')
      return res.json({ success: false, message: `งานสถานะ "${currentStatus}" ไม่สามารถแก้ไขย้อนหลังได้` });

    const requesterName = rows[rowIndex][1]  || '';
    const techName      = rows[rowIndex][10] || '';
    const machine        = rows[rowIndex][3]  || '';

    let imgAfterArr = [];
    if (Array.isArray(imgAfter)) imgAfterArr = imgAfter;
    else if (typeof imgAfter === 'string') {
      try { imgAfterArr = JSON.parse(imgAfter); } catch { imgAfterArr = [imgAfter]; }
    }
    const imgAfterUrls = await processImages(imgAfterArr, `${id}_after`);
    const imgAfterStr  = JSON.stringify(imgAfterUrls);

  const sheetRow   = rowIndex + 2;
    const updateData = [
      { range: `Repairs!I${sheetRow}`, values: [[imgAfterStr]] },
      { range: `Repairs!J${sheetRow}`, values: [[status || '']] },
      { range: `Repairs!N${sheetRow}`, values: [[note   || '']] },
    ];
    if (status === 'ซ่อมเสร็จ' || status === 'รอตรวจรับ' || status === 'ซ่อมเสร็จแล้ว')
      updateData.push({ range: `Repairs!L${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
    if (updatedBy)
      updateData.push({ range: `Repairs!U${sheetRow}`, values: [[updatedBy]] });

    await writeRepairUpdate(updateData);

    const statusLabel = {
      'กำลังซ่อม':     '🔧 กำลังดำเนินการซ่อม',
      'ซ่อมเสร็จแล้ว': '✅ ซ่อมเสร็จแล้ว รอตรวจรับ',
      'ซ่อมเสร็จ':     '✅ ซ่อมเสร็จแล้ว รอตรวจรับ',
      'รออะไหล่':      '⏳ รอจัดหาอะไหล่',
      'ขอหยุดเครื่อง': '🛑 ขอหยุดเครื่องเพื่อซ่อม',
      'Workaround':    '🛠 แก้ไขชั่วคราว (Workaround)',
      'ส่งซ่อมภายนอก': '📦 ส่งซ่อมภายนอก',
    }[status] || `📌 ${status}`;

    // แจ้งเตือนผู้แจ้งงานเฉพาะสถานะสำคัญ (ตัดสถานะระหว่างทางที่ไม่จำเป็นออก)
    const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requesterName);
    if (requesterLineId && NOTIFY_REQUESTER_STATUSES.includes(status)) {
      await sendLineMessage(requesterLineId,
        `📢 อัปเดตสถานะงานซ่อม\n` +
        `📋 รหัสงาน: ${id}\n` +
        `🔧 เครื่องจักร: ${machine}\n` +
        `${statusLabel}\n` +
        (note ? `📝 หมายเหตุ: ${note}` : '')
      );
    }

    // ตัดแจ้งเตือน admin ตอน "เสร็จซ่อม/รอตรวจรับ" ออก — แอดมินรู้แค่ตอนเปิดงาน กับ ตอนตรวจรับผ่าน (ปิดงาน) พอ
    // (TODO เปิดใช้ภายหลัง — แจ้งเตือนช่างตอนงานเสร็จ ถ้าต้องการ)

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/qc (เฉพาะผู้แจ้งซ่อม/แอดมิน — ช่างไม่มีสิทธิ์ตรวจรับงานตัวเอง
// เพราะการตรวจรับเป็นหน้าที่ของผู้แจ้ง เพื่อรักษาการตรวจสอบแยกจากคนซ่อม)
router.post('/:id/qc', requireRole('user', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { result, by, note } = req.body;

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:W1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (currentStatus === 'ปิดงาน') return res.json({ success: false, message: 'งานนี้ปิดแล้ว' });

    const requesterName  = rows[rowIndex][1]  || '';
    const techName       = rows[rowIndex][10] || '';
    const machine        = rows[rowIndex][3]  || '';
    // ตรวจรับไม่ผ่าน = งานซ่อมยังไม่เรียบร้อย ต้องกลับไปให้ "ช่างคนเดิม" แก้ไขต่อ (ไม่ใช่ส่งกลับผู้แจ้งขอข้อมูลเพิ่ม
    // แบบ /:id/reject) จึงตั้งสถานะกลับเป็น "กำลังซ่อม" และไม่แตะคอลัมน์ K (ชื่อช่าง) เพื่อให้ช่างเดิมยังเป็นเจ้าของงาน
    const newStatus  = result === 'ผ่านตรวจรับ' ? 'ปิดงาน' : 'กำลังซ่อม';
    const qcFailNote = `[ตรวจรับไม่ผ่าน ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}] ${note || 'ไม่ระบุเหตุผล'}`;
    const sheetRow      = rowIndex + 2;

    const updateData = [
      { range: `Repairs!J${sheetRow}`, values: [[newStatus]]    },
      { range: `Repairs!O${sheetRow}`, values: [[result || '']] },
      { range: `Repairs!P${sheetRow}`, values: [[by     || '']] },
      { range: `Repairs!Q${sheetRow}`, values: [[note   || '']] },
    ];
    // เดิม route นี้เขียนเวลาทับคอลัมน์ L (doneDate) ซ้ำ ทำให้แยกไม่ออกว่า "เสร็จซ่อม" กับ
    // "ปิดงานจริง (ตรวจรับผ่าน)" เกิดขึ้นเมื่อไหร่ — ย้ายมาเขียนคอลัมน์ W (closedDate) แยกต่างหากแทน
    // เพื่อคำนวณ "รอปิดงาน" (เสร็จซ่อม → ปิดงาน) ได้ถูกต้อง (Downtime คำนวณจาก R → L แยกต่างหาก ดูด้านล่าง)
    if (result === 'ผ่านตรวจรับ') {
      updateData.push({ range: `Repairs!W${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
      // หมายเหตุ: Downtime (คอลัมน์ X) ถูกคำนวณไปแล้วตอนสถานะเปลี่ยนเป็น "ซ่อมเสร็จ/รอตรวจรับ"
      // (วันที่แจ้งซ่อม (R) → เวลาซ่อมเสร็จ (L)) ที่ route /:id/status ด้านล่าง — ไม่ต้องคำนวณซ้ำตรงนี้
    } else {
      // บันทึกเหตุผลตรวจรับไม่ผ่านลงคอลัมน์ N (note) — เป็นฟิลด์เดียวกับที่การ์ดงานของช่างโชว์ (j.progress/j.note)
      // ทำให้ช่างเห็นเหตุผลที่ตรวจรับตีกลับตอนเปิดงานเดิมมาแก้ไขต่อ
      updateData.push({ range: `Repairs!N${sheetRow}`, values: [[qcFailNote]] });
    }

    await writeRepairUpdate(updateData);

   if (result === 'ผ่านตรวจรับ') {
      // ตัดแจ้งเตือนออกทั้งหมดตอนตรวจรับผ่าน/ปิดงาน — ไม่ต้องแจ้งผู้แจ้งซ่อม/ช่าง/แอดมิน
    } else {
      // ตัดแจ้งเตือนช่างตอนตรวจรับไม่ผ่านออก — แจ้งแค่แอดมินพอ
      // แจ้ง admin ผ่าน LINE ตอนตรวจรับไม่ผ่าน
      await broadcastToTechGroup(id, requesterName, machine, rows[rowIndex][6] || '', 'ตรวจรับไม่ผ่าน', note || '');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('ตรวจรับงาน error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/reject — ช่างตีกลับ (เฉพาะช่าง/วิศวกร/แอดมิน)
router.post('/:id/reject', requireRole('technician', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, rejectedBy } = req.body;
    if (!reason || !reason.trim())
      return res.status(400).json({ success: false, message: 'กรุณาระบุเหตุผลที่ตีกลับ' });

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:T1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (LOCKED_STATUSES.includes(currentStatus))
      return res.json({ success: false, message: `งานนี้ถูกปิดแล้ว ไม่สามารถตีกลับได้` });

    const requesterName = rows[rowIndex][1] || '';
    const machine       = rows[rowIndex][3] || '';
    const rejectNote    = `[ตีกลับ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}] ${reason}`;
    const sheetRow      = rowIndex + 2;

  const rejectData = [
      { range: `Repairs!J${sheetRow}`, values: [['ตีกลับ']] },
      { range: `Repairs!N${sheetRow}`, values: [[rejectNote]] },
    ];
    if (rejectedBy)
      rejectData.push({ range: `Repairs!U${sheetRow}`, values: [[rejectedBy]] });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: rejectData },
    });

    // แจ้ง requester ให้รู้ว่าต้องแก้ไขข้อมูล
    const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requesterName);
    if (requesterLineId) {
      await sendLineMessage(requesterLineId,
        `⚠️ ใบแจ้งซ่อมถูกตีกลับ\n` +
        `📋 รหัสงาน: ${id}\n` +
        `🔧 เครื่องจักร: ${machine}\n` +
        `📝 เหตุผล: ${reason}\n` +
        `กรุณาแก้ไขข้อมูลและส่งใหม่อีกครั้ง`
      );
    }

    // แจ้งแอดมินด้วย
    await broadcastToTechGroup(id, requesterName, machine, rows[rowIndex][6] || '', 'ตีกลับ', reason);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/resubmit — ผู้แจ้งแก้ไขรายละเอียด/แนบรูปเพิ่ม แล้วส่งกลับเข้าคิวซ่อมอีกครั้ง
// (หลังโดนช่างตีกลับขอข้อมูลเพิ่ม) — ใช้ได้เฉพาะตอนสถานะปัจจุบันเป็น "ตีกลับ" เท่านั้น
router.post('/:id/resubmit', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { detail, side, opType, img, requesterName } = req.body;
    if (!detail || !detail.trim())
      return res.status(400).json({ success: false, message: 'กรุณากรอกรายละเอียดที่แก้ไข' });

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:W1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (!BOUNCED_STATUSES.includes(currentStatus))
      return res.json({ success: false, message: `ส่งงานนี้ใหม่ได้เฉพาะตอนสถานะเป็น "ตีกลับ" เท่านั้น (ปัจจุบัน: ${currentStatus})` });

    // กันแก้ไขงานของคนอื่น — เช็คว่าชื่อผู้ส่งตรงกับผู้แจ้งเดิม (ถ้า frontend ส่งชื่อมาด้วย)
    const originalRequester = rows[rowIndex][1] || '';
    if (requesterName && originalRequester &&
        requesterName.trim().toLowerCase() !== originalRequester.trim().toLowerCase()) {
      return res.json({ success: false, message: 'คุณไม่มีสิทธิ์แก้ไขงานนี้ (ไม่ใช่ผู้แจ้งเดิม)' });
    }

    const machine = rows[rowIndex][3] || '';

    let imgArr = [];
    if (Array.isArray(img)) imgArr = img;
    else if (typeof img === 'string') {
      try { imgArr = JSON.parse(img); } catch { imgArr = [img]; }
    }
    const imgUrls = await processImages(imgArr, `${id}_resubmit`);
    const imgStr  = JSON.stringify(imgUrls);

    const now          = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const resubmitNote = `[ผู้แจ้งแก้ไขและส่งใหม่ ${now}]`;
    const sheetRow      = rowIndex + 2;

    const resubmitData = [
      { range: `Repairs!G${sheetRow}`, values: [[detail]] },
      { range: `Repairs!H${sheetRow}`, values: [[imgStr]] },
      { range: `Repairs!J${sheetRow}`, values: [['รอซ่อม']] },
      { range: `Repairs!K${sheetRow}`, values: [['']] }, // ล้างชื่อช่างเดิม — เข้าคิวใหม่ให้ใครก็ได้รับ
      { range: `Repairs!N${sheetRow}`, values: [[resubmitNote]] },
    ];
    if (side)   resubmitData.push({ range: `Repairs!E${sheetRow}`, values: [[side]] });
    if (opType) resubmitData.push({ range: `Repairs!F${sheetRow}`, values: [[opType]] });
    if (requesterName)
      resubmitData.push({ range: `Repairs!U${sheetRow}`, values: [[requesterName]] });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: resubmitData },
    });

    // แจ้งผู้แจ้งยืนยันว่าส่งใหม่สำเร็จ
    const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, originalRequester);
    if (requesterLineId) {
      await sendLineMessage(requesterLineId,
        `✅ ส่งข้อมูลแก้ไขเรียบร้อย!\n` +
        `📋 รหัสงาน: ${id}\n` +
        `🔧 เครื่องจักร: ${machine}\n` +
        `📌 สถานะ: กลับเข้าคิวรอช่างรับงานอีกครั้ง`
      );
    }

    // แจ้งแอดมิน เหมือนงานใหม่เข้าคิว
    await broadcastToTechGroup(id, originalRequester, machine, detail, 'รอซ่อม');

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/admin-undo-reject — แอดมินยกเลิกการตีกลับของช่าง (เห็นว่าไม่สมควรตีกลับ)
// (เฉพาะแอดมิน) ใช้ได้เฉพาะตอนสถานะปัจจุบันเป็น "ตีกลับ" เท่านั้น — ส่งงานกลับเข้าคิว "รอซ่อม"
// ให้ช่างคนไหนก็ได้มารับต่อ โดยไม่ต้องรอผู้แจ้งแก้ไขข้อมูลใหม่ (ล้างชื่อช่างเดิมออกด้วย เพื่อให้เข้าคิวสะอาดๆ)
router.post('/:id/admin-undo-reject', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { note, by } = req.body;

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:W1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (!BOUNCED_STATUSES.includes(currentStatus))
      return res.json({ success: false, message: `ยกเลิกการตีกลับได้เฉพาะงานที่อยู่ในสถานะ "ตีกลับ" เท่านั้น (ปัจจุบัน: ${currentStatus})` });

    const requesterName = rows[rowIndex][1] || '';
    const machine        = rows[rowIndex][3] || '';
    const now             = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const undoNote        = `[แอดมินยกเลิกการตีกลับ ${now}]${note ? ' ' + note : ''}`;
    const sheetRow         = rowIndex + 2;

    const undoData = [
      { range: `Repairs!J${sheetRow}`, values: [['รอซ่อม']] },
      { range: `Repairs!K${sheetRow}`, values: [['']] }, // ล้างชื่อช่างเดิม — เข้าคิวใหม่ให้ใครก็ได้รับ
      { range: `Repairs!N${sheetRow}`, values: [[undoNote]] },
    ];
    if (by)
      undoData.push({ range: `Repairs!U${sheetRow}`, values: [[by]] });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: undoData },
    });

    // แจ้งผู้แจ้งว่าแอดมินตรวจสอบแล้ว งานกลับเข้าคิวซ่อมอีกครั้ง (ไม่ต้องแก้ไขอะไรเพิ่ม)
    const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requesterName);
    if (requesterLineId) {
      await sendLineMessage(requesterLineId,
        `✅ แอดมินตรวจสอบใบแจ้งซ่อมของคุณแล้ว\n` +
        `📋 รหัสงาน: ${id}\n` +
        `🔧 เครื่องจักร: ${machine}\n` +
        `งานของคุณกลับเข้าสู่คิวซ่อมอีกครั้ง ไม่ต้องแก้ไขข้อมูลเพิ่มเติมครับ`
      );
    }

    // แจ้งแอดมิน (คนอื่น) ด้วยว่ามีการยกเลิกการตีกลับ งานกลับเข้าคิวแล้ว
    await broadcastToTechGroup(id, requesterName, machine, rows[rowIndex][6] || '', 'รอซ่อม', undoNote);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/status — admin update (เฉพาะแอดมิน)
router.post('/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, technician, imgAfter } = req.body;

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:W1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    // งานที่ปิด/ตีกลับแล้ว ห้าม "เปลี่ยนสถานะ" ซ้ำ แต่ยังแก้วันที่/หมายเหตุ/ช่างย้อนหลังได้ตามปกติ
    // (เผื่อกรอกผิดตอนแรก หรือแอดมินต้องแก้ข้อมูลย้อนหลังให้ตรงกับที่เกิดขึ้นจริง)
    if (LOCKED_STATUSES.includes(currentStatus) && status && status !== currentStatus)
      return res.json({ success: false, message: `งานถูกปิดแล้ว (${currentStatus}) ไม่สามารถเปลี่ยนสถานะได้ — แก้ไขวันที่/หมายเหตุยังทำได้ปกติ` });

    let imgAfterArr = [];
    if (Array.isArray(imgAfter)) imgAfterArr = imgAfter;
    else if (typeof imgAfter === 'string') {
      try { imgAfterArr = JSON.parse(imgAfter); } catch { imgAfterArr = [imgAfter]; }
    }
    const imgAfterUrls = await processImages(imgAfterArr, `${id}_after`);
    const imgAfterStr  = JSON.stringify(imgAfterUrls);

    const requesterName = rows[rowIndex][1] || '';
    const machine       = rows[rowIndex][3] || '';
    const oldTech       = rows[rowIndex][10] || '';

    const sheetRow   = rowIndex + 2;
    const updateData = [
      { range: `Repairs!I${sheetRow}`, values: [[imgAfterStr]]  },
      { range: `Repairs!J${sheetRow}`, values: [[status || '']] },
      { range: `Repairs!K${sheetRow}`, values: [[technician || oldTech]] },
      { range: `Repairs!N${sheetRow}`, values: [[note   || '']] },
    ];

    // ── เวลาทุกจุด (รับงาน/เสร็จซ่อม/ปิดงาน) ให้ระบบจับอัตโนมัติทั้งหมดตามสถานะ ไม่มีให้แก้มือแล้ว ──

    // "เวลารับงาน" (V) — เผื่อแอดมิน assign ช่างแล้วเปลี่ยนสถานะเองโดยไม่ผ่านปุ่ม "รับงาน" ของช่าง
    const alreadyAcceptedAt = rows[rowIndex][21] || '';
    const startedStatuses = ['กำลังซ่อม', 'รออะไหล่', 'ขอหยุดเครื่อง', 'Workaround', 'ซ่อมเสร็จ', 'รอตรวจรับ', 'ซ่อมเสร็จแล้ว', 'ปิดงาน'];
    if (status && startedStatuses.includes(status) && !alreadyAcceptedAt) {
      updateData.push({ range: `Repairs!V${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
    }

    // "เวลาเสร็จซ่อม" (L) — auto-set ตอนสถานะเปลี่ยนเป็นเสร็จ/รอตรวจรับ เหมือนเดิม
    if (['ซ่อมเสร็จ', 'รอตรวจรับ', 'ซ่อมเสร็จแล้ว'].includes(status)) {
      const doneDate = new Date();
      const doneStr  = doneDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      updateData.push({ range: `Repairs!L${sheetRow}`, values: [[doneStr]] });

      // เขียน Downtime (นาที) ลงคอลัมน์ X = เวลาซ่อมเสร็จ (L) - วันที่แจ้งซ่อม (R)
      // นับเฉพาะงาน "ซ่อมฉุกเฉิน (Break Down)" เท่านั้น (คอลัมน์ F = opType)
      const reportDateStr   = rows[rowIndex][17] || ''; // R
      const opType           = rows[rowIndex][5]  || ''; // F
      const downtimeMinutes = calcDowntimeMinutes(reportDateStr, doneDate, opType);
      console.log(`[DOWNTIME-DEBUG][status] id=${id} opType="${opType}" reportDateStr="${reportDateStr}" doneStr="${doneStr}" downtimeMinutes=${downtimeMinutes}`);
      if (downtimeMinutes !== '') {
        updateData.push({ range: `Repairs!X${sheetRow}`, values: [[downtimeMinutes]] });
      } else {
        console.warn(`[DOWNTIME-DEBUG][status] id=${id} ไม่ได้เขียน Downtime — ไม่ใช่งานฉุกเฉิน หรือ reportDateStr/doneDate parse ไม่ผ่าน หรือ diff ติดลบ`);
      }
    }

    // "เวลาปิดงานจริง" (W) — auto-set เฉพาะตอนสถานะ "เปลี่ยนเข้า" ปิดงาน (กันเขียนทับซ้ำถ้าปิดงานอยู่แล้วแค่แก้หมายเหตุ)
    const isClosingNow = status === 'ปิดงาน' && currentStatus !== 'ปิดงาน';
    if (isClosingNow) {
      updateData.push({ range: `Repairs!W${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
    }

    await writeRepairUpdate(updateData);

    const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requesterName);
    if (requesterLineId && status && NOTIFY_REQUESTER_STATUSES.includes(status)) {
      const statusMsg = {
        'รอซ่อม':       '📋 ระบบได้บันทึกการแจ้งซ่อมของคุณแล้ว',
        'กำลังซ่อม':     '🔧 ช่างกำลังดำเนินการซ่อมอยู่',
        'รออะไหล่':      '⏳ ระบบรอจัดหาอะไหล่เข้า',
        'ขอหยุดเครื่อง': '🛑 ขอหยุดเครื่องเพื่อดำเนินการซ่อม',
        'ซ่อมเสร็จแล้ว': '✅ ซ่อมเสร็จแล้ว รอตรวจรับงาน',
        'ซ่อมเสร็จ':     '✅ ซ่อมเสร็จแล้ว รอตรวจรับงาน',
        'ปิดงาน':       '🎉 ปิดงานซ่อมเรียบร้อย',
        'ตีกลับ':       '⚠️ ใบแจ้งซ่อมถูกตีกลับ',
      }[status] || `📌 สถานะ: ${status}`;

      await sendLineMessage(requesterLineId,
        `📢 อัปเดตสถานะงานซ่อม\n` +
        `📋 รหัสงาน: ${id}\n` +
        `🔧 เครื่องจักร: ${machine}\n` +
        `${statusMsg}\n` +
        (note ? `📝 หมายเหตุ: ${note}` : '')
      );
    }

    // ตัดแจ้งเตือนช่างตอนถูก assign ออก — แอดมินมอบหมายงานเองนอกระบบ
    // ตัดแจ้งเตือน admin ออก — แอดมินเป็นผู้แก้เอง ไม่จำเป็นต้องแจ้งเตือนตัวเอง

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/repairs/:id (เฉพาะแอดมิน) — ลบรายการแจ้งซ่อม
// ใช้วิธีเคลียร์ค่าทั้งแถวแทนการลบแถวจริง (soft delete) — ป้องกันปัญหาเลขแถวเลื่อนของ
// รายการอื่นที่อยู่ด้านล่าง (แพทเทิร์นเดียวกับ PM_Calendar ใน pm.js)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:X1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบรายการนี้' });

    const sheetRow = rowIndex + 2;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `Repairs!A${sheetRow}:X${sheetRow}`,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Repairs] delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;