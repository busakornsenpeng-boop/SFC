const express = require('express');
const router  = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');

router.get('/', async (req, res) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'MasterData!A3:C1000',
    });
    const rows = result.data.values || [];

    // เครื่องจักร — return เป็น string โดยตรง
    const machines = rows
      .filter(r => r[0])
      .map(r => r[1] ? `${r[0]} (${r[1]})` : r[0]);

    // แผนก — unique
    const departments = [...new Set(rows.map(r => r[2]).filter(Boolean))];

    res.json({ success: true, machines, departments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;