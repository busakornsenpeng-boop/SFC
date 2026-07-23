// scripts/fixNetDowntime.js
// ─────────────────────────────────────────────────────────────
// สคริปต์ one-time: ไล่คำนวณ "นาทีสะสม" (AA) ใหม่ ให้กับงานที่ "ปิดงานแล้ว"
// ทุกแถว ด้วยสูตรใหม่ = (วันที่ปิดงาน − วันที่แจ้งซ่อม) หักเวลาที่เคยอยู่ใน
// สถานะ "รออะไหล่"/"ขอหยุดเครื่อง" ออก — ใช้ตอนย้อนแก้ข้อมูลเก่าที่ปิดไปแล้ว
// ก่อนโค้ดใหม่จะขึ้น (งานที่ปิดหลังจากนี้ระบบจะคำนวณให้ถูกอัตโนมัติอยู่แล้ว
// ไม่ต้องรันสคริปต์นี้ซ้ำ)
//
// วิธีรัน (จากโฟลเดอร์ root ของโปรเจกต์ ที่มี routes/db/connection.js อยู่):
//   node scripts/fixNetDowntime.js            → dry-run ดูตัวอย่างก่อน ไม่เขียนจริง
//   node scripts/fixNetDowntime.js --apply    → เขียนจริงลงชีต
// ─────────────────────────────────────────────────────────────
const { sheets, SPREADSHEET_ID } = require('../db/connection');

const WAIT_STATUSES = ['รออะไหล่', 'ขอหยุดเครื่อง'];

// เหมือนกับใน routes/repairs.js (แก้บั๊ก parseThaiDateTime แล้ว — ของเดิมคาดว่ามี comma
// คั่นวันที่กับเวลา แต่ .toLocaleString('th-TH') จริงไม่มี comma ทำให้เวลาหายไปหมด
// กลายเป็น 00:00:00 เสมอ ใช้ regex รองรับทั้งสองแบบแทน)
function parseThaiDateTime(str) {
  if (!str) return null;
  try {
    const match = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[, ]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (!match) return null;
    let [, d, m, y, hh, mm, ss] = match;
    y = parseInt(y);
    if (y > 2400) y -= 543; // พ.ศ. → ค.ศ.
    return new Date(y, parseInt(m) - 1, parseInt(d), parseInt(hh) || 0, parseInt(mm) || 0, parseInt(ss) || 0);
  } catch (e) { return null; }
}

function computeNetDowntimeMinutes(reportDateRaw, closedDateRaw, currentStatus, waitStartRaw, waitMinutesRaw) {
  const reportDate = parseThaiDateTime(reportDateRaw);
  const closedDate = parseThaiDateTime(closedDateRaw);
  if (!reportDate || !closedDate) return null; // แปลงวันที่ไม่ได้ — ข้ามแถวนี้ ไม่เดา

  const totalMinutes = Math.max(0, (closedDate.getTime() - reportDate.getTime()) / 60000);

  let totalWaitMinutes = parseFloat(waitMinutesRaw) || 0;
  if (WAIT_STATUSES.includes(currentStatus)) {
    const waitStart = parseThaiDateTime(waitStartRaw);
    if (waitStart) totalWaitMinutes += Math.max(0, (closedDate.getTime() - waitStart.getTime()) / 60000);
  }

  // กันข้อมูล wait เก่าเพี้ยน (จากบั๊ก parseThaiDateTime ก่อนหน้านี้ ที่ทำให้ waitMinutes
  // ที่บันทึกไว้มากกว่าเวลารวมทั้งงานได้ — เป็นไปไม่ได้ในทางตรรกะ) ถ้าเจอแบบนี้ ถือว่า
  // ข้อมูล wait ไม่น่าเชื่อถือ ไม่หักออกเลย ใช้เวลารวมทั้งหมดเป็น downtime แทน
  if (totalWaitMinutes > totalMinutes) totalWaitMinutes = 0;

  return Math.round(Math.max(0, totalMinutes - totalWaitMinutes));
}

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(`เริ่มสแกน Repairs sheet... (โหมด: ${apply ? 'APPLY — เขียนจริง' : 'DRY-RUN — ดูตัวอย่างเฉยๆ'})\n`);

  const res  = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:AA5000',
  });
  const rows = res.data.values || [];

  const updates = [];
  let skippedNoClose = 0;
  let skippedBadDate = 0;
  let skippedNoChange = 0;

  rows.forEach((r, i) => {
    const sheetRow  = i + 2;
    const id        = r[0]  || '';
    const status    = r[9]  || '';
    const reportRaw = r[17] || ''; // R
    const closedRaw = r[22] || ''; // W
    const waitStart = r[25] || ''; // Z
    const waitMin   = r[26] || ''; // AA (ค่าปัจจุบัน — จะถูกอ่านเป็น "ยอดรอสะสม" เดิม)

    if (status !== 'ปิดงาน' || !closedRaw) { skippedNoClose++; return; }

    const netDowntime = computeNetDowntimeMinutes(reportRaw, closedRaw, status, waitStart, waitMin);
    if (netDowntime === null) { skippedBadDate++; console.warn(`  ⚠️  แปลงวันที่ไม่ได้ ข้าม: ${id} (row ${sheetRow}) R="${reportRaw}" W="${closedRaw}"`); return; }

    const oldValue = parseFloat(waitMin) || 0;
    if (oldValue === netDowntime) { skippedNoChange++; return; }

    updates.push({ id, sheetRow, oldValue, netDowntime });
  });

  console.log(`พบทั้งหมด: ${rows.length} แถว`);
  console.log(`  - ยังไม่ปิดงาน/ไม่มีวันที่ปิดงาน: ${skippedNoClose}`);
  console.log(`  - แปลงวันที่ไม่ได้ (ข้าม ไม่แตะ): ${skippedBadDate}`);
  console.log(`  - ค่าเดิมตรงกับสูตรใหม่อยู่แล้ว: ${skippedNoChange}`);
  console.log(`  - ต้องแก้ทั้งหมด: ${updates.length}\n`);

  if (!updates.length) {
    console.log('ไม่มีอะไรต้องแก้แล้วครับ ✅');
    return;
  }

  console.log('ตัวอย่างการเปลี่ยนแปลง (job | แถว | ค่าเดิม → ค่าใหม่):');
  updates.forEach(u => console.log(`  ${u.id.padEnd(20)} row ${u.sheetRow}: ${u.oldValue} → ${u.netDowntime}`));

  if (!apply) {
    console.log('\n(นี่คือ dry-run ยังไม่ได้เขียนอะไรลงชีต — รันใหม่พร้อม --apply เพื่อบันทึกจริง)');
    return;
  }

  const data = updates.map(u => ({
    range:  `Repairs!AA${u.sheetRow}`,
    values: [[u.netDowntime]],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  console.log(`\n✅ อัปเดตสำเร็จ ${updates.length} แถว`);
}

main().catch(err => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exit(1);
});