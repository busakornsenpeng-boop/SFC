// scripts/import-legacy-repairs.js
// ─────────────────────────────────────────────────────────────
// นำเข้าข้อมูลแจ้งซ่อมเก่าจากไฟล์ Excel (export จากระบบเดิม)
// เข้าสู่ชีต Repairs ของระบบใหม่ — ไม่มีการยิง LINE แจ้งเตือนใดๆ ทั้งสิ้น
//
// กติกาการนำเข้า:
//   - งานที่ "จบแล้ว" (ปิดงาน / ซ่อมเสร็จแล้ว / แก้ไข(ตีกลับ)) → คงสถานะ+ช่างเดิมไว้ เป็นประวัติอ้างอิง
//   - งานที่ "ยังไม่จบ" (รอซ่อม / กำลังซ่อม / รออะไหล่) → บังคับเป็น "รอซ่อม" + เคลียร์ช่างว่าง
//     ให้ช่างใหม่มา "รับงาน" ผ่านระบบใหม่เอง พร้อมแนบหมายเหตุบอกสถานะเดิมไว้ในเนื้องาน
//   - ข้าม job_id ที่มีอยู่แล้วในชีตปัจจุบัน กันข้อมูลซ้ำเวลารันซ้ำ
//
// วิธีใช้:
//   1) npm install xlsx --save-dev   (ถ้ายังไม่มี)
//   2) เอาไฟล์ที่ export จากระบบเก่า ไปวางไว้ที่ scripts/legacy-data/legacy-repairs.xlsx
//      (หรือแก้ path ตัวแปร SOURCE_FILE ด้านล่างให้ตรงกับที่คุณวางไฟล์จริง)
//   3) node scripts/import-legacy-repairs.js            ← dry-run (ดูก่อน ไม่เขียนจริง)
//   4) node scripts/import-legacy-repairs.js --apply     ← เขียนจริงลงชีต
// ─────────────────────────────────────────────────────────────
const path = require('path');
const XLSX = require('xlsx');
const { sheets, SPREADSHEET_ID } = require('../db/connection');

const APPLY = process.argv.includes('--apply');
const SOURCE_FILE = path.join(__dirname, 'legacy-data', 'legacy-repairs.xlsx');
const SHEET_TAB_NAME = 'รายการแจ้งซ่อม';

const OPEN_STATUSES = ['รอซ่อม', 'กำลังซ่อม', 'รออะไหล่'];

// ── แปลง JS Date (จาก Excel) เป็น string รูปแบบเดียวกับที่แอประบบใหม่ใช้ เช่น "19/6/2569 10:39:12" ──
function formatThai(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return '';
  const d  = date.getUTCDate();
  const m  = date.getUTCMonth() + 1;
  const y  = date.getUTCFullYear() + 543;
  const hh = date.getUTCHours();
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
}

function cell(row, i) {
  const v = row[i];
  return (v === undefined || v === null) ? '' : v;
}

async function getExistingJobIds() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:A5000',
  });
  const rows = res.data.values || [];
  return new Set(rows.map(r => r[0]).filter(Boolean));
}

function readLegacyRows() {
  // raw:true → เซลล์วันที่จะได้เป็น JS Date object ตรงๆ เสมอ (ไม่พึ่ง format ที่ตั้งไว้ในไฟล์ Excel เดิม
  // ซึ่งบางคอลัมน์ format ไม่เหมือนกัน ทำให้ parse เป็น string แล้วไม่ชัวร์)
  const wb = XLSX.readFile(SOURCE_FILE, { cellDates: true });
  const ws = wb.Sheets[SHEET_TAB_NAME];
  if (!ws) throw new Error(`ไม่พบชีตชื่อ "${SHEET_TAB_NAME}" ในไฟล์ ${SOURCE_FILE}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  // header row = rows[0], ข้ามแถวว่าง (ไม่มี JobID ในคอลัมน์ A)
  return rows.slice(1).filter(r => r && r[0]);
}

// ค่าที่ได้จาก sheet_to_json({raw:true}) เป็น Date object อยู่แล้วถ้าเซลล์เป็นวันที่ — ส่งผ่านตรงๆ
function parseCellDate(v) {
  if (!v || !(v instanceof Date) || isNaN(v)) return null;
  return v;
}

function buildRow(r, existingIds) {
  const jobId = String(cell(r, 0)).trim();
  if (existingIds.has(jobId)) return null; // ข้ามงานที่มีอยู่แล้ว

  const status       = cell(r, 10);
  const isOpen        = OPEN_STATUSES.includes(status);

  const requester     = cell(r, 2);
  const dept           = cell(r, 3);
  const machine        = cell(r, 4);
  const side            = cell(r, 5);
  const opType         = cell(r, 6);
  const detail          = cell(r, 7);
  const imgBefore      = cell(r, 8);
  const imgAfter        = cell(r, 9);
  const technicianOld  = cell(r, 11);
  const doneDateOld    = parseCellDate(cell(r, 12));
  const planStopDate  = parseCellDate(cell(r, 13));
  const etaDate         = parseCellDate(cell(r, 14));
  const noteOld          = cell(r, 15);
  const qcResultOld    = cell(r, 16);
  const qcBy             = cell(r, 17);
  const qcNote           = cell(r, 18);
  const qcDate            = parseCellDate(cell(r, 19));
  const acceptedDateOld = parseCellDate(cell(r, 20));
  const createdAt        = parseCellDate(cell(r, 1));

  // ── สถานะ + ช่าง ──
  const finalStatus     = isOpen ? 'รอซ่อม' : status;
  const finalTechnician = isOpen ? '' : technicianOld;
  const finalDoneDate    = isOpen ? '' : formatThai(doneDateOld);
  const finalAccepted    = isOpen ? '' : formatThai(acceptedDateOld);

  // ── ผลตรวจรับ ──
  let qcResultNew = '';
  if (qcResultOld === 'ผ่าน QC') qcResultNew = 'ผ่านตรวจรับ';
  else if (qcResultOld === 'ตีกลับ') qcResultNew = 'ตีกลับ';

  // ── วันที่ปิดงาน (เฉพาะงานที่ผ่านตรวจรับจริง) ──
  const closedDate = (qcResultOld === 'ผ่าน QC' && qcDate) ? formatThai(qcDate) : '';

  // ── หมายเหตุ: แนบ context ที่ไม่มีคอลัมน์รองรับ ──
  const extraNotes = [];
  if (isOpen) extraNotes.push(`[ย้ายจากระบบเก่า — เดิมสถานะ: ${status}]`);
  if (qcResultOld === 'ตีกลับ' && qcDate) extraNotes.push(`[ตรวจรับไม่ผ่าน ${formatThai(qcDate)}]`);
  if (planStopDate) extraNotes.push(`[แผนหยุดเครื่อง (เดิม): ${formatThai(planStopDate)}]`);
  const finalNote = [...extraNotes, noteOld].filter(Boolean).join(' ');

  return {
    jobId,
    values: [
      jobId,                    // A job_id
      requester,                // B ผู้แจ้ง
      dept,                     // C แผนก
      machine,                  // D เครื่องจักร
      side,                     // E ด้านปัญหา
      opType,                   // F ประเภทงานซ่อม
      detail,                   // G รายละเอียดอาการ
      imgBefore,                // H รูปก่อนซ่อม
      imgAfter,                 // I รูปหลังซ่อม
      finalStatus,              // J สถานะ
      finalTechnician,          // K ช่างผู้รับผิดชอบ
      finalDoneDate,            // L วันที่ซ่อมเสร็จ
      formatThai(etaDate),      // M กำหนดเสร็จ (เดิม)
      finalNote,                // N หมายเหตุ
      qcResultNew,              // O ผลตรวจรับ
      qcBy,                     // P ผู้ตรวจรับ
      qcNote,                   // Q หมายเหตุตรวจรับ
      formatThai(createdAt),    // R วันที่แจ้งซ่อม
      'ซ่อมปกติ',                // S ประเภทงาน
      '',                       // T สถานะอนุมัติ
      '',                       // U (ไม่แตะ)
      finalAccepted,            // V วันที่รับงาน
      closedDate,               // W วันที่ปิดงาน
      '',                       // X เคยรอ (อะไหล่/หยุดเครื่อง)
      '',                       // Y ระยะเวลาซ่อม
      '',                       // Z เวลาเริ่มรอ
      '',                       // AA นาทีที่รอสะสม
    ],
    isOpen,
  };
}

async function run() {
  const existingIds = await getExistingJobIds();
  console.log(`มีงานอยู่ในชีตปัจจุบันแล้ว ${existingIds.size} รายการ`);

  const legacyRows = readLegacyRows();
  console.log(`อ่านจากไฟล์เก่าได้ ${legacyRows.length} รายการ`);

  const toImport = [];
  let skippedExisting = 0;

  legacyRows.forEach(r => {
    const built = buildRow(r, existingIds);
    if (!built) { skippedExisting++; return; }
    toImport.push(built);
  });

  const openCount   = toImport.filter(x => x.isOpen).length;
  const closedCount = toImport.length - openCount;

  console.log(`\nจะนำเข้าทั้งหมด ${toImport.length} รายการ`);
  console.log(`  - งานที่จบแล้ว (คงสถานะ/ช่างเดิม)            : ${closedCount} รายการ`);
  console.log(`  - งานที่ยังไม่จบ (ตั้งเป็น "รอซ่อม" + เคลียร์ช่าง) : ${openCount} รายการ`);
  console.log(`ข้ามเพราะมีอยู่แล้วในชีต                          : ${skippedExisting} รายการ`);

  console.log('\nตัวอย่าง 3 รายการแรกที่จะนำเข้า:');
  toImport.slice(0, 3).forEach(x => {
    console.log(`  ${x.values[0]} | สถานะ: ${x.values[9]} | ช่าง: "${x.values[10]}" | เครื่องจักร: ${x.values[3]}`);
  });

  if (!toImport.length) { console.log('\nไม่มีอะไรต้องนำเข้า ✅'); return; }

  if (!APPLY) {
    console.log('\n(dry-run) ไม่มีการเขียนจริง — รันด้วย --apply เพื่อเขียนลงชีตจริง');
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A:AA',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: toImport.map(x => x.values) },
  });

  console.log(`\nนำเข้าสำเร็จ ${toImport.length} รายการ ✅`);
}

run().catch(err => {
  console.error('Import error:', err);
  process.exit(1);
});