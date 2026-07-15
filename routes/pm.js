const express = require('express');
const router = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { sendLineMessage, getLineUserIdByName, broadcastToAdmins } = require('./notify');
const { requireAuth, requireRole } = require('../middleware/adminAuth');

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
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `PM_Calendar!B${sheetRow}:G${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
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
      valueInputOption: 'USER_ENTERED',
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

// POST /api/pm/auto-schedule/run (เฉพาะแอดมิน) — สั่งรันตัวจัดตาราง PM รายเดือนแบบทดสอบ/ฉุกเฉิน
// ตามปกติระบบจะรันเองอัตโนมัติทุกวันที่ 1 ของเดือนผ่าน cron (ดู routes/pmAutoScheduler.js)
router.post('/auto-schedule/run', requireRole('admin'), async (req, res) => {
  try {
    const { runMonthlyPMAutoSchedule } = require('./Pmautoscheduler');
    const result = await runMonthlyPMAutoSchedule();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[PM Auto-Schedule] manual run error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/pm/auto-schedule/run-year (เฉพาะแอดมิน) — สร้างแผน PM ล่วงหน้าทั้งปี (12 เดือน)
// body: { year }  ← ไม่ส่งมา = ใช้ปีปัจจุบัน
// หมายเหตุ: สร้างเฉพาะ "ตามรอบ Tier" เท่านั้น เดือนอนาคตยังไม่มีข้อมูลแจ้งซ่อมจริง
// ส่วน "เหตุแจ้งซ่อม" จะถูกเพิ่มให้อัตโนมัติทีหลังตอนถึงเดือนนั้นจริงผ่าน cron รายเดือน
router.post('/auto-schedule/run-year', requireRole('admin'), async (req, res) => {
  try {
    const { runAnnualPMSchedule } = require('./Pmautoscheduler');
    const { year } = req.body;
    const result = await runAnnualPMSchedule(year ? Number(year) : undefined);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[PM Auto-Schedule] annual run error:', err);
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