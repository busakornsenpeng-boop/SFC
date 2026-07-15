// routes/pmAutoScheduler.js
// ─────────────────────────────────────────────────────────────
// ⚠️ ไม่ได้ใช้งานแล้ว (DEPRECATED) — ทีมงานแจ้งว่าไม่ต้องการให้ระบบจัดตาราง PM แบบอัตโนมัติ
// (Tier + cron รายเดือน) อีกต่อไป เปลี่ยนมาใช้การอัปโหลด "ไฟล์มาสเตอร์" แทน ซึ่งแอดมินกำหนด
// แผน PM เองในไฟล์ Excel แล้วนำเข้าผ่าน POST /api/pm/import (ดู routes/pm.js)
//
// routes/pm.js ตัดการ require ไฟล์นี้ออกแล้ว ดังนั้นทั้ง route มือ (/auto-schedule/run-year เดิม)
// และ cron รายเดือนด้านล่างนี้จะไม่ถูกเรียกใช้งานอีก — เก็บไฟล์นี้ไว้เผื่ออ้างอิงโค้ดเดิมเท่านั้น
// ลบทิ้งได้อย่างปลอดภัยถ้าไม่ต้องการเก็บไว้อ้างอิงแล้ว
// ─────────────────────────────────────────────────────────────
//
// เอกสารเดิม (ยังใช้ได้ถ้ามีคนต้องการนำกลับมาใช้ในอนาคต):
// ─────────────────────────────────────────────────────────────
// จัดตาราง PM แบบกระจายล่วงหน้า 12 เดือน (ไม่ใช่ทุกเครื่องทุกเดือนเหมือนเดิม)
//
// หลักการ:
//   1) แบ่งเครื่องจักรเป็น 3 ระดับ (Tier) ตามความถี่การแจ้งซ่อมทั้งหมดตั้งแต่เริ่มระบบ
//        Tier A (แจ้งซ่อมบ่อยสุด ~15% แรก) → PM ทุก 3 เดือน  (4 ครั้ง/ปี)
//        Tier B (ถัดมา ~35%)               → PM ทุก 6 เดือน  (2 ครั้ง/ปี)
//        Tier C (ที่เหลือ ~50%)             → PM ปีละครั้ง    (1 ครั้ง/ปี)
//      แต่ละเครื่องมีเดือน "ที่ต้องตรวจ" คงที่ ไม่สุ่มใหม่ทุกเดือน (คำนวณจาก hash ชื่อเครื่อง
//      เพื่อกระจายเครื่องในแต่ละ Tier ให้ไม่ไปกระจุกเดือนเดียวกันหมด)
//   2) เครื่องที่มีการแจ้งซ่อมใน "เดือนก่อนหน้า" จะถูกดึงเข้าคิว PM ของเดือนปัจจุบันทันทีเป็นพิเศษ
//      (เหตุ) แม้จะยังไม่ถึงรอบ Tier ของตัวเอง — ใช้ได้เฉพาะ "เดือนปัจจุบัน" เท่านั้น เพราะเดือนอนาคต
//      ยังไม่มีข้อมูลแจ้งซ่อมจริง (ดูฟังก์ชัน runAnnualPMSchedule ด้านล่าง)
//   3) วันที่ในเดือนกระจายทั่วทั้งเดือนจริง (ไม่ hardcode 28) และ "เว้นวันอาทิตย์"
//      และไม่มีวันที่ที่ผ่านมาแล้วของเดือนปัจจุบันเด็ดขาด
//
// เรียกได้ 2 ทาง:
//   1) มือ — POST /api/pm/auto-schedule/run-year (แอดมินเท่านั้น — ดู routes/pm.js)
//   2) อัตโนมัติ — cron รันเองทุกวันที่ 1 ของเดือน เวลา 01:00 (Asia/Bangkok, ดูท้ายไฟล์นี้)
//      เพราะฟังก์ชันนี้ rolling ล่วงหน้า 12 เดือนเสมอ การรันซ้ำทุกต้นเดือนทำให้ตรรกะ
//      "แจ้งซ่อมเดือนก่อน" ในข้อ 2 ทำงานทันเดือนปัจจุบันเรื่อยๆ โดยไม่ต้องกดมือ
//      (ยังกดปุ่มมือได้ตามปกติ เช่น อยากรันนอกรอบ หรือจัดล่วงหน้าเต็มปีอนาคต)
// ─────────────────────────────────────────────────────────────
const cron = require('node-cron');
const { sheets, SPREADSHEET_ID } = require('../db/connection');

const START_DAY = 2; // เริ่มจัดวันที่ 2 เป็นค่าเริ่มต้น (เดือนปัจจุบันจะถูกขยับเป็น "วันนี้" แทน ดู minDay ด้านล่าง)

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

// สร้าง pool วันที่ครอบคลุมทั้งเดือน เริ่มจาก minDay (ปกติ START_DAY=2, แต่ถ้าเป็นเดือนปัจจุบัน
// ผู้เรียกจะส่ง "วันนี้" เข้ามาแทน กันไม่ให้สุ่มได้วันที่ผ่านมาแล้วของเดือนนี้) ถึงวันสุดท้ายจริงของเดือน
// เว้นวันอาทิตย์ออก
function buildDayPool(year, month /* 0-indexed */, minDay = START_DAY) {
  const daysInMonth = getDaysInMonth(year, month);
  const start = Math.min(minDay, daysInMonth); // กันกรณี minDay เกินจำนวนวันจริงของเดือน
  const pool = [];
  for (let d = start; d <= daysInMonth; d++) {
    const dayOfWeek = new Date(year, month, d).getDay(); // 0 = อาทิตย์
    if (dayOfWeek === 0) continue;
    pool.push(d);
  }
  if (!pool.length) pool.push(daysInMonth); // กันพูลว่าง (เช่นเหลือวันเดียวในเดือนแล้วดันเป็นอาทิตย์)
  return pool;
}

// สร้างวันที่ของเดือน/ปีที่ระบุ จาก "ลำดับที่ N" ในลิสต์วัน โดยวนซ้ำถ้าเครื่องมากกว่าจำนวนวัน
// (round-robin — ยิ่ง dayPool ยาวเท่าไหร่ ยิ่งกระจาย/ชนกันน้อยลง)
function pickDate(year, month /* 0-indexed */, dayPool, i) {
  const day = dayPool[i % dayPool.length];
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// สร้างแผน PM ล่วงหน้า 12 เดือน (ตัวจัดตารางเดียวของระบบ — ไม่มีตัวรายเดือนแยกแล้ว)
//
// ถ้าไม่ระบุ targetYear (หรือระบุเป็นปีปัจจุบัน) → rolling 12 เดือนถัดไปนับจาก "เดือนนี้"
//   ไหลข้ามปีได้ เช่น กดเดือน ก.ค. 2569 → จัด ก.ค. 2569 ถึง มิ.ย. 2570 (ครบ 12 เดือนเสมอ)
// ถ้าระบุปีอื่นที่ไม่ใช่ปีปัจจุบัน (วางแผนล่วงหน้าเต็มปีอนาคต) → จัดเต็ม ม.ค.-ธ.ค. ของปีนั้นตรงๆ
//
// เดือน "ปัจจุบัน" เท่านั้นที่จะรวมตรรกะ "แจ้งซ่อมเดือนก่อน" (ดึงเครื่องที่เพิ่งแจ้งซ่อมเข้าคิวทันที
// แม้ยังไม่ถึงรอบ Tier) เพราะเดือนอื่นๆ ที่เหลือเป็นอนาคต ยังไม่มีข้อมูลแจ้งซ่อมจริงให้เช็ค —
// ตรรกะนี้จะทำงานทันเดือนถัดๆ ไปเองผ่าน cron ที่รันซ้ำทุกต้นเดือน (ดูท้ายไฟล์) ไม่ต้องกดมือแล้ว
// แต่ถ้าอยากรันนอกรอบ (เช่น เพิ่งอนุมัติแจ้งซ่อมแล้วอยากให้เข้าคิว PM ทันที) ก็ยังกดปุ่มมือได้
//
// เรียกผ่าน POST /api/pm/auto-schedule/run-year (แอดมินเท่านั้น — ดู routes/pm.js)
// หรือรอ cron รันเองอัตโนมัติทุกวันที่ 1 ของเดือน
// ─────────────────────────────────────────────────────────────
async function runAnnualPMSchedule(targetYear) {
  const now        = new Date();
  const todayYear  = now.getFullYear();
  const todayMonth = now.getMonth(); // 0-indexed
  const todayDay   = now.getDate();
  const year = targetYear || todayYear;

  // ปีที่ผ่านไปแล้วทั้งปี — ไม่มีประโยชน์ที่จะจัดตารางย้อนหลัง
  if (year < todayYear) {
    return { year, createdTotal: 0, months: [], note: `ปี ${year} ผ่านไปแล้วทั้งปี ไม่สามารถจัดตารางย้อนหลังได้` };
  }

  // เดือนก่อนหน้าของ "วันนี้" — ใช้เช็คเครื่องที่เพิ่งแจ้งซ่อม ดึงเข้าคิว PM เดือนปัจจุบันทันที
  const prevMonthDate = new Date(todayYear, todayMonth - 1, 1);
  const prevYear  = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth();

  const [machines, repairCounts, existingIds, recentlyRepaired] = await Promise.all([
    getMachineList(),
    getRepairCountsByMachine(),
    getExistingPMIds(),
    getMachinesRepairedInMonth(prevYear, prevMonth),
  ]);

  if (!machines.length) {
    return { year, createdTotal: 0, months: [], note: 'ไม่พบรายชื่อเครื่องจักรใน MasterData' };
  }

  const ranked = machines
    .map(m => ({ machine: m, repairCount: repairCounts[m] || 0 }))
    .sort((a, b) => b.repairCount - a.repairCount)
    .map((item, i, arr) => ({ ...item, tier: assignTier(i, arr.length) }));

  const tierRank = { A: 0, B: 1, C: 2 };

  // รายการ {y, m} ของ 12 เดือนที่จะจัด (ดูเงื่อนไข rolling / เต็มปี ที่หมายเหตุด้านบนฟังก์ชัน)
  const targetMonths = [];
  if (year === todayYear) {
    for (let i = 0; i < 12; i++) {
      const idx = todayYear * 12 + todayMonth + i;
      targetMonths.push({ y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 });
    }
  } else {
    for (let m = 0; m < 12; m++) targetMonths.push({ y: year, m });
  }

  const months = [];
  let createdTotal = 0;

  for (const { y, m } of targetMonths) {
    const monthIndex     = y * 12 + m;
    const yyyymm          = `${y}${String(m + 1).padStart(2, '0')}`;
    const isCurrentMonth  = (y === todayYear && m === todayMonth);

    // (1) ตามรอบ Tier ของตัวเอง
    const dueList = ranked
      .map(item => ({ ...item, dueByRotation: isDueThisMonth(item.machine, item.tier, monthIndex), dueByRepair: false }))
      .filter(item => item.dueByRotation);

    // (2) เดือนปัจจุบันเท่านั้น — เครื่องที่เพิ่งแจ้งซ่อมเดือนก่อน ดึงเข้าคิวทันทีแม้ยังไม่ถึงรอบ
    if (isCurrentMonth) {
      const dueMachineSet = new Set(dueList.map(d => d.machine));
      ranked.forEach(item => {
        if (!recentlyRepaired.has(item.machine)) return;
        if (dueMachineSet.has(item.machine)) {
          dueList.find(d => d.machine === item.machine).dueByRepair = true;
        } else {
          dueList.push({ ...item, dueByRotation: false, dueByRepair: true });
        }
      });
    }

    // เรียงลำดับความสำคัญ: เหตุแจ้งซ่อมเดือนก่อน (เร่งด่วนสุด) → Tier A → B → C
    dueList.sort((a, b) => {
      if (a.dueByRepair !== b.dueByRepair) return a.dueByRepair ? -1 : 1;
      if (tierRank[a.tier] !== tierRank[b.tier]) return tierRank[a.tier] - tierRank[b.tier];
      return b.repairCount - a.repairCount;
    });

    // เดือนปัจจุบัน ห้ามสุ่มวันที่ผ่านมาแล้ว — เดือนอนาคตใช้ START_DAY ปกติ
    const minDay  = isCurrentMonth ? Math.max(START_DAY, todayDay) : START_DAY;
    const dayPool = buildDayPool(y, m, minDay);
    const newRows = [];
    let skippedCount = 0;

    dueList.forEach((item, i) => {
      const id   = `PMAUTO-${yyyymm}-${slug(item.machine)}`;
      const date = pickDate(y, m, dayPool, i);
      if (existingIds.has(id)) { skippedCount++; return; } // มีอยู่แล้ว (เช่นรันซ้ำ) — ข้าม
      const reasonLabel = item.dueByRepair
        ? (item.dueByRotation ? `${TIER_LABEL[item.tier]} + แจ้งซ่อมเดือนก่อน` : 'แจ้งซ่อมเดือนก่อน (นอกรอบ)')
        : TIER_LABEL[item.tier];
      newRows.push([id, `PM ประจำเดือน - ${item.machine}`, item.machine, date, reasonLabel, '', 'รอดำเนินการ']);
      existingIds.add(id); // กันสร้างซ้ำถ้าเผลอเรียกฟังก์ชันนี้ซ้อนกันในรันเดียว
    });

    if (newRows.length) {
      // RAW แทน USER_ENTERED — กันไม่ให้ Sheets ตีความ date string เป็น date serial number
      // แล้วโชว์เป็นตัวเลขดิบ ถ้าคอลัมน์ดันมี number format เป็น "Number" อยู่ก่อนแล้ว
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'PM_Calendar!A:G',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newRows },
      });
    }

    createdTotal += newRows.length;
    months.push({
      month: `${y}-${String(m + 1).padStart(2, '0')}`,
      due: dueList.length,
      created: newRows.length,
      skipped: skippedCount,
    });
  }

  console.log(`[PM Auto-Schedule] จัดตาราง PM ล่วงหน้า 12 เดือนจาก ${months[0]?.month}: สร้างรวม ${createdTotal} รายการ`);
  return { year, createdTotal, months };
}

// ─────────────────────────────────────────────────────────────
// Cron: รัน runAnnualPMSchedule() เองอัตโนมัติทุกวันที่ 1 ของเดือน เวลา 01:00 (Asia/Bangkok)
// ไม่ส่ง year → rolling 12 เดือนถัดไปนับจากเดือนที่รัน (พฤติกรรมเดียวกับกดปุ่มมือ ไม่ระบุปี)
// ตั้งค่า timezone ตรงๆ กันเซิร์ฟเวอร์ deploy อยู่คนละ timezone แล้ว cron ยิงผิดเวลา
//
// module นี้ require ครั้งเดียวตอน server เริ่มทำงาน (routes/pm.js require แบบ top-level)
// ดังนั้น cron.schedule ด้านล่างนี้จะถูกลงทะเบียนแค่ครั้งเดียวเท่านั้น ไม่ซ้ำซ้อน
// ─────────────────────────────────────────────────────────────
cron.schedule('0 1 1 * *', async () => {
  console.log('[PM Auto-Schedule] cron เริ่มรันอัตโนมัติ (ทุกวันที่ 1)...');
  try {
    const result = await runAnnualPMSchedule();
    console.log(`[PM Auto-Schedule] cron รันสำเร็จ: ปี ${result.year}, สร้างรวม ${result.createdTotal} รายการ`);
  } catch (err) {
    console.error('[PM Auto-Schedule] cron รันล้มเหลว:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

module.exports = { runAnnualPMSchedule };