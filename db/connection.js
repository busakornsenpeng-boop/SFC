const { google } = require('googleapis');
const path = require('path');

const KEYFILE = path.join(__dirname, 'service-account-key.json');
const SPREADSHEET_ID = '1VYCqhFgHaOXn_mZa4RLQ0AwQVza_BpwmJwxDeBU50Ac';

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',   // ← เพิ่ม Drive scope
  ],
});

const sheets = google.sheets({ version: 'v4', auth });

module.exports = { sheets, auth, SPREADSHEET_ID };  // ← เพิ่ม auth