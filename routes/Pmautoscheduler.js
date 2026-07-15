// services/pmAutoScheduler.js
// ─────────────────────────────────────────────────────────────
// จัดตาราง PM รายเดือนอัตโนมัติ โดยวิเคราะห์ความถี่การแจ้งซ่อม
// ของแต่ละเครื่องจักร (ข้อมูลทั้งหมดตั้งแต่เริ่มระบบ):
//   - เครื่องที่แจ้งซ่อมบ่อยที่สุด (Top 5-10) → จัด PM ไว้ต้นเดือน
//   - เครื่องที่เหลือทั้งหมด → กระจาย PM ไว้ท้ายเดือน
// รันอัตโนมัติทุกวันที่ 1 ของเดือน ผ่าน node-cron (ดู startPMAutoScheduler)
// รันด้วยมือได้ผ่าน POST /api/pm/auto-schedule/run (แอดมินเท่านั้น — ดู routes/pm.js)
// ─────────────────────────────────────────────────────────────
const cron = require('node-cron');
const { sheets, SPREADSHEET_ID } = require('../db/connection');

const TOP_N          = 8;                                   // จำนวนเครื่อง "ซ่อมบ่อยสุด" ที่จัดไว้ต้นเดือน (อยู่ในช่วง 5-10 ที่ตกลงกันไว้)
const EARLY_DAYS     = [2, 3, 4, 5, 6, 7, 8, 9, 10];         // วันที่สำหรับกลุ่มต้นเดือน (เว้นวันที่ 1 ไว้เพราะเป็นวันที่ job รัน)
const LATE_DAY_START = 12;                                   // วันที่เริ่มกลุ่มท้ายเดือน
const LATE_DAY_END   = 28;                                   // วันสุดท้ายที่ปลอดภัยสำหรับทุกเดือน (กัน ก.พ./เดือนสั้น)

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'machine';
}

async function getMachineList() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'MasterData!A3:D1000',
  });
  const rows = res.data.values || [];
  return rows
    .filter(r => r[0])
    .map(r => (r[1] ? `${r[0]} (${r[1]})` : r[0]));
}

async function getRepairCountsByMachine() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!D2:D5000', // คอลัมน์ D = machine (ดู getAllRepairs ใน routes/repairs.js)
  });
  const rows = res.data.values || [];
  const counts = {};
  rows.forEach(r => {
    const machine = r[0];
    if (!machine) return;
    counts[machine] = (counts[machine] || 0) + 1;
  });
  return counts;
}

async function getExistingPMIds() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PM_Calendar!A2:A5000',
  });
  const rows = res.data.values || [];
  return new Set(rows.map(r => r[0]).filter(Boolean));
}

// สร้างวันที่ของเดือน/ปีที่ระบุ จาก "ลำดับที่ N" ในลิสต์วัน โดยวนซ้ำถ้าเครื่องมากกว่าจำนวนวัน
function pickDate(year, month /* 0-indexed */, dayPool, i) {
  const day = dayPool[i % dayPool.length];
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function runMonthlyPMAutoSchedule() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const yyyymm = `${year}${String(month + 1).padStart(2, '0')}`;

  const [machines, repairCounts, existingIds] = await Promise.all([
    getMachineList(),
    getRepairCountsByMachine(),
    getExistingPMIds(),
  ]);

  if (!machines.length) {
    return { created: 0, skipped: 0, month: `${year}-${String(month + 1).padStart(2, '0')}`, ranking: [], note: 'ไม่พบรายชื่อเครื่องจักรใน MasterData' };
  }

  // จัดอันดับเครื่องจักรตามความถี่การแจ้งซ่อม (มาก → น้อย) ทั้งหมดตั้งแต่เริ่มระบบ
  const ranked = machines
    .map(m => ({ machine: m, repairCount: repairCounts[m] || 0 }))
    .sort((a, b) => b.repairCount - a.repairCount);

  const earlyGroup = ranked.slice(0, Math.min(TOP_N, ranked.length));
  const lateGroup  = ranked.slice(Math.min(TOP_N, ranked.length));

  const lateDayPool = [];
  for (let d = LATE_DAY_START; d <= LATE_DAY_END; d++) lateDayPool.push(d);

  const newRows = [];
  const rankingOut = [];

  earlyGroup.forEach((item, i) => {
    const id = `PMAUTO-${yyyymm}-${slug(item.machine)}`;
    rankingOut.push({ ...item, group: 'early', date: pickDate(year, month, EARLY_DAYS, i), skipped: existingIds.has(id) });
    if (existingIds.has(id)) return; // กันสร้างซ้ำถ้ารันมากกว่า 1 ครั้งในเดือนเดียวกัน
    newRows.push([id, `PM ประจำเดือน - ${item.machine}`, item.machine, pickDate(year, month, EARLY_DAYS, i), 'รายเดือน', '', 'รอดำเนินการ']);
  });

  lateGroup.forEach((item, i) => {
    const id = `PMAUTO-${yyyymm}-${slug(item.machine)}`;
    rankingOut.push({ ...item, group: 'late', date: pickDate(year, month, lateDayPool, i), skipped: existingIds.has(id) });
    if (existingIds.has(id)) return;
    newRows.push([id, `PM ประจำเดือน - ${item.machine}`, item.machine, pickDate(year, month, lateDayPool, i), 'รายเดือน', '', 'รอดำเนินการ']);
  });

  if (newRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PM_Calendar!A:G',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: newRows },
    });
  }

  const result = {
    created: newRows.length,
    skipped: rankingOut.length - newRows.length,
    month: `${year}-${String(month + 1).padStart(2, '0')}`,
    ranking: rankingOut,
  };
  console.log(`[PM Auto-Schedule] เดือน ${result.month}: สร้างใหม่ ${result.created} รายการ, ข้าม (มีอยู่แล้ว) ${result.skipped} รายการ`);
  return result;
}

// เรียกครั้งเดียวตอน start server เพื่อตั้งเวลาให้รันอัตโนมัติทุกวันที่ 1 ของเดือน เวลา 00:30 (เวลาไทย)
function startPMAutoScheduler() {
  cron.schedule('30 0 1 * *', () => {
    console.log('[PM Auto-Schedule] เริ่มจัดตาราง PM ประจำเดือนอัตโนมัติ...');
    runMonthlyPMAutoSchedule().catch(err => console.error('[PM Auto-Schedule] error:', err));
  }, { timezone: 'Asia/Bangkok' });
  console.log('[PM Auto-Schedule] ตั้งเวลาทำงานอัตโนมัติแล้ว (ทุกวันที่ 1 ของเดือน เวลา 00:30 น.)');
}

module.exports = { runMonthlyPMAutoSchedule, startPMAutoScheduler };