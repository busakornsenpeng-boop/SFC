// routes/linewebhook.js
// ─────────────────────────────────────────────────────────────
// Webhook รับข้อความจาก LINE Official Account
// แปลงมาจาก Google Apps Script doPost()
// ─────────────────────────────────────────────────────────────
const express        = require('express');
const router         = express.Router();
const { sheets, SPREADSHEET_ID } = require('../db/connection');
const {
  sendTextReply,
  sendFlexReply,
  findJobById,
  getLineUserIdByName,
  saveLineUserId,
} = require('./notify');

const APP_URL = process.env.APP_URL || 'https://yourdomain.com';

// ── บันทึก userId ลง Users sheet (ถ้ายังไม่มี) ──
async function saveUserIfNew(userId) {
  if (!userId) return;
  try {
    const res  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Users!A2:J1000' });
    const rows = res.data.values || [];
    // เช็คจาก line_user_id (col J = index 9)
    const exists = rows.some(r => r[9] === userId);
    if (!exists) {
      // บันทึกชั่วคราว — เพิ่ม row ใหม่ที่คอลัมน์ J เท่านั้น
      // (ถ้าต้องการบันทึก UserList แยก ให้ปรับ range ตามโครงสร้างจริง)
      console.log(`[LINE Webhook] พบ userId ใหม่: ${userId}`);
    }
  } catch (err) {
    console.error('[LINE Webhook] saveUserIfNew error:', err.message);
  }
}

// POST /api/line/webhook  ← ตั้งใน LINE Developers Console
router.post('/', async (req, res) => {
  // ตอบ 200 ทันทีเสมอ (LINE จะ retry ถ้าไม่ได้รับ 200)
  res.sendStatus(200);

  try {
    const events = req.body?.events || [];
    if (!events.length) return;

    for (const event of events) {
      if (event.type !== 'message' || event.message?.type !== 'text') continue;

      const userId     = event.source?.userId;
      const replyToken = event.replyToken;
      const text       = (event.message.text || '').trim();

      // บันทึก user ใหม่
      await saveUserIfNew(userId);

      // ── Routing ข้อความ ──

      if (text.includes('ติดต่อ')) {
        await sendTextReply(replyToken, '📞 ติดต่อเจ้าหน้าที่ ENG: 098-182-5072');
        continue;
      }

      if (text === 'แจ้งซ่อม') {
        await sendTextReply(
          replyToken,
          `📋 กดลิงก์ด้านล่างเพื่อแจ้งซ่อมได้เลยครับ 👇\n\n${APP_URL}\n\n` +
          `🔔 เมื่อช่างอัปเดตสถานะ ระบบจะแจ้งกลับมาหาคุณทันที`
        );
        continue;
      }

      if (text.includes('สถานะ') && text.length < 10) {
        await sendTextReply(replyToken, '🔍 กรุณาพิมพ์รหัสงานซ่อม (เช่น REP-20250101-123) เพื่อเช็คสถานะครับ');
        continue;
      }

      // เช็คว่าเป็น Job ID หรือเปล่า (REP-XXXXXXXX-XXX หรือข้อความยาว >= 5)
      if (text.length >= 5) {
        const job = await findJobById(text);
        if (job) {
          await sendFlexReply(replyToken, job.id, job.reporter, job.machine, job.detail, job.status);
        } else {
          await sendTextReply(replyToken,
            `❌ ไม่พบรหัสงานซ่อม: ${text}\nกรุณาตรวจสอบรหัสอีกครั้งครับ`
          );
        }
        continue;
      }

      // default
      await sendTextReply(replyToken,
        `👋 สวัสดีครับ! พิมพ์คำสั่งด้านล่างได้เลย:\n\n` +
        `📋 "แจ้งซ่อม" — เปิดฟอร์มแจ้งซ่อม\n` +
        `🔍 "REP-XXXXXXXX-XXX" — เช็คสถานะงาน\n` +
        `📞 "ติดต่อ" — ติดต่อเจ้าหน้าที่`
      );
    }
  } catch (err) {
    console.error('[LINE Webhook] error:', err.message);
  }
});

module.exports = router;