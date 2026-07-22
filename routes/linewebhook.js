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
  findUsernameByLineId,
} = require('./notify');
const { resetPasswordForUsername } = require('./users');

const APP_URL = process.env.APP_URL || 'https://yourdomain.com';

// บัญชีที่ตั้งค่ารหัสผ่านผ่าน env var บน Render (ไม่มีแถวใน Users sheet) — reset ผ่าน LINE ไม่ได้
const ADMIN_USERNAME      = process.env.ADMIN_USERNAME;
const TE_SHARED_USERNAME  = (process.env.TE_SHARED_USERNAME || 'eng_team').trim();

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

// ─────────────────────────────────────────────────────────────
// ผูกบัญชี LINE ผ่านคำสั่งแชท เช่น "ผูกไอดี somchai01"
// ใช้แทนการ login ผ่าน LINE OAuth (ไม่ต้องพึ่ง LINE Login channel เลย)
// ─────────────────────────────────────────────────────────────
const LINK_CMD_REGEX = /^(?:ผูกไอดี|ผูกบัญชี|เชื่อมบัญชี|เชื่อมไอดี)\s+(.+)$/i;

// คำสั่งขอรหัสผ่านใหม่: "ลืมรหัสผ่าน" / "ขอรหัสผ่านใหม่" — ใช้ได้เฉพาะบัญชีที่ผูก LINE ไว้แล้วเท่านั้น
// (ยืนยันตัวตนด้วยการที่ LINE นี้ผูกกับ username อยู่แล้ว เหมือนกับที่ใช้ตอน "ผูกไอดี")
const FORGOT_PW_REGEX = /^(?:ลืมรหัสผ่าน|ขอรหัสผ่านใหม่|reset\s*password)$/i;

async function linkLineAccount(username, lineUserId) {
  const res  = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Users!A2:J1000' });
  const rows = res.data.values || [];

  const rowIndex = rows.findIndex(r => String(r[0] || '').toLowerCase() === username.toLowerCase());
  if (rowIndex === -1) {
    return { success: false, message: `ไม่พบ username "${username}" ในระบบ\nกรุณาตรวจสอบการสะกดอีกครั้ง (username ต้องตรงกับที่ใช้ login เว็บ)` };
  }

  // กันไม่ให้ LINE ID เดียวถูกผูกซ้ำกับคนละ username
  const conflictRow = rows.find((r, i) => i !== rowIndex && r[9] === lineUserId);
  if (conflictRow) {
    return { success: false, message: `LINE นี้ถูกผูกกับบัญชี "${conflictRow[0]}" ไปแล้ว\nหากต้องการเปลี่ยนบัญชี กรุณาติดต่อแอดมิน` };
  }

  const fullname = rows[rowIndex][3] || username;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Users!J${rowIndex + 2}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[lineUserId]] },
  });
  console.log(`[LINE Webhook] ผูกบัญชีสำเร็จ: ${username} → ${lineUserId}`);

  return { success: true, fullname };
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

      // คำสั่งผูกบัญชี LINE: "ผูกไอดี username" / "เชื่อมบัญชี username"
      const linkMatch = text.match(LINK_CMD_REGEX);
      if (linkMatch) {
        const username = linkMatch[1].trim();
        try {
          const result = await linkLineAccount(username, userId);
          if (result.success) {
            await sendTextReply(replyToken,
              `✅ เชื่อมบัญชี LINE สำเร็จ!\n👤 บัญชี: ${result.fullname}\n🔔 คุณจะได้รับแจ้งเตือนงานซ่อม/PM ผ่าน LINE นับจากนี้`
            );
          } else {
            await sendTextReply(replyToken, `❌ ${result.message}`);
          }
        } catch (err) {
          console.error('[LINE Webhook] linkLineAccount error:', err.message);
          await sendTextReply(replyToken, '❌ เกิดข้อผิดพลาดในการผูกบัญชี กรุณาลองใหม่อีกครั้ง');
        }
        continue;
      }

      // คำสั่งลืมรหัสผ่าน: "ลืมรหัสผ่าน" / "ขอรหัสผ่านใหม่"
      if (FORGOT_PW_REGEX.test(text)) {
        try {
          const username = await findUsernameByLineId(userId);
          if (!username) {
            await sendTextReply(replyToken,
              `❌ LINE นี้ยังไม่ได้ผูกกับบัญชีผู้ใช้ใดๆ\nกรุณาผูกบัญชีก่อนด้วยคำสั่ง "ผูกไอดี username"`
            );
          } else if (username === ADMIN_USERNAME || username === TE_SHARED_USERNAME) {
            await sendTextReply(replyToken,
              `❌ บัญชี "${username}" เป็นบัญชีกลาง ไม่สามารถรีเซ็ตรหัสผ่านผ่าน LINE ได้\nกรุณาติดต่อแอดมินโดยตรง`
            );
          } else {
            const result = await resetPasswordForUsername(username);
            if (result.success) {
              await sendTextReply(replyToken,
                `🔑 รีเซ็ตรหัสผ่านสำเร็จ!\n👤 บัญชี: ${username}\n🔐 รหัสผ่านชั่วคราว: ${result.tempPassword}\n\n` +
                `กรุณาเข้าสู่ระบบด้วยรหัสนี้ และเปลี่ยนรหัสผ่านโดยเร็ว\n⚠️ ห้ามบอกรหัสนี้กับผู้อื่น`
              );
            } else {
              await sendTextReply(replyToken, `❌ ${result.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'}`);
            }
          }
        } catch (err) {
          console.error('[LINE Webhook] forgot-password error:', err.message);
          await sendTextReply(replyToken, '❌ เกิดข้อผิดพลาดในการรีเซ็ตรหัสผ่าน กรุณาลองใหม่อีกครั้ง');
        }
        continue;
      }

      if (text.includes('ติดต่อ')) {
        await sendTextReply(replyToken, '📞 ติดต่อเจ้าหน้าที่ ENG: 098-182-5072');
        continue;
      }

      if (text === 'แจ้งซ่อม') {
        const reportUrl = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}line_uid=${encodeURIComponent(userId)}`;
        await sendTextReply(
          replyToken,
          `📋 กดลิงก์ด้านล่างเพื่อแจ้งซ่อมได้เลยครับ 👇\n\n${reportUrl}\n\n` +
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
        `📞 "ติดต่อ" — ติดต่อเจ้าหน้าที่\n` +
        `🔗 "ผูกไอดี username" — เชื่อมบัญชี LINE เพื่อรับแจ้งเตือน\n` +
        `   (เช่น พิมพ์ "ผูกไอดี somchai01")\n` +
        `🔑 "ลืมรหัสผ่าน" — ขอรหัสผ่านชั่วคราวใหม่ (เฉพาะบัญชีที่ผูก LINE ไว้แล้ว)`
      );
    }
  } catch (err) {
    console.error('[LINE Webhook] error:', err.message);
  }
});

module.exports = router;