const express = require('express');
const router = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');

async function getAllPM() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PM_Calendar!A2:G1000',
  });
  const rows = res.data.values || [];
  return rows.map(row => ({
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

// POST /api/pm
router.post('/', async (req, res) => {
  try {
    const { title, machine, date, type, assignee, status } = req.body;
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

// POST /api/pm/checklist
router.post('/checklist', async (req, res) => {
  try {
    const { pmCode, equip, productionLine, date, tech, shift, runningHr, parts, result, workDone, remarks, checklist } = req.body;
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_History!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[pmCode, equip, date, tech, result, workDone, remarks || '', parts || '-', checklist || '{}', shift || '', productionLine || '']],
      },
    });
    const pmRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_Calendar!A2:G1000',
    });
    const rows = pmRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === pmCode);
    if (rowIndex !== -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `PM_Calendar!G${rowIndex + 2}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['เสร็จแล้ว']] },
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;