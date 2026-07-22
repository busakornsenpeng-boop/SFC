// scripts/clear-repairs-sheet.js
// ─────────────────────────────────────────────────────────────
// ล้างข้อมูลทั้งหมดในชีต Repairs (ทั้งของทดสอบ/dummy และที่ import จาก
// legacy-repairs.xlsx) ก่อนเริ่มใช้งานจริง — ไม่แตะแถวหัวตาราง (row 1)
// และไม่แตะชีตอื่น (Users, PM_Calendar, ฯลฯ)
//
// วิธีใช้:
//   node scripts/clear-repairs-sheet.js            ← dry-run (นับให้ดูก่อน ไม่ลบจริง)
//   node scripts/clear-repairs-sheet.js --apply     ← ลบจริง
// ─────────────────────────────────────────────────────────────
const { sheets, SPREADSHEET_ID } = require('../db/connection');

const APPLY = process.argv.includes('--apply');
const RANGE_TO_CLEAR = 'Repairs!A2:AA100000'; // เว้น row 1 (หัวตาราง) ไว้เสมอ

async function run() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:A100000',
  });
  const rows = res.data.values || [];
  const jobIds = rows.map(r => r[0]).filter(Boolean);

  console.log(`พบข้อมูลทั้งหมด ${jobIds.length} แถวในชีต Repairs (ไม่รวมหัวตาราง)`);
  if (jobIds.length) {
    console.log('ตัวอย่างรายการที่จะถูกลบ:');
    jobIds.slice(0, 5).forEach(id => console.log(`  - ${id}`));
    if (jobIds.length > 5) console.log(`  ... และอีก ${jobIds.length - 5} รายการ`);
  }

  if (!jobIds.length) {
    console.log('\nไม่มีข้อมูลต้องลบ ✅');
    return;
  }

  if (!APPLY) {
    console.log(`\n(dry-run) ยังไม่มีการลบจริง — จะลบข้อมูลทั้งหมด ${jobIds.length} แถว ในช่วง ${RANGE_TO_CLEAR}`);
    console.log('รันด้วย --apply เพื่อลบจริง (แนะนำให้แน่ใจก่อนว่า export/backup ชีตปัจจุบันไว้แล้ว)');
    return;
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE_TO_CLEAR,
  });

  console.log(`\nลบข้อมูลทั้งหมด ${jobIds.length} แถว ในชีต Repairs สำเร็จ ✅ (หัวตาราง row 1 ยังอยู่ครบ)`);
}

run().catch(err => {
  console.error('Clear error:', err);
  process.exit(1);
});