const express = require('express');
const router = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { sendLineMessage, getLineUserIdByName, broadcastToAdmins } = require('./notify');
const { requireAuth, requireRole } = require('../middleware/adminAuth');
// หมายเหตุ: เดิมไฟล์นี้ require routes/Pmautoscheduler.js (ตัวจัดตาราง PM อัตโนมัติแบบ Tier
// + cron รายเดือน) แต่ทีมงานแจ้งว่าไม่ต้องการจัดตารางอัตโนมัติแล้ว ให้แอดมินอัปโหลด
// "ไฟล์มาสเตอร์" เพื่อกำหนดแผน PM เองแทน (ดู route POST /import ด้านล่าง) — จึงตัด require
// ออกเพื่อปิดทั้งปุ่มมือเดิมและ cron รายเดือนไปพร้อมกัน

async function getAllPM() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PM_Calendar!A2:G1000',
  });
  const rows = res.data.values || [];
  return rows
    .filter(row => row[0]) // ตัดแถวที่ถูก "ลบ" แล้ว (เคลียร์ค่าออกหมด — ดูฟังก์ชัน DELETE ด้านล่าง)
    .map(row => ({
      id:       row[0] || '',
      title:    row[1] || '',
      machine:  row[2] || '',
      date:     row[3] || '',
      type:     row[4] || '',
      assignee: row[5] || '',
      status:   row[6] || '',
    }));
}

// GET /api/pm
router.get('/', async (req, res) => {
  try {
    const data = await getAllPM();
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/pm/history
router.get('/history', async (req, res) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_History!A2:K1000',
    });
    const rows = result.data.values || [];
    const data = rows.map(row => ({
      pmCode:         row[0] || '',
      equip:          row[1] || '',
      date:           row[2] || '',
      tech:           row[3] || '',
      result:         row[4] || '',
      workDone:       row[5] || '',
      note:           row[6] || '',
      parts:          row[7] || '',
      checklist:      row[8] || '{}',
      shift:          row[9] || '',
      productionLine: row[10] || '',
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/pm — สร้างแผน PM ใหม่ หรือแก้ไข/เลื่อนวันแผนเดิม (ถ้าส่ง id มาด้วย)
// เฉพาะแอดมินเท่านั้นที่จัดตาราง PM ได้ — ช่าง/วิศวกรมีแค่หน้าไปทำ (ดู PM_Calendar ผ่าน GET เท่านั้น)
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { id, title, machine, date, type, assignee, status } = req.body;

    if (id) {
      // ── แก้ไข/เลื่อนวันแผนเดิม ──
      const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'PM_Calendar!A2:G1000' });
      const rows     = getRes.data.values || [];
      const rowIndex = rows.findIndex(r => r[0] === id);
      if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบแผน PM นี้' });

      const sheetRow = rowIndex + 2;
      // RAW แทน USER_ENTERED — กันไม่ให้ Sheets ตีความวันที่เป็น date serial number แล้วโชว์เป็นตัวเลขดิบ
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `PM_Calendar!B${sheetRow}:G${sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[title, machine, date, type, assignee || '', status || 'รอดำเนินการ']],
        },
      });
      return res.json({ success: true, pmId: id });
    }

    // ── สร้างใหม่ ──
    const pmId = 'PM-' + Date.now();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_Calendar!A:G',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[pmId, title, machine, date, type, assignee || '', status || 'รอดำเนินการ']],
      },
    });
    res.json({ success: true, pmId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/pm/clear-all (เฉพาะแอดมิน) — ล้างแผน PM ทั้งหมดในตาราง PM_Calendar
// ใช้ตอนข้อมูลปนกันมั่วจากการทดสอบปุ่มจัดตารางอัตโนมัติ/ทั้งปี — ไม่แตะ PM_History (ประวัติงานที่ทำจริงแล้ว)
// วางไว้ "ก่อน" route DELETE /:id เพื่อกัน Express จับ 'clear-all' เป็นค่า :id
router.delete('/clear-all', requireRole('admin'), async (req, res) => {
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_Calendar!A2:G100000',
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[PM] clear-all error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/pm/:id (เฉพาะแอดมิน) — เคลียร์ค่าทั้งแถว (soft delete เหมือนแพทเทิร์นที่ใช้กับ TechProfiles)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const getRes   = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'PM_Calendar!A2:G1000' });
    const rows     = getRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === id);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบแผน PM นี้' });

    const sheetRow = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `PM_Calendar!A${sheetRow}:G${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['', '', '', '', '', '', '']] },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/pm/import (เฉพาะแอดมิน) — นำเข้าแผน PM จาก "ไฟล์มาสเตอร์" ที่แอดมินอัปโหลด
// (แทนที่ตัวจัดตารางอัตโนมัติแบบ Tier/cron เดิม — ทีมงานแจ้งว่าไม่ต้องการจัดตารางอัตโนมัติแล้ว
// ให้สร้างแผนตรงตามที่ระบุในไฟล์แทน ดู routes/Pmautoscheduler.js เดิมที่เลิกใช้แล้ว)
// body: { rows: [{ machine, title, type, date, status }, ...] } — ฝั่ง frontend เป็นคนอ่านไฟล์
// Excel และแปลงเป็น JSON มาให้แล้ว (ดู handlePMMasterFileUpload ใน scripts.js)
// กันแถวซ้ำ: ข้ามแถวที่ (machine + date + title) ตรงกับแผนที่มีอยู่แล้วในตาราง ป้องกันข้อมูลซ้ำ
// ถ้าอัปโหลดไฟล์เดิมซ้ำ หรืออัปโหลดไฟล์ที่มีบางแถวซ้ำกับที่เคยนำเข้าไปแล้ว
router.post('/import', requireRole('admin'), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลแผน PM ในไฟล์ที่อัปโหลด' });
    }

    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_Calendar!A2:G1000',
    });
    const existingRows = getRes.data.values || [];
    const existingKeys = new Set(
      existingRows
        .filter(r => r[0])
        .map(r => `${r[2] || ''}|${r[3] || ''}|${r[1] || ''}`) // machine|date|title
    );

    const newRows = [];
    let skipped = 0;
    let seq = 0;

    rows.forEach(r => {
      const machine = String(r.machine || '').trim();
      const title   = String(r.title   || '').trim();
      const date    = String(r.date    || '').trim();
      const type    = String(r.type    || '').trim() || 'รายเดือน';
      const status  = String(r.status  || '').trim() || 'รอดำเนินการ';
      if (!machine || !title || !date) { skipped++; return; }

      const key = `${machine}|${date}|${title}`;
      if (existingKeys.has(key)) { skipped++; return; }
      existingKeys.add(key); // กันแถวซ้ำกันเองภายในไฟล์เดียวกันด้วย

      seq++;
      const id = `PM-${Date.now()}-${seq}`;
      newRows.push([id, title, machine, date, type, '', status]);
    });

    if (newRows.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'PM_Calendar!A:G',
        valueInputOption: 'RAW', // กันไม่ให้ Sheets ตีความวันที่เป็น date serial number
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newRows },
      });
    }

    res.json({ success: true, createdTotal: newRows.length, skipped });
  } catch (err) {
    console.error('[PM Import] error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/pm/checklist (เฉพาะช่าง/วิศวกร/แอดมิน)
router.post('/checklist', requireRole('engineer', 'admin'), async (req, res) => {
  try {
    const { pmCode, equip, productionLine, date, tech, shift, runningHr, parts, result, workDone, remarks, checklist } = req.body;
    console.log(`[PM Checklist] Submitting PM: ${pmCode}, Equipment: ${equip}, Tech: ${tech}`);
    
    // บันทึกลงใน PM_History
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_History!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[pmCode, equip, date, tech, result, workDone, remarks || '', parts || '-', checklist || '{}', shift || '', productionLine || '']],
      },
    });
    console.log(`[PM Checklist] PM_History บันทึกสำเร็จ: ${pmCode}`);

    // อัปเดตสถานะใน PM_Calendar
    const pmRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_Calendar!A2:G1000',
    });
    const rows = pmRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === pmCode);
    
    if (rowIndex !== -1) {
      console.log(`[PM Checklist] Found PM at row ${rowIndex + 2}, updating status to "เสร็จแล้ว"`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `PM_Calendar!G${rowIndex + 2}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['เสร็จแล้ว']] },
      });
      console.log(`[PM Checklist] สถานะ PM อัปเดตสำเร็จ: ${pmCode}`);

      // แจ้งเตือน LINE
      const techLineId = await getLineUserIdByName(sheets, SPREADSHEET_ID, tech);
      if (techLineId) {
        await sendLineMessage(techLineId,
          `✅ งาน PM บันทึกเสร็จสิ้น\n` +
          `📋 รหัส: ${pmCode}\n` +
          `🔧 เครื่องจักร: ${equip}\n` +
          `📊 ผลการตรวจ: ${result}\n` +
          `👤 ผู้ตรวจ: ${tech}`
        );
      }
      
      // แจ้ง admin
      await broadcastToAdmins(pmCode, tech, equip, workDone, 'PM เสร็จแล้ว');
    } else {
      console.warn(`[PM Checklist] ไม่พบ PM ID: ${pmCode}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[PM Checklist] Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;