// scripts/backupImagesToDrive.js
// ─────────────────────────────────────────────────────────────
// สำรองรูปภาพงานซ่อม (ก่อน/หลังซ่อม) จาก Cloudinary → Google Drive
// กันเหตุ Cloudinary โดนลบ/หมดอายุ/บัญชีมีปัญหา
//
// รันได้ 2 แบบด้วยไฟล์เดียวกัน:
//   1) รันมือครั้งแรก (workflow_dispatch) เพื่อ backfill งานเก่าทั้งหมด
//   2) Cron รายวันผ่าน GitHub Actions ดูแลงานใหม่ต่อไปเรื่อยๆ
// เป็น idempotent — เช็คชื่อไฟล์ที่มีอยู่แล้วในโฟลเดอร์ปลายทางก่อนอัปโหลด
// เรียกซ้ำกี่รอบก็ได้ ไม่มีไฟล์ซ้ำ ไม่เปลืองโควตา Drive
//
// ชื่อไฟล์ปลายทาง: <JobID>_before_1.jpg, <JobID>_before_2.jpg, <JobID>_after_1.jpg ...
// ─────────────────────────────────────────────────────────────
const { google }  = require('googleapis');
const { Readable } = require('stream');
const path = require('path');

// .trim() กันปัญหา env var/secret มีช่องว่างหรือ newline แฝงมาตอน copy-paste
// (เจอเคสจริง: ค่าใน GitHub Secret มีช่องว่างนำหน้า ทำให้ Drive API หา folder ไม่เจอ)
const SPREADSHEET_ID  = (process.env.SPREADSHEET_ID || '1VYCqhFgHaOXn_mZa4RLQ0AwQVza_BpwmJwxDeBU50Ac').trim();
const DRIVE_FOLDER_ID = (process.env.DRIVE_BACKUP_FOLDER_ID || '').trim();

if (!DRIVE_FOLDER_ID) {
  console.error('[backup] ขาด DRIVE_BACKUP_FOLDER_ID — ตั้งค่า env var/secret ก่อนรัน (ID โฟลเดอร์ Drive ที่ share ให้ service account แล้ว)');
  process.exit(1);
}

// ── Auth (สคริปต์แยก ไม่ได้ require db/connection.js เพื่อให้รันเป็น standalone job ได้
//     โดยไม่ต้อง boot ทั้งแอป — ใช้ pattern env var เดียวกับ db/connection.js ทุกประการ) ──
let authConfig;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  authConfig = {
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  };
} else {
  authConfig = {
    keyFile: path.join(__dirname, '..', 'db', 'service-account-key.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  };
}

const auth   = new google.auth.GoogleAuth(authConfig);
const sheets = google.sheets({ version: 'v4', auth });
const drive  = google.drive({ version: 'v3', auth });

function extFromUrl(url) {
  const m = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
  return m ? m[1].toLowerCase() : 'jpg';
}

function filenameFromUrl(url, fallbackPrefix, index) {
  try {
    const clean = decodeURIComponent(url.split('?')[0]);
    const base  = clean.split('/').pop();
    if (base && base.includes('.')) return base;
  } catch { /* ใช้ fallback ด้านล่าง */ }
  return `${fallbackPrefix}_${index + 1}.${extFromUrl(url)}`;
}

function parseImgField(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(Boolean) : (typeof raw === 'string' && raw.startsWith('http') ? [raw] : []);
  } catch {
    return raw.startsWith('http') ? [raw] : [];
  }
}

async function listExistingFilenames() {
  const names = new Set();
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${DRIVE_FOLDER_ID}' in parents and trashed = false`,
      fields: 'nextPageToken, files(name)',
      pageSize: 1000,
      pageToken,
    });
    (res.data.files || []).forEach(f => names.add(f.name));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return names;
}

async function uploadImage(url, filename) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`ดาวน์โหลดรูปไม่สำเร็จ (HTTP ${resp.status})`);
  const nodeStream = Readable.fromWeb(resp.body);
  await drive.files.create({
    requestBody: { name: filename, parents: [DRIVE_FOLDER_ID] },
    media: { mimeType: resp.headers.get('content-type') || 'image/jpeg', body: nodeStream },
    fields: 'id',
  });
}

async function main() {
  console.log('[backup] เริ่มสำรองรูปภาพ → Google Drive');
  console.log(`[backup] SPREADSHEET_ID: ${SPREADSHEET_ID}`);
  console.log(`[backup] DRIVE_BACKUP_FOLDER_ID: ${DRIVE_FOLDER_ID}`);
  console.log(`[backup] DRIVE_FOLDER_ID length: ${DRIVE_FOLDER_ID.length} (ควรเป็น 33)`);
  console.log(`[backup] DRIVE_FOLDER_ID JSON: ${JSON.stringify(DRIVE_FOLDER_ID)}`);

  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:I5000',
  });
  const rows = getRes.data.values || [];

  const existing = await listExistingFilenames();
  console.log(`[backup] พบไฟล์ที่ backup ไว้แล้ว ${existing.size} ไฟล์ในโฟลเดอร์ปลายทาง`);

  let uploaded = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const jobId = row[0];
    if (!jobId) continue;

    const beforeImgs = parseImgField(row[7]);
    const afterImgs  = parseImgField(row[8]);

    const tasks = [
      ...beforeImgs.map((url, i) => ({ url, filename: filenameFromUrl(url, `${jobId}_before`, i) })),
      ...afterImgs.map((url, i)  => ({ url, filename: filenameFromUrl(url, `${jobId}_after`, i) })),
    ];

    for (const { url, filename } of tasks) {
      if (existing.has(filename)) { skipped++; continue; }
      try {
        await uploadImage(url, filename);
        existing.add(filename);
        uploaded++;
        console.log(`[backup] ✓ ${filename}`);
      } catch (err) {
        failed++;
        console.error(`[backup] ✗ ${filename} — ${err.message}`);
      }
    }
  }

  console.log(`[backup] เสร็จสิ้น — อัปโหลดใหม่ ${uploaded} | ข้าม (มีอยู่แล้ว) ${skipped} | ล้มเหลว ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('[backup] เกิดข้อผิดพลาดร้ายแรง:', err);
  process.exit(1);
});
