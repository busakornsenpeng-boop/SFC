// routes/pmAutoScheduler.js
// ─────────────────────────────────────────────────────────────
// จัดตาราง PM แบบกระจายทั้งปี (ไม่ใช่ทุกเครื่องทุกเดือนเหมือนเดิม)
//
// หลักการ:
//   1) แบ่งเครื่องจักรเป็น 3 ระดับ (Tier) ตามความถี่การแจ้งซ่อมทั้งหมดตั้งแต่เริ่มระบบ
//        Tier A (แจ้งซ่อมบ่อยสุด ~15% แรก) → PM ทุก 3 เดือน  (4 ครั้ง/ปี)
//        Tier B (ถัดมา ~35%)               → PM ทุก 6 เดือน  (2 ครั้ง/ปี)
//        Tier C (ที่เหลือ ~50%)             → PM ปีละครั้ง    (1 ครั้ง/ปี)
//      แต่ละเครื่องมีเดือน "ที่ต้องตรวจ" คงที่ ไม่สุ่มใหม่ทุกเดือน (คำนวณจาก hash ชื่อเครื่อง
//      เพื่อกระจายเครื่องในแต่ละ Tier ให้ไม่ไปกระจุกเดือนเดียวกันหมด)
//   2) เครื่องที่มีการแจ้งซ่อมใน "เดือนก่อนหน้า" จะถูกดึงเข้าคิว PM เดือนนี้ทันทีเป็นพิเศษ
//      (เหตุ) แม้จะยังไม่ถึงรอบ Tier ของตัวเอง — เพิ่มอัตโนมัติ ไม่ต้องรอแอดมินเลือก
//   3) วันที่ในเดือนกระจายทั่วทั้งเดือนจริง (ไม่ hardcode 28) และ "เว้นวันอาทิตย์"
//
// รันอัตโนมัติทุกวันที่ 1 ของเดือน (ดู startPMAutoScheduler ด้านล่าง — ใช้
// setInterval + Intl.DateTimeFormat เช็คเวลาไทยเอง ไม่ต้องพึ่ง library ภายนอก)
// รันด้วยมือได้ผ่าน POST /api/pm/auto-schedule/run (แอดมินเท่านั้น — ดู routes/pm.js)
// ─────────────────────────────────────────────────────────────
const { sheets, SPREADSHEET_ID } = require('../db/connection');

const START_DAY = 2; // เริ่มจัดวันที่ 2 (เว้นวันที่ 1 ไว้เพราะเป็นวันที่ job auto-schedule รันเอง)

// สัดส่วนแบ่ง Tier ตามอันดับความถี่แจ้งซ่อม (เรียงมาก→น้อยแล้ว)
const TIER_A_PERCENTILE = 0.15; // ~15% แรก
const TIER_B_PERCENTILE = 0.50; // ~35% ถัดมา (สะสมถึง 50%)

const TIER_INTERVAL = { A: 3, B: 6, C: 12 }; // เดือน/รอบ
const TIER_LABEL     = { A: 'Tier A (ทุก 3 เดือน)', B: 'Tier B (ทุก 6 เดือน)', C: 'Tier C (ปีละครั้ง)' };

// คำนวณวันสุดท้ายของเดือนจริง (28/29/30/31 ตามเดือน/ปีนั้นๆ) แทนการ hardcode 28
function getDaysInMonth(year, month /* 0-indexed */) {
  return new Date(year, month + 1, 0).getDate();
}

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'machine';
}

// hash ชื่อเครื่องแบบ deterministic (djb2) ใช้กำหนด "เดือน offset" ของแต่ละเครื่องภายใน Tier
// เพื่อให้เครื่องใน Tier เดียวกันกระจายไปคนละเดือนกัน ไม่ชนกันหมด และคงที่ทุกครั้งที่รัน
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash);
}

function assignTier(rankIndex, total) {
  const percentile = total > 0 ? rankIndex / total : 0;
  if (percentile < TIER_A_PERCENTILE) return 'A';
  if (percentile < TIER_B_PERCENTILE) return 'B';
  return 'C';
}

// เครื่องนี้ "ถึงรอบ" ต้องตรวจในเดือนนี้หรือยัง (ตาม Tier + offset คงที่ของมันเอง)
function isDueThisMonth(machine, tier, monthIndex /* year*12+month, 0-indexed */) {
  const interval = TIER_INTERVAL[tier];
  const offset   = hashString(machine) % interval;
  return ((monthIndex - offset) % interval + interval) % interval === 0;
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

// ดึงรายชื่อเครื่องที่ "มีแจ้งซ่อม" ในเดือนก่อนหน้า (ตามปี/เดือนที่ระบุ)
// หมายเหตุ: ไม่ใช้คอลัมน์ date (row[17]) เพราะบันทึกด้วย toLocaleString('th-TH') เป็นปี พ.ศ.
// parse กลับด้วย new Date() ไม่แม่นยำ — ใช้วันที่ที่ฝังอยู่ท้าย Job ID แทน (รูปแบบ DDMMYY ปี ค.ศ.
// สร้างจาก now.getFullYear() ปกติ ดู generateJobId ใน routes/repairs.js)
async function getMachinesRepairedInMonth(year, month /* 0-indexed */) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:D5000',
  });
  const rows = res.data.values || [];
  const targetMM = String(month + 1).padStart(2, '0');
  const targetYY = String(year).slice(-2);

  const machines = new Set();
  rows.forEach(r => {
    const id      = r[0] || '';
    const machine = r[3] || '';
    if (!id || !machine) return;
    const parts = id.split('-');
    if (parts.length < 3) return;
    const datePart = parts[parts.length - 1]; // DDMMYY
    if (datePart.length !== 6) return;
    const mm = datePart.slice(2, 4);
    const yy = datePart.slice(4, 6);
    if (mm === targetMM && yy === targetYY) machines.add(machine);
  });
  return machines;
}

async function getExistingPMIds() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PM_Calendar!A2:A5000',
  });
  const rows = res.data.values || [];
  return new Set(rows.map(r => r[0]).filter(Boolean));
}

// สร้าง pool วันที่ครอบคลุมทั้งเดือน (วันที่ START_DAY ถึงวันสุดท้ายจริงของเดือนนั้น)
// เว้นวันอาทิตย์ออก
function buildDayPool(year, month /* 0-indexed */) {
  const daysInMonth = getDaysInMonth(year, month);
  const pool = [];
  for (let d = START_DAY; d <= daysInMonth; d++) {
    const dayOfWeek = new Date(year, month, d).getDay(); // 0 = อาทิตย์
    if (dayOfWeek === 0) continue;
    pool.push(d);
  }
  return pool;
}

// สร้างวันที่ของเดือน/ปีที่ระบุ จาก "ลำดับที่ N" ในลิสต์วัน โดยวนซ้ำถ้าเครื่องมากกว่าจำนวนวัน
// (round-robin — ยิ่ง dayPool ยาวเท่าไหร่ ยิ่งกระจาย/ชนกันน้อยลง)
function pickDate(year, month /* 0-indexed */, dayPool, i) {
  const day = dayPool[i % dayPool.length];
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function runMonthlyPMAutoSchedule() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const yyyymm = `${year}${String(month + 1).padStart(2, '0')}`;
  const monthIndex = year * 12 + month;

  // เดือนก่อนหน้า (สำหรับเช็คเครื่องที่เพิ่งแจ้งซ่อม)
  const prevMonthDate = new Date(year, month - 1, 1);
  const prevYear  = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth();

  const [machines, repairCounts, existingIds, recentlyRepaired] = await Promise.all([
    getMachineList(),
    getRepairCountsByMachine(),
    getExistingPMIds(),
    getMachinesRepairedInMonth(prevYear, prevMonth),
  ]);

  if (!machines.length) {
    return { created: 0, skipped: 0, month: `${year}-${String(month + 1).padStart(2, '0')}`, ranking: [], note: 'ไม่พบรายชื่อเครื่องจักรใน MasterData' };
  }

  // จัดอันดับเครื่องจักรตามความถี่การแจ้งซ่อม (มาก → น้อย) แล้วแบ่ง Tier ตามสัดส่วน
  const ranked = machines
    .map(m => ({ machine: m, repairCount: repairCounts[m] || 0 }))
    .sort((a, b) => b.repairCount - a.repairCount)
    .map((item, i, arr) => ({ ...item, tier: assignTier(i, arr.length) }));

  // ── คัดเครื่องที่ต้องจัด PM เดือนนี้ ──
  // (1) ตามรอบ Tier ของตัวเอง  (2) ตามเหตุ — แจ้งซ่อมเดือนก่อน (ถึงยังไม่ถึงรอบก็เพิ่มให้)
  const dueList = [];
  ranked.forEach(item => {
    const dueByRotation = isDueThisMonth(item.machine, item.tier, monthIndex);
    const dueByRepair   = recentlyRepaired.has(item.machine);
    if (dueByRotation || dueByRepair) {
      dueList.push({ ...item, dueByRotation, dueByRepair });
    }
  });

  // เรียงลำดับความสำคัญ: เหตุแจ้งซ่อมเดือนก่อน (เร่งด่วนสุด) → Tier A → B → C
  // เพื่อให้ได้คิววันต้นๆ ของเดือนก่อน
  const tierRank = { A: 0, B: 1, C: 2 };
  dueList.sort((a, b) => {
    if (a.dueByRepair !== b.dueByRepair) return a.dueByRepair ? -1 : 1;
    if (tierRank[a.tier] !== tierRank[b.tier]) return tierRank[a.tier] - tierRank[b.tier];
    return b.repairCount - a.repairCount;
  });

  const dayPool = buildDayPool(year, month);
  const newRows = [];
  const rankingOut = [];

  dueList.forEach((item, i) => {
    const id   = `PMAUTO-${yyyymm}-${slug(item.machine)}`;
    const date = pickDate(year, month, dayPool, i);
    const reasonLabel = item.dueByRepair
      ? (item.dueByRotation ? `${TIER_LABEL[item.tier]} + แจ้งซ่อมเดือนก่อน` : 'แจ้งซ่อมเดือนก่อน (นอกรอบ)')
      : TIER_LABEL[item.tier];

    rankingOut.push({ ...item, date, reason: reasonLabel, skipped: existingIds.has(id) });
    if (existingIds.has(id)) return; // กันสร้างซ้ำถ้ารันมากกว่า 1 ครั้งในเดือนเดียวกัน

    newRows.push([id, `PM ประจำเดือน - ${item.machine}`, item.machine, date, reasonLabel, '', 'รอดำเนินการ']);
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
    totalMachines: machines.length,
    notScheduledThisMonth: machines.length - rankingOut.length, // เครื่องที่ยังไม่ถึงรอบและไม่มีแจ้งซ่อม
    month: `${year}-${String(month + 1).padStart(2, '0')}`,
    ranking: rankingOut,
  };
  console.log(`[PM Auto-Schedule] เดือน ${result.month}: สร้างใหม่ ${result.created} รายการ, ข้าม (มีอยู่แล้ว) ${result.skipped} รายการ, ยังไม่ถึงรอบ ${result.notScheduledThisMonth} เครื่อง`);
  return result;
}

// เรียกครั้งเดียวตอน start server — ตั้ง interval เช็คทุกชั่วโมงว่าเข้าวันที่ 1 ของเดือน (เวลาไทย) หรือยัง
// ใช้ Intl.DateTimeFormat แทน timezone ของเครื่อง server เอง (ปกติ hosting อย่าง Render รันเวลา UTC)
// กันรันซ้ำในเดือนเดียวกันด้วย _lastAutoRunKey ที่เก็บไว้ใน memory
let _lastAutoRunKey = null;

function getBangkokDateParts() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

function checkAndRunIfDue() {
  const { year, month, day } = getBangkokDateParts();
  if (day !== '01') return; // ไม่ใช่วันที่ 1 ของเดือน (เวลาไทย)

  const key = `${year}-${month}`;
  if (_lastAutoRunKey === key) return; // เดือนนี้รันไปแล้ว ไม่ต้องรันซ้ำ

  _lastAutoRunKey = key;
  console.log(`[PM Auto-Schedule] เริ่มจัดตาราง PM ประจำเดือนอัตโนมัติ (${key})...`);
  runMonthlyPMAutoSchedule().catch(err => {
    console.error('[PM Auto-Schedule] error:', err);
    _lastAutoRunKey = null; // รันไม่สำเร็จ — เปิดให้ลองใหม่ได้ในรอบเช็คถัดไป
  });
}

function startPMAutoScheduler() {
  checkAndRunIfDue();                            // เผื่อ server เพิ่ง start ตรงกับวันที่ 1 พอดี
  setInterval(checkAndRunIfDue, 60 * 60 * 1000);  // เช็คทุก 1 ชั่วโมง
  console.log('[PM Auto-Schedule] ตั้งเวลาทำงานอัตโนมัติแล้ว (เช็คทุกชั่วโมง — จะรันตอนเข้าวันที่ 1 ของเดือน เวลาไทย)');
}

module.exports = { runMonthlyPMAutoSchedule, startPMAutoScheduler };