const express = require('express');
const router  = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/adminAuth');

// GET /api/daily-pm
router.get('/', async (req, res) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'DailyPM!A2:M1000',
    });
    const rows = result.data.values || [];
    const data = rows.map(r => ({
      code:           r[0]  || '',
      date:           r[1]  || '',
      time:           r[2]  || '',
      machine:        r[3]  || '',
      productionLine: r[4]  || '',
      inspector:      r[5]  || '',
      result:         r[6]  || '',
      note:           r[7]  || '',
      checklist:      r[8]  || '',
      engStatus:      r[9]  || '',
      engBy:          r[10] || '',
    }));
    res.json({ success: true, dailyPMHistory: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/daily-pm (ต้อง login ก่อน)
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      code, date, time, machine, productionLine,
      inspector, result, note, checklist
    } = req.body;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'DailyPM!A2',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          code           || '',
          date           || '',
          time           || '',
          machine        || '',
          productionLine || '',
          inspector      || '',
          result         || '',
          note           || '',
          checklist      || '',
          '',
          '',
        ]]
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/daily-pm/:code/ack (เฉพาะช่าง/วิศวกร/แอดมิน)
router.post('/:code/ack', requireRole('engineer', 'admin'), async (req, res) => {
  try {
    const { code } = req.params;
    const { by }   = req.body;

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'DailyPM!A2:M1000',
    });
    const rows     = result.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === code);
    if (rowIndex === -1) return res.json({ success: false, message: 'ไม่พบรายการ' });

    const sheetRow = rowIndex + 2;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `DailyPM!J${sheetRow}`, values: [['รับทราบแล้ว']] },
          { range: `DailyPM!K${sheetRow}`, values: [[by || '']] },
        ],
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;