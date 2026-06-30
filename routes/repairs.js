const express    = require('express');
const router     = express.Router();
const cloudinary = require('cloudinary').v2;
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { sendLineMessage, getLineUserIdByName } = require('./notify');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const LOCKED_STATUSES = ['ปิดงาน', 'ตีกลับ'];
const DONE_STATUSES   = ['ซ่อมเสร็จ', 'ปิดงาน', 'รอ QC'];

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
    folder:    'sfc-repair',
    public_id: `${filename}_${Date.now()}`,
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
    range: 'Repairs!A2:T1000',
  });
  const rows = res.data.values || [];
  return rows.map(row => ({
    id:         row[0]  || '',
    name:       row[1]  || '',
    dept:       row[2]  || '',
    machine:    row[3]  || '',
    side:       row[4]  || '',
    opType:     row[5]  || '',
    detail:     row[6]  || '',
    img:        row[7]  || '',
    imgAfter:   row[8]  || '',
    status:     row[9]  || '',
    technician: row[10] || '',
    doneDate:   row[11] || '',
    eta:        row[12] || '',
    note:       row[13] || '',
    qcResult:   row[14] || '',
    qcBy:       row[15] || '',
    qcNote:     row[16] || '',
    date:       row[17] || '',
    jobType:    row[18] || 'ซ่อมปกติ',
    approval:   row[19] || '',
  }));
}

// ── Broadcast แจ้งเตือนช่าง/วิศวกรทุกคนที่ผูก LINE ──
async function broadcastToTechs(message) {
  try {
    const res  = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A2:J1000',
    });
    const rows = res.data.values || [];
    const targets = rows.filter(r =>
      ['technician', 'engineer', 'tech'].includes((r[2] || '').toLowerCase()) && r[9]
    );
    await Promise.all(targets.map(r => sendLineMessage(r[9], message)));
  } catch (err) {
    console.error('[LINE Broadcast] ช่าง error:', err.message);
  }
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

// POST /api/repairs — แจ้งซ่อมใหม่
router.post('/', async (req, res) => {
  try {
    const { requester, dept, machine, side, op_type, detail, img, job_type } = req.body;
    let imgArr = [];
    if (Array.isArray(img)) imgArr = img;
    else if (typeof img === 'string') {
      try { imgArr = JSON.parse(img); } catch { imgArr = [img]; }
    }

    const jobId   = await generateJobId(dept);          // ✅ PDF-001-300626
    const dateStr = new Date().toLocaleString('th-TH'); // ✅ บรรทัดเดียว
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

    const shortDetail = (detail || '').length > 60 ? detail.slice(0, 60) + '...' : (detail || '');
    await broadcastToTechs(
      `🔔 มีใบแจ้งซ่อมใหม่!\n` +
      `📋 รหัสงาน: ${jobId}\n` +
      `🔧 เครื่องจักร: ${machine}\n` +
      `📍 แผนก: ${dept}\n` +
      `📝 อาการ: ${shortDetail}\n` +
      `📅 ${dateStr}`
    );

    res.json({ success: true, jobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/accept — ช่างรับงาน
router.post('/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;
    const { technician } = req.body;
    if (!technician) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อช่าง' });

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:T1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (LOCKED_STATUSES.includes(currentStatus))
      return res.json({ success: false, message: `งานนี้ถูกปิดแล้ว (${currentStatus})` });

    const requesterName = rows[rowIndex][1] || '';
    const machine       = rows[rowIndex][3] || '';
    const sheetRow      = rowIndex + 2;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: [
        { range: `Repairs!J${sheetRow}`, values: [['กำลังซ่อม']] },
        { range: `Repairs!K${sheetRow}`, values: [[technician]] },
      ]},
    });

    const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requesterName);
    if (requesterLineId) {
      await sendLineMessage(requesterLineId,
        `🔧 ช่างรับงานซ่อมของคุณแล้ว!\n` +
        `📋 รหัสงาน: ${id}\n` +
        `🔧 เครื่องจักร: ${machine}\n` +
        `👨‍🔧 ช่างซ่อม: ${technician}\n` +
        `📌 สถานะ: กำลังซ่อม`
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/update — ช่างอัปเดตสถานะ
router.post('/:id/update', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, eta, imgAfter } = req.body;

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:T1000' });
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
    const machine       = rows[rowIndex][3]  || '';

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
      { range: `Repairs!M${sheetRow}`, values: [[eta    || '']] },
      { range: `Repairs!N${sheetRow}`, values: [[note   || '']] },
    ];
    if (status === 'ซ่อมเสร็จ' || status === 'รอ QC' || status === 'ซ่อมเสร็จแล้ว')
      updateData.push({ range: `Repairs!L${sheetRow}`, values: [[new Date().toLocaleString('th-TH')]] });

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

    const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requesterName);
    if (requesterLineId) {
      await sendLineMessage(requesterLineId,
        `📢 อัปเดตสถานะงานซ่อม\n` +
        `📋 รหัสงาน: ${id}\n` +
        `🔧 เครื่องจักร: ${machine}\n` +
        `${statusLabel}\n` +
        (note ? `📝 หมายเหตุ: ${note}` : '')
      );
    }

    if (status === 'ซ่อมเสร็จแล้ว' || status === 'ซ่อมเสร็จ') {
      const techLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, techName);
      if (techLineId) {
        await sendLineMessage(techLineId,
          `✅ งานซ่อมของคุณเสร็จสิ้น\n` +
          `📋 รหัสงาน: ${id}\n` +
          `🔧 เครื่องจักร: ${machine}\n` +
          `📌 รอวิศวกรตรวจสอบ QC`
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/qc
router.post('/:id/qc', async (req, res) => {
  try {
    const { id } = req.params;
    const { result, by, note } = req.body;

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:T1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (currentStatus === 'ปิดงาน') return res.json({ success: false, message: 'งานนี้ปิดแล้ว' });

    const requesterName = rows[rowIndex][1]  || '';
    const techName      = rows[rowIndex][10] || '';
    const machine       = rows[rowIndex][3]  || '';
    const newStatus     = result === 'ผ่าน QC' ? 'ปิดงาน' : 'แก้ไข (ตีกลับ)';
    const sheetRow      = rowIndex + 2;

    const updateData = [
      { range: `Repairs!J${sheetRow}`, values: [[newStatus]]    },
      { range: `Repairs!O${sheetRow}`, values: [[result || '']] },
      { range: `Repairs!P${sheetRow}`, values: [[by     || '']] },
      { range: `Repairs!Q${sheetRow}`, values: [[note   || '']] },
    ];
    if (result === 'ผ่าน QC')
      updateData.push({ range: `Repairs!L${sheetRow}`, values: [[new Date().toLocaleString('th-TH')]] });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updateData }
    });

    if (result === 'ผ่าน QC') {
      const requesterLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, requesterName);
      if (requesterLineId) {
        await sendLineMessage(requesterLineId,
          `🎉 งานซ่อมผ่าน QC และปิดงานแล้ว!\n` +
          `📋 รหัสงาน: ${id}\n` +
          `🔧 เครื่องจักร: ${machine}\n` +
          `✅ ตรวจสอบโดย: ${by}`
        );
      }
      const techLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, techName);
      if (techLineId) {
        await sendLineMessage(techLineId,
          `🎉 งานซ่อมของคุณผ่าน QC!\n` +
          `📋 รหัสงาน: ${id}\n` +
          `🔧 เครื่องจักร: ${machine}\n` +
          `✅ ปิดงานเรียบร้อย`
        );
      }
    } else {
      const techLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, techName);
      if (techLineId) {
        await sendLineMessage(techLineId,
          `⚠️ งานซ่อมถูกตีกลับ!\n` +
          `📋 รหัสงาน: ${id}\n` +
          `🔧 เครื่องจักร: ${machine}\n` +
          `📝 เหตุผล: ${note || 'ไม่ระบุ'}\n` +
          `กรุณาแก้ไขและส่งใหม่อีกครั้ง`
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('QC error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/approval
router.post('/:id/approval', async (req, res) => {
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
      updateData.push({ range: `Repairs!L${sheetRow}`, values: [[new Date().toLocaleString('th-TH')]] });
    }
    if (result === 'รออนุมัติ' && progressNote)
      updateData.push({ range: `Repairs!N${sheetRow}`, values: [[`[${new Date().toLocaleString('th-TH')}] ${progressNote}`]] });

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

// POST /api/repairs/:id/reject — ช่างตีกลับ
router.post('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
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
    const rejectNote    = `[ตีกลับ ${new Date().toLocaleString('th-TH')}] ${reason}`;
    const sheetRow      = rowIndex + 2;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: [
        { range: `Repairs!J${sheetRow}`, values: [['ตีกลับ']] },
        { range: `Repairs!N${sheetRow}`, values: [[rejectNote]] },
      ]},
    });

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

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/repairs/:id/status — admin update
router.post('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, eta, imgAfter } = req.body;

    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Repairs!A2:T1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบงาน' });

    const currentStatus = rows[rowIndex][9] || '';
    if (LOCKED_STATUSES.includes(currentStatus))
      return res.json({ success: false, message: `งานถูกปิดแล้ว (${currentStatus})` });

    let imgAfterArr = [];
    if (Array.isArray(imgAfter)) imgAfterArr = imgAfter;
    else if (typeof imgAfter === 'string') {
      try { imgAfterArr = JSON.parse(imgAfter); } catch { imgAfterArr = [imgAfter]; }
    }
    const imgAfterUrls = await processImages(imgAfterArr, `${id}_after`);
    const imgAfterStr  = JSON.stringify(imgAfterUrls);

    const sheetRow   = rowIndex + 2;
    const updateData = [
      { range: `Repairs!I${sheetRow}`, values: [[imgAfterStr]]  },
      { range: `Repairs!J${sheetRow}`, values: [[status || '']] },
      { range: `Repairs!M${sheetRow}`, values: [[eta    || '']] },
      { range: `Repairs!N${sheetRow}`, values: [[note   || '']] },
    ];
    if (['ซ่อมเสร็จ', 'รอ QC', 'ซ่อมเสร็จแล้ว'].includes(status))
      updateData.push({ range: `Repairs!L${sheetRow}`, values: [[new Date().toLocaleString('th-TH')]] });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updateData }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;