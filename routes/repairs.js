const express    = require('express');
const router     = express.Router();
const cloudinary = require('cloudinary').v2;
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { sendLineMessage, getLineUserIdByName, broadcastToAdmins, sendFlexMessage } = require('./notify');
const { requireAuth, requireRole } = require('../middleware/adminAuth');
const repairWorkflow = require('../lib/repairWorkflow');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const LOCKED_STATUSES = ['ปิดงาน', 'ตีกลับ', 'แก้ไข (ตีกลับ)'];
const DONE_STATUSES   = ['ซ่อมเสร็จ', 'ปิดงาน', 'รอตรวจรับ'];

// ── สถานะ "ตีกลับ" ทั้งสองแบบ ──
// - 'ตีกลับ'            → ช่างตีกลับขอข้อมูลเพิ่ม (route /:id/reject)
// - 'แก้ไข (ตีกลับ)'     → ตรวจรับไม่ผ่าน (route /:id/qc)
// ทั้งสองแบบต้องเดิน flow "ส่งกลับให้ผู้แจ้งแก้ไข → resubmit เข้าคิวใหม่" เหมือนกัน
// จึงต้องเช็คคู่กันเสมอ ห้ามเช็คแค่ 'ตีกลับ' เพราะจะทำให้งานตรวจรับไม่ผ่านค้าง ไม่มีทางแก้ไขต่อ
const BOUNCED_STATUSES = ['ตีกลับ', 'แก้ไข (ตีกลับ)'];

// ── สถานะที่นับเป็น "กำลังรอ" (รออะไหล่ / ขอหยุดเครื่อง) ──
// ใช้จับเวลาเข้า-ออกสถานะนี้ เพื่อคำนวณ "ใช้เวลารออะไหล่" แยกจาก "ใช้เวลาซ่อม"
const WAIT_STATUSES = ['รออะไหล่', 'ขอหยุดเครื่อง'];

// แปลงข้อความวันที่แบบที่ระบบเก็บ "D/M/YYYY, HH:mm:ss" (toLocaleString th-TH) กลับเป็น Date
function parseThaiDateTime(str) {
  return repairWorkflow.parseThaiDateTime(str);
  /* legacy implementation retained below for reference
  if (!str) return null;
  try {
    const [dPart, tPart] = String(str).split(',').map(s => (s || '').trim());
    const parts = dPart.split('/');
    if (parts.length !== 3) return null;
    let y = parseInt(parts[2]);
    if (y > 2400) y -= 543; // พ.ศ. → ค.ศ.
    const [hh, mm, ss] = (tPart || '00:00:00').split(':').map(Number);
    return new Date(y, parseInt(parts[1]) - 1, parseInt(parts[0]), hh || 0, mm || 0, ss || 0);
  } catch (e) { return null; } */
}

// คำนวณการเปลี่ยนสถานะเข้า/ออกจากช่วง "รอ" (รออะไหล่/ขอหยุดเครื่อง)
// - เพิ่งเข้าสถานะรอ  → บันทึกเวลาเริ่มรอ (Z)
// - เพิ่งออกจากสถานะรอ → รวมเวลาที่รอไปสะสมไว้ (AA) แล้วเคลียร์เวลาเริ่มรอ (Z)
// - ยังอยู่ในสถานะรอเหมือนเดิม (เช่นสลับ รออะไหล่ ↔ ขอหยุดเครื่อง) → ไม่แตะ ให้นับเวลาต่อเนื่อง
function buildWaitUpdateData(sheetRow, currentStatus, newStatus, waitStartRaw, waitMinutesRaw) {
  return repairWorkflow.buildWaitUpdateData(sheetRow, currentStatus, newStatus, waitStartRaw, waitMinutesRaw);
  /* legacy implementation retained below for reference
  const wasWaiting = WAIT_STATUSES.includes(currentStatus);
  const isWaiting   = !!newStatus && WAIT_STATUSES.includes(newStatus);
  const data = [];

  if (!wasWaiting && isWaiting) {
    data.push({ range: `Repairs!Z${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
  } else if (wasWaiting && !isWaiting) {
    const start     = parseThaiDateTime(waitStartRaw);
    const prevTotal = parseFloat(waitMinutesRaw) || 0;
    const elapsed   = start ? Math.max(0, (Date.now() - start.getTime()) / 60000) : 0;
    data.push({ range: `Repairs!AA${sheetRow}`, values: [[Math.round(prevTotal + elapsed)]] });
    data.push({ range: `Repairs!Z${sheetRow}`,  values: [['']] });
  }
  return data; */
}

// ── สถานะที่จะแจ้งเตือน "ผู้แจ้งงาน" เท่านั้น (ตัดสถานะระหว่างทางที่ไม่จำเป็นออก) ──
// ปรับลิสต์นี้ได้ตามที่คิดว่าสำคัญจริงกับผู้แจ้งงาน
const NOTIFY_REQUESTER_STATUSES = ['ซ่อมเสร็จ', 'ซ่อมเสร็จแล้ว'];

// ── สร้าง JobID format: PDF-001-300626 ──
// เลขรัน (001, 002, 003...) นับรวมทุกแผนกในเดือน+ปีเดียวกัน
// เมื่อขึ้นเดือนใหม่ เลขจะรีเซ็ตกลับมาเริ่มที่ 001 อัตโนมัติ
async function generateJobId(dept) {
  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yy   = String(now.getFullYear()).slice(-2);
  const dateStr    = `${dd}${mm}${yy}`;   // 300626
  const deptPrefix = (dept || 'GEN').replace(/\s+/g, '').slice(0, 3).toUpperCase();

  // นับ job ทั้งหมด (รวมทุกแผนก) ที่อยู่ในเดือน+ปีนี้
  const res  = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:A5000',
  });
  const rows = res.data.values || [];
  const count = rows.filter(r => {
    const parts = (r[0] || '').split('-');
    if (parts.length < 3) return false;
    const datePart = parts[parts.length - 1]; // DDMMYY
    return datePart.slice(2, 4) === mm &&
           datePart.slice(4, 6) === yy;
  }).length;

  const running = String(count + 1).padStart(3, '0');
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
    range: 'Repairs!A2:AA1000',
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
    eta:          row[12] || '', // เดิม — เหลือไว้เผื่อยังมีที่ใช้อยู่ (ช่างฝั่ง tech update)
    note:         row[13] || '',
    qcResult:     row[14] || '',
    qcBy:         row[15] || '',
    qcNote:       row[16] || '',
    date:         row[17] || '',
    jobType:      row[18] || 'ซ่อมปกติ',
    approval:     row[19] || '',
    actionBy:     row[20] || '', // ← ชื่อคนล่าสุดที่ update/reject งานนี้
    acceptedDate: row[21] || '', // ← เวลาที่ช่างกดรับงาน (V)
    closedDate:   row[22] || '', // ← เวลาที่ปิดงานจริง หลังตรวจรับผ่าน/แอดมินปิดงาน (W)
    hadWait:      row[23] || '', // ← 'TRUE' ถ้างานนี้เคยผ่านสถานะรออะไหล่/ขอหยุดเครื่อง (X)
    repairDuration: row[24] || '', // ← เวลาที่ใช้ซ่อม กรอกเองโดยช่างตอนอัปเดตงาน (Y)
    waitStart:    row[25] || '', // ← เวลาที่เริ่มเข้าสถานะรออะไหล่/ขอหยุดเครื่อง (ถ้ากำลังรออยู่ตอนนี้) (Z)
    waitMinutes:  row[26] || '', // ← จำนวนนาทีสะสมที่เคยรอไปแล้ว (นับรวมทุกช่วงที่เคยเข้ารอ) (AA)
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

// POST /api/repairs — แจ้งซ่อมใหม่ (ต้อง login ก่อน)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { requester, dept, machine, side, op_type, detail, img, job_type } = req.body;
    let imgArr = [];
    if (Array.isArray(img)) imgArr = img;
    else if (typeof img === 'string') {
      try { imgArr = JSON.parse(img); } catch { imgArr = [img]; }
    }

    const jobId   = await generateJobId(dept);          // ✅ PDF-001-300626
    const dateStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); // ✅ บรรทัดเดียว
    const imgUrls = await processImages(imgArr, `${jobId}_before`);
    const imgStr  = JSON.stringify(imgUrls);
    const resolvedJobType = job_type || 'ซ่อมปกติ';
    const approval = ['ติดตั้งใหม่', 'งานโครงการ'].includes(resolvedJobType) ? 'รออนุมัติ' : '';

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Repairs!A:T',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          jobId, requester, dept, machine, side, op_type,
          detail, imgStr, '', 'รอซ่อม', '', '', '', '', '', '', '',
          dateStr, resolvedJobType, approval,
        ]],
      },
    });

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
    await broadcastToAdmins(jobId, requester, machine, detail, 'รอซ่อม');
    res.json({ success: true, jobId });
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

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:X1000' });
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
    const { status, note, imgAfter, updatedBy, repairDuration } = req.body;
    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:AA1000' });
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
    const waitStartRaw   = rows[rowIndex][25] || '';
    const waitMinutesRaw = rows[rowIndex][26] || '';

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
    // ติดธง "เคยรอ" ไว้ถาวร — ใช้เตือนตอนแสดงระยะเวลาว่าตัวเลขรวมช่วงรออะไหล่/หยุดเครื่องด้วย
    if (status === 'รออะไหล่' || status === 'ขอหยุดเครื่อง')
      updateData.push({ range: `Repairs!X${sheetRow}`, values: [['TRUE']] });
    if (updatedBy)
      updateData.push({ range: `Repairs!U${sheetRow}`, values: [[updatedBy]] });
    if (repairDuration)
      updateData.push({ range: `Repairs!Y${sheetRow}`, values: [[repairDuration]] });
    // เข้า/ออกสถานะ "รออะไหล่-ขอหยุดเครื่อง" — จับเวลาอัตโนมัติเพื่อคำนวณ "ใช้เวลารออะไหล่"
    updateData.push(...buildWaitUpdateData(sheetRow, currentStatus, status, waitStartRaw, waitMinutesRaw));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updateData },
    });

    const statusLabel = {
      'กำลังซ่อม':     '🔧 กำลังดำเนินการซ่อม',
      'ซ่อมเสร็จแล้ว': '✅ ซ่อมเสร็จแล้ว รอตรวจรับ',
      'ซ่อมเสร็จ':     '✅ ซ่อมเสร็จแล้ว รอตรวจรับ',
      'รออะไหล่':      '⏳ รอจัดหาอะไหล่',
      'ขอหยุดเครื่อง': '🛑 ขอหยุดเครื่องเพื่อซ่อม',
      'Workaround':    '🛠 แก้ไขชั่วคราว (Workaround)',
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

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:X1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (currentStatus === 'ปิดงาน') return res.json({ success: false, message: 'งานนี้ปิดแล้ว' });

    const requesterName = rows[rowIndex][1]  || '';
    const techName      = rows[rowIndex][10] || '';
    const machine       = rows[rowIndex][3]  || '';
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
    // เพื่อคำนวณ "รอปิดงาน" (เสร็จซ่อม → ปิดงาน) ได้ถูกต้อง
    if (result === 'ผ่านตรวจรับ') {
      updateData.push({ range: `Repairs!W${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
    } else {
      // บันทึกเหตุผลตรวจรับไม่ผ่านลงคอลัมน์ N (note) — เป็นฟิลด์เดียวกับที่การ์ดงานของช่างโชว์ (j.progress/j.note)
      // ทำให้ช่างเห็นเหตุผลที่ตรวจรับตีกลับตอนเปิดงานเดิมมาแก้ไขต่อ
      updateData.push({ range: `Repairs!N${sheetRow}`, values: [[qcFailNote]] });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updateData }
    });

   if (result === 'ผ่านตรวจรับ') {
      const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requesterName);
      if (requesterLineId) {
        await sendLineMessage(requesterLineId,
          `🎉 งานซ่อมผ่านการตรวจรับและปิดงานแล้ว!\n` +
          `📋 รหัสงาน: ${id}\n` +
          `🔧 เครื่องจักร: ${machine}\n` +
          `✅ ตรวจสอบโดย: ${by}`
        );
      }
      // ตัดแจ้งเตือนช่างตอนตรวจรับผ่านออก (แอดมินเป็นผู้ประสานงานให้ช่างเอง)
      // แจ้ง admin ผ่าน LINE
      await broadcastToAdmins(id, requesterName, machine, rows[rowIndex][6] || '', 'ปิดงาน', `✅ ผ่านตรวจรับ - ${by}`);
    } else {
      // แจ้งช่างคนที่รับงานนี้ไว้ — ตรวจรับไม่ผ่าน งานกลับเข้าสถานะ "กำลังซ่อม" ให้แก้ไขต่อ
      const techLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, techName);
      if (techLineId) {
        await sendLineMessage(techLineId,
          `⚠️ งานซ่อมไม่ผ่านการตรวจรับ!\n` +
          `📋 รหัสงาน: ${id}\n` +
          `🔧 เครื่องจักร: ${machine}\n` +
          `📝 เหตุผล: ${note || 'ไม่ระบุ'}\n` +
          `กรุณาดำเนินการแก้ไขต่อแล้วส่งตรวจรับอีกครั้ง`
        );
      }
      // แจ้ง admin ผ่าน LINE ตอนตรวจรับไม่ผ่าน
      await broadcastToAdmins(id, requesterName, machine, rows[rowIndex][6] || '', 'ตรวจรับไม่ผ่าน', note || '');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('ตรวจรับงาน error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/approval (เฉพาะแอดมิน — อนุมัติงานติดตั้งใหม่/งานโครงการ)
router.post('/:id/approval', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { result, progressNote } = req.body;

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:T1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const sheetRow   = rowIndex + 2;
    const updateData = [{ range: `Repairs!T${sheetRow}`, values: [[result || '']] }];
    if (result === 'อนุมัติ') {
      updateData.push({ range: `Repairs!J${sheetRow}`, values: [['ปิดงาน']] });
      updateData.push({ range: `Repairs!L${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
    }
    if (result === 'รออนุมัติ' && progressNote)
      updateData.push({ range: `Repairs!N${sheetRow}`, values: [[`[${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}] ${progressNote}`]] });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updateData },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
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
    await broadcastToAdmins(id, requesterName, machine, rows[rowIndex][6] || '', 'ตีกลับ', reason);

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

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:AA1000' });
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
    await broadcastToAdmins(id, originalRequester, machine, detail, 'รอซ่อม');

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

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:AA1000' });
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

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:AA1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    const waitStartRaw   = rows[rowIndex][25] || '';
    const waitMinutesRaw = rows[rowIndex][26] || '';
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
      updateData.push({ range: `Repairs!L${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
    }

    // "เวลาปิดงานจริง" (W) — auto-set เฉพาะตอนสถานะ "เปลี่ยนเข้า" ปิดงาน (กันเขียนทับซ้ำถ้าปิดงานอยู่แล้วแค่แก้หมายเหตุ)
    if (status === 'ปิดงาน' && currentStatus !== 'ปิดงาน') {
      updateData.push({ range: `Repairs!W${sheetRow}`, values: [[new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] });
    }

    // ติดธง "เคยรอ" ไว้ถาวร — ใช้เตือนตอนแสดงระยะเวลาว่าตัวเลขรวมช่วงรออะไหล่/หยุดเครื่องด้วย
    if (status === 'รออะไหล่' || status === 'ขอหยุดเครื่อง') {
      updateData.push({ range: `Repairs!X${sheetRow}`, values: [['TRUE']] });
    }
    // เข้า/ออกสถานะ "รออะไหล่-ขอหยุดเครื่อง" — จับเวลาอัตโนมัติเพื่อคำนวณ "ใช้เวลารออะไหล่"
    updateData.push(...buildWaitUpdateData(sheetRow, currentStatus, status, waitStartRaw, waitMinutesRaw));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updateData }
    });

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

module.exports = router;
