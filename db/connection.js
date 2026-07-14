const { google } = require('googleapis');
const path = require('path');

// อ่าน SPREADSHEET_ID จาก Environment Variable ก่อนเสมอ (ตั้งใน Render → Environment)
// ถ้าไม่ได้ตั้งค่าไว้ ให้ fallback ไปใช้ ID เดิมนี้ (สำหรับรันบนเครื่อง local เท่านั้น)
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1VYCqhFgHaOXn_mZa4RLQ0AwQVza_BpwmJwxDeBU50Ac';

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

// เช็ค ID ที่ใช้จริงตอน start server — ช่วยดีบักเวลาสงสัยว่าต่อไฟล์ผิด
console.log(`[db/connection] ใช้งาน SPREADSHEET_ID: ${SPREADSHEET_ID}${process.env.SPREADSHEET_ID ? ' (จาก env var)' : ' (ค่า fallback ในโค้ด — ควรตั้ง SPREADSHEET_ID ใน Render)'}`);

module.exports = { sheets, auth, SPREADSHEET_ID };