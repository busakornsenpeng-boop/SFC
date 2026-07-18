// scripts/migrate-qc-rename.js
// ─────────────────────────────────────────────────────────────
// Migration ครั้งเดียว:
//   0) ขยายจำนวนคอลัมน์ของชีต Repairs ให้รองรับถึงคอลัมน์ AA (ถ้ายังไม่พอ)
//   1) อัปเดตค่าสถานะ/ผลลัพธ์เก่าในชีต Repairs ที่ยังเป็น "QC" ให้เป็น "ตรวจรับงาน"
//   2) อัปเดตหัวคอลัมน์ (row 1) ให้เป็นภาษาไทยตรงกับที่ระบบใช้จริง
//
// วิธีรัน:
//   node scripts/migrate-qc-rename.js            ← dry-run
//   node scripts/migrate-qc-rename.js --apply     ← เขียนจริงลงชีต
// ─────────────────────────────────────────────────────────────
const { sheets, SPREADSHEET_ID } = require('../db/connection');

const APPLY = process.argv.includes('--apply');
const SHEET_NAME = 'Repairs';
const MIN_COLUMNS = 27; // ต้องมีอย่างน้อยถึงคอลัมน์ AA (27)

const HEADER_MAP = {
  A: 'รหัสงาน', B: 'ผู้แจ้ง', C: 'แผนก', D: 'เครื่องจักร', E: 'ด้านปัญหา',
  F: 'ประเภทงานซ่อม', G: 'รายละเอียดอาการ', H: 'รูปก่อนซ่อม', I: 'รูปหลังซ่อม',
  J: 'สถานะ', K: 'ช่างผู้รับผิดชอบ', L: 'วันที่ซ่อมเสร็จ', M: 'กำหนดเสร็จ (เดิม)',
  N: 'หมายเหตุ', O: 'ผลตรวจรับ', P: 'ผู้ตรวจรับ', Q: 'หมายเหตุตรวจรับ',
  R: 'วันที่แจ้งซ่อม', S: 'ประเภทงาน', T: 'สถานะอนุมัติ', U: null,
  V: 'วันที่รับงาน', W: 'วันที่ปิดงาน', X: 'เคยรอ (อะไหล่/หยุดเครื่อง)',
  Y: 'ระยะเวลาซ่อม', Z: 'เวลาเริ่มรอ', AA: 'นาทีที่รอสะสม',
};

// ── ตรวจ/ขยายจำนวนคอลัมน์ของชีตให้พอ ──
async function ensureEnoughColumns() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`ไม่พบชีตชื่อ "${SHEET_NAME}"`);

  const currentCols = sheet.properties.gridProperties.columnCount;
  console.log(`ชีต "${SHEET_NAME}" ตอนนี้มี ${currentCols} คอลัมน์`);

  if (currentCols >= MIN_COLUMNS) {
    console.log('คอลัมน์พอแล้ว ไม่ต้องขยาย ✅');
    return;
  }

  console.log(`ต้องขยายจาก ${currentCols} → ${MIN_COLUMNS} คอลัมน์`);
  if (!APPLY) {
    console.log('(dry-run) จะขยายคอลัมน์ตอนรันจริงด้วย --apply');
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        updateSheetProperties: {
          properties: {
            sheetId: sheet.properties.sheetId,
            gridProperties: { columnCount: MIN_COLUMNS },
          },
          fields: 'gridProperties.columnCount',
        },
      }],
    },
  });
  console.log(`ขยายคอลัมน์เป็น ${MIN_COLUMNS} สำเร็จ ✅`);
}

async function run() {
  await ensureEnoughColumns();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:AA5000',
  });
  const rows = res.data.values || [];

  const updates = [];
  let statusCount = 0, resultCount = 0, noteCount = 0;

  rows.forEach((row, i) => {
    const sheetRow = i + 2;
    if (row[9] === 'รอ QC') {
      updates.push({ range: `Repairs!J${sheetRow}`, values: [['รอตรวจรับ']] });
      statusCount++;
    }
    if (row[14] === 'ผ่าน QC') {
      updates.push({ range: `Repairs!O${sheetRow}`, values: [['ผ่านตรวจรับ']] });
      resultCount++;
    }
    const note = row[13] || '';
    if (note.includes('QC ไม่ผ่าน')) {
      updates.push({ range: `Repairs!N${sheetRow}`, values: [[note.replace(/QC ไม่ผ่าน/g, 'ตรวจรับไม่ผ่าน')]] });
      noteCount++;
    }
  });

  const headerUpdates = Object.entries(HEADER_MAP)
    .filter(([, value]) => value !== null)
    .map(([col, value]) => ({ range: `Repairs!${col}1`, values: [[value]] }));

  console.log('\nพบสิ่งที่ต้องแก้:');
  console.log(`  - สถานะ 'รอ QC'      → 'รอตรวจรับ'    : ${statusCount} แถว`);
  console.log(`  - ผล 'ผ่าน QC'       → 'ผ่านตรวจรับ'  : ${resultCount} แถว`);
  console.log(`  - หมายเหตุที่มีคำว่า 'QC ไม่ผ่าน'      : ${noteCount} แถว`);
  console.log(`  - หัวคอลัมน์ที่จะเปลี่ยน               : ${headerUpdates.length} คอลัมน์`);

  const allUpdates = [...updates, ...headerUpdates];
  console.log(`\nรวมทั้งหมด ${allUpdates.length} การเขียนค่า`);

  if (!allUpdates.length) { console.log('ไม่มีอะไรต้องแก้ ✅'); return; }

  if (!APPLY) {
    console.log('\n(dry-run) ไม่มีการเขียนจริง — รันด้วย --apply เพื่อเขียนลงชีตจริง');
    return;
  }

  const CHUNK = 500;
  for (let i = 0; i < allUpdates.length; i += CHUNK) {
    const chunk = allUpdates.slice(i, i + CHUNK);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: chunk },
    });
    console.log(`เขียนแล้ว ${Math.min(i + CHUNK, allUpdates.length)}/${allUpdates.length}`);
  }

  console.log('เขียนข้อมูลลงชีตเสร็จสิ้น ✅');
}

run().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});