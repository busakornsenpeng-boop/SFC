const express = require('express');
const cors    = require('cors');
const dotenv  = require('dotenv');
const axios   = require('axios');

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const repairRoutes      = require('./routes/repairs');
const userRoutes        = require('./routes/users');
const pmRoutes          = require('./routes/pm');
const masterDataRoutes  = require('./routes/masterdata');
const dailyPMRoutes     = require('./routes/dailypm');
const adminRoutes       = require('./routes/admin');
const lineWebhookRoutes = require('./routes/linewebhook'); // ✅ เพิ่ม

app.use('/api/repairs',      repairRoutes);
app.use('/api/users',        userRoutes);
app.use('/api/pm',           pmRoutes);
app.use('/api/masterdata',   masterDataRoutes);
app.use('/api/daily-pm',     dailyPMRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/line/webhook', lineWebhookRoutes); // ✅ เพิ่ม

// ── LINE Callback ──
const {
  saveLineUserId,
  findUsernameByLineId,
  sendLineMessage,
  broadcastToAdmins,
} = require('./routes/notify');

// ── 🧪 ทดสอบแจ้งเตือน LINE (ลบออกทีหลังได้เมื่อทดสอบเสร็จ) ──
app.get('/api/test-line-notify', async (req, res) => {
  try {
    await broadcastToAdmins('TEST-001', 'ทดสอบระบบ', 'เครื่องทดสอบ', 'นี่คือข้อความทดสอบ', 'รอซ่อม');
    res.send('✅ ส่งคำสั่งแจ้งเตือนแล้ว เช็ค LINE ได้เลย (ถ้าไม่มา ให้เช็ค Render Logs)');
  } catch (err) {
    console.error('[TEST-LINE] error:', err.message);
    res.status(500).send('❌ Error: ' + err.message);
  }
});

app.get('/auth/line/callback', async (req, res) => {
  const { code, state, error } = req.query;

 // ── กรณีเปิดจาก popup (Register modal กดเชื่อม LINE) ──
  if (state === 'popup_register') {
    if (error || !code) {
      return res.send(`<!DOCTYPE html><html><body>
        <script>window.opener?.postMessage({type:'LINE_AUTH_CANCEL'},'*');window.close();</script>
        <p style="font-family:sans-serif;text-align:center;padding:40px;color:#666">ยกเลิกการเชื่อมต่อ...</p>
      </body></html>`);
    }
    return res.send(`<!DOCTYPE html><html><body>
      <script>window.opener?.postMessage({type:'LINE_AUTH_CODE',code:${JSON.stringify(code)}},'*');window.close();</script>
      <p style="font-family:sans-serif;text-align:center;padding:40px;color:#666">กำลังเชื่อมต่อ LINE...</p>
    </body></html>`);
  }
  // ── กรณี redirect ปกติ (Login ด้วย LINE / ผูกบัญชี) ──
  if (!code) return res.redirect('/?error=no_code');

  try {
    // 1. แลก code → access_token
    const tokenRes = await axios.post(
      'https://api.line.me/oauth2/v2.1/token',
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.LINE_REDIRECT_URI,
        client_id:     process.env.LINE_CLIENT_ID,
        client_secret: process.env.LINE_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // 2. ดึง profile → userId
    const { access_token } = tokenRes.data;
    const profileRes = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const { userId, displayName, pictureUrl } = profileRes.data;

    // 3. แยก state
    if (state && state.startsWith('connect_')) {
      // ── ผูก LINE กับบัญชีที่ login อยู่ ──
      const username = state.replace('connect_', '');
      await saveLineUserId(username, userId);
      await sendLineMessage(userId,
        `✅ เชื่อม LINE กับบัญชี "${username}" สำเร็จ!\n` +
        `🔔 ระบบจะแจ้งเตือนสถานะงานซ่อมมาที่นี่ครับ`
      );
      return res.redirect('/?line_connected=1');
    }

    // ── Login ด้วย LINE ──
    const username = await findUsernameByLineId(userId);
    if (username) {
      return res.redirect(
        `/?line_login=${encodeURIComponent(username)}` +
        `&line_uid=${userId}` +
        `&line_name=${encodeURIComponent(displayName)}` +
        `&line_pic=${encodeURIComponent(pictureUrl || '')}`
      );
    }

    // LINE นี้ยังไม่ผูกบัญชี
    return res.redirect(
      `/?line_uid=${userId}` +
      `&line_name=${encodeURIComponent(displayName)}` +
      `&line_pic=${encodeURIComponent(pictureUrl || '')}` +
      `&line_error=not_linked`
    );

  } catch (err) {
    console.error('LINE callback error:', err.message);
    res.redirect('/?error=line_failed');
  }
});

app.listen(PORT, () => {
  console.log(`Server รันอยู่ที่ http://localhost:${PORT}`);
});