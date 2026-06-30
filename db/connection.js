const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = '1VYCqhFgHaOXn_mZa4RLQ0AwQVza_BpwmJwxDeBU50Ac';

// อ่าน credentials จาก Environment Variable (สำหรับ production บน Render)
// ถ้าไม่มี ให้ fallback ไปอ่านจากไฟล์ (สำหรับรันบนเครื่อง local)
let authConfig;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  authConfig = {
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  };
} else {
  const KEYFILE = path.join(__dirname, 'service-account-key.json');
  authConfig = {
    keyFile: KEYFILE,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  };
}

const auth = new google.auth.GoogleAuth(authConfig);

const sheets = google.sheets({ version: 'v4', auth });

module.exports = { sheets, auth, SPREADSHEET_ID };  // ← เพิ่ม auth