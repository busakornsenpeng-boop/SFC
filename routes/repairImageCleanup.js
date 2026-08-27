// routes/repairImageCleanup.js
// ─────────────────────────────────────────────────────────────
// ลบรูปภาพ (img / imgAfter) ของงานที่สถานะ "ปิดงาน" และปิดมาแล้วเกิน 2 เดือน
// ออกจาก Cloudinary เพื่อประหยัดพื้นที่ storage
//
// ⚠️ ลบเฉพาะ "รูปภาพ" เท่านั้น — ไม่ลบแถวงานซ่อมออกจากชีต ข้อมูลรายละเอียดงาน/ประวัติซ่อม
// (เวลาซ่อมเสร็จ, Downtime, ผู้แจ้ง, ช่าง ฯลฯ) ยังอยู่ครบเหมือนเดิมทุกอย่าง
// เปลี่ยนแค่คอลัมน์ H (img) และ I (imgAfter) ให้เป็นข้อความ "ลบแล้ว" แทน URL รูปเดิม
//
// รันได้ 2 ทาง:
//   1) อัตโนมัติ — cron ด้านล่างรันเองทุก 2 เดือน (วันที่ 1 เวลา 02:00 Asia/Bangkok)
//   2) มือ — POST /api/repairs/cleanup-old-images (แอดมินเท่านั้น — ดู routes/repairs.js)
// ─────────────────────────────────────────────────────────────
const cron       = require('node-cron');
const cloudinary = require('cloudinary').v2;
const { sheets, SPREADSHEET_ID } = require('../db/connection');

const CLOSED_STATUS    = 'ปิดงาน';
const MONTHS_THRESHOLD = 2;
const DELETED_MARK     = 'ลบแล้ว';

// ── แปลง string วันที่แบบ Thai locale (พ.ศ.) ที่เก็บในคอลัมน์ W (closedDate) กลับเป็น Date (ค.ศ.) ──
// คัดลอก logic เดียวกับ parseThaiDateString ใน routes/repairs.js (ไม่ได้ export ออกมาให้ใช้ร่วม)
// สตริงนี้เก็บเวลา Bangkok local time (UTC+7) จึงต้องตีความเป็น UTC+7 แล้วแปลงกลับเป็น UTC instant จริง
function parseThaiDateString(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyyBE, hh, mi, ss] = m;
  const yyyyCE = parseInt(yyyyBE, 10) - 543;
  const utcMs = Date.UTC(yyyyCE, parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mi, 10), parseInt(ss, 10)) - 7 * 60 * 60 * 1000;
  const d = new Date(utcMs);
  return isNaN(d.getTime()) ? null : d;
}

// ── ดึง public_id จาก Cloudinary secure_url เพื่อใช้กับ api.delete_resources ──
// รองรับ URL ที่มี transformation string คั่นอยู่ก่อน version เช่น
// .../upload/q_auto,f_auto/v1690000000/sfc-repair/xxx_after_0_123.jpg → "sfc-repair/xxx_after_0_123"
function extractPublicId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/upload\/(?:[a-z0-9_,]+\/)*?(?:v\d+\/)?(.+?)\.[a-zA-Z0-9]+(?:\?.*)?$/i);
  return match ? match[1] : null;
}

// คอลัมน์ img/imgAfter เก็บเป็น JSON array ของ URL (บางแถวเก่าอาจเป็น URL เดี่ยวๆ ไม่ใช่ JSON)
function parseImgColumn(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
    return parsed ? [parsed] : [];
  } catch {
    return raw.startsWith('http') ? [raw] : [];
  }
}

// ลบรูปออกจาก Cloudinary เป็นชุด (สูงสุด 100 public_id ต่อ 1 call ตามข้อจำกัดของ Cloudinary Admin API)
async function destroyPublicIds(publicIds) {
  const unique = [...new Set(publicIds.filter(Boolean))];
  if (!unique.length) return { deleted: 0, failed: 0 };

  let deleted = 0, failed = 0;
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    try {
      const result = await cloudinary.api.delete_resources(batch);
      Object.values(result.deleted || {}).forEach(status => {
        // 'not_found' นับเป็นสำเร็จด้วย เพราะเป้าหมายคือ "ไม่มีรูปนี้ค้างอยู่บน Cloudinary แล้ว"
        if (status === 'deleted' || status === 'not_found') deleted++;
        else failed++;
      });
    } catch (err) {
      console.error('[Repairs Cleanup] delete_resources error:', err.message);
      failed += batch.length;
    }
  }
  return { deleted, failed };
}

// ── งานหลัก: หางาน "ปิดงาน" ที่ปิดมาแล้วเกิน 2 เดือน และยังมีรูปค้างอยู่ → ลบรูปทิ้ง ──
async function cleanupOldClosedJobImages() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Repairs!A2:X5000',
  });
  const rows = res.data.values || [];

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS_THRESHOLD);

  const publicIdsToDelete = [];
  const sheetUpdates      = [];
  let candidateCount      = 0;

  rows.forEach((row, i) => {
    const id         = row[0]  || '';
    const status     = row[9]  || '';
    const img        = row[7]  || '';
    const imgAfter   = row[8]  || '';
    const closedDate = row[22] || ''; // W

    if (!id) return;                                   // แถวว่าง (soft-deleted แล้ว) — ข้าม
    if (status !== CLOSED_STATUS) return;               // ยังไม่ปิดงาน — ข้าม
    if (img === DELETED_MARK && imgAfter === DELETED_MARK) return; // ลบไปแล้วรอบก่อนหน้า — ข้าม
    if (!img && !imgAfter) return;                       // ไม่มีรูปแนบตั้งแต่แรก — ไม่ต้องทำอะไร

    const closed = parseThaiDateString(closedDate);
    if (!closed || closed > cutoff) return; // ยังไม่ถึง 2 เดือน หรือหาวันที่ปิดงานไม่ได้ (กันลบผิดพลาด ข้ามไว้ก่อน)

    candidateCount++;
    [...parseImgColumn(img), ...parseImgColumn(imgAfter)].forEach(u => {
      const pid = extractPublicId(u);
      if (pid) publicIdsToDelete.push(pid);
    });

    const sheetRow = i + 2; // +2 เพราะข้อมูลเริ่มแถว 2 (แถว 1 = header)
    sheetUpdates.push({ range: `Repairs!H${sheetRow}:I${sheetRow}`, values: [[DELETED_MARK, DELETED_MARK]] });
  });

  if (!candidateCount) {
    console.log('[Repairs Cleanup] ไม่มีงานปิดที่ครบกำหนดลบรูป (เกิน 2 เดือน) ในรอบนี้');
    return { candidates: 0, imagesDeleted: 0, imagesFailed: 0 };
  }

  const { deleted, failed } = await destroyPublicIds(publicIdsToDelete);

  // เคลียร์คอลัมน์ H/I ในชีตทีเดียวหลังลบรูปบน Cloudinary เสร็จ (ไม่ว่าจะลบสำเร็จครบทุกรูปหรือไม่
  // ก็ยังเคลียร์ค่าในชีต เพราะเป้าหมายคือไม่ต้องมีลิงก์รูปเก่าค้างอยู่ในระบบ ส่วนรูปที่ลบไม่สำเร็จ
  // บน Cloudinary จะถูก log ไว้ให้ตรวจสอบย้อนหลังได้)
  if (sheetUpdates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: sheetUpdates },
    });
  }

  console.log(`[Repairs Cleanup] เคลียร์รูปสำเร็จ: งาน ${candidateCount} รายการ, รูปที่ลบบน Cloudinary ${deleted} รูป, ล้มเหลว ${failed} รูป`);
  return { candidates: candidateCount, imagesDeleted: deleted, imagesFailed: failed };
}

// ── Cron: รันอัตโนมัติทุก 2 เดือน วันที่ 1 เวลา 02:00 (Asia/Bangkok) ──
// "1-11/2" = เดือน ม.ค., มี.ค., พ.ค., ก.ค., ก.ย., พ.ย. (ทุก 2 เดือนนับจากต้นปี)
// module นี้ require ครั้งเดียวตอน server เริ่มทำงาน (routes/repairs.js require แบบ top-level)
// ดังนั้น cron.schedule ด้านล่างนี้จะถูกลงทะเบียนแค่ครั้งเดียวเท่านั้น ไม่ซ้ำซ้อน
cron.schedule('0 2 1 1-11/2 *', async () => {
  console.log('[Repairs Cleanup] cron เริ่มรันอัตโนมัติ (ทุก 2 เดือน)...');
  try {
    await cleanupOldClosedJobImages();
  } catch (err) {
    console.error('[Repairs Cleanup] cron รันล้มเหลว:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

module.exports = { cleanupOldClosedJobImages };