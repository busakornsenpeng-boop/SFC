// ============================================================
// GLOBAL STATE
// ============================================================
let isLocalMode = false;
const API_URL = '/api';
let currentAdminTimeFilter = 'all';
let currentAdminCustomFrom = null;
let currentAdminCustomTo = null;
let adminRepDateFrom = null;
let adminRepDateTo = null;
let currentUser = null;
let localRepairs = [];
let localPMCalendar = [];
let localPMHistory = [];
let cachedJobs = [], cachedPM = [], cachedPMHistory = [];
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let calendarSelectedDate = null;
let selectedJobForAction = null;
let uploadedFilesBase64 = [];
let chartSideInstance = null, chartDeptInstance = null, chartMonthlyInstance = null;
let insDailyHistory = [];
let authToken = null; // JWT ที่ได้จาก /api/users/login — เก็บไว้ใน memory เท่านั้น (ไม่ใส่ localStorage เพื่อลดความเสี่ยง XSS-token-theft)

// ── บัญชี login กลางของทีมช่าง/วิศวกร — ต้องตรงกับ TE_SHARED_USERNAME ที่ตั้งไว้ใน Render ──
// (ถ้าไม่ได้ตั้งค่า TE_SHARED_USERNAME ใน Render ระบบฝั่ง backend จะ default เป็น 'eng_team')
const TECH_PROFILE_PARENT_ACCOUNT = 'eng_team';

// ── ใช้แทน fetch() ธรรมดาสำหรับ endpoint ที่ต้อง login (แนบ Authorization header ให้อัตโนมัติ) ──
function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  return fetch(url, { ...options, headers }).then(res => {
    if (res.status === 401) {
      // token หมดอายุ/ไม่ถูกต้อง → บังคับ login ใหม่
      currentUser = null;
      authToken = null;
      showToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning');
    }
    return res;
  });
}

// ── กัน stored-XSS: escape ค่าที่มาจากผู้ใช้ก่อนแทรกลง innerHTML ──
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LOGO_BASE64 = "/logo.png";
const monthsThai = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

const INS_GROUPS = [
  {name:"ระบบลำเลียงสายพาน",color:"#10b981",items:["ไม่ฉีกขาด","ไม่ชำรุด","พร้อมใช้งาน"]},
  {name:"หัวฟิวลิงค์",color:"#f59e0b",items:["ตำแหน่งพร้อมใช้งาน"]},
  {name:"ต้นกำลังเครื่องจักร (มอเตอร์)",color:"#f43f5e",items:["พร้อมใช้งาน","ไม่สั่น","มีการ์ด","น็อตไม่หลุด / ไม่หลวม"]},
  {name:"สายไฟ",color:"#f59e0b",items:["อยู่ในรางทั้งหมด","ไม่ล้นออกจากตู้คอนโทรล"]},
  {name:"ระบบลม",color:"#10b981",items:["ไม่มีลมรั่ว"]},
  {name:"จุดหมุน",color:"#14b8a6",items:["มีการอัดจาระบี / หล่อลื่น"]},
  {name:"เครื่องชั่ง",color:"#3b82f6",items:["พร้อมใช้งาน"]}
];
const checkGroups = INS_GROUPS;

// ============================================================
// ENGINEER PANEL STATE
// ============================================================
let engCalY, engCalM, engCalSel = null;
let engHistFreq = 'all';

const engCondPill = {
  ปกติ:'<span class="rpill pass">ปกติ</span>',
  เฝ้าระวัง:'<span class="rpill warn">เฝ้าระวัง</span>',
  ผิดปกติ:'<span class="rpill fail">ผิดปกติ</span>',
};
const engFreqBadge = {
  daily:'<span class="freq-type-badge freq-d">รายวัน</span>',
  monthly:'<span class="freq-type-badge freq-m">รายเดือน</span>',
};
const engStCls = {รอดำเนินการ:'pend',กำลังดำเนินการ:'prog',เสร็จแล้ว:'done',เกินกำหนด:'over'};
const engStSp  = {รอดำเนินการ:'sp-pend',กำลังดำเนินการ:'sp-prog',เสร็จแล้ว:'sp-done',เกินกำหนด:'sp-over'};

// ============================================================
// DEMO DATA SEEDER (local mode only)
// ============================================================
function seedDemoData() {
  if(localPMCalendar.length > 0) return;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth()+1).padStart(2,'0');
  const d = String(today.getDate()).padStart(2,'0');
  const ymd = `${y}-${m}-${d}`;
  localPMCalendar = [
    {id:'PM1',date:`${y}-${m}-20`,machine:'FLF (07)',title:'ตรวจเช็กรายเดือน',type:'รายเดือน',status:'เกินกำหนด'},
    {id:'PM2',date:ymd,machine:'FLF (03)',title:'ตรวจเช็กประจำวัน',type:'รายวัน',status:'รอดำเนินการ'},
    {id:'PM3',date:ymd,machine:'FLF (12)',title:'ตรวจเช็กประจำวัน',type:'รายวัน',status:'รอดำเนินการ'},
    {id:'PM4',date:ymd,machine:'FLF (15)',title:'ตรวจเช็กรายเดือน',type:'รายเดือน',status:'กำลังดำเนินการ'},
    {id:'PM5',date:`${y}-${m}-25`,machine:'FLF (01)',title:'ตรวจเช็กประจำวัน',type:'รายวัน',status:'เสร็จแล้ว'},
    {id:'PM6',date:`${y}-${m}-28`,machine:'FLF (10)',title:'ตรวจเช็กรายเดือน',type:'รายเดือน',status:'รอดำเนินการ'},
  ];
  localRepairs = [
    {id:'REP-20260521-001',date:'21/5/2026, 09:30:00',name:'สมหมาย',dept:'ฝ่ายผลิต (Production)',machine:'ปั๊มลม',side:'ระบบลม (Pneumatic)',opType:'ซ่อมฉุกเฉิน (Break Down)',detail:'ไม่มีแรงดัน ปั๊มไม่ทำงาน',img:'',imgAfter:'',status:'รอซ่อม',technician:'',doneDate:'',eta:'',note:'',hoursOpen:35},
    {id:'REP-20260522-002',date:'22/5/2026, 08:00:00',name:'สมศรี',dept:'ฝ่ายคลังสินค้า (Warehouse)',machine:'ตู้ซิงค์',side:'ระบบไฟฟ้า (Electrical)',opType:'ซ่อมตามอาการ (Corrective)',detail:'ไฟล้นออกมา มีกลิ่นไหม้',img:'',imgAfter:'',status:'รอซ่อม',technician:'',doneDate:'',eta:'',note:'',hoursOpen:0},
    {id:'REP-20260520-003',date:'20/5/2026, 10:15:00',name:'สมบัติ',dept:'ฝ่ายผลิต (Production)',machine:'FLF (05)',side:'ระบบเครื่องกล (Mechanical)',opType:'ซ่อมตามอาการ (Corrective)',detail:'เสียงดังผิดปกติ สั่นมากกว่าปกติ',img:'',imgAfter:'',status:'กำลังซ่อม',technician:'สมชาย มั่นคง',doneDate:'',eta:'25/5/2026',note:'ถอดฝาครอบแล้ว ตรวจสอบแบริ่ง',hoursOpen:0},
  ];
  localPMHistory = [
    {no:1,pmCode:'PM-M-20260520',equip:'FLF (07)',productionLine:'',date:'20/5/2026',tech:'วิชัย ใจดี',runningHr:'4200',parts:'-',result:'warn',workDone:'ตรวจสอบแบริ่ง พบการสึกหรอ',note:'ติดตามต่อเดือนหน้า',checklist:'{}',savedAt:'20/5/2026, 10:00:00'},
    {no:2,pmCode:'PM-D-20260522',equip:'FLF (03)',productionLine:'',date:'22/5/2026',tech:'สมชาย มั่นคง',runningHr:'1850',parts:'-',result:'pass',workDone:'ทำความสะอาด เติมสารหล่อลื่น',note:'-',checklist:'{}',savedAt:'22/5/2026, 08:30:00'},
  ];
}
document.addEventListener('DOMContentLoaded', function() {
  seedDemoData();

  document.querySelectorAll('img.header-logo-img').forEach(el => {
    el.src = LOGO_BASE64;
  });

  // ── เพิ่มตรงนี้: รับผลจาก LINE callback ──
  const _lp = new URLSearchParams(window.location.search);

  if (_lp.get('line_connected') === '1') {
    showToast('เชื่อม LINE สำเร็จ! จะได้รับแจ้งเตือนผ่าน LINE', 'success');
    history.replaceState({}, '', '/');
  }
  if (_lp.get('line_error') === 'not_linked') {
    showToast('LINE นี้ยังไม่ผูกบัญชี กรุณา login ก่อนแล้วกด "เชื่อม LINE"', 'warning');
    history.replaceState({}, '', '/');
  }
  if (_lp.get('line_login')) {
    const uname = _lp.get('line_login');
    const ud = document.getElementById('username-display');
    if (ud) { ud.value = uname; syncUsername(uname); }
    history.replaceState({}, '', '/');
    showToast('ยินดีต้อนรับ! กรุณากรอกรหัสผ่านเพื่อเข้าสู่ระบบ', 'info');
  }
  // ── ดักจับ line_uid ที่แนบมาจากลิงก์ "แจ้งซ่อม" ใน LINE OA ──
  // เก็บไว้รอผูกบัญชีอัตโนมัติทันทีที่ login สำเร็จ (ดูใน handleLoginSubmit)
  if (_lp.get('line_uid')) {
    localStorage.setItem('pending_line_uid', _lp.get('line_uid'));
    history.replaceState({}, '', location.pathname);
  }
  // ── จบส่วนที่เพิ่ม ──

  if (isLocalMode) {
    hideLoading();
    const s = sessionStorage.getItem('mock_session');
    if(s) { currentUser = JSON.parse(s); setupDashboard(); }
  } else {
    loadAllData();
  }
});

function loadAllData() {
  showLoading('กำลังโหลดข้อมูลหลัก...');
  return Promise.all([
    fetch(`${API_URL}/repairs`).then(r => r.json()).catch(() => ({ data: [] })),
    fetch(`${API_URL}/pm`).then(r => r.json()).catch(() => ({ data: [] })),
    fetch(`${API_URL}/pm/history`).then(r => r.json()).catch(() => ({ data: [] })),
   fetch(`${API_URL}/masterdata`)
  .then(r => r.json())
  .catch(err => { console.error('[masterdata] fetch failed:', err); return { success: false }; }),
    fetch(`${API_URL}/users/technicians`).then(r => r.json()).catch(() => ({ data: [] })),
  ])
  .then(([repairsRes, pmRes, pmHistRes, masterRes, techRes]) => {
    cachedJobs      = repairsRes.data  || [];
    cachedPM        = pmRes.data       || [];
    cachedPMHistory = pmHistRes.data   || [];
   if (masterRes.success) {
  populateMachineDropdown(masterRes.machines);
  populateDeptDropdown(masterRes.departments);
  populateLineDropdown(masterRes.lines);
} else {
  console.error('[masterdata] success=false, response:', masterRes);
  populateLineDropdown([]);      // จะขึ้น error แทนค้าง "กำลังโหลด..."
  populateMachineDropdown([]);
  showToast('โหลดข้อมูล master (สถานที่/เครื่องจักร) ไม่สำเร็จ กรุณารีเฟรชหน้า', 'error');
}
    if (techRes.data) {
      populateTechDropdown(techRes.data);
    }
    
    hideLoading();
    if(currentUser) setupDashboard();
  })
  .catch(err => {
    hideLoading();
    showToast('โหลดข้อมูลไม่สำเร็จ: ' + err.message, 'error');
  });
}

function showLoading(txt='กำลังประมวลผล...') {
  const o = document.getElementById('loading-overlay');
  o.style.display='flex'; o.style.opacity=1; o.style.pointerEvents='auto';
  document.getElementById('loading-txt').textContent=txt;
}
function hideLoading() {
  const o = document.getElementById('loading-overlay');
  o.style.opacity=0; o.style.pointerEvents='none';
  setTimeout(()=>{ if(o.style.opacity==='0') o.style.display='none'; }, 300);
}

function showToast(msg, type='success') {
  const c = document.getElementById('toast-container'); if(!c) return;
  const t = document.createElement('div');
  t.className='toast toast-'+type;
  const icons={success:'ion-ios-checkmark-circle',error:'ion-ios-close-circle',warning:'ion-ios-warning',info:'ion-ios-information-circle'};
  t.innerHTML=`<i class="${icons[type]||icons.info} toast-icon"></i><div>${msg}</div>`;
  c.appendChild(t); t.offsetHeight; t.classList.add('show');
  setTimeout(()=>{t.classList.add('hide');t.addEventListener('transitionend',()=>t.remove());},3500);
}

function handleServerResponse(res) {
  if(!res) return;
  let msg=res, type='info';
  if(res.startsWith('✅')){msg=res.slice(2).trim();type='success';}
  else if(res.startsWith('❌')){msg=res.slice(2).trim();type='error';}
  else if(res.startsWith('⚠️')){msg=res.slice(3).trim();type='warning';}
  showToast(msg,type);
}

// ============================================================
// LOGIN
// ============================================================
function syncUsername(val) { document.getElementById('username').value=val; }

function handleLoginSubmit(event) {
  event.preventDefault();
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  if (!u) { showLoginError(); return; }
  showLoading('กำลังตรวจสอบสิทธิ์...');
  fetch(`${API_URL}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  })
  .then(res => res.json())
  .then(res => {
  hideLoading();
  if (res.success) {
    currentUser = {
      username: res.username,
      name:     res.name,
      role:     res.role,
      avatar:  res.avatar,
      isChief: res.isChief,
      dept :    res.dept,
    };
    authToken = res.token || null;

    // ── ล้างตัวตนที่เคยระบุไว้ ทุกครั้งที่ login สำเร็จ กันชื่อคนก่อนหน้าค้างข้ามรอบ ──
    sessionStorage.removeItem('identified_tech_' + currentUser.username);
    myIdentifiedName = null;

    autoLinkPendingLineId(); // ผูก LINE ID อัตโนมัติถ้ามีค้างจากลิงก์ "แจ้งซ่อม"
    setupDashboard();
  } else {
    showLoginError();
  }
})
  .catch(() => { hideLoading(); showLoginError(); });
}

// ─────────────────────────────────────────────────────────────
// ผูก LINE ID อัตโนมัติหลัง login สำเร็จ (ถ้ามี line_uid ค้างจากลิงก์แจ้งซ่อมใน LINE OA)
// ทำงานเงียบๆ เบื้องหลัง ไม่รบกวน flow การ login
// ─────────────────────────────────────────────────────────────
async function autoLinkPendingLineId() {
  const lineUid = localStorage.getItem('pending_line_uid');
  if (!lineUid || !currentUser?.username) return;
  try {
    const res = await fetch(`${API_URL}/users/${encodeURIComponent(currentUser.username)}/link-line`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineUserId: lineUid }),
    }).then(r => r.json());
    localStorage.removeItem('pending_line_uid'); // เอาออกไม่ว่าจะสำเร็จหรือไม่ กันลูปผูกซ้ำ
    if (res.success) {
      showToast('เชื่อมบัญชี LINE สำเร็จอัตโนมัติ! จะได้รับแจ้งเตือนผ่าน LINE', 'success');
    }
    // ถ้าไม่สำเร็จ (เช่น LINE นี้ผูกกับบัญชีอื่นแล้ว) จะไม่โชว์ error รบกวน เพราะไม่ใช่การกระทำที่ user ตั้งใจกดเอง
  } catch (err) {
    console.error('[autoLinkPendingLineId] error:', err.message);
  }
}

function mockCheckLogin(u,p) {
  return {status:'fail'};
}

function showLoginError() {
  const e=document.getElementById('login-err-msg');e.style.display='block';
  setTimeout(()=>e.style.display='none',5000);
}
// ใหม่
function handleLogout() {
  // ── ล้างการระบุตัวตนของบัญชีกลาง กันชื่อคนก่อนหน้าค้างข้ามคน ──
  if (currentUser?.username) {
    sessionStorage.removeItem('identified_tech_' + currentUser.username);
  }
  myIdentifiedName = null;
  ME = '';

  currentAdminTimeFilter = 'all';
  currentUser = null;
  authToken = null;
  if (isLocalMode) sessionStorage.removeItem('mock_session');
  document.getElementById('dashboard-page').style.display  = 'none';
  document.getElementById('te-panel-page').style.display   = 'none'; // ← เหลือแค่นี้
  document.getElementById('login-page').style.display      = 'flex';
  document.getElementById('password').value = '';
  const ud = document.getElementById('username-display');
  if(ud) { ud.value = ''; ud.placeholder = 'กรอก username'; }
  syncUsername('');
  [chartSideInstance,chartDeptInstance,chartMonthlyInstance].forEach(c=>{
    try{c&&c.destroy();}catch(e){}
  });
  chartSideInstance=chartDeptInstance=chartMonthlyInstance=null;
}

// ============================================================
// ROLE HELPERS
// ============================================================
// ช่างซ่อมและวิศวกรถูกรวมเป็น role เดียวกัน ('engineer') ตั้งแต่ระดับ backend
// (resolveRole ใน users.js จะ map แผนก MTN/ENG ให้เป็น 'engineer' เหมือนกันหมด)
// ฟังก์ชันนี้เก็บไว้เผื่อมี user เก่าที่ยังมี role='technician' ค้างอยู่ใน Sheet
function isRepairStaff(role) {
  return role === 'engineer' || role === 'technician';
}

// ============================================================
// SETUP DASHBOARD
// ============================================================
// ใหม่
function setupDashboard() {
  document.getElementById('login-page').style.display = 'none';

  // ทั้ง technician และ engineer → TE Panel (role เดียวกัน)
  if (isRepairStaff(currentUser.role)) {
    document.getElementById('dashboard-page').style.display  = 'none';
    document.getElementById('te-panel-page').style.display   = 'block';
    initTEPanel();
    return;
  }

  // user, admin → dashboard เดิม
  document.getElementById('te-panel-page').style.display   = 'none';
  document.getElementById('dashboard-page').style.display  = 'block';
  document.getElementById('user-display-name').textContent = currentUser.name;
  document.getElementById('user-display-role').textContent = currentUser.role;

  // ── ซ่อนปุ่ม "เชื่อม LINE" สำหรับแอดมิน ──
  // แอดมินตั้งค่า LINE ID สำหรับรับแจ้งเตือนผ่าน ADMIN_LINE_IDS ใน .env โดยตรง
  // ไม่ได้เก็บ line_user_id ไว้ใน Users sheet เหมือน user ทั่วไป จึงไม่ต้องมีปุ่มนี้
  const lineBtn = document.getElementById('btn-line-connect');
  if (lineBtn) lineBtn.style.display = (currentUser.role === 'admin') ? 'none' : 'inline-flex';

  const nav = document.getElementById('main-nav-tabs'); nav.innerHTML = '';

  const roleTabs = {
  user: [
    {panel:'report-repair', label:'แจ้งซ่อมบำรุง',  icon:'ion-ios-add-circle-outline'},
    {panel:'track-repairs', label:'ติดตามงานซ่อม',   icon:'ion-ios-time'},
   {panel:'ins-daily-pm',  label:'เช็คก่อนผลิตทุกวัน',  icon:'ion-ios-clipboard'},
    {panel:'qc-panel',      label:'ตรวจรับงาน QC',   icon:'ion-ios-ribbon'}
  ],
  engineer: [
    // แท็บสำหรับวิศวกร
  ],
 admin: [
    {panel:'admin-dashboard',    label:'Dashboard ภาพรวม',   icon:'ion-ios-pie'},
    {panel:'admin-repairs',      label:'จัดการใบแจ้งซ่อม',   icon:'ion-ios-options'},
    {panel:'admin-people',       label:'จัดการผู้ใช้งาน',    icon:'ion-ios-people'}
  ]
};

  const myTabs = roleTabs[currentUser.role] || [];
  myTabs.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${i === 0 ? 'active' : ''}`;
    btn.innerHTML = `<i class="${tab.icon}"></i> ${tab.label}`;
    btn.setAttribute('onclick', `switchViewPanel('${tab.panel}',this)`);
    nav.appendChild(btn);
  });

  const addPmBtn = document.getElementById('btn-add-pm-item');
  if (addPmBtn) addPmBtn.classList.add('d-none');
  const epPmAddBtn = document.getElementById('ep-pm-add-btn');
  if (epPmAddBtn) epPmAddBtn.classList.add('d-none');

  if (myTabs.length > 0) {
    switchViewPanel(myTabs[0].panel, nav.children[0]);
    const er = document.getElementById('rep-requester');
    if (er && currentUser) er.value = currentUser.name;
    const ed = document.getElementById('rep-dept');
   if (ed && currentUser) ed.value = currentUser.dept || ''; 
  }
}

function switchViewPanel(panelId, tabBtn) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(p=>p.classList.remove('active'));
  tabBtn.classList.add('active');
  const ap=document.getElementById(`panel-${panelId}`); if(ap) ap.classList.add('active');
  if(panelId==='report-repair')   { const er=document.getElementById('rep-requester');
    if(er&&currentUser) er.value=currentUser.name; }
  if(panelId==='track-repairs')   renderRepairsTable();
  if(panelId==='pm-table')        { renderPMTable(); updatePMStats(); }
  if(panelId==='pm-calendar')     renderCalendar();
  if(panelId==='pm-history')      renderPMHistoryTable();
  if(panelId==='eng-main')        initEngPanel();
  if(panelId==='admin-dashboard') initAdminDashboard();
  if(panelId==='admin-repairs')   renderAdminRepairsTable();
if(panelId==='admin-people')    initAdminPeoplePanel();
  if(panelId==='ins-daily-pm')    insInitForm();
  if(panelId==='qc-panel')        renderUserQCPanel(); 
};

function refreshData(msg='กำลังอัปเดตข้อมูล...') {
  if(isLocalMode) return;
  showLoading(msg); loadAllData();
}

function getRepairJobsData(){ return isLocalMode ? localRepairs    : cachedJobs; }
function getPMData()        { return isLocalMode ? localPMCalendar : cachedPM; }
function getPMHistoryData() { return isLocalMode ? localPMHistory  : cachedPMHistory; }

// ============================================================
// ENGINEER PANEL LOGIC
// ============================================================
function initEngPanel() {
  const pmList=getPMData(), jobs=getRepairJobsData();
  const qcJobs=jobs.filter(j=>j.status==='ซ่อมเสร็จแล้ว');
  const pmPend=pmList.filter(p=>p.status==='รอดำเนินการ').length;
  const pmDone=pmList.filter(p=>p.status==='เสร็จแล้ว').length;
  document.getElementById('eng-kpi-qc').textContent=qcJobs.length;
  document.getElementById('eng-kpi-pmpend').textContent=pmPend;
  document.getElementById('eng-kpi-pmdone').textContent=pmDone;
  document.getElementById('eng-kpi-pmtotal').textContent=pmList.length;
  document.getElementById('eng-kpi-repairs').textContent=jobs.length;
  document.getElementById('eng-kpi-sla').textContent='92%';
  document.getElementById('eng-badge-qc').textContent=qcJobs.length;
  document.getElementById('eng-badge-pm').textContent=pmList.length;
  document.getElementById('eng-badge-daily').textContent=0;
  const now=new Date();
  if(!engCalY){engCalY=now.getFullYear();engCalM=now.getMonth();}
  swEng('qc',document.getElementById('et-qc'));
}

function swEng(tab,btn) {
  document.querySelectorAll('.eng-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.eng-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('ep-'+tab).classList.add('active');
  if(tab==='qc')    engRenderQC();
  if(tab==='dash')  engRenderDash();
  if(tab==='pm')    engRenderPMTable();
  if(tab==='cal')   engRenderCal();
  if(tab==='hist')  engRenderHist();
  if(tab==='rep')   engRenderRepairs();
  if(tab==='daily') engRenderDailyPM();
}

function engRenderDailyPM(){
  const grid = document.getElementById('ep-daily-grid');
  if(!grid) return;
  const search = (document.getElementById('ep-daily-search')?.value||'').toLowerCase();
  const statusF = document.getElementById('ep-daily-status')?.value||'';

  if(isLocalMode){
    grid.innerHTML = '<div style="color:var(--text3);text-align:center;padding:2rem;grid-column:1/-1"><i class="ion-ios-archive"></i> ไม่มีข้อมูล Daily PM ใน Local Mode</div>';
    return;
  }

  showLoading('กำลังโหลด Daily PM...');
  fetch(`${API_URL}/daily-pm`)
    .then(r => r.json())
    .then(function(data){
      hideLoading();
      let list = (data.dailyPMHistory||[]).filter(h => {
        const matchSearch = !search||(h.machine||'').toLowerCase().includes(search)||(h.inspector||'').toLowerCase().includes(search);
        const matchStatus = !statusF||(statusF==='pending'&&h.engStatus!=='รับทราบแล้ว')||(statusF==='acked'&&h.engStatus==='รับทราบแล้ว');
        return matchSearch && matchStatus;
      });
      document.getElementById('eng-badge-daily').textContent = list.filter(h=>h.engStatus!=='รับทราบแล้ว').length;
      if(!list.length){ grid.innerHTML='<div style="color:var(--text3);text-align:center;padding:2rem;grid-column:1/-1"><i class="ion-ios-archive"></i> ไม่พบรายการ</div>'; return; }
      const OL = {pass:'ปกติ',warn:'ต้องติดตาม',fail:'ชำรุด'};
      const OC = {pass:'var(--green)',warn:'var(--yellow)',fail:'var(--red)'};
      grid.innerHTML = list.map(h => {
        const acked = h.engStatus==='รับทราบแล้ว';
        return `<div style="background:var(--surface);border:1px solid ${acked?'var(--border)':'var(--teal)'};border-radius:var(--r);padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div style="font-size:10px;font-family:var(--font-mono);color:var(--accent)">${h.code}</div>
            <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:${acked?'var(--green-bg)':'rgba(20,184,166,.15)'};color:${acked?'var(--green)':'var(--teal)'}">
              ${acked?'<i class="ion-ios-checkmark-circle"></i> รับทราบแล้ว':'⏳ รอรับทราบ'}
            </span>
          </div>
          <div style="font-weight:700;font-size:14px;margin-bottom:2px">${h.machine||'-'}</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:8px"><i class="ion-ios-business"></i> ${h.productionLine||'-'} · <i class="ion-ios-person"></i> ${h.inspector||'-'}</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:10px"><i class="ion-ios-calendar"></i> ${h.date} ${h.time}</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;font-weight:600;color:${OC[h.result]||'var(--text)'}">● ${OL[h.result]||h.result}</span>
            ${acked
              ? `<span style="font-size:11px;color:var(--text2)">${h.engBy||''}</span>`
              : `<button class="btn btn-accent" style="padding:5px 12px;font-size:11px" onclick="engOpenDailyPMDetail('${h.code}')">รับทราบ</button>`
            }
          </div>
        </div>`;
      }).join('');
    })
    .catch(() => { hideLoading(); grid.innerHTML='<div style="color:var(--text3);text-align:center;padding:2rem;grid-column:1/-1"><i class="ion-ios-close-circle"></i> โหลดไม่สำเร็จ</div>'; });
}
function engRenderQC() {
  const jobs=getRepairJobsData();
  const qcJobs=jobs.filter(j=>j.status==='ซ่อมเสร็จแล้ว');
  const sub=document.getElementById('ep-qc-subtitle');
  const grid=document.getElementById('ep-qc-grid');
  if(sub) sub.textContent=`งานซ่อมที่รอตรวจสอบคุณภาพ • ${qcJobs.length} รายการ`;
  if(!grid) return;
  if(!qcJobs.length){
    grid.innerHTML='<div style="color:var(--text3);text-align:center;padding:2rem;font-size:13px"><i class="ion-ios-archive"></i> ไม่มีงานรอตรวจ QC ขณะนี้</div>';
    return;
  }
  grid.innerHTML=qcJobs.map(j=>`
    <div class="qc-card" style="border-left:3px solid var(--teal)">
      <div class="qc-card-top"><span class="qc-card-id">${j.id}</span><span class="qc-urgency normal">รอ QC</span></div>
      <div class="qc-card-machine">${j.machine}</div>
      <div class="qc-card-tech"><i class="ion-ios-construct"></i> ${j.technician||'—'} · เสร็จ ${j.doneDate||j.date||'—'}</div>
      <div class="qc-card-meta">
        <span class="qc-meta-tag">${j.dept||''}</span>
        <span class="qc-meta-tag">${(j.side||'').split(' ')[0]}</span>
        <span class="qc-meta-tag">${j.opType||''}</span>
      </div>
      <div class="qc-card-actions">
        <button class="qc-btn-detail" onclick="viewJobDetail('${j.id}')"><i class="ion-ios-eye"></i> ดูรายละเอียด</button>
        <button class="qc-btn-do"     onclick="engOpenQC('${j.id}')"><i class="ion-ios-checkmark-circle"></i> ทำ QC ตรวจสอบ</button>
      </div>
    </div>`).join('');
}

function engOpenQC(id){viewJobDetail(id);}

function engRenderDash() {
  const pmList=getPMData();
  const total=pmList.length||1;
  const done=pmList.filter(p=>p.status==='เสร็จแล้ว').length;
  const pend=pmList.filter(p=>p.status==='รอดำเนินการ').length;
  const prog=pmList.filter(p=>p.status==='กำลังดำเนินการ').length;
  const over=pmList.filter(p=>p.status==='เกินกำหนด').length;
  const trendEl=document.getElementById('ep-trend-list');
  if(trendEl){
    const months=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.'];
    const vals=[18,22,15,25,Math.max(total,1)];
    const maxV=Math.max(...vals);
    trendEl.innerHTML=months.map((m,i)=>`
      <div class="trend-item">
        <span class="trend-label">${m}</span>
        <div class="trend-bar-bg"><div class="trend-bar" style="width:${Math.round(vals[i]/maxV*100)}%;background:var(--teal)"></div></div>
        <span class="trend-val">${vals[i]}</span>
      </div>`).join('');
  }
  const recentEl=document.getElementById('ep-recent-list');
  if(recentEl){
    const recent=getPMHistoryData().slice(0,5);
    if(recent.length){
      const condCls={pass:'pass',warn:'warn',fail:'fail'};
      const condTxt={pass:'ปกติ',warn:'เฝ้าระวัง',fail:'ผิดปกติ'};
      recentEl.innerHTML=recent.map(h=>`
        <div class="recent-item">
          <div class="recent-info">
            <div class="recent-machine">${h.equip} — ${condTxt[h.result]||h.result}</div>
            <div class="recent-date">${h.date}</div>
          </div>
          <span class="rpill ${condCls[h.result]||'pass'}">${condTxt[h.result]||h.result}</span>
        </div>`).join('');
    } else {
      recentEl.innerHTML=`
        <div class="recent-item"><div class="recent-info"><div class="recent-machine">FLF (03) — ผ่าน QC</div><div class="recent-date">วันนี้</div></div><span class="rpill pass">ปกติ</span></div>
        <div class="recent-item"><div class="recent-info"><div class="recent-machine">PM FLF (12) — ตรวจแล้ว</div><div class="recent-date">วันนี้</div></div><span class="rpill qc">PM เสร็จ</span></div>`;
    }
  }
  const barsEl=document.getElementById('ep-pm-bars');
  if(barsEl){
    const bars=[
      {label:'เสร็จแล้ว',val:done,total,color:'var(--green)'},
      {label:'รอดำเนินการ',val:pend,total,color:'var(--yellow)'},
      {label:'กำลังดำเนินการ',val:prog,total,color:'var(--accent)'},
      {label:'เกินกำหนด',val:over,total,color:'var(--red)'},
    ];
    barsEl.innerHTML=bars.map(b=>`
      <div>
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px">
          <span style="color:${b.color}">${b.label}</span>
          <span style="font-family:var(--font-mono);color:${b.color}">${b.val} / ${b.total}</span>
        </div>
        <div style="height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${b.total?Math.round(b.val/b.total*100):0}%;background:${b.color};border-radius:4px"></div>
        </div>
      </div>`).join('');
  }
}

function engRenderPMTable() {
  const q=(document.getElementById('ep-pm-search')?.value||'').toLowerCase();
  const statusF=document.getElementById('ep-pm-status')?.value||'';
  const freqF=document.getElementById('ep-pm-freq')?.value||'';
  const tbody=document.getElementById('ep-pm-tbody'); if(!tbody) return;
  const filtered=getPMData().filter(p=>
    (p.machine.toLowerCase().includes(q)||p.title.toLowerCase().includes(q))&&
    (!statusF||p.status===statusF)&&(!freqF||p.type===freqF));
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:20px">ไม่พบข้อมูล</td></tr>`;return;}
  const canEdit=currentUser&&(currentUser.role==='admin'||(currentUser.role==='engineer'&&currentUser.isChief));
  tbody.innerHTML=filtered.map((p,i)=>`
    <tr>
      <td style="color:var(--text3);font-family:var(--font-mono);font-size:11px">${i+1}</td>
      <td style="font-weight:700">${p.machine}</td>
      <td><span style="background:var(--surface2);color:var(--text2);padding:2px 6px;border-radius:4px;font-size:10px">${p.title}</span></td>
      <td style="color:var(--text2);font-size:11px">${p.type}</td>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--text2)">${p.date}</td>
      <td><span class="spill ${engStSp[p.status]||'sp-pend'}">${p.status}</span></td>
      <td>${canEdit
        ?`<button class="edit-btn-eng" onclick="openEditPMModal('${p.id}')"><i class="ion-ios-create"></i> แก้ไขแผน</button>`
        :p.status==='เสร็จแล้ว'
          ?`<span style="font-size:11px;color:var(--green)"><i class="ion-ios-checkmark-circle"></i> เสร็จสิ้น</span>`
          :`<button class="btn-action" onclick="openPMChecklistForm('${p.id}','${p.machine}')">ตรวจเช็ก</button>`
      }</td>
    </tr>`).join('');
}

function engRenderHist() {
  const q=(document.getElementById('hist-search')?.value||'').toLowerCase();
  const cond=document.getElementById('hist-cond')?.value||'';
  const condMap={pass:'ปกติ',warn:'เฝ้าระวัง',fail:'ผิดปกติ'};
  const engHistData=getPMHistoryData().map(h=>({
    id:h.pmCode, machine:h.equip,
    freq:h.pmCode.startsWith('PM-D')?'daily':'monthly',
    date:h.date, tech:h.tech,
    cond:condMap[h.result]||h.result||'ปกติ',
    task:h.workDone||'-'
  }));
  const rows=engHistData.filter(r=>{
    if(engHistFreq==='daily'&&r.freq!=='daily') return false;
    if(engHistFreq==='monthly'&&r.freq!=='monthly') return false;
    if(cond&&r.cond!==cond) return false;
    if(q&&!r.machine.toLowerCase().includes(q)&&!r.id.toLowerCase().includes(q)&&!r.tech.toLowerCase().includes(q)) return false;
    return true;
  });
  const tbody=document.getElementById('hist-tbody');
  const empty=document.getElementById('hist-empty');
  const countEl=document.getElementById('hist-count');
  if(!rows.length){if(tbody)tbody.innerHTML='';if(empty)empty.style.display='block';}
  else{
    if(empty)empty.style.display='none';
    if(tbody)tbody.innerHTML=rows.map((r,i)=>`
      <tr>
        <td style="color:var(--text3);font-size:11px;font-family:var(--font-mono)">${i+1}</td>
        <td><div style="font-weight:600">${r.machine}</div><div style="font-size:10px;color:var(--text2);font-family:var(--font-mono)">${r.id}</div></td>
        <td>${engFreqBadge[r.freq]||''}</td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--text2)">${r.date}</td>
        <td style="color:var(--text2)">${r.tech}</td>
        <td>${engCondPill[r.cond]||r.cond}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2);font-size:11px">${r.task}</td>
        <td><button class="view-btn-eng"><i class="ion-ios-document"></i> ดู</button></td>
      </tr>`).join('');
  }
  const label=engHistFreq==='daily'?'รายวัน':engHistFreq==='monthly'?'รายเดือน':'ทั้งหมด';
  if(countEl) countEl.textContent=`ประวัติ PM ${label} • ${rows.length} รายการ`;
}

function engSetFreq(f,btn) {
  engHistFreq=f;
  document.querySelectorAll('.freq-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  engRenderHist();
}

function engRenderRepairs() {
  const q=(document.getElementById('ep-rep-search')?.value||'').toLowerCase();
  const statusF=document.getElementById('ep-rep-status')?.value||'';
  const sideF=document.getElementById('ep-rep-side')?.value||'';
  const tbody=document.getElementById('ep-rep-tbody'); if(!tbody) return;
  const filtered=getRepairJobsData().filter(j=>
    (j.machine.toLowerCase().includes(q)||j.id.toLowerCase().includes(q))&&
    (!statusF||j.status===statusF)&&(!sideF||j.side.includes(sideF)));
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:20px">ไม่พบข้อมูล</td></tr>`;return;}
  const sc={รอซ่อม:'pill-waiting',กำลังซ่อม:'pill-repairing',ซ่อมเสร็จแล้ว:'pill-completed',ปิดงาน:'pill-closed'};
  tbody.innerHTML=filtered.map(j=>`
    <tr>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--accent);font-weight:600">${j.id}</td>
      <td style="font-size:11px;color:var(--text2)">${j.date}</td>
      <td style="font-weight:600">${j.machine}</td>
      <td><span class="lbl-tag">${(j.side||'').split(' ')[0]}</span></td>
      <td style="color:var(--text2);font-size:12px">${j.technician||'—'}</td>
      <td><span class="pill ${sc[j.status]||'pill-waiting'}">${j.status}</span></td>
      <td><button class="act-btn-eng" onclick="viewJobDetail('${j.id}')">ดูรายละเอียด</button></td>
    </tr>`).join('');
}

// ── Engineer Calendar ──
function engRenderCal() {
  document.getElementById('eng-cal-title').textContent=monthsThai[engCalM]+' '+(engCalY+543);
  const fd=new Date(engCalY,engCalM,1).getDay(),nd=new Date(engCalY,engCalM+1,0).getDate(),pd=new Date(engCalY,engCalM,0).getDate();
  const todayStr=tpFmt(new Date()),total=Math.ceil((fd+nd)/7)*7;
  const grid=document.getElementById('eng-cal-days'); grid.innerHTML='';
  const pmList=getPMData();
  for(let i=0;i<total;i++){
    let dn,other=false,ds='';
    if(i<fd){dn=pd-fd+1+i;other=true;}
    else if(i>=fd+nd){dn=i-fd-nd+1;other=true;}
    else{dn=i-fd+1;ds=`${engCalY}-${String(engCalM+1).padStart(2,'0')}-${String(dn).padStart(2,'0')}`;}
    const evts=ds?pmList.filter(p=>p.date===ds):[];
    const cell=document.createElement('div');
    cell.className=`cal-cell${other?' other':''}${ds&&ds===engCalSel?' sel':''}`;
    if(ds) cell.onclick=()=>engCalClick(ds);
    let evHtml='';evts.slice(0,3).forEach(e=>{evHtml+=`<div class="cal-ev ${engStCls[e.status]||'pend'}">${e.machine.split(' ')[0]}</div>`;});
    if(evts.length>3) evHtml+=`<div style="font-size:8px;color:var(--text3)">+${evts.length-3}</div>`;
    const isToday=ds===todayStr;
    cell.innerHTML=`<div class="cal-daynum${isToday?' today':''}">${dn}</div><div class="cal-ev-wrap">${evHtml}</div>`;
    grid.appendChild(cell);
  }
}

function engCalClick(ds){engCalSel=ds;engRenderCal();engCalShowDetail(ds);}

function engCalShowDetail(ds){
  const pmList=getPMData();
  const evts=pmList.filter(p=>p.date===ds);
  document.getElementById('eng-cal-detail').style.display='block';
  document.getElementById('eng-cal-day-lbl').textContent=tpFmtThai(ds);
  const inner=document.getElementById('eng-cal-detail-inner');
  if(!evts.length){inner.innerHTML=`<div class="day-detail-hdr"><i class="ion-ios-calendar"></i> ${tpFmtThai(ds)}</div><div style="text-align:center;padding:1.5rem;color:var(--text3);font-size:12px"><i class="ion-ios-archive"></i> ไม่มีกำหนดการ PM ในวันนี้</div>`;return;}
  let rows='';
  evts.forEach(e=>{
    const btn=e.status==='เสร็จแล้ว'
      ?`<span style="font-size:11px;color:var(--green)"><i class="ion-ios-checkmark-circle"></i> เสร็จสิ้น</span>`
      :`<button class="edit-btn-eng" style="border-color:var(--teal-bg);color:var(--teal)" onclick="openPMChecklistForm('${e.id}','${e.machine}')">เปิดตรวจเช็ก</button>`;
    rows+=`<div class="day-detail-row">
      <div><div style="font-size:13px;font-weight:600">${e.machine}</div><div style="font-size:10px;color:var(--text2);margin-top:2px">${e.title}</div></div>
      <div style="display:flex;align-items:center;gap:8px"><span class="spill ${engStSp[e.status]||'sp-pend'}">${e.status}</span>${btn}</div>
    </div>`;
  });
  inner.innerHTML=`<div class="day-detail-hdr"><i class="ion-ios-calendar"></i> PM วันที่ ${tpFmtThai(ds)} — ${evts.length} รายการ</div>${rows}`;
}

function engCalClear(){engCalSel=null;document.getElementById('eng-cal-detail').style.display='none';engRenderCal();}
function engCalShift(d){engCalM+=d;if(engCalM>11){engCalM=0;engCalY++;}else if(engCalM<0){engCalM=11;engCalY--;}engCalClear();}
function engCalShiftDay(d){
  if(!engCalSel) return;
  const[y,m,dd]=engCalSel.split('-').map(Number);const c=new Date(y,m-1,dd);c.setDate(c.getDate()+d);
  engCalM=c.getMonth();engCalY=c.getFullYear();engCalSel=tpFmt(c);engRenderCal();engCalShowDetail(engCalSel);
}
function engCalToday(){const t=new Date();engCalM=t.getMonth();engCalY=t.getFullYear();engCalSel=tpFmt(t);engRenderCal();engCalShowDetail(engCalSel);}

// ============================================================
// TECH PANEL LOGIC
// ============================================================
let ME='';
let myIdentifiedName = null;
let tpPmSearch='',tpPmStatusFilter='';
let tpCurYear,tpCurMonth,tpSelDate=null;
const tpStClass={รอดำเนินการ:'pend',กำลังดำเนินการ:'prog',เสร็จแล้ว:'done',เกินกำหนด:'over'};
function mapJobToTechPanel(j) {
  const statusMap={'ปิดงาน':'เสร็จแล้ว'}; 
  return{id:j.id,title:j.machine||'-',desc:j.detail||'-',dept:j.dept||'',type:j.side?j.side.split('(')[0].trim():'',priority:j.opType||null,date:j.date?j.date.split(',')[0].trim():'-',overdue:(j.hoursOpen||0)>24&&j.status==='รอซ่อม',overdueHrs:j.hoursOpen||0,status:statusMap[j.status]||j.status,assignee:j.technician||null,eta:j.eta||null,progress:j.note||''};
}
function tpGetAllJobs(){return getRepairJobsData().map(mapJobToTechPanel);}
function tpFmtThai(s){if(!s)return'';try{const[y,m,d]=s.split('-').map(Number);return`${d} ${monthsThai[m-1]} ${y+543}`;}catch(e){return s;}}
function tpFmt(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function tpUpdateStats(){
  const jobs=tpGetAllJobs();const pmList=getPMData();
  const waiting=jobs.filter(j=>j.status==='รอซ่อม').length;
  const mine=jobs.filter(j=>j.status==='กำลังซ่อม'&&j.assignee===(myIdentifiedName||ME)).length;
  const done=jobs.filter(j=>j.status==='เสร็จแล้ว'&&j.assignee===(myIdentifiedName||ME)).length;
  const pmPend=pmList.filter(p=>p.status!=='เสร็จแล้ว').length;
  document.getElementById('tp-stat-wait').textContent=waiting;
  document.getElementById('tp-stat-mine').textContent=mine;
  document.getElementById('tp-stat-done').textContent=done;
  document.getElementById('tp-badge-q').textContent=waiting;
  document.getElementById('tp-badge-m').textContent=mine;
  document.getElementById('tp-badge-p').textContent=pmPend;
  document.getElementById('tp-badge-c').textContent=pmList.length;
}

function tpSw(tab,btn){
  ['q','m','p','c'].forEach(t=>{document.getElementById('tp-v-'+t).style.display=(t===tab)?'block':'none';document.getElementById('tp-t-'+t).classList.toggle('active',t===tab);});
  if(tab==='q')tpRenderQueue();if(tab==='m')tpRenderMine();if(tab==='p')tpRenderPMList();if(tab==='c')tpRenderCal();
}

function tpRenderQueue(){
  const el=document.getElementById('tp-v-q');
  const jobs=tpGetAllJobs().filter(j=>j.status==='รอซ่อม');
  if(!jobs.length){el.innerHTML=`<div class="tp-sdiv">งานรอซ่อม</div><div class="tp-empty"><i class="ion-ios-archive"></i> ไม่มีงานรอซ่อมขณะนี้</div>`;return;}
  el.innerHTML=`<div class="tp-sdiv">งานรอซ่อมทั้งหมด • ${jobs.length} รายการ</div>`+jobs.map(j=>tpJobCardHTML(j,'queue')).join('');
}
function tpRenderMine(){
  const el=document.getElementById('tp-v-m');
  const jobs=tpGetAllJobs().filter(j=>j.assignee===(myIdentifiedName||ME)&&j.status!=='รอซ่อม');
  if(!jobs.length){el.innerHTML=`<div class="tp-sdiv">งานที่รับไว้</div><div class="tp-empty"><i class="ion-ios-archive"></i> ยังไม่มีงานที่รับไว้</div>`;return;}
  el.innerHTML=`<div class="tp-sdiv">งานที่รับไว้ • ${jobs.length} รายการ</div>`+jobs.map(j=>tpJobCardHTML(j,'mine')).join('');
}

function tpJobCardHTML(j,mode){
  const statusLabelMap = {
    'รอซ่อม':          {cls:'wait',   text:'รอซ่อม'},
    'กำลังซ่อม':        {cls:'work',   text:'กำลังซ่อม'},
    'รออะไหล่':        {cls:'work',   text:'รออะไหล่'},
    'ขอหยุดเครื่อง':    {cls:'work',   text:'ขอหยุดเครื่อง'},
    'Workaround':      {cls:'work',   text:'Workaround'},
    'ซ่อมเสร็จแล้ว':    {cls:'done-s', text:'รอ QC'},
    'เสร็จแล้ว':        {cls:'done-s', text:'เสร็จแล้ว'},
    'ปิดงาน':          {cls:'done-s', text:'ปิดงานแล้ว'},
    'ตีกลับ':          {cls:'wait',   text:'↩ ตีกลับ'},
    'แก้ไข (ตีกลับ)':   {cls:'wait',   text:'↩ ตีกลับ'},
  };
  const stInfo = statusLabelMap[j.status] || {cls:'wait', text:j.status};
  const statLabel = `<span class="tp-jstat ${stInfo.cls}"><span class="tp-jdot"></span>${stInfo.text}</span>`;
  const ovHTML=j.overdue?`<div class="tp-jovr"><i class="ion-ios-warning"></i> เกิน 24 ชม. (${j.overdueHrs} ชม.)</div>`:'';
  const noteHTML=j.progress?`<div style="font-size:12px;color:var(--text2);margin-top:4px;line-height:1.4"><i class="ion-ios-create"></i> ${j.progress}</div>`:'';
  const tagsHTML=[j.dept,j.type,j.priority].filter(Boolean).map(t=>`<span class="tp-jtag">${t}</span>`).join('');
  let actHTML='';
 if(mode==='queue'){
  actHTML=`<button class="tp-jbtn-v" onclick="tpOpenJobModal('${j.id}')"><i class="ion-ios-eye"></i> ดูรายละเอียด</button>
    <button class="tp-jbtn-a acc" onclick="tpAcceptJob('${j.id}')"><i class="ion-ios-hand"></i> รับงาน</button>
    <button class="tp-jbtn-a" style="background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.4);color:#ef4444;margin-top:6px;width:100%" onclick="tpOpenRejectModal('${j.id}')">↩ ตีกลับ — ขอข้อมูลเพิ่ม</button>`;
} else if(j.status==='ซ่อมเสร็จแล้ว'){
  // เสร็จแล้ว → รอ QC → ไม่มีปุ่มอัปเดต
  actHTML=`<button class="tp-jbtn-v" onclick="tpOpenJobModal('${j.id}')"><i class="ion-ios-eye"></i> ดูรายละเอียด</button><div class="tp-jbtn-done" style="color:var(--teal)">⏳ รอ QC</div>`;
} else if(j.status==='กำลังซ่อม'||j.status==='รออะไหล่'||j.status==='Workaround'||j.status==='ขอหยุดเครื่อง'){
  actHTML=`<button class="tp-jbtn-v" onclick="tpOpenJobModal('${j.id}')"><i class="ion-ios-eye"></i> ดูรายละเอียด</button>
    <button class="tp-jbtn-a upd" onclick="tpOpenUpdateModal('${j.id}')"><i class="ion-ios-create"></i> อัปเดต</button>
    <button class="tp-jbtn-a" style="background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.4);color:#ef4444" onclick="tpOpenRejectModal('${j.id}')">↩ ตีกลับ</button>`;
} else if(j.status==='เสร็จแล้ว'||j.status==='ปิดงาน'){
  actHTML=`<button class="tp-jbtn-v" onclick="tpOpenJobModal('${j.id}')"><i class="ion-ios-eye"></i> ดูรายละเอียด</button><div class="tp-jbtn-done"><i class="ion-ios-checkmark-circle"></i> ปิดงานแล้ว</div>`;
} else if(j.status==='ตีกลับ'||j.status==='แก้ไข (ตีกลับ)'){
  actHTML=`<button class="tp-jbtn-v" onclick="tpOpenJobModal('${j.id}')"><i class="ion-ios-eye"></i> ดูรายละเอียด</button><div class="tp-jbtn-done" style="color:#ef4444">↩ ส่งกลับให้ผู้แจ้งแล้ว</div>`;
}

return `<div class="tp-jcard${j.overdue?' ov':''}">
  <div class="tp-jtop"><span class="tp-jid">${j.id}</span>${statLabel}</div>
  <div class="tp-jtitle">${j.title}</div>
  <div class="tp-jdesc">${j.desc}</div>
  ${ovHTML}
  ${noteHTML}
  <div class="tp-jtags">${tagsHTML}</div>
  <div class="tp-jdate"><i class="ion-ios-calendar"></i> ${j.date}${j.eta?' · ETA '+j.eta:''}</div>
  <div class="tp-jact">${actHTML}</div>
</div>`; 
}

function tpOpenRejectModal(id) {
  const j = tpGetAllJobs().find(j => j.id === id);
  if (!j) return;
  document.getElementById('tp-modal-title').textContent = 'ตีกลับงาน — ' + j.title;
  document.getElementById('tp-modal-body').innerHTML = `
    <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:#ef4444">
      <i class="ion-ios-warning"></i> งานจะถูกส่งกลับให้ผู้แจ้ง เพื่อเพิ่มรายละเอียดให้ครบถ้วน
    </div>
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:11px 13px;margin-bottom:16px">
      <div style="font-size:11px;font-family:var(--font-mono);color:var(--accent);margin-bottom:3px">${j.id}</div>
      <div style="font-size:15px;font-weight:500">${j.title}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">${j.desc}</div>
    </div>
    <div style="margin-bottom:6px;font-size:12px;font-weight:500;color:var(--text2)"><i class="ion-ios-create"></i> เหตุผลที่ตีกลับ <span style="color:#ef4444">*</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      ${['รายละเอียดปัญหาไม่ชัดเจน','ไม่ระบุตำแหน่งที่เสีย','ภาพประกอบไม่เพียงพอ','ข้อมูลเครื่องจักรไม่ถูกต้อง'].map(r =>
        `<button class="tp-upd-status-btn" onclick="tpRejectQuickSelect(this,'${r}')"
          style="padding:9px 8px;border-radius:8px;border:0.5px solid var(--border);background:var(--bg2);color:var(--text2);font-size:12px;cursor:pointer;font-family:inherit;text-align:left">
          ${r}
        </button>`
      ).join('')}
    </div>
    <textarea id="tp-reject-reason" placeholder="ระบุเหตุผลเพิ่มเติม..." style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;resize:vertical;min-height:80px;box-sizing:border-box"></textarea>`;
  document.getElementById('tp-modal-actions').innerHTML = `
    <button class="tp-mact-btn tp-mact-close" onclick="tpCloseModal()">ยกเลิก</button>
    <button class="tp-mact-btn" style="background:#ef4444;color:#fff" onclick="tpSubmitReject('${j.id}')">
      ↩ ยืนยันตีกลับ
    </button>`;
  document.getElementById('tp-modal-overlay').classList.add('show');
}

function tpRejectQuickSelect(btn, text) {
  document.querySelectorAll('.tp-upd-status-btn').forEach(b => {
    b.style.background = 'var(--bg2)';
    b.style.borderColor = 'var(--border)';
    b.style.color = 'var(--text2)';
  });
  btn.style.background = 'rgba(239,68,68,.12)';
  btn.style.borderColor = 'rgba(239,68,68,.4)';
  btn.style.color = '#ef4444';
  const ta = document.getElementById('tp-reject-reason');
  if (ta) ta.value = text;
}

function tpSubmitReject(id) {
  const reason = document.getElementById('tp-reject-reason')?.value.trim();
  if (!reason) { showToast('กรุณาระบุเหตุผลที่ตีกลับ', 'warning'); return; }
  const j = getRepairJobsData().find(j => j.id === id);
  if (!j) return;

  if (!isLocalMode) {
    showLoading('กำลังตีกลับงาน...');
    authFetch(`${API_URL}/repairs/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, rejectedBy: myIdentifiedName || ME })
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
    if (res.success) {
        j.status = 'ตีกลับ';
        j.note = reason;
        showToast(`↩ ตีกลับงาน ${j.machine} — ${reason}`, 'warning');
        tpCloseModal();
        teUpdateStats(); teRenderQueue(); teRenderMine();
        tpUpdateStats(); tpRenderMine(); tpRenderQueue();
      } else {
        showToast('เกิดข้อผิดพลาด: ' + (res.message || ''), 'error');
      }
    })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้', 'error'); });
    return;
  }

 // Local Mode
  j.status = 'ตีกลับ';
  j.note = reason;
  tpCloseModal();
  teUpdateStats(); teRenderQueue(); teRenderMine();
  tpUpdateStats(); tpRenderMine(); tpRenderQueue();
  showToast(`↩ ตีกลับงาน ${j.machine} — ${reason}`, 'warning');
}

function tpOpenJobModal(id){
  const j=tpGetAllJobs().find(j=>j.id===id);if(!j)return;
  const raw=getRepairJobsData().find(x=>x.id===id);
  const sc=j.status==='กำลังซ่อม'?'work':j.status==='เสร็จแล้ว'?'done-s':'wait';
  const sl=j.status==='กำลังซ่อม'?'กำลังซ่อม':j.status==='เสร็จแล้ว'?'เสร็จแล้ว':'รอซ่อม';
  document.getElementById('tp-modal-title').textContent=j.title;
  document.getElementById('tp-modal-body').innerHTML=`
    <div class="tp-mrow"><div class="tp-mrow-lbl">รหัสงาน</div><div class="tp-mrow-val mono">${j.id}</div></div>
    <div class="tp-mrow"><div class="tp-mrow-lbl">สถานะ</div><span class="tp-jstat ${sc}" style="display:inline-flex"><span class="tp-jdot"></span>${sl}</span></div>
    <div class="tp-mrow"><div class="tp-mrow-lbl">ผู้แจ้ง</div><div class="tp-mrow-val">${raw&&raw.name?raw.name:'-'}</div></div>
    <div class="tp-mrow"><div class="tp-mrow-lbl">แผนก</div><div class="tp-mrow-val desc">${raw&&raw.dept?raw.dept:'-'}</div></div>
    <div class="tp-mrow"><div class="tp-mrow-lbl">วันที่แจ้ง</div><div class="tp-mrow-val">${j.date}</div></div>
    <div class="tp-mrow"><div class="tp-mrow-lbl">ด้านปัญหา</div><div class="tp-mrow-val desc">${raw&&raw.side?raw.side:'-'}</div></div>
    <div class="tp-mrow"><div class="tp-mrow-lbl">รายละเอียด</div><div class="tp-mrow-val desc">${j.desc}</div></div>
    ${j.progress?`<div class="tp-mrow"><div class="tp-mrow-lbl">ความคืบหน้า</div><div class="tp-mrow-val desc">${j.progress}</div></div>`:''}
    <div class="tp-mdivider"></div>
    <div class="tp-mrow"><div class="tp-mrow-lbl">แท็ก</div><div class="tp-mrow-tags">${[j.dept,j.type,j.priority].filter(Boolean).map(t=>`<span class="tp-mtag">${t}</span>`).join('')}</div></div>
    ${j.eta?`<div class="tp-mrow"><div class="tp-mrow-lbl">กำหนดเสร็จ</div><div class="tp-mrow-val">${j.eta}</div></div>`:''}
  ${j.overdue?`<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:9px 12px;color:#ef4444;font-size:12px"><i class="ion-ios-warning"></i> เกินกำหนด ${j.overdueHrs} ชั่วโมง</div>`:''}
  ${(() => {
  let imgs = [];
  try { imgs = JSON.parse(raw.img || '[]'); } catch { imgs = raw.img ? [raw.img] : []; }
  if (!imgs.length) return '';
  return `<div class="tp-mdivider"></div>
    <div class="tp-mrow-lbl" style="margin-bottom:8px"><i class="ion-ios-camera"></i> รูปภาพที่แจ้ง</div>
    ${imgs.map(src => `<img src="${src}" style="width:100%;border-radius:8px;border:1px solid var(--border);object-fit:cover;max-height:200px;cursor:zoom-in;margin-bottom:6px" onclick="imgFullscreen(this)" onerror="this.style.display='none'">`).join('')}`;
})()}
${(() => {
  let imgs = [];
  try { imgs = JSON.parse(raw.imgAfter || '[]'); } catch { imgs = raw.imgAfter ? [raw.imgAfter] : []; }
  if (!imgs.length) return '';
  return `<div class="tp-mrow-lbl" style="margin:10px 0 8px"><i class="ion-ios-checkmark-circle"></i> รูปหลังซ่อม</div>
    ${imgs.map(src => `<img src="${src}" style="width:100%;border-radius:8px;border:1px solid var(--border);object-fit:cover;max-height:200px;cursor:zoom-in;margin-bottom:6px" onclick="imgFullscreen(this)" onerror="this.style.display='none'">`).join('')}`;
})()}`;
  let acts=`<button class="tp-mact-btn tp-mact-close" onclick="tpCloseModal()"><i class="ion-ios-close"></i> ปิด</button>`;
  if(j.status==='รอซ่อม') acts+=`<button class="tp-mact-btn tp-mact-accept" onclick="tpAcceptJob('${j.id}');tpCloseModal()"><i class="ion-ios-hand"></i> รับงาน</button>`;
  document.getElementById('tp-modal-actions').innerHTML=acts;
  document.getElementById('tp-modal-overlay').classList.add('show');
}


function tpOpenUpdateModal(id) {
   uploadedFilesBase64 = [];
  const j = tpGetAllJobs().find(j => j.id === id);
  if (!j) return;
  document.getElementById('tp-modal-title').textContent = 'บันทึกความคืบหน้างานซ่อม';
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  const todayDisplay = `${dd}/${mm}/${yyyy}`;
  const todayISO = `${yyyy}-${mm}-${dd}`;
  document.getElementById('tp-modal-body').innerHTML = `
    <div style="background:var(--color-background-secondary,var(--bg2));border:0.5px solid var(--color-border-tertiary,var(--border));border-radius:8px;padding:11px 13px;margin-bottom:16px">
      <div style="font-size:11px;font-family:var(--font-mono);color:var(--accent);margin-bottom:3px">${j.id}</div>
      <div style="font-size:15px;font-weight:500;margin-bottom:5px">${j.title}</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        ${[j.dept, j.type].filter(Boolean).map(t =>`<span style="font-size:11px;padding:2px 8px;border-radius:100px;border:0.5px solid var(--border);color:var(--text2);background:var(--bg)">${t}</span>`).join('')}
      </div>
    </div>
    <div style="font-size:11px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px">สถานะการดำเนินงาน</div>
   <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <button class="tp-upd-status-btn" onclick="tpSetStatus(this,'กำลังซ่อม')" style="padding:11px 8px;border-radius:8px;border:0.5px solid var(--border);background:var(--bg2);color:var(--text2);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;transition:.15s"><i class="ion-ios-construct"></i>กำลังดำเนินการซ่อม</button>
      <button class="tp-upd-status-btn" onclick="tpSetStatus(this,'รออะไหล่')" style="padding:11px 8px;border-radius:8px;border:0.5px solid var(--border);background:var(--bg2);color:var(--text2);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;transition:.15s"><i class="ion-ios-cube"></i>รอจัดหาอะไหล่</button>
      <button class="tp-upd-status-btn" onclick="tpSetStatus(this,'ขอหยุดเครื่อง')" style="padding:11px 8px;border-radius:8px;border:0.5px solid var(--border);background:var(--bg2);color:var(--text2);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;transition:.15s"><i class="ion-ios-close-circle"></i>ขอหยุดเครื่อง</button>
        <button class="tp-upd-status-btn" onclick="tpSetStatus(this,'Workaround')" style="padding:11px 8px;border-radius:8px;border:0.5px solid var(--border);background:var(--bg2);color:var(--text2);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;transition:.15s"><i class="ion-ios-construct"></i>Workaround</button>
      <button class="tp-upd-status-btn" onclick="tpSetStatus(this,'เสร็จแล้ว')" style="padding:11px 8px;border-radius:8px;border:0.5px solid var(--border);background:var(--bg2);color:var(--text2);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;transition:.15s"><i class="ion-ios-checkmark-circle-outline"></i>ซ่อมเสร็จสิ้น</button>
    </div>
    <input type="hidden" id="tp-upd-status" value="${j.status}">
    <div id="tp-upd-done-box" style="display:none;background:rgba(16,185,129,.08);border:0.5px solid rgba(16,185,129,.3);border-radius:8px;padding:10px 13px;margin-bottom:14px;align-items:center;justify-content:space-between">
      <span style="font-size:12px;color:var(--green);font-weight:500;display:flex;align-items:center;gap:6px"><i class="ion-ios-checkmark"></i> วันที่ซ่อมเสร็จจริง</span>
      <span style="font-size:13px;font-weight:500;color:var(--green);font-family:var(--font-mono)">${todayDisplay} <span style="font-size:10px;opacity:.7">บันทึกอัตโนมัติ</span></span>
    </div>
    <div id="tp-upd-stop-box" style="display:none;margin-bottom:14px">
      <div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px"><i class="ion-ios-calendar"></i> วันที่วางแผนหยุดเครื่อง</div>
      <input type="date" id="tp-upd-stop-date" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box">
    </div>
    <div id="tp-upd-eta-field" style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px">⏱ วันที่คาดว่าจะแล้วเสร็จ (ETA)</div>
      <input type="date" id="tp-upd-eta" value="${todayISO}" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box">
    </div>
    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px"><i class="ion-ios-create"></i> หมายเหตุ / รายงานการซ่อมบำรุง</div>
      <textarea id="tp-upd-note" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;resize:vertical;min-height:72px;box-sizing:border-box" placeholder="ระบุอะไหล่ที่ใช้, วิธีการแก้ไข...">${j.progress || ''}</textarea>
    </div>
    <div>
      <div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px"><i class="ion-ios-camera"></i> ภาพถ่ายหลังการซ่อม</div>
      <div onclick="triggerFileInput('tp-upd-file')" style="border:0.5px dashed var(--border);border-radius:8px;padding:18px;text-align:center;cursor:pointer;background:var(--bg)">
        <i class="ion-ios-cloud-upload" style="font-size:22px;color:var(--text3);display:block;margin-bottom:5px"></i>
        <div style="font-size:12px;color:var(--text3)">แตะเพื่อแนบรูปภาพหลังซ่อม</div>
      </div>
     <input type="file" id="tp-upd-file" accept="image/*" multiple style="display:none" onchange="previewUploadedFile(this,'tp-upd-thumb')">
      <div id="tp-upd-thumb" class="thumb-grid"></div>
    </div>`;

  tpSetStatus(null, j.status);
  document.getElementById('tp-modal-actions').innerHTML = `
    <button class="tp-mact-btn tp-mact-close" onclick="tpCloseModal()">ยกเลิก</button>
    <button class="tp-mact-btn tp-mact-update" onclick="tpSaveUpdate('${j.id}')">
      <i class="ion-ios-save"></i> บันทึกการอัปเดต
    </button>`;
  document.getElementById('tp-modal-overlay').classList.add('show');
}

function tpSetStatus(btn, val) {
  document.querySelectorAll('.tp-upd-status-btn').forEach(b => {
    b.style.background = 'var(--bg2)';
    b.style.borderColor = 'var(--border)';
    b.style.color = 'var(--text2)';
  });
  const colorMap = {
    'กำลังซ่อม':    {bg:'rgba(59,130,246,.12)', bc:'rgba(59,130,246,.4)',  c:'#3b82f6'},
    'รออะไหล่':    {bg:'rgba(245,158,11,.12)', bc:'rgba(245,158,11,.4)',  c:'#f59e0b'},
    'ขอหยุดเครื่อง': {bg:'rgba(239,68,68,.12)',  bc:'rgba(239,68,68,.4)',   c:'#ef4444'},
   'เสร็จแล้ว':    {bg:'rgba(16,185,129,.12)', bc:'rgba(16,185,129,.4)', c:'#10b981'},
    'Workaround':   {bg:'rgba(168,85,247,.12)', bc:'rgba(168,85,247,.4)', c:'#a855f7'},
  };
  const s = colorMap[val];
  if (btn && s) { btn.style.background=s.bg; btn.style.borderColor=s.bc; btn.style.color=s.c; }
  const hidStatus = document.getElementById('tp-upd-status');
  if (hidStatus) hidStatus.value = val;
  const doneBox  = document.getElementById('tp-upd-done-box');
  const stopBox  = document.getElementById('tp-upd-stop-box');
  const etaField = document.getElementById('tp-upd-eta-field');
  if (doneBox)  doneBox.style.display  = val==='เสร็จแล้ว' ? 'flex'  : 'none';
  if (stopBox)  stopBox.style.display  = val==='ขอหยุดเครื่อง' ? 'block' : 'none';
  if (etaField) etaField.style.display = val==='เสร็จแล้ว' ? 'none'  : 'block';
}
function tpSaveUpdate(id) {
  const j = getRepairJobsData().find(j => j.id === id);
  if (!j) return;

  // ป้องกันกดซ้ำ (double-submit)
  const saveBtn = document.querySelector('.tp-mact-update');
  if (saveBtn) { if (saveBtn.disabled) return; saveBtn.disabled = true; }

  const note     = document.getElementById('tp-upd-note')?.value.trim() || '';
  const ns       = document.getElementById('tp-upd-status')?.value || '';
  const eta      = document.getElementById('tp-upd-eta')?.value || '';
  const stopDate = document.getElementById('tp-upd-stop-date')?.value || '';
 const statusMap = {
    'เสร็จแล้ว':  'ซ่อมเสร็จแล้ว',
    'Workaround': 'Workaround'
  };
  const finalStatus = statusMap[ns] || ns;
  const upd = { status: finalStatus, note, eta, planStopDate: stopDate };
  if (!isLocalMode) {
    showLoading('กำลังบันทึก...');
 authFetch(`${API_URL}/repairs/${encodeURIComponent(id)}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ ...upd, imgAfter: uploadedFilesBase64 || [], updatedBy: myIdentifiedName || ME 
})
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
      if (saveBtn) saveBtn.disabled = false;
     if (res.success) {
        Object.assign(j, { note, eta, planStopDate: stopDate });
        if (finalStatus) j.status = finalStatus;
        showToast('บันทึกสำเร็จ!', 'success');
     tpCloseModal();
     teUpdateStats(); teRenderQueue(); teRenderMine();
     tpUpdateStats(); tpRenderMine(); tpRenderQueue();
      } else {
        showToast('เกิดข้อผิดพลาด: ' + (res.message || ''), 'error');
      }
    })
    .catch(() => {
      hideLoading();
      if (saveBtn) saveBtn.disabled = false;
      showToast('เชื่อมต่อ server ไม่ได้', 'error');
    });
    return;
  }
 j.note = note;
  if (eta) j.eta = eta;
  if (stopDate) j.planStopDate = stopDate;
  if (finalStatus) j.status = finalStatus; 
  tpCloseModal();
  teUpdateStats(); teRenderQueue(); teRenderMine();
  tpUpdateStats(); tpRenderMine(); tpRenderQueue();
  const label = ns === 'เสร็จแล้ว' ? 'ซ่อมเสร็จสิ้น' : `อัปเดตเป็น "${ns}"`;
  showToast(`${label} — ${j.title}`, ns === 'เสร็จแล้ว' ? 'success' : 'info');
  if (saveBtn) saveBtn.disabled = false;
}
function tpRenderPMList(){
  const el=document.getElementById('tp-v-p');
  const pmList=getPMData();
  const all=pmList.length,pend=pmList.filter(p=>p.status==='รอดำเนินการ').length,done=pmList.filter(p=>p.status==='เสร็จแล้ว').length,over=pmList.filter(p=>p.status==='เกินกำหนด').length;
  const filtered=pmList.filter(p=>{const mn=p.machine.toLowerCase().includes(tpPmSearch.toLowerCase());const ms=!tpPmStatusFilter||p.status===tpPmStatusFilter;return mn&&ms;});
  const cardsHTML=filtered.length?filtered.map(p=>{const sc=tpStClass[p.status]||'pend';const isDone=p.status==='เสร็จแล้ว';return`<div class="tp-pcard${p.status==='เกินกำหนด'?' ov':''}"><div class="tp-pcleft"><div class="tp-pmach">${p.machine}</div><div class="tp-ptype">${p.title} <span class="tp-pfreq">${p.type}</span></div><div class="tp-pdate"><i class="ion-ios-calendar"></i> ${tpFmtThai(p.date)}</div></div><div class="tp-pcright"><span class="tp-ppill ${sc}">${p.status}</span>${isDone?`<span style="font-size:10px;color:#10b981"><i class="ion-ios-checkmark-circle"></i> เสร็จสิ้น</span>`:`<button class="tp-pcbtn" onclick="tpOpenPMChecklistModal('${p.id}')"><i class="ion-ios-checkmark-circle"></i> ตรวจเช็ก</button>`}</div></div>`;}).join(''):`<div class="tp-pm-empty">🔍 ไม่พบรายการที่ตรงกัน</div>`;
  el.innerHTML=`<div class="tp-pmini-stats"><div class="tp-pmini"><div class="tp-pmini-num" style="color:#8b949e">${all}</div><div class="tp-pmini-lbl">ทั้งหมด</div></div><div class="tp-pmini"><div class="tp-pmini-num" style="color:#f59e0b">${pend}</div><div class="tp-pmini-lbl">รอ</div></div><div class="tp-pmini"><div class="tp-pmini-num" style="color:#10b981">${done}</div><div class="tp-pmini-lbl">เสร็จ</div></div><div class="tp-pmini"><div class="tp-pmini-num" style="color:#ef4444">${over}</div><div class="tp-pmini-lbl">เกิน</div></div></div><div class="tp-sbar"><input class="tp-sinp" placeholder="🔍 ค้นหาเครื่องจักร..." value="${tpPmSearch}" oninput="tpPmSearchChange(this.value)"><select class="tp-ssel" onchange="tpPmStatusChange(this.value)"><option value="" ${!tpPmStatusFilter?'selected':''}>ทั้งหมด</option><option ${tpPmStatusFilter==='รอดำเนินการ'?'selected':''}>รอดำเนินการ</option><option ${tpPmStatusFilter==='กำลังดำเนินการ'?'selected':''}>กำลังดำเนินการ</option><option ${tpPmStatusFilter==='เสร็จแล้ว'?'selected':''}>เสร็จแล้ว</option><option ${tpPmStatusFilter==='เกินกำหนด'?'selected':''}>เกินกำหนด</option></select></div>${cardsHTML}`;
}
function tpPmSearchChange(v){tpPmSearch=v;tpRenderPMList();}
function tpPmStatusChange(v){tpPmStatusFilter=v;tpRenderPMList();}
function tpCompletePM(id){
  const p=getPMData().find(p=>p.id===id);if(!p||p.status==='เสร็จแล้ว')return;
  p.status='เสร็จแล้ว';tpUpdateStats();tpRenderPMList();showToast(`ตรวจเช็กเสร็จสิ้น — ${p.machine}`,'success');
}
function tpOpenPMChecklistModal(pmId) {
  const p = getPMData().find(x => x.id === pmId);
  if (!p || p.status === 'เสร็จแล้ว') return;
  document.getElementById('tp-modal-title').textContent = 'ตรวจเช็ก PM — ' + p.machine;
  const today = new Date().toISOString().split('T')[0];
  let groupsHtml = '';
  checkGroups.forEach((g, gi) => {
    groupsHtml += `<div style="font-size:12px;font-weight:600;color:var(--accent);margin:14px 0 8px">${gi+1}. ${g.name}</div>`;
    g.items.forEach((item, ii) => {
      const nm = `tppm_item_${gi}_${ii}`;
      groupsHtml += `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:12.5px;flex:1">${item}</span>
          <div style="display:flex;gap:10px;flex-shrink:0">
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--green);cursor:pointer"><input type="radio" name="${nm}" value="ok" checked> OK</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--red);cursor:pointer"><input type="radio" name="${nm}" value="ng"> NG</label>
          </div>
        </div>
        <input type="text" id="tppm_note_${gi}_${ii}" placeholder="หมายเหตุ..." style="width:100%;margin:4px 0;background:var(--bg2);border:0.5px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;font-family:inherit;outline:none;box-sizing:border-box">`;
    });
  });
  document.getElementById('tp-modal-body').innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:11px 13px;margin-bottom:14px">
      <div style="font-size:11px;font-family:var(--font-mono);color:var(--accent);margin-bottom:3px">${p.id}</div>
      <div style="font-size:15px;font-weight:500">${p.machine}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:2px">${p.title} · ${p.type}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px">วันที่ตรวจ</div>
        <input type="date" id="tppm-date" value="${today}" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box"></div>
      <div><div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px">ชั่วโมงเดินเครื่อง</div>
        <input type="text" id="tppm-runninghr" placeholder="เช่น 1850" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box"></div>
    </div>
    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px">ผลตรวจโดยรวม</div>
      <select id="tppm-result" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none">
        <option value="pass">ปกติ</option><option value="warn">เฝ้าระวัง</option><option value="fail">ผิดปกติ</option>
      </select>
    </div>
    <div style="font-size:11px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">รายการตรวจเช็ก</div>
    ${groupsHtml}
    <div style="margin-top:14px"><div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px">อะไหล่ที่เปลี่ยน/ใช้</div>
      <input type="text" id="tppm-parts" placeholder="ไม่มี" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box"></div>
    <div style="margin-top:14px"><div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px">งานที่ดำเนินการ</div>
      <textarea id="tppm-workdone" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;resize:vertical;min-height:60px;box-sizing:border-box"></textarea></div>
    <div style="margin-top:14px"><div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:5px">หมายเหตุเพิ่มเติม</div>
      <textarea id="tppm-remarks" style="width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;resize:vertical;min-height:50px;box-sizing:border-box"></textarea></div>`;
  document.getElementById('tp-modal-actions').innerHTML = `
    <button class="tp-mact-btn tp-mact-close" onclick="tpCloseModal()">ยกเลิก</button>
    <button class="tp-mact-btn tp-mact-update" onclick="tpSubmitPMChecklist('${p.id}')">
      <i class="ion-ios-checkmark-circle-outline"></i> บันทึก & ตรวจเสร็จ
    </button>`;
  document.getElementById('tp-modal-overlay').classList.add('show');
}

function tpSubmitPMChecklist(pmId) {
  const p = getPMData().find(x => x.id === pmId);
  if (!p) return;
  const date      = document.getElementById('tppm-date')?.value || '';
  const runningHr = document.getElementById('tppm-runninghr')?.value || '';
  const result    = document.getElementById('tppm-result')?.value || 'pass';
  const parts     = document.getElementById('tppm-parts')?.value || '-';
  const workDone  = document.getElementById('tppm-workdone')?.value || '-';
  const remarks   = document.getElementById('tppm-remarks')?.value || '';
  const chkObj = {};
  checkGroups.forEach((g, gi) => g.items.forEach((item, ii) => {
    const r = document.querySelector(`input[name="tppm_item_${gi}_${ii}"]:checked`);
    chkObj[`r${gi}_${ii}`] = { status: r ? r.value : 'ok', note: document.getElementById(`tppm_note_${gi}_${ii}`)?.value || '' };
  }));
  const finish = () => {
    p.status = 'เสร็จแล้ว'; tpUpdateStats(); tpRenderPMList();
    if (tpSelDate) tpShowDayDetail(tpSelDate);
    tpCloseModal(); showToast(`ตรวจเช็ก PM เสร็จสิ้น — ${p.machine}`, 'success');
  };
  if (!isLocalMode) {
    showLoading('กำลังบันทึก PM...');
    authFetch(`${API_URL}/pm/${pmId}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, tech: ME, runningHr, parts, result, workDone, remarks, checklist: JSON.stringify(chkObj) })
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
      if (res.success) {
        localPMHistory.unshift({no:1, pmCode:p.id, equip:p.machine, date, tech:ME, runningHr, parts, result, workDone, note:remarks, checklist:JSON.stringify(chkObj)});
        finish();
      } else {
        showToast('เกิดข้อผิดพลาด: ' + (res.message||''), 'error');
      }
    })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้', 'error'); });
    return;
  }
  localPMHistory.unshift({no:localPMHistory.length+1, pmCode:p.id, equip:p.machine, date, tech:ME, runningHr, parts, result, workDone, note:remarks, checklist:JSON.stringify(chkObj)});
  finish();
}

function tpRenderCal(){
  document.getElementById('tp-cal-title').textContent=monthsThai[tpCurMonth]+' '+(tpCurYear+543);
  const fd=new Date(tpCurYear,tpCurMonth,1).getDay(),nd=new Date(tpCurYear,tpCurMonth+1,0).getDate(),pd=new Date(tpCurYear,tpCurMonth,0).getDate();
  const todayStr=tpFmt(new Date()),total=Math.ceil((fd+nd)/7)*7;
  const grid=document.getElementById('tp-cal-days');grid.innerHTML='';
  const pmList=getPMData();
  for(let i=0;i<total;i++){
    let dn,other=false,ds='';
    if(i<fd){dn=pd-fd+1+i;other=true;}else if(i>=fd+nd){dn=i-fd-nd+1;other=true;}else{dn=i-fd+1;ds=`${tpCurYear}-${String(tpCurMonth+1).padStart(2,'0')}-${String(dn).padStart(2,'0')}`;}
    const evts=ds?pmList.filter(p=>p.date===ds):[];
    const isSel=ds&&ds===tpSelDate;const isToday=ds===todayStr;
    const cell=document.createElement('div');cell.className=`tp-cal-day${other?' other':''}${isSel?' selected':''}`;
    if(ds)cell.onclick=()=>tpClickDay(ds);
    let evHtml='';evts.slice(0,3).forEach(e=>{evHtml+=`<div class="tp-ev-pill ${tpStClass[e.status]||'pend'}">${e.machine}</div>`;});
    if(evts.length>3)evHtml+=`<div class="tp-ev-more">+${evts.length-3}</div>`;
    cell.innerHTML=`<div class="tp-day-num${isToday?' today':''}">${dn}</div><div class="tp-ev-wrap">${evHtml}</div>`;
    grid.appendChild(cell);
  }
}
function tpClickDay(ds){tpSelDate=ds;tpRenderCal();tpShowDayDetail(ds);}
function tpShowDayDetail(ds){
  const pmList=getPMData();const evts=pmList.filter(p=>p.date===ds);
  document.getElementById('tp-day-nav').style.display='flex';document.getElementById('tp-day-nav-lbl').textContent=tpFmtThai(ds);
  const det=document.getElementById('tp-day-detail');det.style.display='block';
  if(!evts.length){det.innerHTML=`<div class="tp-det-card"><div class="tp-no-ev"><i class="ion-ios-archive"></i> ไม่มีกำหนดการ PM ในวันนี้</div></div>`;return;}
  let rows='';evts.forEach(e=>{const sc=tpStClass[e.status]||'pend';const btn=e.status==='เสร็จแล้ว'?`<span class="tp-dbtn-done"><i class="ion-ios-checkmark-circle"></i> เสร็จสิ้น</span>`:`<button class="tp-dbtn" onclick="tpOpenPMChecklistModal('${e.id}')"><i class="ion-ios-checkmark-circle"></i> ตรวจเช็ก</button>`;rows+=`<div class="tp-det-row"><div><div class="tp-dr-machine">${e.machine}</div><div class="tp-dr-sub">${e.title} · <span style="color:#14b8a6">${e.type}</span></div></div><div class="tp-dr-right"><span class="tp-dpill ${sc}">${e.status}</span>${btn}</div></div>`;});
  det.innerHTML=`<div class="tp-det-card"><div class="tp-det-hdr"><i class="ion-ios-calendar"></i> PM วันที่ ${tpFmtThai(ds)} — ${evts.length} รายการ</div>${rows}</div>`;
}
function tpCompletePMCal(id,ds){tpCompletePM(id);tpShowDayDetail(ds);}
function tpShiftDay(d){if(!tpSelDate)return;const[y,m,dd]=tpSelDate.split('-').map(Number);const cur=new Date(y,m-1,dd);cur.setDate(cur.getDate()+d);tpCurMonth=cur.getMonth();tpCurYear=cur.getFullYear();tpSelDate=tpFmt(cur);tpRenderCal();tpShowDayDetail(tpSelDate);}
function tpShiftMonth(d){tpCurMonth+=d;if(tpCurMonth>11){tpCurMonth=0;tpCurYear++;}else if(tpCurMonth<0){tpCurMonth=11;tpCurYear--;}tpClearDay();}
function tpClearDay(){tpSelDate=null;document.getElementById('tp-day-nav').style.display='none';document.getElementById('tp-day-detail').style.display='none';tpRenderCal();}
function tpGoToday(){const t=new Date();tpCurMonth=t.getMonth();tpCurYear=t.getFullYear();tpSelDate=tpFmt(t);tpRenderCal();tpShowDayDetail(tpSelDate);}

// ============================================================
// REGULAR DASHBOARD FUNCTIONS
// ============================================================
function renderRepairsTable(){
  const search=document.getElementById('track-search')?.value.toLowerCase()||'';
  const statusF=document.getElementById('track-filter-status')?.value||'';
  const deptF=document.getElementById('track-filter-dept')?.value||'';
  const sideF=document.getElementById('track-filter-side')?.value||'';
  const tbody=document.getElementById('track-repairs-tbody');if(!tbody)return;tbody.innerHTML='';
  const filtered=getRepairJobsData().filter(j=>(j.machine.toLowerCase().includes(search)||j.id.toLowerCase().includes(search))&&(!statusF||j.status===statusF)&&(!deptF||j.dept.includes(deptF))&&(!sideF||j.side.includes(sideF)));
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;color:var(--text3)">ไม่พบข้อมูลรายการแจ้งซ่อม</td></tr>`;return;}
  filtered.forEach(j=>{const sc={รอซ่อม:'pill-waiting',กำลังซ่อม:'pill-repairing',ซ่อมเสร็จแล้ว:'pill-completed',ปิดงาน:'pill-closed','แก้ไข (ตีกลับ)':'pill-fail',ตีกลับ:'pill-fail'}[j.status]||'pill-waiting';
    const tr=document.createElement('tr');tr.innerHTML=`<td style="font-family:var(--font-mono);font-weight:600;font-size:12px">${escapeHtml(j.id)}</td><td style="color:var(--text2);font-size:12px">${escapeHtml(j.date)}</td><td style="font-weight:600">${escapeHtml(j.machine)}</td><td><span class="lbl-tag">${escapeHtml((j.side||'').split(' ')[0])}</span></td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(j.detail)}</td><td style="color:var(--text2)">${escapeHtml(j.technician||'-')}</td><td><span class="pill ${sc}">${escapeHtml(j.status)}</span></td><td><button class="btn-action" onclick="viewJobDetail('${escapeHtml(j.id)}')">ดูรายละเอียด</button></td>`;tbody.appendChild(tr);});
}

function updatePMStats(){
  const d=getPMData();
  const ts=document.getElementById('pm-stat-total');if(ts)ts.textContent=d.length;
  const ps=document.getElementById('pm-stat-pend');if(ps)ps.textContent=d.filter(p=>p.status==='รอดำเนินการ').length;
  const ds=document.getElementById('pm-stat-done');if(ds)ds.textContent=d.filter(p=>p.status==='เสร็จแล้ว').length;
  const os=document.getElementById('pm-stat-over');if(os)os.textContent=d.filter(p=>p.status==='เกินกำหนด').length;
}

function renderPMTable(){
  const search=document.getElementById('pm-search')?.value.toLowerCase()||'';
  const statusF=document.getElementById('pm-filter-status')?.value||'';
  const freqF=document.getElementById('pm-filter-freq')?.value||'';
  const tbody=document.getElementById('pm-list-tbody');if(!tbody)return;tbody.innerHTML='';
  const filtered=getPMData().filter(p=>(p.machine.toLowerCase().includes(search)||p.title.toLowerCase().includes(search))&&(!statusF||p.status===statusF)&&(!freqF||p.type===freqF));
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;color:var(--text3)">ไม่พบข้อมูลตาราง PM</td></tr>`;return;}
  filtered.forEach((p,idx)=>{const sc={รอดำเนินการ:'sp-pend',กำลังดำเนินการ:'sp-prog',เสร็จแล้ว:'sp-done',เกินกำหนด:'sp-over'}[p.status]||'sp-pend';const canEdit=currentUser&&(currentUser.role==='admin'||(currentUser.role==='engineer'&&currentUser.isChief));const btn=canEdit?`<button class="btn-action" style="border-color:var(--purple);color:var(--purple)" onclick="openEditPMModal('${p.id}')">แก้ไขแผน</button>`:`<button class="btn-action" onclick="openPMChecklistForm('${p.id}','${p.machine}')">ตรวจเช็ก</button>`;const tr=document.createElement('tr');tr.innerHTML=`<td style="color:var(--text3);font-size:11px">${idx+1}</td><td style="font-weight:600">${p.machine}</td><td>${p.title}</td><td style="color:var(--text2);font-size:12px">${p.type}</td><td style="font-family:var(--font-mono);font-size:12px;color:var(--text2)">${p.date}</td><td><span class="spill ${sc}">${p.status}</span></td><td>${p.status==='เสร็จแล้ว'?'<span class="pill pill-closed">เสร็จสิ้น</span>':btn}</td>`;tbody.appendChild(tr);});
}

function renderCalendar(){
  const ctt=document.getElementById('calendar-title-txt');if(!ctt)return;
  ctt.textContent=monthsThai[calendarMonth]+' '+(calendarYear+543);
  const firstDay=new Date(calendarYear,calendarMonth,1).getDay();const numDays=new Date(calendarYear,calendarMonth+1,0).getDate();const prevDays=new Date(calendarYear,calendarMonth,0).getDate();
  const grid=document.getElementById('calendar-body-days');if(!grid)return;grid.innerHTML='';
  const todayStr=tpFmt(new Date());const total=Math.ceil((firstDay+numDays)/7)*7;
  for(let i=0;i<total;i++){
    let dayNum,other=false,ds='';
    if(i<firstDay){dayNum=prevDays-firstDay+1+i;other=true;}else if(i>=firstDay+numDays){dayNum=i-firstDay-numDays+1;other=true;}else{dayNum=i-firstDay+1;ds=`${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;}
    const isToday=ds===todayStr;const isSel=ds&&ds===calendarSelectedDate;const dayEvts=ds?getPMData().filter(p=>p.date===ds):[];
    let evtHtml=dayEvts.map(e=>{const ec={รอดำเนินการ:'pending',กำลังดำเนินการ:'prog',เสร็จแล้ว:'done',เกินกำหนด:'overdue'}[e.status]||'pending';return`<div class="cal-event-pill ${ec}">${e.machine.split(' ')[0]}</div>`;}).join('');
    const cell=document.createElement('div');cell.className=`calendar-day ${other?'other-month':''} ${isSel?'selected':''}`;cell.setAttribute('onclick',`onCalendarDayClick('${ds}',${!other})`);cell.innerHTML=`<div class="day-number-badge ${isToday?'is-today':''}">${dayNum}</div><div class="event-container">${evtHtml}</div>`;grid.appendChild(cell);
  }
}

function adjustCalendarMonth(offset){calendarMonth+=offset;if(calendarMonth>11){calendarMonth=0;calendarYear++;}else if(calendarMonth<0){calendarMonth=11;calendarYear--;}clearSelectedDayNav();renderCalendar();}
function focusCalendarToday(){const t=new Date();calendarMonth=t.getMonth();calendarYear=t.getFullYear();calendarSelectedDate=tpFmt(t);renderCalendar();showDayEventsDetail(calendarSelectedDate);}
function onCalendarDayClick(ds,valid){if(!valid||!ds)return;calendarSelectedDate=ds;renderCalendar();showDayEventsDetail(ds);}

function showDayEventsDetail(ds){
  const evts=getPMData().filter(p=>p.date===ds);
  const nav=document.getElementById('cal-day-navigator');const card=document.getElementById('cal-day-detail-card');
  if(!nav||!card)return;
  nav.style.display='inline-flex';document.getElementById('cal-selected-day-lbl').textContent=fmtThaiFull(ds);
  card.style.display='block';
  document.getElementById('cal-detail-title-txt').innerHTML=`<i class="ion-ios-calendar"></i> ตาราง PM วันที่ ${fmtThaiFull(ds)} (${evts.length} รายการ)`;
  const listDiv=document.getElementById('cal-day-detail-list');listDiv.innerHTML='';
  if(!evts.length){listDiv.innerHTML='<div style="text-align:center;color:var(--text3);padding:20px">ไม่มีกำหนดการเช็ก PM</div>';return;}
  evts.forEach(e=>{
    const sc={รอดำเนินการ:'sp-pend',กำลังดำเนินการ:'sp-prog',เสร็จแล้ว:'sp-done',เกินกำหนด:'sp-over'}[e.status]||'sp-pend';
    const canEdit=currentUser&&(currentUser.role==='admin'||(currentUser.role==='engineer'&&currentUser.isChief));
    const btn=canEdit?`<button class="btn-action" style="border-color:var(--purple);color:var(--purple)" onclick="openEditPMModal('${e.id}')">แก้ไขแผน</button>`:`<button class="btn-action" onclick="openPMChecklistForm('${e.id}','${e.machine}')">เปิดตรวจเช็ก</button>`;
    const row=document.createElement('div');row.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)';
    row.innerHTML=`<div><div style="font-weight:600;font-size:13.5px">${e.machine}</div><div style="font-size:12px;color:var(--text2);margin-top:2px">${e.title}</div></div><div style="display:flex;align-items:center;gap:10px"><span class="spill ${sc}">${e.status}</span>${e.status==='เสร็จแล้ว'?'<span class="pill pill-closed">เสร็จสิ้น</span>':btn}</div>`;
    listDiv.appendChild(row);
  });
}

function shiftSelectedDay(offset){if(!calendarSelectedDate)return;const[y,m,d]=calendarSelectedDate.split('-').map(Number);const cur=new Date(y,m-1,d);cur.setDate(cur.getDate()+offset);calendarSelectedDate=tpFmt(cur);calendarMonth=cur.getMonth();calendarYear=cur.getFullYear();renderCalendar();showDayEventsDetail(calendarSelectedDate);}
function clearSelectedDayNav(){calendarSelectedDate=null;const nav=document.getElementById('cal-day-navigator');const card=document.getElementById('cal-day-detail-card');if(nav)nav.style.display='none';if(card)card.style.display='none';renderCalendar();}
function fmtThaiFull(s){if(!s)return'';try{const[y,m,d]=s.split('-').map(Number);return`${d} ${monthsThai[m-1]} ${y+543}`;}catch(e){return s;}}

function openPMChecklistForm(pmId,machineName){
  const p=getPMData().find(x=>x.id===pmId);if(!p)return;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(v=>v.classList.remove('active'));
  document.getElementById('panel-pm-checklist').classList.add('active');
  document.getElementById('chk-pm-code').value=p.id;
  document.getElementById('chk-pm-equip').value=p.machine;
  document.getElementById('chk-pm-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('chk-pm-tech').value=currentUser?currentUser.name:'';
  document.getElementById('chk-sign-tech-input').value=currentUser?currentUser.name:'';
  updateSignatureBox('tech');buildChecklistRows();
}

function buildChecklistRows(){
  const tbody=document.getElementById('checklist-tbody-items');if(!tbody)return;tbody.innerHTML='';
  checkGroups.forEach((g,gi)=>{
    const hdr=document.createElement('tr');
    hdr.innerHTML=`<td colspan="3" class="checklist-group-title">${gi+1}. ${g.name}</td>`;
    tbody.appendChild(hdr);
    g.items.forEach((item,ii)=>{
      const nm=`chk_item_${gi}_${ii}`;
      const tr=document.createElement('tr');tr.className='checklist-row';
      tr.innerHTML=`<td class="checklist-item-lbl">${item}</td><td><div class="checklist-radios"><label class="ok"><input type="radio" name="${nm}" value="ok" required checked> OK</label><label class="ng"><input type="radio" name="${nm}" value="ng" required> NG</label></div></td><td><input type="text" id="chk_note_${gi}_${ii}" class="checklist-note-input" placeholder="หมายเหตุ..."></td>`;
      tbody.appendChild(tr);
    });
  });
}

function updateSignatureBox(type){
  const now=new Date();const ds=now.toLocaleDateString('th-TH');
  if(type==='tech'){const v=document.getElementById('chk-sign-tech-input')?.value;const d=document.getElementById('chk-sign-tech-disp');const dt=document.getElementById('chk-sign-tech-date');if(v&&d){d.textContent=v;d.style.fontStyle='italic';if(dt)dt.textContent=`ลงนามเมื่อ ${ds}`;}}
  else{const v=document.getElementById('chk-sign-appr-input')?.value;const d=document.getElementById('chk-sign-appr-disp');const dt=document.getElementById('chk-sign-appr-date');if(v&&d){d.textContent=v;d.style.fontStyle='italic';if(dt)dt.textContent=`อนุมัติเมื่อ ${ds}`;}}
}

function resetPMForm(){
  ['chk-pm-shift','chk-overall-result'].forEach(id=>{const e=document.getElementById(id);if(e)e.selectedIndex=0;});
  ['chk-running-hr','chk-parts-replaced','chk-work-done','chk-remarks','chk-next-pm'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.querySelectorAll('#checklist-tbody-items input[type=radio]').forEach(r=>{if(r.value==='ok')r.checked=true;});
  document.querySelectorAll('#checklist-tbody-items .checklist-note-input').forEach(i=>i.value='');
  const st=document.getElementById('chk-sign-tech-input');if(st&&currentUser)st.value=currentUser.name;
  const sa=document.getElementById('chk-sign-appr-input');if(sa)sa.value='';
  updateSignatureBox('tech');updateSignatureBox('appr');
}
   // submitPMForm
function submitPMForm(){
  const pmCode = document.getElementById('chk-pm-code').value;
  const equip  = document.getElementById('chk-pm-equip').value;
  const date   = document.getElementById('chk-pm-date').value;
  const tech   = document.getElementById('chk-pm-tech').value;
  const result = document.getElementById('chk-overall-result').value;
  const techSign = document.getElementById('chk-sign-tech-input').value;
  const apprSign = document.getElementById('chk-sign-appr-input').value;
  if(!pmCode||!equip||!date||!tech||!result||!techSign||!apprSign){
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน!','warning'); return;
  }
  const shift          = document.getElementById('chk-pm-shift').value;
  const productionLine = document.getElementById('chk-pm-line').value;
  const runningHr      = document.getElementById('chk-running-hr').value;
  const parts          = document.getElementById('chk-parts-replaced').value;
  const workDone       = document.getElementById('chk-work-done').value;
  const remarks        = document.getElementById('chk-remarks').value;
  const nextPm         = document.getElementById('chk-next-pm').value;
  const chkObj = {};
  checkGroups.forEach((g,gi) => g.items.forEach((item,ii) => {
    const r = document.querySelector(`input[name="chk_item_${gi}_${ii}"]:checked`);
    chkObj[`r${gi}_${ii}`] = { status: r?r.value:'ok', note: document.getElementById(`chk_note_${gi}_${ii}`).value };
  }));

  if(!isLocalMode){
    showLoading('กำลังบันทึก PM...');
    authFetch(`${API_URL}/pm/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pmCode, equip, productionLine, date, tech, shift, runningHr, parts, result, workDone, remarks, nextPm, checklist: JSON.stringify(chkObj) })
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
      if(res.success){
        // อัปเดต local cache
        localPMHistory.unshift({no:1, pmCode, equip, date, shift, tech, runningHr, parts, result, workDone, note:remarks, checklist:JSON.stringify(chkObj)});
        const idx = localPMCalendar.findIndex(x => x.id===pmCode);
        if(idx>-1) localPMCalendar[idx].status='เสร็จแล้ว';
        
        // Reload PM data จาก server พร้อมกัน
        Promise.all([
          fetch(`${API_URL}/pm`).then(r=>r.json()),
          fetch(`${API_URL}/pm/history`).then(r=>r.json())
        ]).then(([pmRes, histRes]) => {
          if(pmRes.data) cachedPM = pmRes.data;
          if(histRes.data) cachedPMHistory = histRes.data;
          
          // Refresh UI หลังจาก reload เสร็จ
          renderPMTable(); 
          renderPMHistoryTable();
          
          if(currentUser?.role === 'engineer' || currentUser?.role === 'admin') {
            engRenderPMTable(); 
            engRenderHist(); 
            engRenderDash();
          }
        });
        
        resetPMForm(); 
        showToast('บันทึกใบตรวจเช็ก PM สำเร็จ!','success');
      } else {
        showToast('เกิดข้อผิดพลาด: '+(res.message||''),'error');
      }
    })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
    return;
  }
  localPMHistory.unshift({no:localPMHistory.length+1, pmCode, equip, date, shift, tech, runningHr, parts, result, workDone, note:remarks, checklist:JSON.stringify(chkObj)});
  const idx = localPMCalendar.findIndex(x => x.id===pmCode);
  if(idx>-1) localPMCalendar[idx].status='เสร็จแล้ว';
  showToast('บันทึกใบตรวจเช็ก PM สำเร็จ!','success'); resetPMForm();
}
// techSubmitUpdate
function techSubmitUpdate(){
  if(!selectedJobForAction) return;
  const j = getRepairJobsData().find(x => x.id===selectedJobForAction); if(!j) return;
  const status = document.getElementById('tup-status')?.value;
  const note   = document.getElementById('tup-note')?.value;
  const eta    = document.getElementById('tup-eta')?.value;
  console.log('techSubmitUpdate:', {selectedJobForAction, currentStatus: j.status, newStatus: status, note, eta});
  if(!isLocalMode){
    showLoading('กำลังบันทึก...');
    authFetch(`${API_URL}/repairs/${encodeURIComponent(selectedJobForAction)}/update`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ status, note, eta, updatedBy: myIdentifiedName || ME })
    })
    .then(r => r.json())
    .then(res => {
      console.log('techSubmitUpdate response:', res);
      hideLoading();
      if(res.success){ 
        if(status) j.status=status; 
        if(note) j.note=note; 
        if(eta) j.eta=eta; 
        console.log('Updated local job:', j);
        closeModal('job-detail-modal');
        loadAllData().then(() => {
          tpUpdateStats(); 
          tpRenderMine(); 
          tpRenderQueue();
          showToast(`อัปเดตงาน ${j.machine} สำเร็จ!`,'success');
        });
      }
      else showToast('เกิดข้อผิดพลาด: '+(res.message||''),'error');
    })
    .catch(err => { 
      console.error('techSubmitUpdate error:', err);
      hideLoading(); 
      showToast('เชื่อมต่อ server ไม่ได้','error'); 
    });
    return;
  }
  if(status)j.status=status; if(note)j.note=note; if(eta)j.eta=eta;
  closeModal('job-detail-modal'); 
  tpUpdateStats(); 
  tpRenderMine(); 
  tpRenderQueue();
  showToast(`อัปเดตงาน ${j.machine} สำเร็จ!`,'success');
}

// adminSubmitUpdateJob
function adminSubmitUpdateJob(){
  if(!selectedJobForAction) return;
  const j = getRepairJobsData().find(x => x.id===selectedJobForAction); if(!j) return;
  const status = document.getElementById('adm-job-status')?.value;
  const tech   = document.getElementById('adm-job-tech')?.value;
  const eta    = document.getElementById('adm-job-eta')?.value;
  const note   = document.getElementById('adm-job-note')?.value;
  if(!isLocalMode){
    showLoading('กำลังบันทึก...');
    authFetch(`${API_URL}/repairs/${encodeURIComponent(selectedJobForAction)}/status`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ status, technician: tech, eta, note })
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
      if(res.success){ 
        if(status) j.status=status; 
        if(tech) j.technician=tech; 
        if(eta) j.eta=eta;
        if(note) j.note=note; 
        closeModal('job-detail-modal'); 
        renderAdminRepairsTable(); 
        showToast(`อัปเดตรายการ ${j.id} สำเร็จ!`,'success'); 
      }
      else showToast('เกิดข้อผิดพลาด: '+(res.message||''),'error');
    })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
    return;
  }
  if(status)j.status=status; if(tech)j.technician=tech; if(eta)j.eta=eta; if(note)j.note=note;
  closeModal('job-detail-modal'); showToast(`อัปเดตรายการ ${j.id} สำเร็จ!`,'success'); renderAdminRepairsTable();
}

// adminDeleteSelectedJob
function adminDeleteSelectedJob(){
  if(!selectedJobForAction) return; if(!confirm('ยืนยันการลบรายการนี้?')) return;
  if(!isLocalMode){
    showLoading('กำลังลบ...');
    fetch(`${API_URL}/repairs/${encodeURIComponent(selectedJobForAction)}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(res => { hideLoading(); if(res.success){ closeModal('job-detail-modal'); renderAdminRepairsTable(); showToast('ลบรายการสำเร็จ!','success'); } else showToast(res.message||'เกิดข้อผิดพลาด','error'); })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
    return;
  }
  const idx = localRepairs.findIndex(j => j.id===selectedJobForAction); if(idx>-1) localRepairs.splice(idx,1);
  closeModal('job-detail-modal'); showToast('ลบรายการสำเร็จ!','success'); renderAdminRepairsTable();
}

// submitPMEventForm
function submitPMEventForm(event){
  event.preventDefault();
  const id=document.getElementById('pmem-id').value, date=document.getElementById('pmem-date').value,
        title=document.getElementById('pmem-title-input').value, machine=getMachineValue('pmem-machine'),
        type=document.getElementById('pmem-type').value, status=document.getElementById('pmem-status').value;
  const item = {id:id||null, date, title, machine, type, status};
  if(!isLocalMode){
    showLoading('กำลังบันทึก...');
    authFetch(`${API_URL}/pm`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(item) })
    .then(r => r.json())
    .then(res => { hideLoading(); if(res.success){ closeModal('pm-event-modal'); refreshData(); } else showToast(res.message||'เกิดข้อผิดพลาด','error'); })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
    return;
  }
  if(id){ const idx=localPMCalendar.findIndex(x=>x.id===id); if(idx>-1) Object.assign(localPMCalendar[idx],{date,title,machine,type,status}); }
  else localPMCalendar.push({id:'PM-'+Date.now(), date, title, machine, type, status});
  closeModal('pm-event-modal'); showToast('บันทึกแผน PM สำเร็จ!','success'); renderPMTable(); updatePMStats(); renderCalendar();
}

// deletePMEventItem
function deletePMEventItem(){
  const id = document.getElementById('pmem-id').value; if(!id) return;
  if(!isLocalMode){
    showLoading('กำลังลบ...');
    fetch(`${API_URL}/pm/${encodeURIComponent(id)}`, { method:'DELETE' })
    .then(r => r.json())
    .then(res => { hideLoading(); if(res.success){ closeModal('pm-event-modal'); refreshData(); } else showToast(res.message||'เกิดข้อผิดพลาด','error'); })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
    return;
  }
  const idx = localPMCalendar.findIndex(x=>x.id===id); if(idx>-1) localPMCalendar.splice(idx,1);
  closeModal('pm-event-modal'); showToast('ลบแผน PM สำเร็จ!','success'); renderPMTable(); updatePMStats(); renderCalendar();
}

function viewPMDoc(pmCode,arrIdx){
  const doc=getPMHistoryData()[arrIdx];if(!doc)return;
  let chkObj={};try{chkObj=JSON.parse(doc.checklist||'{}');}catch(e){}
  let itemsHtml='';
  checkGroups.forEach((g,gi)=>{
    itemsHtml+=`<div style="background:var(--bg2);padding:6px 12px;font-weight:700;color:var(--teal);font-size:12.5px;border-radius:4px;margin:10px 0 6px">${gi+1}. ${g.name}</div>`;
    g.items.forEach((item,ii)=>{const vo=chkObj[`r${gi}_${ii}`]||{status:'ok',note:''};const res=typeof vo==='string'?vo:vo.status;const note=typeof vo==='object'?(vo.note||''):'';const bc=res==='ok'?'badge-green':'badge-red';const bt=res==='ok'?'OK':'NG';const nh=note?`<span style="font-size:11.5px;color:var(--text2);margin-left:8px">(${escapeHtml(note)})</span>`:'';itemsHtml+=`<div style="display:flex;justify-content:space-between;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.03);font-size:13px"><span>— ${escapeHtml(item)} ${nh}</span><span class="badge ${bc}">${bt}</span></div>`;});
  });
  document.getElementById('pm-view-doc-body').innerHTML=`<div style="border:1px solid var(--border);border-radius:var(--r);padding:20px"><h3 style="color:var(--accent);text-align:center;margin-bottom:12px">ใบตรวจเช็ก PM — ${escapeHtml(doc.pmCode)}</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)"><div><strong>เครื่องจักร:</strong> ${escapeHtml(doc.equip)}</div><div><strong>วันที่:</strong> ${escapeHtml(doc.date)}</div><div><strong>ช่างผู้ตรวจ:</strong> ${escapeHtml(doc.tech)}</div><div><strong>อะไหล่:</strong> ${escapeHtml(doc.parts||'-')}</div></div><div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-sm);padding:10px;margin-bottom:16px">${itemsHtml}</div><div><strong>งานที่ดำเนินการ:</strong><p style="background:var(--bg2);padding:10px;border-radius:var(--r-sm);margin-top:4px;color:var(--text2)">${escapeHtml(doc.workDone||'-')}</p></div></div>`;
  openModal('pm-view-doc-modal');
}

// ============================================================
// ADMIN DASHBOARD
// ============================================================
function parseJobDate(str){if(!str)return null;try{const parts=str.split(',')[0].trim().split('/');if(parts.length!==3)return null;let y=parseInt(parts[2]);if(y>2400)y-=543;return new Date(y,parseInt(parts[1])-1,parseInt(parts[0]));}catch(e){return null;}}
function filterJobsByTimeRange(jobs,ft){
  if(ft==='all')return jobs;
  const today=new Date();today.setHours(0,0,0,0);
  const msStart=new Date(today.getFullYear(),today.getMonth(),1);
  const t3m=new Date();t3m.setMonth(today.getMonth()-2);t3m.setDate(1);t3m.setHours(0,0,0,0);
  if(ft==='custom' && currentAdminCustomFrom && currentAdminCustomTo){
    const[fy,fm,fd]=currentAdminCustomFrom.split('-').map(Number);
    const[ty,tm,td]=currentAdminCustomTo.split('-').map(Number);
    const from=new Date(fy,fm-1,fd);from.setHours(0,0,0,0);
    const to=new Date(ty,tm-1,td);to.setHours(0,0,0,0);
    return jobs.filter(j=>{const jd=parseJobDate(j.date);if(!jd)return false;jd.setHours(0,0,0,0);return jd.getTime()>=from.getTime()&&jd.getTime()<=to.getTime();});
  }
  return jobs.filter(j=>{const jd=parseJobDate(j.date);if(!jd)return false;jd.setHours(0,0,0,0);if(ft==='daily')return jd.getTime()===today.getTime();if(ft==='monthly')return jd.getTime()>=msStart.getTime();if(ft==='3months')return jd.getTime()>=t3m.getTime();return true;});
}
function calculateAdminStats(jobs){const s={total:jobs.length,waiting:0,working:0,closed:0,sideData:{},deptData:{},monthlyData:{}};jobs.forEach(j=>{if(j.status==='รอซ่อม')s.waiting++;else if(j.status==='ปิดงาน')s.closed++;else s.working++;const side=j.side||'อื่นๆ';s.sideData[side]=(s.sideData[side]||0)+1;const dept=j.dept||'อื่นๆ';s.deptData[dept]=(s.deptData[dept]||0)+1;const jd=parseJobDate(j.date);if(jd){const k=`${String(jd.getMonth()+1).padStart(2,'0')}/${jd.getFullYear()}`;s.monthlyData[k]=(s.monthlyData[k]||0)+1;}});return s;}
function calculateTechPerformance(jobs){const m={};jobs.forEach(j=>{if(!j.technician)return;if(!m[j.technician])m[j.technician]={name:j.technician,total:0,done:0,closed:0,back:0};const t=m[j.technician];t.total++;if(j.status==='ซ่อมเสร็จแล้ว')t.done++;else if(j.status==='ปิดงาน'){t.closed++;t.done++;}else if(j.status==='แก้ไข (ตีกลับ)')t.back++;});return Object.values(m).map(t=>{const pc=t.total>0?(t.closed/t.total)*100:0;const pb=t.total>0?(t.back/t.total)*100:0;const perf=Math.round(pc*0.6+(100-pb)*0.4);return{...t,perfScore:Math.min(100,Math.max(0,perf))};}).sort((a,b)=>b.perfScore-a.perfScore);}

function buildTrend(val,unit,icon,cls,note){return`<span class="${cls}">${icon} ${val}${unit}${note?' '+note:''}</span>`;}

function initAdminDashboard(){
  const filtered=filterJobsByTimeRange(getRepairJobsData(),currentAdminTimeFilter);
  const stats=calculateAdminStats(filtered);const pm=getPMData();const sv=id=>document.getElementById(id);
  if(sv('adm-stat-total'))sv('adm-stat-total').textContent=stats.total;if(sv('adm-stat-wait'))sv('adm-stat-wait').textContent=stats.waiting;if(sv('adm-stat-work'))sv('adm-stat-work').textContent=stats.working;if(sv('adm-stat-closed'))sv('adm-stat-closed').textContent=stats.closed;if(sv('adm-stat-pm'))sv('adm-stat-pm').textContent=pm.length;if(sv('adm-stat-sla'))sv('adm-stat-sla').textContent='92%';
  const overdue=getRepairJobsData().filter(j=>j.slaOverdue).length;const pmToday=pm.filter(p=>p.date===new Date().toISOString().split('T')[0]).length;
  if(sv('adm-trend-total'))sv('adm-trend-total').innerHTML=buildTrend('+12','%','↑','kv-trend up','จากเดือนก่อน');
  if(sv('adm-trend-wait'))sv('adm-trend-wait').innerHTML=overdue>0?buildTrend(overdue,' งาน','<i class="ion-ios-warning"></i>','kv-trend warn','เกิน 24 ชม.'):'<span class="kv-trend up">✓ ทุกงานยังในกำหนด</span>';
  if(sv('adm-trend-work'))sv('adm-trend-work').innerHTML=buildTrend(stats.working,' งาน','<i class="ion-ios-construct"></i>','kv-trend','กำลังดำเนินการ');
  if(sv('adm-trend-closed'))sv('adm-trend-closed').innerHTML=buildTrend('+5',' งาน','↑','kv-trend up','สัปดาห์นี้');
  if(sv('adm-trend-pm'))sv('adm-trend-pm').innerHTML=buildTrend(pmToday,' กำหนดวันนี้','<i class="ion-ios-calendar"></i>','kv-trend','');
  if(sv('adm-trend-sla'))sv('adm-trend-sla').innerHTML=buildTrend('+3','%','↑','kv-trend up','จากเดือนก่อน');
  const palette=['#ef4444','#3b82f6','#10b981','#f59e0b','#a855f7','#14b8a6'];
  const chartCfg=(type,data,extra={})=>({type,data,options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#a1a1aa',font:{size:11},boxWidth:10}}},scales:type==='bar'||type==='line'?{x:{ticks:{color:'#a1a1aa',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#a1a1aa',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}}}:undefined,...extra}});
  if(chartSideInstance)chartSideInstance.destroy();const sc=sv('chart-side');if(sc)chartSideInstance=new Chart(sc,chartCfg('doughnut',{labels:Object.keys(stats.sideData),datasets:[{data:Object.values(stats.sideData),backgroundColor:palette,borderColor:'#18181b',borderWidth:2,hoverOffset:4}]},{plugins:{legend:{position:'bottom',labels:{color:'#a1a1aa',font:{size:10},boxWidth:8,padding:10}}}}));
  if(chartDeptInstance)chartDeptInstance.destroy();const dc=sv('chart-dept');if(dc)chartDeptInstance=new Chart(dc,chartCfg('bar',{labels:Object.keys(stats.deptData).map(l=>l.split(' ')[0]),datasets:[{label:'จำนวน',data:Object.values(stats.deptData),backgroundColor:'rgba(20,184,166,0.55)',borderColor:'#14b8a6',borderWidth:1,borderRadius:5,borderSkipped:false}]}));
  if(chartMonthlyInstance)chartMonthlyInstance.destroy();const mc=sv('chart-monthly');if(mc){const mKeys=Object.keys(stats.monthlyData).sort((a,b)=>{const[ma,ya]=a.split('/').map(Number);const[mb,yb]=b.split('/').map(Number);return(ya*12+ma)-(yb*12+mb);});chartMonthlyInstance=new Chart(mc,chartCfg('line',{labels:mKeys,datasets:[{label:'แจ้งซ่อม',data:mKeys.map(k=>stats.monthlyData[k]),borderColor:'#ef4444',backgroundColor:'rgba(239,68,68,0.08)',fill:true,tension:0.4,pointBackgroundColor:'#ef4444',pointRadius:4,pointHoverRadius:6}]}));}
  const lb=sv('leaderboard-tbody');if(lb){lb.innerHTML='';calculateTechPerformance(filtered).forEach((t,i)=>{const rankCls=['rank-1','rank-2','rank-3'][i]||'rank-n';const slaNum=t.total>0?Math.min(100,Math.round(t.perfScore*0.9+10)):null;const slaText=slaNum!==null?slaNum+'%':'—';const slaColor=slaNum>=80?'#10b981':slaNum>=60?'#f59e0b':'#ef4444';const tr=document.createElement('tr');tr.innerHTML=`<td><span class="rank-badge ${rankCls}">${i+1}</span></td><td style="font-weight:600;color:var(--text)">${t.name}</td><td style="color:var(--text2);text-align:center">${t.total}</td><td style="color:var(--text2);text-align:center">${t.done}</td><td style="color:#10b981;font-weight:600;text-align:center">${t.closed}</td><td style="color:#ef4444;text-align:center">${t.back}</td><td style="font-family:var(--font-mono);font-weight:700;color:${slaColor};text-align:center">${slaText}</td><td><div style="display:flex;align-items:center;gap:10px"><div style="flex:1"><div class="perf-bar-wrap"><div class="perf-bar-fill" style="width:${t.perfScore}%"></div></div></div><span style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--teal);min-width:36px;text-align:right">${t.perfScore}<span style="font-size:10px;color:var(--text3)">/100</span></span></div></td>`;lb.appendChild(tr);});}
}

// ── KPI Card → Dept Breakdown Modal ──
const DBM_CONFIG = {
  total:   { label: 'แจ้งซ่อมทั้งหมด', icon: 'ion-ios-clipboard', match: j => true },
  waiting: { label: 'รอซ่อม',          icon: 'ion-ios-hourglass',     match: j => j.status === 'รอซ่อม' },
  working: { label: 'กำลังซ่อม',       icon: 'ion-ios-construct',   match: j => j.status !== 'รอซ่อม' && j.status !== 'ปิดงาน' },
  closed:  { label: 'ปิดงานเสร็จ',     icon: 'ion-ios-checkmark-circle',   match: j => j.status === 'ปิดงาน' }
};

function openDeptBreakdown(kind){
  const cfg = DBM_CONFIG[kind]; if(!cfg) return;
  const filtered = filterJobsByTimeRange(getRepairJobsData(), currentAdminTimeFilter).filter(cfg.match);

  const byDept = {};
  filtered.forEach(j => { const d = j.dept || 'ไม่ระบุแผนก'; byDept[d] = (byDept[d]||0) + 1; });
  const deptEntries = Object.entries(byDept).sort((a,b) => b[1]-a[1]);

  document.getElementById('dbm-title').innerHTML = `<i class="${cfg.icon}"></i> ${cfg.label} — แยกตามแผนก`;

  const body = document.getElementById('dbm-body');
  if(!deptEntries.length){
    body.innerHTML = `<div class="dbm-empty">ไม่มีรายการในกลุ่มนี้</div>`;
  } else {
    body.innerHTML =
      `<div class="dbm-total-line">รวมทั้งหมด <strong style="color:var(--text)">${filtered.length}</strong> งาน · คลิกแผนกเพื่อดูรายการ</div>` +
      deptEntries.map(([dept, count]) => `
        <div class="dbm-row" onclick="goToRepairsFiltered('${kind}', '${dept.replace(/'/g,"\\'")}')">
          <div class="dbm-row-left"><i class="ion-ios-business" style="color:var(--text3)"></i><span class="dbm-row-dept">${dept}</span></div>
          <span class="dbm-row-count">${count}</span>
        </div>
      `).join('');
  }
  openModal('dept-breakdown-modal');
}

// นำทางไปหน้า "จัดการใบแจ้งซ่อม" พร้อมตั้งค่า filter สถานะ + แผนกให้อัตโนมัติ
function goToRepairsFiltered(kind, dept){
  closeModal('dept-breakdown-modal');
  const navBtn = document.querySelector('.tab-btn[onclick*="admin-repairs"]');
  switchViewPanel('admin-repairs', navBtn || document.querySelector('.tab-btn'));

  const statusMap = { waiting: 'รอซ่อม', closed: 'ปิดงาน', working: '', total: '' };
  const statusSel = document.getElementById('admin-filter-status-rep');
  if(statusSel) statusSel.value = statusMap[kind] ?? '';

  const deptSel = document.getElementById('admin-filter-dept-rep');
  if(deptSel){
    let opt = Array.from(deptSel.options).find(o => o.value === dept);
    if(!opt){ opt = document.createElement('option'); opt.value = dept; opt.textContent = dept; deptSel.appendChild(opt); }
    deptSel.value = dept;
  }
  renderAdminRepairsTable();
}

function setFltBtn(btn){document.querySelectorAll('.adm-flt').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
function exportAdminPDF(){showToast('กำลังเตรียมไฟล์ PDF...','info');setTimeout(()=>{try{window.print();}catch(e){showToast('เปิด Print Dialog เพื่อบันทึกเป็น PDF ได้เลยครับ','info');}},300);}
function changeAdminTimeFilter(ft){
  currentAdminTimeFilter=ft;
  const customBtn=document.getElementById('adm-flt-custom-btn');
  if(customBtn && ft!=='custom') customBtn.innerHTML='<i class="ion-ios-calendar"></i> เลือกวันที่';
  initAdminDashboard();
}

// ── แปลงวันที่ ISO (YYYY-MM-DD) เป็นรูปแบบไทย พ.ศ. ──
function formatThaiDate(isoStr){
  if(!isoStr) return '';
  const[y,m,d]=isoStr.split('-').map(Number);
  const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `${d} ${months[m-1]} ${y+543}`;
}
function updateThaiDateHint(inputId, hintId){
  const el=document.getElementById(inputId);
  const hint=document.getElementById(hintId);
  if(el && hint) hint.textContent = formatThaiDate(el.value);
}

function toggleAdminDatePopover(ev){
  if(ev) ev.stopPropagation();
  const pop=document.getElementById('adm-date-popover');
  if(!pop) return;
  const willOpen = !pop.classList.contains('open');
  pop.classList.toggle('open', willOpen);
  if(willOpen){
    // pre-fill กับค่าที่เลือกไว้ล่าสุด (ถ้ามี) มิฉะนั้นตั้งเป็นวันนี้
    const today=new Date().toISOString().split('T')[0];
    const fromEl=document.getElementById('adm-custom-date-from');
    const toEl=document.getElementById('adm-custom-date-to');
    if(fromEl) fromEl.value = currentAdminCustomFrom || today;
    if(toEl)   toEl.value   = currentAdminCustomTo   || today;
    updateThaiDateHint('adm-custom-date-from','adm-custom-date-from-th');
    updateThaiDateHint('adm-custom-date-to','adm-custom-date-to-th');
    document.addEventListener('click', closeAdminDatePopoverOutside);
  }
}
function closeAdminDatePopoverOutside(ev){
  const pop=document.getElementById('adm-date-popover');
  const btn=document.getElementById('adm-flt-custom-btn');
  if(!pop) return;
  if(pop.contains(ev.target) || (btn && btn.contains(ev.target))) return;
  pop.classList.remove('open');
  document.removeEventListener('click', closeAdminDatePopoverOutside);
}
function applyAdminCustomRange(){
  const fromEl=document.getElementById('adm-custom-date-from');
  const toEl=document.getElementById('adm-custom-date-to');
  const from=fromEl?.value, to=toEl?.value;
  if(!from || !to){ showToast('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด','error'); return; }
  if(from > to){ showToast('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด','error'); return; }

  currentAdminCustomFrom = from;
  currentAdminCustomTo   = to;
  currentAdminTimeFilter = 'custom';

  const[fy,fm,fd]=from.split('-').map(Number);
  const[ty,tm,td]=to.split('-').map(Number);
  const btn=document.getElementById('adm-flt-custom-btn');
  if(btn){
    const label = (from===to)
      ? `${fd}/${fm}/${fy+543}`
      : `${fd}/${fm}/${fy+543} - ${td}/${tm}/${ty+543}`;
    btn.innerHTML=`<i class="ion-ios-calendar"></i> ${label}`;
    setFltBtn(btn);
  }
  document.getElementById('adm-date-popover')?.classList.remove('open');
  document.removeEventListener('click', closeAdminDatePopoverOutside);
  initAdminDashboard();
}
function getFilteredAdminRepairs(){
  const search=(document.getElementById('admin-search-rep')?.value||'').toLowerCase();
  const statusF=document.getElementById('admin-filter-status-rep')?.value||'';
  const deptF=document.getElementById('admin-filter-dept-rep')?.value||'';
  let list=getRepairJobsData().filter(j=>(j.machine.toLowerCase().includes(search)||j.id.toLowerCase().includes(search)||(j.name||'').toLowerCase().includes(search))&&(!statusF||j.status===statusF)&&(!deptF||j.dept.includes(deptF)));
  if(adminRepDateFrom && adminRepDateTo){
    const[fy,fm,fd]=adminRepDateFrom.split('-').map(Number);
    const[ty,tm,td]=adminRepDateTo.split('-').map(Number);
    const from=new Date(fy,fm-1,fd);from.setHours(0,0,0,0);
    const to=new Date(ty,tm-1,td);to.setHours(0,0,0,0);
    list=list.filter(j=>{const jd=parseJobDate(j.date);if(!jd)return false;jd.setHours(0,0,0,0);return jd.getTime()>=from.getTime()&&jd.getTime()<=to.getTime();});
  }
  return list;
}

function toggleAdminRepDatePopover(ev){
  if(ev) ev.stopPropagation();
  const pop=document.getElementById('admin-rep-date-popover');
  if(!pop) return;
  const willOpen=!pop.classList.contains('open');
  pop.classList.toggle('open', willOpen);
  if(willOpen){
    const today=new Date().toISOString().split('T')[0];
    const fromEl=document.getElementById('admin-rep-date-from');
    const toEl=document.getElementById('admin-rep-date-to');
    if(fromEl) fromEl.value=adminRepDateFrom || today;
    if(toEl)   toEl.value=adminRepDateTo || today;
    updateThaiDateHint('admin-rep-date-from','admin-rep-date-from-th');
    updateThaiDateHint('admin-rep-date-to','admin-rep-date-to-th');
    document.addEventListener('click', closeAdminRepDatePopoverOutside);
  }
}
function closeAdminRepDatePopoverOutside(ev){
  const pop=document.getElementById('admin-rep-date-popover');
  const btn=document.getElementById('admin-rep-date-btn');
  if(!pop) return;
  if(pop.contains(ev.target) || (btn && btn.contains(ev.target))) return;
  pop.classList.remove('open');
  document.removeEventListener('click', closeAdminRepDatePopoverOutside);
}
function applyAdminRepDateFilter(){
  const from=document.getElementById('admin-rep-date-from')?.value;
  const to=document.getElementById('admin-rep-date-to')?.value;
  if(!from || !to){ showToast('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด','error'); return; }
  if(from > to){ showToast('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด','error'); return; }
  adminRepDateFrom=from; adminRepDateTo=to;
  const[fy,fm,fd]=from.split('-').map(Number);
  const[ty,tm,td]=to.split('-').map(Number);
  const btn=document.getElementById('admin-rep-date-btn');
  if(btn) btn.innerHTML=`<i class="ion-ios-calendar"></i> ${fd}/${fm}/${fy+543} - ${td}/${tm}/${ty+543}`;
  document.getElementById('admin-rep-date-popover')?.classList.remove('open');
  document.removeEventListener('click', closeAdminRepDatePopoverOutside);
  renderAdminRepairsTable();
}
function clearAdminRepDateFilter(){
  adminRepDateFrom=null; adminRepDateTo=null;
  const btn=document.getElementById('admin-rep-date-btn');
  if(btn) btn.innerHTML=`<i class="ion-ios-calendar"></i> เลือกช่วงวันที่`;
  document.getElementById('admin-rep-date-popover')?.classList.remove('open');
  document.removeEventListener('click', closeAdminRepDatePopoverOutside);
  renderAdminRepairsTable();
}

function renderAdminRepairsTable(){
  const tbody=document.getElementById('admin-rep-list-tbody');if(!tbody)return;tbody.innerHTML='';
  const filtered=getFilteredAdminRepairs();
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;color:var(--text3)">ไม่พบข้อมูล</td></tr>`;return;}
  filtered.forEach(j=>{const sc={รอซ่อม:'pill-waiting',กำลังซ่อม:'pill-repairing',ซ่อมเสร็จแล้ว:'pill-completed',ปิดงาน:'pill-closed'}[j.status]||'pill-waiting';const tr=document.createElement('tr');tr.innerHTML=`<td style="font-family:var(--font-mono);font-size:12px;font-weight:600">${j.id}</td><td style="color:var(--text2);font-size:12px">${j.date}</td><td>${j.name||j.requester||'-'}</td><td style="font-weight:600">${j.machine}</td><td style="color:var(--text2)">${j.technician||'ยังไม่กำหนด'}</td><td><span class="pill ${sc}">${j.status}</span></td><td>—</td><td><button class="btn-action" onclick="viewJobDetail('${j.id}')">แก้ไข</button></td>`;tbody.appendChild(tr);});
}

// ── ดึงข้อมูลรูปภาพจาก URL มาเป็น buffer สำหรับฝังลง Excel ──
function fetchImageForExcel(url){
  return new Promise(resolve => {
    if(!url){ resolve(null); return; }
    fetch(url)
      .then(r => { if(!r.ok) throw new Error('fetch failed'); return r.arrayBuffer(); })
      .then(buf => {
        const blob = new Blob([buf]);
        const objUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objUrl);
          let ext = (url.split('?')[0].split('.').pop() || 'png').toLowerCase();
          if(!['png','jpeg','jpg','gif'].includes(ext)) ext = 'png';
          if(ext === 'jpg') ext = 'jpeg';
          resolve({ buffer: buf, extension: ext, naturalWidth: img.naturalWidth || 120, naturalHeight: img.naturalHeight || 90 });
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
        img.src = objUrl;
      })
      .catch(() => resolve(null));
  });
}

function firstImgUrl(raw){
  if(!raw) return '';
  try { const arr = JSON.parse(raw); return Array.isArray(arr) && arr.length ? arr[0] : ''; }
  catch { return raw.startsWith('http') || raw.startsWith('data:') ? raw : ''; }
}

// ── ส่งออกรายการแจ้งซ่อม (ตาม filter ปัจจุบัน) เป็นไฟล์ Excel พร้อมรูปภาพ ──
async function exportAdminRepairsExcel(){
  if(typeof ExcelJS === 'undefined'){ showToast('โหลดไลบรารี Excel ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต','error'); return; }

  const filtered=getFilteredAdminRepairs();

  if(!filtered.length){ showToast('ไม่มีข้อมูลให้ส่งออก','error'); return; }

  const btn=document.getElementById('admin-rep-export-btn');
  if(btn) btn.disabled = true;
  showLoading('กำลังเตรียมไฟล์ Excel...');

  try{
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SFC Maintenance Service';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('ใบแจ้งซ่อม', { views:[{ state:'frozen', ySplit:1 }] });

    sheet.columns = [
      { header:'JobID',        key:'id',      width:20 },
      { header:'วันที่แจ้ง',    key:'date',    width:18 },
      { header:'ผู้แจ้ง',       key:'name',    width:16 },
      { header:'แผนก',         key:'dept',    width:20 },
      { header:'เครื่องจักร',   key:'machine', width:22 },
      { header:'ด้านปัญหา',     key:'side',    width:20 },
      { header:'ประเภทงาน',     key:'opType',  width:18 },
      { header:'รายละเอียด',    key:'detail',  width:30 },
      { header:'ช่างซ่อม',      key:'tech',    width:16 },
      { header:'สถานะ',        key:'status',  width:14 },
      { header:'วันที่เสร็จ',    key:'doneDate',width:14 },
      { header:'กำหนดเสร็จ (ETA)',key:'eta',   width:14 },
      { header:'หมายเหตุ',      key:'note',    width:24 },
      { header:'ผล QC',        key:'qc',      width:12 },
      { header:'รูปก่อนซ่อม',   key:'imgBefore',width:20 },
      { header:'รูปหลังซ่อม',   key:'imgAfter', width:20 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold:true, color:{ argb:'FFFFFFFF' }, name:'Arial' };
    headerRow.eachCell(cell => {
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF0D9488' } };
      cell.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
    });
    headerRow.height = 22;

    // ดึงรูปทั้งหมดล่วงหน้าแบบขนาน (เร็วกว่าดึงทีละแถว)
    const imgTasks = filtered.map(j => Promise.all([
      fetchImageForExcel(firstImgUrl(j.img)),
      fetchImageForExcel(firstImgUrl(j.imgAfter))
    ]));
    const imgResults = await Promise.all(imgTasks);

    filtered.forEach((j, i) => {
      const row = sheet.addRow({
        id: j.id, date: j.date, name: j.name || j.requester || '-', dept: j.dept || '-',
        machine: j.machine || '-', side: j.side || '-', opType: j.opType || '-',
        detail: j.detail || '-', tech: j.technician || 'ยังไม่กำหนด', status: j.status || '-',
        doneDate: j.doneDate || '-', eta: j.eta || '-', note: j.note || '-', qc: j.qcResult || '-',
        imgBefore: '', imgAfter: ''
      });
      row.font = { name:'Arial', size:10 };
      row.alignment = { vertical:'middle', wrapText:true };
      row.height = 78;

      const [before, after] = imgResults[i];
      const rowIdx = row.number - 1; // 0-based สำหรับ ExcelJS anchor
      if(before){
        const imgId = workbook.addImage({ buffer: before.buffer, extension: before.extension });
        sheet.addImage(imgId, { tl:{ col:14, row: rowIdx + 0.05 }, ext:{ width:110, height:100 } });
      } else {
        row.getCell('imgBefore').value = '-';
      }
      if(after){
        const imgId = workbook.addImage({ buffer: after.buffer, extension: after.extension });
        sheet.addImage(imgId, { tl:{ col:15, row: rowIdx + 0.05 }, ext:{ width:110, height:100 } });
      } else {
        row.getCell('imgAfter').value = '-';
      }
    });

    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const stamp = adminRepDateFrom && adminRepDateTo
      ? `${adminRepDateFrom.replace(/-/g,'')}-${adminRepDateTo.replace(/-/g,'')}`
      : `${String(now.getDate()).padStart(2,'0')}${String(now.getMonth()+1).padStart(2,'0')}${now.getFullYear()+543}`;
    const a = document.createElement('a');
    a.href = url; a.download = `ใบแจ้งซ่อม_${stamp}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`ส่งออก Excel สำเร็จ (${filtered.length} รายการ)`, 'success');
  }catch(err){
    console.error('[Export Excel] error:', err);
    showToast('เกิดข้อผิดพลาดในการสร้างไฟล์ Excel', 'error');
  }finally{
    hideLoading();
    if(btn) btn.disabled = false;
  }
}
// ── Admin Users Panel ──
function renderAdminUsersTable() {
  const panel = document.getElementById('panel-admin-users');
  if (!panel) return;
  if (!document.getElementById('admin-users-tbody')) {
    panel.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <div class="card-title" style="margin-bottom:0"><i class="ion-ios-people"></i> จัดการผู้ใช้งานระบบ</div>
          <button class="btn btn-sec" style="font-size:12px" onclick="renderAdminUsersTable()"><i class="ion-ios-refresh"></i> รีเฟรช</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <input type="text" id="admin-user-search" class="input-ctrl" style="flex:1;min-width:160px;font-size:13px" placeholder="🔍 ค้นหา username / ชื่อ..." oninput="filterAdminUsers()">
          <select id="admin-user-role-filter" class="select-ctrl" style="width:140px;font-size:12px" onchange="filterAdminUsers()">
            <option value="">ทุก Role</option><option value="user">พนักงาน (user)</option>
            <option value="engineer">ช่าง/วิศวกร</option><option value="admin">แอดมิน</option>
          </select>
          <select id="admin-user-status-filter" class="select-ctrl" style="width:120px;font-size:12px" onchange="filterAdminUsers()">
            <option value="">ทุกสถานะ</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>#</th><th>Avatar</th><th>Username</th><th>ชื่อ-สกุล</th><th>Role</th><th>แผนก</th><th>ติดต่อ</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead>
            <tbody id="admin-users-tbody"></tbody>
          </table>
        </div>
      </div>`;
  }
  if (isLocalMode) {
    _renderUsersRows([
      {username:'demo_user',role:'user',fullname:'สมชาย ทดสอบ',dept:'ฝ่ายผลิต',contact:'081-000-0001',status:'active',avatar:''},
      {username:'demo_tech',role:'engineer',fullname:'วิชัย ช่างดี',dept:'ฝ่ายวิศวกรรม',contact:'081-000-0002',status:'active',avatar:''},
    ]);
    return;
  }
  showLoading('กำลังโหลดข้อมูล Users...');
  authFetch(`${API_URL}/users`)
    .then(r => r.json())
    .then(data => { hideLoading(); _allUsersCache = data.users || data || []; _renderUsersRows(_allUsersCache); })
    .catch(err => { hideLoading(); showToast('โหลดข้อมูล Users ไม่สำเร็จ','error'); });
}
let _allUsersCache = [];

function filterAdminUsers() {
  const search = (document.getElementById('admin-user-search')?.value || '').toLowerCase();
  const roleF  = document.getElementById('admin-user-role-filter')?.value  || '';
  const statusF= document.getElementById('admin-user-status-filter')?.value|| '';
  const filtered = _allUsersCache.filter(u =>
    (!search  || u.username.toLowerCase().includes(search) || u.fullname.toLowerCase().includes(search)) &&
    (!roleF   || u.role === roleF || (roleF === 'engineer' && isRepairStaff(u.role))) &&
    (!statusF || u.status === statusF)
  );
  _renderUsersRows(filtered);
}

function _renderUsersRows(users) {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:20px">ไม่พบข้อมูลผู้ใช้งาน</td></tr>`;
    return;
  }
  const roleLabel = { user:'<i class="ion-ios-person"></i> พนักงาน', technician:'<i class="ion-ios-construct"></i> ช่าง/วิศวกร', engineer:'<i class="ion-ios-construct"></i> ช่าง/วิศวกร', admin:'<i class="ion-ios-checkmark-circle"></i> แอดมิน' };
  const rolePill  = { user:'pill-waiting', technician:'pill-closed', engineer:'pill-closed', admin:'pill-fail' };
  tbody.innerHTML = users.map((u, i) => {
    const avatarHtml = u.avatar && u.avatar.length > 10
      ? `<img src="${u.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid var(--border)">`
      : `<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">${(u.fullname||u.username||'?').slice(0,2)}</div>`;
    const statusBadge = u.status === 'active'
      ? `<span class="badge badge-green">Active</span>`
      : `<span class="badge badge-red">Inactive</span>`;
    const toggleLabel = u.status === 'active' ? 'ระงับ' : 'เปิดใช้';
    const toggleCls   = u.status === 'active' ? 'btn-danger' : 'btn-sec';
    return `<tr>
      <td style="color:var(--text3);font-size:11px">${i + 1}</td>
      <td>${avatarHtml}</td>
      <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--accent)">${u.username}</td>
      <td style="font-weight:600">${u.fullname || '—'}</td>
      <td><span class="pill ${rolePill[u.role]||'pill-waiting'}" style="font-size:11px">${roleLabel[u.role]||u.role}</span></td>
      <td style="color:var(--text2);font-size:12px">${u.dept || '—'}</td>
      <td style="color:var(--text2);font-size:12px">${u.contact || '—'}</td>
      <td>${statusBadge}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn ${toggleCls}" style="font-size:11px;padding:4px 10px"
            onclick="adminToggleUserStatus('${u.username}','${u.status === 'active' ? 'inactive' : 'active'}',this)">
            ${toggleLabel}
          </button>
          <button class="btn btn-danger" style="font-size:11px;padding:4px 10px"
            onclick="adminDeleteUserConfirm('${u.username}')">
            <i class="ion-ios-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function adminToggleUserStatus(username, newStatus, btn) {
  if (isLocalMode) { showToast('Local Mode — ไม่สามารถแก้ไขได้','warning'); return; }
  showLoading('กำลังอัปเดต...');
  authFetch(`${API_URL}/users/${encodeURIComponent(username)}/status`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ status: newStatus })
  })
  .then(r => r.json())
  .then(res => {
    hideLoading();
    if(res&&res.success){ showToast(`อัปเดตสถานะ ${username} สำเร็จ`,'success'); renderAdminUsersTable(); }
    else showToast((res&&res.message)||'เกิดข้อผิดพลาด','error');
  })
  .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
}

function adminDeleteUserConfirm(username) {
  if (!confirm(`⚠️ ยืนยันการลบ User "${username}" ?`)) return;
  if (isLocalMode) { showToast('Local Mode — ไม่สามารถลบได้','warning'); return; }
  showLoading('กำลังลบ...');
  authFetch(`${API_URL}/users/${encodeURIComponent(username)}`, { method:'DELETE' })
  .then(r => r.json())
  .then(res => {
    hideLoading();
    if(res&&res.success){ showToast(`ลบ User "${username}" สำเร็จ`,'success'); renderAdminUsersTable(); }
    else showToast((res&&res.message)||'เกิดข้อผิดพลาด','error');
  })
  .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
}

// ============================================================
// ADMIN — TECH PROFILES (โปรไฟล์ช่าง/วิศวกร ในบัญชีกลาง)
// ============================================================
let _allTechProfilesCache = [];
let _editingTechProfileId = null;

function renderAdminTechProfiles() {
  const panel = document.getElementById('panel-admin-techprofiles');
  if (!panel) return;
  if (!document.getElementById('admin-techprofiles-tbody')) {
    panel.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <div class="card-title" style="margin-bottom:0"><i class="ion-ios-contact"></i> โปรไฟล์ช่าง/วิศวกร (บัญชีกลาง)</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sec" style="font-size:12px" onclick="renderAdminTechProfiles()"><i class="ion-ios-refresh"></i> รีเฟรช</button>
            <button class="btn btn-accent" style="font-size:12px" onclick="openTechProfileModal()"><i class="ion-ios-add"></i> เพิ่มช่างใหม่</button>
          </div>
        </div>
        <p style="font-size:12.5px;color:var(--text2);margin-bottom:14px">
          รายชื่อคนที่ผูกอยู่กับบัญชี login กลาง (เช่น <code>eng_team</code>) — ใช้ตอนเลือกชื่อ+กรอกรหัสพนักงานก่อนรับงาน
        </p>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>#</th><th>ชื่อ-สกุล</th><th>รหัสพนักงาน</th><th>เบอร์โทร</th><th>บัญชีที่สังกัด</th><th>หัวหน้า</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead>
            <tbody id="admin-techprofiles-tbody"></tbody>
          </table>
        </div>
      </div>`;
  }
  showLoading('กำลังโหลดข้อมูลโปรไฟล์ช่าง...');
  authFetch(`${API_URL}/tech-profiles`)
    .then(r => r.json())
    .then(data => {
      hideLoading();
      _allTechProfilesCache = (data.success && data.data) ? data.data : [];
      _renderTechProfileRows(_allTechProfilesCache);
    })
    .catch(() => { hideLoading(); showToast('โหลดข้อมูลโปรไฟล์ช่างไม่สำเร็จ','error'); });
}

function _renderTechProfileRows(profiles) {
  const tbody = document.getElementById('admin-techprofiles-tbody');
  if (!tbody) return;
  if (!profiles.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:20px">ยังไม่มีโปรไฟล์ช่าง — กด "เพิ่มช่างใหม่" เพื่อเริ่มต้น</td></tr>`;
    return;
  }
  tbody.innerHTML = profiles.map((p, i) => {
    const isChief = p.is_chief === 'TRUE' || p.is_chief === true;
    const isActive = p.status === 'active';
    return `<tr>
      <td style="color:var(--text3);font-size:11px">${i + 1}</td>
      <td style="font-weight:600">${p.fullname || '—'}</td>
      <td style="font-family:var(--font-mono);font-size:12px">${p.employee_code || '—'}</td>
      <td style="color:var(--text2);font-size:12px">${p.phone || '—'}</td>
      <td style="font-family:var(--font-mono);font-size:12px;color:var(--accent)">${p.parent_account || '—'}</td>
      <td>${isChief ? '<span class="badge badge-green">หัวหน้า</span>' : '—'}</td>
      <td>${isActive ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Inactive</span>'}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sec" style="font-size:11px;padding:4px 10px" onclick="openTechProfileModal('${p.id}')">
            <i class="ion-ios-create"></i>
          </button>
          <button class="btn ${isActive ? 'btn-danger' : 'btn-sec'}" style="font-size:11px;padding:4px 10px"
            onclick="toggleTechProfileStatus('${p.id}','${isActive ? 'inactive' : 'active'}')">
            ${isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openTechProfileModal(id) {
  _editingTechProfileId = id || null;
  const p = id ? _allTechProfilesCache.find(x => x.id === id) : null;

  document.getElementById('tpm-modal-title').textContent = id ? 'แก้ไขโปรไฟล์ช่าง' : 'เพิ่มโปรไฟล์ช่างใหม่';
  document.getElementById('tpm-fullname').value      = p?.fullname      || '';
  document.getElementById('tpm-employee-code').value = p?.employee_code || '';
  document.getElementById('tpm-phone').value         = p?.phone         || '';
  document.getElementById('tpm-parent-account').value= TECH_PROFILE_PARENT_ACCOUNT;
  document.getElementById('tpm-parent-account-display').textContent = TECH_PROFILE_PARENT_ACCOUNT;
  document.getElementById('tpm-is-chief').checked    = p ? (p.is_chief === 'TRUE' || p.is_chief === true) : false;
  document.getElementById('tpm-error').style.display = 'none';

  openModal('tech-profile-modal');
}

function submitTechProfileForm() {
  const fullname      = document.getElementById('tpm-fullname').value.trim();
  const employee_code = document.getElementById('tpm-employee-code').value.trim();
  const phone         = document.getElementById('tpm-phone').value.trim();
  const parent_account= TECH_PROFILE_PARENT_ACCOUNT; // auto-fill — ผูกกับบัญชี login กลางของทีมช่างเสมอ
  const is_chief      = document.getElementById('tpm-is-chief').checked;
  const errEl = document.getElementById('tpm-error');
  const showErr = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };
  errEl.style.display = 'none';

  if (!fullname)       return showErr('กรุณากรอกชื่อ-สกุล');
  if (!employee_code)  return showErr('กรุณากรอกรหัสพนักงาน');

  const btn = document.getElementById('tpm-submit-btn');
  if (btn) btn.disabled = true;

  const payload = { fullname, employee_code, phone, parent_account, is_chief };
  const req = _editingTechProfileId
    ? authFetch(`${API_URL}/tech-profiles/${encodeURIComponent(_editingTechProfileId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
    : authFetch(`${API_URL}/tech-profiles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });

  req.then(r => r.json())
    .then(res => {
      if (res.success) {
        showToast(_editingTechProfileId ? 'แก้ไขโปรไฟล์สำเร็จ' : 'เพิ่มโปรไฟล์ช่างสำเร็จ', 'success');
        closeModal('tech-profile-modal');
        renderAdminTechProfiles();
      } else {
        showErr(res.message || 'เกิดข้อผิดพลาด');
      }
    })
    .catch(() => showErr('เชื่อมต่อ server ไม่ได้'))
    .finally(() => { if (btn) btn.disabled = false; });
}

function toggleTechProfileStatus(id, newStatus) {
  showLoading('กำลังอัปเดต...');
  const req = newStatus === 'inactive'
    ? authFetch(`${API_URL}/tech-profiles/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      })
    : authFetch(`${API_URL}/tech-profiles/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }),
      });

  req.then(r => r.json())
    .then(res => {
      hideLoading();
      if (res.success) { showToast('อัปเดตสถานะสำเร็จ', 'success'); renderAdminTechProfiles(); }
      else showToast(res.message || 'เกิดข้อผิดพลาด', 'error');
    })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้', 'error'); });
}
// ============================================================
// MODAL HELPERS
// ============================================================
let _currentDailyPMCode='';

function engOpenDailyPMDetail(code){
  _currentDailyPMCode = code;
  document.getElementById('daily-pm-modal-title').textContent = 'Daily PM — '+code;
  document.getElementById('daily-pm-modal-body').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text2)">กำลังโหลด...</div>';
  openModal('daily-pm-detail-modal');
  fetch(`${API_URL}/daily-pm`)
    .then(r => r.json())
    .then(data => {
      const h = (data.dailyPMHistory||[]).find(x => x.code===code);
      if(!h){ document.getElementById('daily-pm-modal-body').innerHTML='ไม่พบข้อมูล'; return; }
      const OL = {pass:'ปกติ',warn:'ต้องติดตาม',fail:'ชำรุด'};
      let chk = {items:[]}; try{ chk=JSON.parse(h.checklist||'{}'); }catch(e){}
      let itemsHtml = '';
      if(Array.isArray(chk.items)){
        let lastGroup='';
        chk.items.forEach(it=>{
          if(it.group!==lastGroup){ itemsHtml+=`<div style="background:var(--bg2);padding:6px 12px;font-weight:700;color:var(--teal);font-size:12px;margin:8px 0 4px">${it.group}</div>`; lastGroup=it.group; }
          const bc=it.status==='ok'?'badge-green':'badge-red';
          itemsHtml+=`<div style="display:flex;justify-content:space-between;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.03);font-size:13px"><span style="color:var(--text2)">— ${it.item}</span><span class="badge ${bc}">${it.status==='ok'?'OK':'NG'}</span></div>`;
        });
      }
      document.getElementById('daily-pm-modal-body').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;font-size:13px">
          <div><span style="color:var(--text2)">เครื่องจักร: </span><strong>${h.machine}</strong></div>
          <div><span style="color:var(--text2)">ไลน์: </span><strong>${h.productionLine}</strong></div>
          <div><span style="color:var(--text2)">ผู้ตรวจ: </span><strong>${escapeHtml(h.inspector)}</strong></div>
          <div><span style="color:var(--text2)">สภาพรวม: </span><strong>${OL[h.result]||h.result}</strong></div>
          <div><span style="color:var(--text2)">วันที่: </span>${h.date} ${h.time}</div>
          <div><span style="color:var(--text2)">หมายเหตุ: </span>${escapeHtml(h.note||'-')}</div>
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--r-sm);overflow:hidden;max-height:300px;overflow-y:auto">
          ${itemsHtml||'<div style="padding:16px;color:var(--text3);text-align:center">ไม่มีรายการ checklist</div>'}
        </div>`;
      const ackBtn = document.getElementById('daily-pm-ack-btn');
      if(ackBtn) ackBtn.style.display = h.engStatus==='รับทราบแล้ว'?'none':'inline-flex';
    })
    .catch(() => { document.getElementById('daily-pm-modal-body').innerHTML='<div style="color:var(--red);padding:1rem"><i class="ion-ios-close-circle"></i> โหลดไม่สำเร็จ</div>'; });
}

function engAckDailyPM(){
  if(!_currentDailyPMCode) return;
  if(!isLocalMode){
    showLoading('กำลังบันทึก...');
    authFetch(`${API_URL}/daily-pm/${encodeURIComponent(_currentDailyPMCode)}/ack`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ by: currentUser.name })
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
      if(res&&res.success){ showToast('รับทราบ Daily PM สำเร็จ','success'); closeModal('daily-pm-detail-modal'); engRenderDailyPM(); }
      else showToast('เกิดข้อผิดพลาด','error');
    })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
    return;
  }
  showToast('Local Mode — ไม่สามารถบันทึกได้','warning'); closeModal('daily-pm-detail-modal');
}

function tpCloseModal(){document.getElementById('tp-modal-overlay').classList.remove('show');}
function tpCloseModalOutside(event){if(event.target===document.getElementById('tp-modal-overlay'))tpCloseModal();}
function openModal(id){const m=document.getElementById(id);if(m)m.classList.add('active');}
function closeModal(id){const m=document.getElementById(id);if(m)m.classList.remove('active');}

// ============================================================
// INS PM DAILY
// ============================================================
function insGenCode(){return'PM-D-'+new Date().toISOString().replace(/[-T:.Z]/g,'').slice(0,14);}
function insInitForm(){
  document.getElementById('ins-pm-code').value=insGenCode();
  document.getElementById('ins-pm-date').value=new Date().toISOString().split('T')[0];
  const insp = document.getElementById('ins-pm-inspector');
  if (insp && currentUser) insp.value = currentUser.name;
  insBuildChecklist();insRenderHistory();
}
function insBuildChecklist(){
  const c=document.getElementById('ins-checklist-container');if(!c)return;c.innerHTML='';
  INS_GROUPS.forEach((g,gi)=>{
    const card=document.createElement('div');card.className='pm-check-card';
    let rows='';g.items.forEach((item,ii)=>{const nm=`ins_chk_${gi}_${ii}`;rows+=`<div class="pm-check-row"><span style="font-size:13px">— ${item}</span><div class="pm-radios"><label class="pm-ok-lbl"><input type="radio" name="${nm}" value="ok" checked> OK</label><label class="pm-ng-lbl"><input type="radio" name="${nm}" value="ng"> NG</label></div><input class="pm-note-inp" type="text" id="ins_note_${gi}_${ii}" placeholder="หมายเหตุ..."></div>`;});
    card.innerHTML=`<div class="pm-group-header"><div class="pm-group-dot" style="background:${g.color}"></div><span>${gi+1}. ${g.name}</span></div>${rows}`;
    c.appendChild(card);
  });
}
function insGetChecklistData(){let ok=0,ng=0,items=[];INS_GROUPS.forEach((g,gi)=>{g.items.forEach((item,ii)=>{const r=document.querySelector(`input[name="ins_chk_${gi}_${ii}"]:checked`);const note=document.getElementById(`ins_note_${gi}_${ii}`).value;const status=r?r.value:'ok';if(status==='ok')ok++;else ng++;items.push({group:g.name,item,status,note});});});return{ok,ng,items};}
function insSubmitForm(){
 const inspector=document.getElementById('ins-pm-inspector').value.trim();const line=document.getElementById('ins-pm-line').value;const overall=document.getElementById('ins-pm-overall').value;
if(!inspector){showToast('กรุณาระบุชื่อผู้ตรวจ','warning');return;}if(!line){showToast('กรุณาเลือกสถานที่ปฏิบัติงาน','warning');return;}if(!overall){showToast('กรุณาเลือกสภาพโดยรวม','warning');return;}
  const chk=insGetChecklistData();const now=new Date();
 const entry={id:document.getElementById('ins-pm-code').value,date:document.getElementById('ins-pm-date').value,shift:document.getElementById('ins-pm-shift').value,inspector,line,overall,parts:document.getElementById('ins-pm-parts').value||'-',work:document.getElementById('ins-pm-work').value||'-',remark:document.getElementById('ins-pm-remark').value||'-',checklist:chk,ts:now.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})};
  if (!isLocalMode) {
  showLoading('กำลังบันทึก...');
  authFetch(`${API_URL}/daily-pm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
  code:           entry.id,
  date:           entry.date,
  time:           entry.ts,
  productionLine: entry.line,
  inspector:      entry.inspector,
  result:         entry.overall,
  note:           entry.remark,
  checklist:      JSON.stringify(entry.checklist),
})
  })
  .then(r => r.json())
  .then(res => {
    hideLoading();
    if (res.success) {
      insDailyHistory.unshift(entry);
      insRenderHistory();
      insResetForm();
      showToast('บันทึกผล PM รายวันสำเร็จ!', 'success');
    } else {
      showToast('เกิดข้อผิดพลาด: ' + (res.message || ''), 'error');
    }
  })
  .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้', 'error'); });
  return;
}
  insDailyHistory.unshift(entry);insRenderHistory();insResetForm();showToast('บันทึกผล PM รายวันสำเร็จ!','success');
}
function insResetForm(){document.getElementById('ins-pm-code').value=insGenCode();document.getElementById('ins-pm-date').value=new Date().toISOString().split('T')[0];['ins-pm-shift','ins-pm-line','ins-pm-overall'].forEach(id=>{const e=document.getElementById(id);if(e)e.selectedIndex=0;});['ins-pm-parts','ins-pm-work','ins-pm-remark'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});const insp=document.getElementById('ins-pm-inspector');if(insp&&currentUser)insp.value=currentUser.name;insBuildChecklist();}
function insRenderHistory(){
  const body=document.getElementById('ins-hist-body');const cnt=document.getElementById('ins-hist-count');if(cnt)cnt.textContent=insDailyHistory.length+' รายการ';
  if(!insDailyHistory.length){if(body)body.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text3);font-size:13px"><i class="ion-ios-archive" style="font-size:28px;display:block;margin-bottom:8px"></i>ยังไม่มีประวัติการตรวจ</div>';return;}
  const OL={pass:'ปกติ',warn:'ต้องติดตาม',fail:'ชำรุด'};const OC={pass:'badge-green',warn:'badge-amber',fail:'badge-red'};
  let html=`<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>เวลา</th><th>ผู้ตรวจ</th><th>ไลน์</th><th>เครื่องจักร</th><th>OK/NG</th><th>สภาพรวม</th><th>ดู</th></tr></thead><tbody>`;
  insDailyHistory.forEach((h,i)=>{html+=`<tr><td style="font-size:12px;color:var(--text2)">${h.ts}</td><td style="font-weight:600">${escapeHtml(h.inspector)}</td><td style="color:var(--text2)">${escapeHtml(h.line)}</td><td>${escapeHtml(h.machine)}</td><td><span style="color:var(--green)">${h.checklist.ok}</span>/<span style="color:var(--red)">${h.checklist.ng}</span></td><td><span class="pm-hist-badge ${OC[h.overall]||'pm-hist-ok'}">${OL[h.overall]||h.overall}</span></td><td><button class="pm-hist-detail-btn" onclick="insShowDetail(${i})">ดู</button></td></tr>`;});
  html+='</tbody></table></div>';if(body)body.innerHTML=html;
}
function insShowDetail(i){
  const h=insDailyHistory[i];if(!h)return;
  const OL={pass:'ปกติ',warn:'ต้องติดตาม',fail:'ชำรุด'};const OC={pass:'badge-green',warn:'badge-amber',fail:'badge-red'};
  document.getElementById('ins-modal-title').textContent=`${h.inspector} | ${h.machine} | ${h.ts}`;
  const total=h.checklist.ok+h.checklist.ng;let itemsHtml='';let lastGroup='';
  h.checklist.items.forEach(it=>{if(it.group!==lastGroup){itemsHtml+=`<div style="background:var(--bg2);padding:6px 12px;font-weight:700;color:var(--teal);font-size:12px;border-radius:4px;margin:10px 0 4px">${it.group}</div>`;lastGroup=it.group;}const bc=it.status==='ok'?'badge-green':'badge-red';const bt=it.status==='ok'?'OK':'NG';itemsHtml+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.03);font-size:13px"><span style="color:var(--text2)">— ${it.item}</span><span class="badge ${bc}">${bt}</span></div>`;});
  document.getElementById('ins-modal-body').innerHTML=`<div class="pm-stat-row"><div class="pm-stat-mini"><div class="val" style="color:var(--accent)">${total}</div><div class="lbl">รายการ</div></div><div class="pm-stat-mini"><div class="val" style="color:var(--green)">${h.checklist.ok}</div><div class="lbl">OK</div></div><div class="pm-stat-mini"><div class="val" style="color:var(--red)">${h.checklist.ng}</div><div class="lbl">NG</div></div></div><div class="pm-detail-info-grid"><div><span class="lbl">วันที่:</span> ${h.date}</div><div><span class="lbl">กะ:</span> ${h.shift||'-'}</div><div><span class="lbl">ผู้ตรวจ:</span> ${h.inspector}</div><div><span class="lbl">สภาพรวม:</span> <span class="badge ${OC[h.overall]||'badge-green'}">${OL[h.overall]||h.overall}</span></div></div><div style="border:1px solid var(--border);border-radius:var(--r-sm);overflow:hidden">${itemsHtml}</div>`;
  openModal('ins-pm-detail-modal');
}

// ============================================================
// MISC / FILE UPLOAD
// ============================================================
function triggerFileInput(id){document.getElementById(id)?.click();}
function previewUploadedFile(input, thumbGridId) {
  const files = Array.from(input.files);
  if (!files.length) return;
  const tg = document.getElementById(thumbGridId);

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      uploadedFilesBase64.push(e.target.result);
      if (tg) {
        const idx = uploadedFilesBase64.length - 1;
        const wrapper = document.createElement('div');
        wrapper.className = 'thumb-wrapper';
        wrapper.innerHTML = `<img src="${e.target.result}">
          <button type="button" class="thumb-remove"
            onclick="removeUploadedFile(${idx},'${thumbGridId}',this)"><i class="ion-ios-close"></i></button>`;
        tg.appendChild(wrapper);
      }
    };
    reader.readAsDataURL(file);
  });
}

function removeUploadedFile(idx, thumbGridId, btn) {
  uploadedFilesBase64.splice(idx, 1);
  btn.closest('.thumb-wrapper').remove();
}

function clearUploadPreview(thumbGridId) {
  uploadedFilesBase64 = [];
  const tg = document.getElementById(thumbGridId);
  if (tg) tg.innerHTML = '';
}
function resetForm(formId,thumbGridId){const f=document.getElementById(formId);if(f)f.reset();clearUploadPreview(thumbGridId);}
function copyJobIdToClipboard(){const id=document.getElementById('success-job-id')?.textContent;if(id&&navigator.clipboard)navigator.clipboard.writeText(id).then(()=>showToast('คัดลอกรหัสงานแล้ว!','success'));}
function showSuccessModal(jobID){const el=document.getElementById('success-job-id');if(el)el.textContent=jobID;openModal('success-modal');}

// ============================================================
// REGISTER — Avatar Upload
// ============================================================
let regAvatarBase64 = '';

function previewRegAvatar(input) {
  const file = input.files[0];
  if (!file) return;

  // validate size (2MB)
  if (file.size > 2 * 1024 * 1024) {
    showToast('รูปภาพต้องมีขนาดไม่เกิน 2MB', 'warning');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    regAvatarBase64 = e.target.result;

    // แสดง preview วงกลม
    const preview = document.getElementById('reg-avatar-preview');
    const icon    = document.getElementById('reg-avatar-icon');
    const img     = document.getElementById('reg-avatar-img');
    const clearBtn = document.getElementById('reg-avatar-clear-btn');
    const filename = document.getElementById('reg-avatar-filename');

    if (img)   { img.src = regAvatarBase64; img.style.display = 'block'; }
    if (icon)  { icon.style.display = 'none'; }
    if (preview) { preview.style.border = '2px solid #f97316'; }
    if (clearBtn){ clearBtn.style.display = 'inline-flex'; }
    if (filename){ filename.textContent = file.name; }
  };
  reader.readAsDataURL(file);
}

function clearRegAvatar() {
  regAvatarBase64 = '';

  const preview  = document.getElementById('reg-avatar-preview');
  const icon     = document.getElementById('reg-avatar-icon');
  const img      = document.getElementById('reg-avatar-img');
  const clearBtn = document.getElementById('reg-avatar-clear-btn');
  const filename = document.getElementById('reg-avatar-filename');
  const fileInput = document.getElementById('reg-avatar-file');

  if (img)    { img.src = ''; img.style.display = 'none'; }
  if (icon)   { icon.style.display = ''; }
  if (preview){ preview.style.border = '2px dashed #cbd5e1'; }
  if (clearBtn){ clearBtn.style.display = 'none'; }
  if (filename){ filename.textContent = ''; }
  if (fileInput){ fileInput.value = ''; }
}

// ============================================================
// TE PANEL (Technician + Engineer รวมกัน)
// ============================================================
let teCalY, teCalM, teCalSel = null;

function initTEPanel() {
  ME = currentUser.name;
  myIdentifiedName = sessionStorage.getItem('identified_tech_' + currentUser.username) || null;
  loadTechProfilesIfShared().then(refreshIdentifyBadge);
  const avatarEl = document.getElementById('te-avatar-initials');
  if (currentUser.avatar && currentUser.avatar.length > 10) {
    avatarEl.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  } else {
    avatarEl.textContent = (ME || '--').slice(0, 2);
  }
  document.getElementById('te-display-name').textContent = myIdentifiedName || ME;
  const now = new Date();
  if (!teCalY) { teCalY = now.getFullYear(); teCalM = now.getMonth(); }
  teUpdateStats();
  teSw('jobs', document.getElementById('te-t-jobs'));
}

// ── แสดง/ซ่อนปุ่ม "ระบุตัวตน" ตามว่าเป็นบัญชีกลางหรือไม่ ──
function refreshIdentifyBadge() {
  const btn = document.getElementById('te-identify-btn');
  if (!btn) return;
  if (TECH_PROFILES.length > 0) {
    btn.style.display = 'inline-flex';
    btn.innerHTML = myIdentifiedName
      ? `<i class="ion-ios-person"></i> ${myIdentifiedName}`
      : `<i class="ion-ios-contact"></i> ระบุตัวตน`;
  } else {
    btn.style.display = 'none';
  }
}

function openTechIdentifySelf() {
  _pendingAcceptJobId = null; // ไม่ใช่ flow รับงาน — แค่ยืนยันตัวตนล่วงหน้า
  openTechIdentifyModal();
}
function teUpdateStats() {
  const jobs   = getRepairJobsData();
  const pmList = getPMData();
  const waiting = jobs.filter(j => j.status === 'รอซ่อม').length;
  const mine    = jobs.filter(j => j.status === 'กำลังซ่อม' && j.technician === (myIdentifiedName || ME)).length;
  const qcJobs  = jobs.filter(j => j.status === 'ซ่อมเสร็จแล้ว').length;
  const pmPend  = pmList.filter(p => p.status !== 'เสร็จแล้ว').length;
  const sv = id => document.getElementById(id);
  if(sv('te-stat-wait'))   sv('te-stat-wait').textContent   = waiting;
  if(sv('te-stat-mine'))   sv('te-stat-mine').textContent   = mine;
  if(sv('te-stat-qc'))     sv('te-stat-qc').textContent     = qcJobs;
  if(sv('te-badge-queue')) sv('te-badge-queue').textContent = waiting;
  if(sv('te-badge-jobs'))  sv('te-badge-jobs').textContent  = waiting;
  if(sv('te-badge-mine'))  sv('te-badge-mine').textContent  = mine;
  if(sv('te-badge-qc'))    sv('te-badge-qc').textContent    = qcJobs;
  if(sv('te-badge-pm'))    sv('te-badge-pm').textContent    = pmPend;
}

let teJobsSub = 'queue';
let tePmSub   = 'list';

function teSw(tab, btn) {
  document.querySelectorAll('.te-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.te-sec').forEach(s => s.style.display = 'none');
  btn.classList.add('active');
  document.getElementById('te-v-' + tab).style.display = 'block';
  if (tab === 'jobs')  teSwJobs(teJobsSub);
  if (tab === 'pm')    teSwPM(tePmSub);
  if (tab === 'hist')  teRenderHist();
  if (tab === 'daily') teRenderDailyPM();
}

function teSwJobs(sub) {
  teJobsSub = sub;
  document.getElementById('te-sub-queue').classList.toggle('active', sub === 'queue');
  document.getElementById('te-sub-mine').classList.toggle('active', sub === 'mine');
  document.getElementById('te-v-queue').style.display = sub === 'queue' ? 'block' : 'none';
  document.getElementById('te-v-mine').style.display  = sub === 'mine'  ? 'block' : 'none';
  if (sub === 'queue') teRenderQueue(); else teRenderMine();
}

function teSwPM(sub) {
  tePmSub = sub;
  document.getElementById('te-sub-pmlist').classList.toggle('active', sub === 'list');
  document.getElementById('te-sub-pmcal').classList.toggle('active', sub === 'cal');
  document.getElementById('te-v-pmlist').style.display = sub === 'list' ? 'block' : 'none';
  document.getElementById('te-v-pmcal').style.display  = sub === 'cal'  ? 'block' : 'none';
  if (sub === 'list') teRenderPMTable(); else teRenderCal();
}

function teRenderQueue() {
  const el   = document.getElementById('te-v-queue');
  const jobs = getRepairJobsData().filter(j => j.status === 'รอซ่อม');
  if (!jobs.length) { el.innerHTML = `<div class="tp-sdiv">งานรอซ่อม</div><div class="tp-empty"><i class="ion-ios-archive"></i> ไม่มีงานรอซ่อมขณะนี้</div>`; return; }
  el.innerHTML = `<div class="tp-sdiv">งานรอซ่อมทั้งหมด • ${jobs.length} รายการ</div>` +
    jobs.map(j => tpJobCardHTML(mapJobToTechPanel(j), 'queue')).join('');
}

function teRenderMine() {
  const el   = document.getElementById('te-v-mine');
  const jobs = getRepairJobsData().filter(j => j.technician === (myIdentifiedName || ME) && j.status !== 'รอซ่อม');
  if (!jobs.length) { el.innerHTML = `<div class="tp-sdiv">งานที่รับไว้</div><div class="tp-empty"><i class="ion-ios-archive"></i> ยังไม่มีงานที่รับไว้</div>`; return; }
  el.innerHTML = `<div class="tp-sdiv">งานที่รับไว้ • ${jobs.length} รายการ</div>` +
    jobs.map(j => tpJobCardHTML(mapJobToTechPanel(j), 'mine')).join('');
}

function teRenderQC() {
  const el       = document.getElementById('te-v-qc');
  const qcJobs   = getRepairJobsData().filter(j => j.status === 'ซ่อมเสร็จแล้ว');
  const doneJobs = getRepairJobsData().filter(j => j.qcResult && j.qcResult !== '' && j.qcResult !== 'รอ QC' && j.status !== 'ซ่อมเสร็จแล้ว');

  const cardHTML = (j, isDone) => `
    <div class="qc-card" style="border-left:3px solid ${isDone ? 'var(--border)' : 'var(--teal)'}">
      <div class="qc-card-top">
        <span class="qc-card-id">${j.id}</span>
        <span class="qc-urgency ${isDone ? 'normal' : 'high'}">${isDone ? (j.qcResult||'เสร็จ') : 'รอ QC'}</span>
      </div>
      <div class="qc-card-machine">${j.machine}</div>
      <div class="qc-card-tech"><i class="ion-ios-construct"></i> ${j.technician||'—'} · ${j.doneDate||j.date}</div>
      <div class="qc-card-meta">
        <span class="qc-meta-tag">${j.dept||''}</span>
        <span class="qc-meta-tag">${(j.side||'').split(' ')[0]}</span>
      </div>
      <div class="qc-card-actions">
        <button class="qc-btn-detail" onclick="viewJobDetail('${j.id}')"><i class="ion-ios-eye"></i> ดูรายละเอียด</button>
        ${!isDone ? `<button class="qc-btn-do" onclick="viewJobDetail('${j.id}')"><i class="ion-ios-checkmark-circle"></i> ทำ QC</button>` : ''}
      </div>
    </div>`;

  el.innerHTML = `
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.6px">รอ QC • ${qcJobs.length} รายการ</div>
    <div class="qc-grid">${qcJobs.map(j => cardHTML(j,false)).join('') || '<div style="color:var(--text3);padding:1rem;font-size:13px"><i class="ion-ios-archive"></i> ไม่มีงานรอ QC</div>'}</div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="font-size:11px;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.6px">QC แล้ว • ${doneJobs.length} รายการ</div>
      <div class="qc-grid">${doneJobs.map(j => cardHTML(j,true)).join('') || '<div style="color:var(--text3);padding:1rem;font-size:13px">ยังไม่มีประวัติ</div>'}</div>
    </div>`;
}

function teRenderPMTable() {
  const el = document.getElementById('te-v-pmlist');
  const q  = (document.getElementById('te-pm-search')?.value || '').toLowerCase();
  const sf = document.getElementById('te-pm-status')?.value || '';
  const filtered = getPMData().filter(p =>
    (p.machine.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)) && (!sf || p.status === sf));
  const stCls = {รอดำเนินการ:'sp-pend',กำลังดำเนินการ:'sp-prog',เสร็จแล้ว:'sp-done',เกินกำหนด:'sp-over'};
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input class="tp-sinp" id="te-pm-search" placeholder="🔍 ค้นหาเครื่องจักร..." oninput="teRenderPMTable()" value="${q}">
      <select class="tp-ssel" id="te-pm-status" onchange="teRenderPMTable()">
        <option value="" ${!sf?'selected':''}>ทุกสถานะ</option>
        <option ${sf==='รอดำเนินการ'?'selected':''}>รอดำเนินการ</option>
        <option ${sf==='กำลังดำเนินการ'?'selected':''}>กำลังดำเนินการ</option>
        <option ${sf==='เสร็จแล้ว'?'selected':''}>เสร็จแล้ว</option>
        <option ${sf==='เกินกำหนด'?'selected':''}>เกินกำหนด</option>
      </select>
    </div>
    ${filtered.length ? filtered.map(p => `
      <div class="tp-pcard${p.status==='เกินกำหนด'?' ov':''}">
        <div class="tp-pcleft">
          <div class="tp-pmach">${p.machine}</div>
          <div class="tp-ptype">${p.title} <span class="tp-pfreq">${p.type}</span></div>
          <div class="tp-pdate"><i class="ion-ios-calendar"></i> ${tpFmtThai(p.date)}</div>
        </div>
        <div class="tp-pcright">
          <span class="tp-ppill ${tpStClass[p.status]||'pend'}">${p.status}</span>
          ${p.status==='เสร็จแล้ว'
            ? `<span style="font-size:10px;color:var(--green)"><i class="ion-ios-checkmark-circle"></i> เสร็จสิ้น</span>`
            : `<button class="tp-pcbtn" onclick="tpOpenPMChecklistModal('${p.id}')"><i class="ion-ios-checkmark-circle"></i> ตรวจเช็ก</button>`}
        </div>
      </div>`).join('')
    : `<div class="tp-pm-empty"><i class="ion-ios-archive"></i> ไม่พบรายการ</div>`}`;
}

function teRenderCal() {
  document.getElementById('te-cal-title').textContent = monthsThai[teCalM] + ' ' + (teCalY + 543);
  const fd = new Date(teCalY,teCalM,1).getDay(), nd = new Date(teCalY,teCalM+1,0).getDate(), pd = new Date(teCalY,teCalM,0).getDate();
  const todayStr = tpFmt(new Date()), total = Math.ceil((fd+nd)/7)*7;
  const grid = document.getElementById('te-cal-days'); grid.innerHTML = '';
  const pmList = getPMData();
  for (let i = 0; i < total; i++) {
    let dn, other = false, ds = '';
    if (i < fd) { dn = pd-fd+1+i; other = true; }
    else if (i >= fd+nd) { dn = i-fd-nd+1; other = true; }
    else { dn = i-fd+1; ds = `${teCalY}-${String(teCalM+1).padStart(2,'0')}-${String(dn).padStart(2,'0')}`; }
    const evts = ds ? pmList.filter(p => p.date === ds) : [];
    const cell = document.createElement('div');
    cell.className = `tp-cal-day${other?' other':''}${ds&&ds===teCalSel?' selected':''}`;
    if (ds) cell.onclick = () => teCalClick(ds);
    let evHtml = '';
    evts.slice(0,3).forEach(e => { evHtml += `<div class="tp-ev-pill ${tpStClass[e.status]||'pend'}">${e.machine}</div>`; });
    if (evts.length > 3) evHtml += `<div class="tp-ev-more">+${evts.length-3}</div>`;
    cell.innerHTML = `<div class="tp-day-num${ds===todayStr?' today':''}">${dn}</div><div class="tp-ev-wrap">${evHtml}</div>`;
    grid.appendChild(cell);
  }
}

function teCalClick(ds) { teCalSel = ds; teRenderCal(); teShowDayDetail(ds); }
function teShowDayDetail(ds) {
  const evts = getPMData().filter(p => p.date === ds);
  document.getElementById('te-day-nav').style.display = 'flex';
  document.getElementById('te-day-nav-lbl').textContent = tpFmtThai(ds);
  const det = document.getElementById('te-day-detail'); det.style.display = 'block';
  if (!evts.length) { det.innerHTML = `<div class="tp-det-card"><div class="tp-no-ev"><i class="ion-ios-archive"></i> ไม่มีกำหนดการ PM</div></div>`; return; }
  det.innerHTML = `<div class="tp-det-card"><div class="tp-det-hdr"><i class="ion-ios-calendar"></i> PM ${tpFmtThai(ds)} — ${evts.length} รายการ</div>` +
    evts.map(e => `<div class="tp-det-row">
      <div><div class="tp-dr-machine">${e.machine}</div><div class="tp-dr-sub">${e.title} · ${e.type}</div></div>
      <div class="tp-dr-right">
        <span class="tp-dpill ${tpStClass[e.status]||'pend'}">${e.status}</span>
        ${e.status==='เสร็จแล้ว'
          ? `<span class="tp-dbtn-done"><i class="ion-ios-checkmark-circle"></i> เสร็จ</span>`
          : `<button class="tp-dbtn" onclick="tpOpenPMChecklistModal('${e.id}')">ตรวจเช็ก</button>`}
      </div>
    </div>`).join('') + '</div>';
}
function teCalClear() { teCalSel=null; document.getElementById('te-day-nav').style.display='none'; document.getElementById('te-day-detail').style.display='none'; teRenderCal(); }
function teShiftMonth(d) { teCalM+=d; if(teCalM>11){teCalM=0;teCalY++;}else if(teCalM<0){teCalM=11;teCalY--;} teCalClear(); }
function teShiftDay(d) {
  if (!teCalSel) return;
  const [y,m,dd] = teCalSel.split('-').map(Number); const c = new Date(y,m-1,dd); c.setDate(c.getDate()+d);
  teCalM=c.getMonth(); teCalY=c.getFullYear(); teCalSel=tpFmt(c); teRenderCal(); teShowDayDetail(teCalSel);
}
function teCalToday() { const t=new Date(); teCalM=t.getMonth(); teCalY=t.getFullYear(); teCalSel=tpFmt(t); teRenderCal(); teShowDayDetail(teCalSel); }

function teRenderHist() {
  const q    = (document.getElementById('te-hist-search')?.value || '').toLowerCase();
  const cond = document.getElementById('te-hist-cond')?.value || '';
  const condMap  = {pass:'ปกติ', warn:'เฝ้าระวัง', fail:'ผิดปกติ'};
  const condPill = {
    ปกติ:     '<span class="rpill pass">ปกติ</span>',
    เฝ้าระวัง:'<span class="rpill warn">เฝ้าระวัง</span>',
    ผิดปกติ:  '<span class="rpill fail">ผิดปกติ</span>',
  };
  const rows = getPMHistoryData().filter(h => {
    const c = condMap[h.result] || h.result || 'ปกติ';
    if (cond && c !== cond) return false;
    if (q && !h.equip.toLowerCase().includes(q) && !h.pmCode.toLowerCase().includes(q)) return false;
    return true;
  });
  const el = document.getElementById('te-v-hist');
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input class="tp-sinp" id="te-hist-search" placeholder="🔍 ค้นหาเครื่องจักร / รหัส PM..." oninput="teRenderHist()" value="${q}">
      <select class="tp-ssel" id="te-hist-cond" onchange="teRenderHist()">
        <option value="" ${!cond?'selected':''}>สภาพรวมทั้งหมด</option>
        <option value="pass" ${cond==='pass'?'selected':''}>ปกติ</option>
        <option value="warn" ${cond==='warn'?'selected':''}>เฝ้าระวัง</option>
        <option value="fail" ${cond==='fail'?'selected':''}>ผิดปกติ</option>
      </select>
    </div>
    ${rows.length ? rows.map((h,i) => `
      <div class="tp-pcard">
        <div class="tp-pcleft">
          <div class="tp-pmach">${h.equip}</div>
          <div style="font-size:10px;color:var(--text2);font-family:var(--font-mono)">${h.pmCode}</div>
          <div class="tp-pdate"><i class="ion-ios-calendar"></i> ${h.date} · <i class="ion-ios-person"></i> ${h.tech}</div>
        </div>
        <div class="tp-pcright">
          ${condPill[condMap[h.result]||h.result] || condPill['ปกติ']}
          <button class="tp-pcbtn" onclick="viewPMDoc('${h.pmCode}',${i})"><i class="ion-ios-document"></i> ดู</button>
        </div>
      </div>`).join('')
    : `<div class="tp-pm-empty"><i class="ion-ios-archive"></i> ไม่พบรายการ</div>`}`;
}

function teRenderDailyPM() {
  const el      = document.getElementById('te-v-daily');
  const search  = (document.getElementById('te-daily-search')?.value || '').toLowerCase();
  const statusF = document.getElementById('te-daily-status')?.value || '';
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input class="tp-sinp" id="te-daily-search" placeholder="🔍 ค้นหาเครื่องจักร / ผู้ตรวจ..." oninput="teRenderDailyPM()" value="${search}">
      <select class="tp-ssel" id="te-daily-status" onchange="teRenderDailyPM()">
        <option value="" ${!statusF?'selected':''}>ทั้งหมด</option>
        <option value="pending" ${statusF==='pending'?'selected':''}>รอรับทราบ</option>
        <option value="acked"   ${statusF==='acked'?'selected':''}>รับทราบแล้ว</option>
      </select>
    </div>
    <div id="te-daily-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      <div style="color:var(--text3);text-align:center;padding:2rem;grid-column:1/-1">กำลังโหลด...</div>
    </div>`;

  if (isLocalMode) {
    document.getElementById('te-daily-grid').innerHTML =
      '<div style="color:var(--text3);text-align:center;padding:2rem;grid-column:1/-1"><i class="ion-ios-archive"></i> ไม่มีข้อมูล Daily PM ใน Local Mode</div>';
    return;
  }

 fetch(`${API_URL}/daily-pm`)
  .then(r => r.json())
  .then(function(data) {
    let list = (data.dailyPMHistory || []).filter(h => {
      const ms = !search || (h.machine||'').toLowerCase().includes(search) || (h.inspector||'').toLowerCase().includes(search);
      const mf = !statusF || (statusF==='pending' && h.engStatus!=='รับทราบแล้ว') || (statusF==='acked' && h.engStatus==='รับทราบแล้ว');
      return ms && mf;
    });
    const grid = document.getElementById('te-daily-grid'); if (!grid) return;
    if (!list.length) { grid.innerHTML = '<div style="color:var(--text3);text-align:center;padding:2rem;grid-column:1/-1"><i class="ion-ios-archive"></i> ไม่พบรายการ</div>'; return; }
    const OL = {pass:'ปกติ', warn:'ต้องติดตาม', fail:'ชำรุด'};
    const OC = {pass:'var(--green)', warn:'var(--yellow)', fail:'var(--red)'};
    grid.innerHTML = list.map(h => {
      const acked = h.engStatus === 'รับทราบแล้ว';
      return `<div style="background:var(--surface);border:1px solid ${acked?'var(--border)':'var(--teal)'};border-radius:var(--r);padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
          <div style="font-size:10px;font-family:var(--font-mono);color:var(--accent)">${h.code}</div>
          <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:${acked?'var(--green-bg)':'rgba(20,184,166,.15)'};color:${acked?'var(--green)':'var(--teal)'}">
            ${acked?'<i class="ion-ios-checkmark-circle"></i> รับทราบแล้ว':'⏳ รอรับทราบ'}
          </span>
        </div>
        <div style="font-weight:700;font-size:14px;margin-bottom:2px">${h.machine||'-'}</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px"><i class="ion-ios-business"></i> ${h.productionLine||'-'} · <i class="ion-ios-person"></i> ${h.inspector||'-'}</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:10px"><i class="ion-ios-calendar"></i> ${h.date} ${h.time}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;font-weight:600;color:${OC[h.result]||'var(--text)'}">● ${OL[h.result]||h.result}</span>
          ${acked
            ? `<span style="font-size:11px;color:var(--text2)">${h.engBy||''}</span>`
            : `<button class="btn btn-accent" style="padding:5px 12px;font-size:11px" onclick="teAckDailyPM('${h.code}')">รับทราบ</button>`}
        </div>
      </div>`;
    }).join('');
 })
  .catch(() => {
    const grid = document.getElementById('te-daily-grid');
    if (grid) grid.innerHTML = '<div style="color:var(--text3);text-align:center;padding:2rem;grid-column:1/-1"><i class="ion-ios-close-circle"></i> โหลดข้อมูลไม่สำเร็จ</div>';
  });
}

function teAckDailyPM(code) {
  if (isLocalMode) { showToast('Local Mode', 'warning'); return; }
  showLoading('กำลังบันทึก...');
  authFetch(`${API_URL}/daily-pm/${encodeURIComponent(code)}/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ by: currentUser.name })
  })
  .then(r => r.json())
  .then(res => {
    hideLoading();
    if (res.success) { showToast('รับทราบสำเร็จ','success'); teRenderDailyPM(); }
    else showToast('เกิดข้อผิดพลาด','error');
  })
  .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
}
// ============================================================
// SUBMIT REPAIR FORM
// ============================================================
function submitRepairForm(event) {
  event.preventDefault();
  const formData = {
    requester: currentUser ? currentUser.name : document.getElementById('rep-requester').value,
    dept:    document.getElementById('rep-dept').value,
    line:    document.getElementById('rep-line').value,
    machine: getMachineValue('rep-machine'),
    side:    document.getElementById('rep-side').value,
    op_type: document.getElementById('rep-type').value,
    detail:  document.getElementById('rep-detail').value,
   img: uploadedFilesBase64 || []
  };

  // ── GAS Mode ──
  if (!isLocalMode) {
    showLoading('กำลังส่งใบแจ้งซ่อม...');
    authFetch(`${API_URL}/repairs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
      if (res.success) {
        showSuccessModal(res.jobId);
        resetForm('repair-request-form', 'rep-thumb-grid');
        loadAllData();
      } else {
        showToast('เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
      }
    })
    .catch(() => { hideLoading(); showToast('เกิดข้อผิดพลาด', 'error'); });
    return; // ← สำคัญมาก! หยุดตรงนี้
  }

  // ── Local Mode ──
  const deptMapLocal = {
    'ออฟฟิศ': 'OFC', 'PDB': 'PDB', 'PDF': 'PDF',
    'วิศวกรรม': 'ENG', 'คลังสินค้า11': 'WH11',
    'คลังสินค้า12': 'WH12', 'คลังสินค้า14': 'WH14',
    'คลังสินค้า17': 'WH17'
  };
  let prefix = 'OTH';
  Object.keys(deptMapLocal).forEach(function(k) {
    if ((formData.dept || '').indexOf(k) > -1) prefix = deptMapLocal[k];
  });
  const now  = new Date();
  const yy   = String(now.getFullYear()).slice(2);
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const hhmm = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  const monthKey = prefix + ' ' + yy + '/' + mm;
  const count = localRepairs.filter(j => String(j.id).indexOf(monthKey) === 0).length;
  const seq   = String(count + 1).padStart(3, '0');
  const jobID = `${prefix}(${seq}) ${yy}${mm}${dd} ${hhmm}`;

  localRepairs.unshift({
    id: jobID,
    date: `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}, ${now.toLocaleTimeString('th-TH')}`,
    name: formData.requester, dept: formData.dept,
    machine: formData.machine, side: formData.side,
    opType: formData.op_type, detail: formData.detail,
    img: uploadedFilesBase64 || [], imgAfter: '',
    status: 'รอซ่อม', technician: '', doneDate: '',
    planStopDate: '', eta: '', note: '', qcResult: '',
    qcBy: '', slaScore: '', hoursOpen: 0
  });

  showSuccessModal(jobID);
  resetForm('repair-request-form', 'rep-thumb-grid');
  uploadedFileBase64 = '';
}

// ============================================================
// USER QC PANEL  ← ย้ายออกมาอยู่นอก submitRepairForm แล้ว
// ============================================================
function renderUserQCPanel() {
  const grid = document.getElementById('user-qc-grid');
  if (!grid) return;

  const myJobs = getRepairJobsData().filter(j =>
    j.status === 'ซ่อมเสร็จแล้ว' &&
    (j.name === currentUser.name || j.requester === currentUser.name)
  );

  if (!myJobs.length) {
    grid.innerHTML = '<div style="color:var(--text3);text-align:center;padding:2rem;grid-column:1/-1"><i class="ion-ios-archive"></i> ไม่มีงานรอตรวจรับขณะนี้</div>';
    return;
  }
grid.innerHTML = myJobs.map(j => `
    <div class="qc-card" style="border-left:3px solid var(--teal)">
      <div class="qc-card-top">
        <span class="qc-card-id">${j.id}</span>
        <span class="qc-urgency normal">รอตรวจรับ</span>
      </div>
      <div class="qc-card-machine">${j.machine}</div>
      <div class="qc-card-tech"><i class="ion-ios-construct"></i> ${j.technician||'—'} · เสร็จ ${j.doneDate||j.date||'—'}</div>
      <div class="qc-card-meta">
        <span class="qc-meta-tag">${j.dept||''}</span>
        <span class="qc-meta-tag">${(j.side||'').split(' ')[0]}</span>
      </div>
      ${(() => {
        let imgs = [];
        try { imgs = JSON.parse(j.imgAfter || '[]'); } catch(e) { imgs = []; }
        return imgs.map(src =>
          '<img src="' + src + '" style="width:100%;border-radius:8px;margin:8px 0;object-fit:cover;max-height:160px" onerror="this.style.display=\'none\'">'
        ).join('');
      })()}
      <div class="qc-card-actions">
        <button class="qc-btn-detail" onclick="viewJobDetail('${j.id}')"><i class="ion-ios-eye"></i> ดูรายละเอียด</button>
        <button class="qc-btn-do"     onclick="viewJobDetail('${j.id}')"><i class="ion-ios-checkmark-circle"></i> ตรวจรับงาน</button>
      </div>
    </div>`).join('');
}
// ============================================================
// TECH PROFILE IDENTIFY (บัญชี login ร่วม + เลือกชื่อ + รหัสพนักงาน)
// ============================================================
// TECH_PROFILES จะมีข้อมูลก็ต่อเมื่อบัญชี login นี้ถูกตั้งเป็นบัญชีกลาง
// (แอดมินเพิ่มโปรไฟล์ช่างไว้ใน TechProfiles sheet) — ถ้าเป็นบัญชีส่วนตัว
// ของแต่ละคนตามปกติ ลิสต์นี้จะว่าง แล้วระบบจะรับงานด้วยชื่อบัญชี (ME) ตามเดิม
let TECH_PROFILES = [];
let _pendingAcceptJobId = null;

async function loadTechProfilesIfShared() {
  if (!currentUser?.username) { TECH_PROFILES = []; return; }
  try {
    const res = await fetch(`${API_URL}/tech-profiles?account=${encodeURIComponent(currentUser.username)}`)
      .then(r => r.json());
    TECH_PROFILES = (res.success && Array.isArray(res.data)) ? res.data : [];
  } catch (err) {
    console.error('[loadTechProfilesIfShared] error:', err.message);
    TECH_PROFILES = [];
  }
}

function openTechIdentifyModal() {
  const sel = document.getElementById('tim-profile-select');
  if (sel) {
    sel.innerHTML = '<option value="">— เลือกชื่อของคุณ —</option>' +
      TECH_PROFILES.map(p => `<option value="${p.id}">${p.fullname}</option>`).join('');
  }
  const codeInput = document.getElementById('tim-employee-code');
  if (codeInput) codeInput.value = '';
  const errEl = document.getElementById('tim-error');
  if (errEl) errEl.style.display = 'none';
  openModal('tech-id-modal');
}

function closeTechIdentifyModal() {
  closeModal('tech-id-modal');
  _pendingAcceptJobId = null;
}
async function submitTechIdentify() {
  const id   = document.getElementById('tim-profile-select')?.value || '';
  const code = document.getElementById('tim-employee-code')?.value.trim() || '';
  const errEl = document.getElementById('tim-error');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
  if (errEl) errEl.style.display = 'none';

  if (!id)   return showErr('กรุณาเลือกชื่อของคุณ');
  if (!code) return showErr('กรุณากรอกรหัสพนักงาน');

  const btn = document.getElementById('tim-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/tech-profiles/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, employee_code: code }),
    }).then(r => r.json());

    if (!res.success) { showErr(res.message || 'ยืนยันตัวตนไม่สำเร็จ'); return; }

    // ── บันทึกตัวตนที่ยืนยันแล้ว จำไว้ตลอด session แม้ refresh หน้า ──
    myIdentifiedName = res.profile.fullname;
    sessionStorage.setItem('identified_tech_' + currentUser.username, myIdentifiedName);

   const jobId = _pendingAcceptJobId;
    closeTechIdentifyModal();
    const nameDisp = document.getElementById('te-display-name');
    if (nameDisp) nameDisp.textContent = myIdentifiedName;
    refreshIdentifyBadge();
    if (jobId) {
      doAcceptJob(jobId, myIdentifiedName);
    } else {
      // กรณี identify เฉยๆ ไม่ได้มาจากการรับงาน
      showToast(`ยืนยันตัวตนสำเร็จ — ${myIdentifiedName}`, 'success');
      teUpdateStats(); teRenderMine();
    }
  } catch (err) {
    showErr('เชื่อมต่อ server ไม่ได้ กรุณาลองใหม่อีกครั้ง');
  } finally {
    if (btn) btn.disabled = false;
  }
}
// ============================================================
// ACCEPT JOB
// ============================================================
// ทางเข้าเดิมทั้งหมด (การ์ดคิวงาน, list มือถือ, modal รายละเอียดงาน) เรียกฟังก์ชันนี้
// ถ้าเป็นบัญชีกลางที่มีหลายโปรไฟล์ → เด้งให้เลือกชื่อ+กรอกรหัสก่อน ถึงจะรับงานจริง
// ถ้าเป็นบัญชีส่วนตัวปกติ (ไม่มีโปรไฟล์) → รับงานทันทีด้วยชื่อบัญชีเหมือนเดิม
function tpAcceptJob(id) {
  if (TECH_PROFILES.length > 0) {
    _pendingAcceptJobId = id;
    openTechIdentifyModal();
    return;
  }
  doAcceptJob(id, ME);
}

function doAcceptJob(id, technicianName) {
  const j = getRepairJobsData().find(j => j.id === id);
  if (!j) return;

  if (!isLocalMode) {
    showLoading('กำลังรับงาน...');
    authFetch(`${API_URL}/repairs/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ technician: technicianName })
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
      if (res.success) {
        j.status = 'กำลังซ่อม';
        j.technician = technicianName;
        showToast(`<i class="ion-ios-hand"></i> รับงาน ${j.machine} สำเร็จ`, 'success');
        teUpdateStats(); teRenderQueue(); teRenderMine();
        tpUpdateStats(); tpRenderQueue(); tpRenderMine();
      } else {
        showToast('เกิดข้อผิดพลาด: ' + (res.message || ''), 'error');
      }
    })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้', 'error'); });
    return;
  }

  // Local Mode
  j.status = 'กำลังซ่อม';
  j.technician = technicianName;
  showToast(`<i class="ion-ios-hand"></i> รับงาน ${j.machine} สำเร็จ`, 'success');
  teUpdateStats(); teRenderQueue(); teRenderMine();
  tpUpdateStats(); tpRenderQueue(); tpRenderMine();
}
function populateDeptDropdown(departments) {
  // reg-dept เป็น <select> ให้เลือกตอนสมัครสมาชิก
  const regEl = document.querySelector('#reg-dept');
  if (regEl) {
    regEl.innerHTML = '<option value="">เลือกแผนก</option>';
    (departments || []).forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      regEl.appendChild(opt);
    });
  }

  // track-filter-dept ดึงรายชื่อแผนกจริงจาก sheet
  const filterEl = document.getElementById('track-filter-dept');
  if (filterEl) {
    filterEl.innerHTML = '<option value="">ทุกแผนก</option>';
    (departments || []).forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      filterEl.appendChild(opt);
    });
  }

  // rep-dept เป็น <input readonly> ใส่ค่าจาก currentUser ตรงๆ
  const repEl = document.getElementById('rep-dept');
  if (repEl && currentUser) repEl.value = currentUser.dept || '';

  // admin-filter-dept-rep ดึงรายชื่อแผนกจริงจาก sheet (ใช้กรองในหน้า "จัดการใบแจ้งซ่อม")
  const adminDeptEl = document.getElementById('admin-filter-dept-rep');
  if (adminDeptEl) {
    adminDeptEl.innerHTML = '<option value="">ทุกแผนก</option>';
    (departments || []).forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      adminDeptEl.appendChild(opt);
    });
  }
}

function populateLineDropdown(lines) {
  const selectors = ['#ins-pm-line', '#chk-pm-line', '#rep-line'];
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.innerHTML = '<option value="">เลือกสถานที่ปฏิบัติงาน</option>';
    (lines || []).forEach(line => {
      const opt = document.createElement('option');
      opt.value = line;
      opt.textContent = line;
      el.appendChild(opt);
    });
  });
}

function populateMachineDropdown(machines) {
 const selectors = ['#rep-machine', '#pmem-machine'];
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.innerHTML = '<option value="">เลือกเครื่องจักร</option>';
    (machines || []).forEach(machine => {
      const opt = document.createElement('option');
      opt.value = machine;
      opt.textContent = machine;
      el.appendChild(opt);
    });
    const otherOpt = document.createElement('option');
    otherOpt.value = '__OTHER__';
    otherOpt.textContent = 'อื่นๆ (โปรดระบุ)';
    el.appendChild(otherOpt);

    const id = sel.slice(1); // ตัด '#' ออก
    initSearchableSelect(id);
    if (el._sselRefresh) el._sselRefresh();
  });
}

function populateTechDropdown(technicians) {
  const selectors = ['#adm-job-tech', '#chk-pm-tech'];
  selectors.forEach(sel => {
    const el = document.getElementById(sel);
    if (!el) return;
    el.innerHTML = '<option value="">เลือกช่าง</option>';
    (technicians || []).forEach(tech => {
      const opt = document.createElement('option');
      opt.value = tech;
      opt.textContent = tech;
      el.appendChild(opt);
    });
  });
}

// เป็นแบบนี้
function loginWithLINE() {
  const clientId  = '2010534462';
  const redirectUri = encodeURIComponent('https://sfc-xrww.onrender.com/auth/line/callback');
  window.location.href =
    `https://access.line.me/oauth2/v2.1/authorize` +
    `?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${redirectUri}&state=login&scope=profile`;
}
async function dashConnectLINE() {
  if (!currentUser?.username) return showToast('ไม่พบข้อมูล username กรุณา login ใหม่', 'error');
  try {
    const r = await fetch('/api/users/line/auth-url?mode=popup').then(r => r.json());
    if (!r.url) return showToast('ไม่สามารถเชื่อมต่อ LINE ได้', 'error');

    const popup = window.open(r.url, 'line_auth_dash', 'width=520,height=680');
    const onMsg = async (e) => {
      if (e.data?.type !== 'LINE_AUTH_CODE') return;
      window.removeEventListener('message', onMsg);
      popup?.close();

      const cb = await fetch('/api/users/line/callback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: e.data.code }),
      }).then(r => r.json());

      if (cb.lineUserId) {
        const link = await fetch(`/api/users/${encodeURIComponent(currentUser.username)}/link-line`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lineUserId: cb.lineUserId }),
        }).then(r => r.json());
        if (link.success) showToast('เชื่อม LINE สำเร็จ!', 'success');
        else showToast(link.message || 'เชื่อมไม่สำเร็จ', 'error');
      } else if (cb.linked) {
        showToast('LINE นี้ผูกกับบัญชีอื่นอยู่แล้ว', 'error');
      }
    };
    window.addEventListener('message', onMsg);
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}
// เพิ่มฟังก์ชันใหม่ — สำหรับผูก LINE หลัง login แล้ว
function connectLINE() {
  if (!currentUser) { showToast('กรุณา login ก่อน', 'warning'); return; }
  const clientId    = '2010534462';
  const redirectUri = encodeURIComponent('https://sfc-xrww.onrender.com/auth/line/callback');
  const state       = encodeURIComponent('connect_' + currentUser.name);
  window.location.href =
    `https://access.line.me/oauth2/v2.1/authorize` +
    `?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${redirectUri}&state=${state}&scope=profile`;
}
// ============================================================
// MISSING FUNCTIONS — เพิ่มต่อท้าย scripts.js
// ============================================================

function viewJobDetail(id) {
  selectedJobForAction = id;
  const j = getRepairJobsData().find(x => x.id === id);
  if (!j) return;

  document.getElementById('jdm-title').textContent = `ใบแจ้งซ่อม — ${j.id}`;
  document.getElementById('jdm-spec-body').innerHTML = `
    <div class="spec-row"><span class="spec-lbl">JobID</span><span class="spec-val mono">${j.id}</span></div>
    <div class="spec-row"><span class="spec-lbl">วันที่แจ้ง</span><span class="spec-val">${j.date}</span></div>
    <div class="spec-row"><span class="spec-lbl">ผู้แจ้ง</span><span class="spec-val">${escapeHtml(j.name||j.requester||'-')}</span></div>
    <div class="spec-row"><span class="spec-lbl">แผนก</span><span class="spec-val">${j.dept||'-'}</span></div>
    <div class="spec-row"><span class="spec-lbl">เครื่องจักร</span><span class="spec-val">${escapeHtml(j.machine)}</span></div>
    <div class="spec-row"><span class="spec-lbl">ด้านปัญหา</span><span class="spec-val">${j.side||'-'}</span></div>
    <div class="spec-row"><span class="spec-lbl">ประเภทงาน</span><span class="spec-val">${j.opType||'-'}</span></div>
    <div class="spec-row"><span class="spec-lbl">รายละเอียด</span><span class="spec-val">${escapeHtml(j.detail||'-')}</span></div>
    <div class="spec-row"><span class="spec-lbl">ช่างซ่อม</span><span class="spec-val">${escapeHtml(j.technician||'ยังไม่ได้รับงาน')}</span></div>
    <div class="spec-row"><span class="spec-lbl">สถานะ</span><span class="spec-val">${j.status}</span></div>
    ${j.note ? `<div class="spec-row"><span class="spec-lbl">หมายเหตุ</span><span class="spec-val">${escapeHtml(j.note)}</span></div>` : ''}
    ${j.eta  ? `<div class="spec-row"><span class="spec-lbl">ETA</span><span class="spec-val">${j.eta}</span></div>`  : ''}`;

  let imgHtml = '';
  try {
    const imgs = JSON.parse(j.img || '[]');
    imgs.forEach(src => { imgHtml += `<img src="${src}" style="width:100%;border-radius:8px;margin-bottom:8px;object-fit:cover;max-height:220px" onerror="this.style.display='none'">`; });
  } catch(e) {
    if (j.img && j.img.length > 10) imgHtml = `<img src="${j.img}" style="width:100%;border-radius:8px" onerror="this.style.display='none'">`;
  }
  document.getElementById('jdm-image-body').innerHTML = imgHtml;

  ['tech-action-accept','tech-action-update','eng-action-qc','admin-action-edit']
    .forEach(sid => document.getElementById(sid)?.classList.add('d-none'));

  const role = currentUser?.role;
  if (isRepairStaff(role) && j.status==='รอซ่อม') {
    document.getElementById('tech-action-accept')?.classList.remove('d-none');
  }
  if (isRepairStaff(role) &&
      ['กำลังซ่อม','รออะไหล่','Workaround','ขอหยุดเครื่อง'].includes(j.status)) {
    document.getElementById('tech-action-update')?.classList.remove('d-none');
    const s = document.getElementById('tup-status'); if(s) s.value = j.status;
    const e = document.getElementById('tup-eta');    if(e && j.eta) e.value = j.eta;
    const n = document.getElementById('tup-note');   if(n && j.note) n.value = j.note;
    toggleDoneInputFields(j.status);
  }
  if ((role==='engineer' || role==='user') && j.status==='ซ่อมเสร็จแล้ว') {
    document.getElementById('eng-action-qc')?.classList.remove('d-none');
    const b = document.getElementById('eqc-by'); if(b) b.value = currentUser.name;
  }
  if (role==='admin') {
    document.getElementById('admin-action-edit')?.classList.remove('d-none');
    const s = document.getElementById('adm-job-status'); if(s) s.value = j.status;
    const t = document.getElementById('adm-job-tech');   if(t && j.technician) t.value = j.technician;
    const n = document.getElementById('adm-job-note');   if(n && j.note) n.value = j.note;
  }
  openModal('job-detail-modal');
}

function engSubmitQC() {
  if (!selectedJobForAction) return;
  const j = getRepairJobsData().find(x => x.id === selectedJobForAction);
  if (!j) return;
  const result = document.getElementById('eqc-result')?.value;
  const by     = document.getElementById('eqc-by')?.value;
  const note   = document.getElementById('eqc-note')?.value || '';

  if (!isLocalMode) {
    showLoading('กำลังบันทึก QC...');
    authFetch(`${API_URL}/repairs/${encodeURIComponent(selectedJobForAction)}/qc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result, by, note })
    })
    .then(r => r.json())
    .then(res => {
      hideLoading();
      if (res.success) {
        j.status   = result === 'ผ่าน QC' ? 'ปิดงาน' : 'แก้ไข (ตีกลับ)';
        j.qcResult = result; j.qcBy = by;
        showToast(`QC: ${result} — ${j.machine}`, result==='ผ่าน QC'?'success':'warning');
        closeModal('job-detail-modal');
        renderRepairsTable(); renderAdminRepairsTable();
        if (currentUser.role==='engineer') { engRenderQC(); teUpdateStats(); }
        renderUserQCPanel();
      } else showToast('เกิดข้อผิดพลาด: '+(res.message||''), 'error');
    })
    .catch(() => { hideLoading(); showToast('เชื่อมต่อ server ไม่ได้','error'); });
    return;
  }
  j.status = result==='ผ่าน QC' ? 'ปิดงาน' : 'แก้ไข (ตีกลับ)';
  j.qcResult = result; j.qcBy = by;
  closeModal('job-detail-modal');
  showToast(`QC: ${result} — ${j.machine}`, result==='ผ่าน QC'?'success':'warning');
  renderRepairsTable(); renderUserQCPanel();
}

function openEditPMModal(pmId) {
  const p = getPMData().find(x => x.id === pmId);
  if (!p) return;
  document.getElementById('pmem-id').value         = p.id;
  document.getElementById('pmem-date').value        = p.date;
  document.getElementById('pmem-title-input').value = p.title;
 setSearchableSelectValue('pmem-machine', p.machine);
  document.getElementById('pmem-type').value        = p.type;
  document.getElementById('pmem-status').value      = p.status;
  openModal('pm-event-modal');
}

function renderPMHistoryTable() {
  const tbody = document.getElementById('pm-history-tbody');
  if (!tbody) return;
  const data = getPMHistoryData();
  const condTxt = { pass:'ปกติ', warn:'ต้องติดตาม', fail:'ชำรุด' };
  const condCls = { pass:'badge-green', warn:'badge-amber', fail:'badge-red' };
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text3)">ยังไม่มีประวัติ PM</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((h, i) => `
    <tr>
      <td style="color:var(--text3)">${i+1}</td>
      <td><div style="font-weight:600">${h.equip}</div>
          <div style="font-size:10px;color:var(--text2);font-family:var(--font-mono)">${h.pmCode}</div></td>
      <td style="font-size:12px;color:var(--text2)">${h.date}</td>
      <td>${h.tech}</td>
      <td><span class="badge ${condCls[h.result]||'badge-green'}">${condTxt[h.result]||h.result}</span></td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text2)">${escapeHtml(h.workDone||'-')}</td>
      <td style="font-size:12px;color:var(--text2)">${escapeHtml(h.note||'-')}</td>
      <td><button class="btn-action" onclick="viewPMDoc('${h.pmCode}',${i})"><i class="ion-ios-document"></i> ดู</button></td>
    </tr>`).join('');
}

function imgFullscreen(img) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  overlay.innerHTML = `<img src="${img.src}" style="max-width:95vw;max-height:95vh;border-radius:8px;object-fit:contain">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function toggleDoneInputFields(status) {
  const doneField = document.getElementById('tech-done-date-field');
  if (doneField) doneField.classList.toggle('d-none', status !== 'ซ่อมเสร็จแล้ว');
}

function techAcceptSelectedJob() {
  if (!selectedJobForAction) return;
  tpAcceptJob(selectedJobForAction);
  closeModal('job-detail-modal');
}
// ═══════════════════════════════════════════════════════════════
// LINE CONNECT — เพิ่มใน scripts.js
// ═══════════════════════════════════════════════════════════════

// ── เก็บ lineUserId ชั่วคราวระหว่างรอ register ──
let _regLineUserId    = null;
let _regLinePopupOpen = false;

async function regConnectLINE() {
  if (_regLinePopupOpen) return;

  // เปิด popup ว่างเปล่าทันที (ก่อน await) เพื่อไม่ให้เบราว์เซอร์บล็อก
  const popup = window.open('', 'line_auth_reg',
    'width=520,height=680,scrollbars=yes,resizable=yes');
  if (!popup) {
    showToast('เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup แล้วลองกดใหม่อีกครั้ง', 'warning');
    return;
  }

  try {
    const r = await fetch('/api/users/line/auth-url?mode=popup').then(r => r.json());
    if (!r.url) {
      popup.close();
      return showToast('ไม่สามารถเชื่อมต่อ LINE ได้', 'error');
    }

    _regLinePopupOpen = true;
    popup.location.href = r.url;

   const onMsg = async (e) => {
      if (e.data?.type !== 'LINE_AUTH_CODE') return;
      window.removeEventListener('message', onMsg);
      _regLinePopupOpen = false;
      popup?.close();
      const cb = await fetch('/api/users/line/callback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: e.data.code }),
      }).then(r => r.json());

      if (cb.lineUserId) {
        _regLineUserId = cb.lineUserId;
        document.getElementById('reg-line-status').innerHTML =
          `<span style="color:#16a34a;font-weight:700;"><i class="ion-ios-checkmark-circle"></i> เชื่อมต่อแล้ว</span>` +
          (cb.displayName ? ` · ${cb.displayName}` : '');
        const btn = document.getElementById('reg-line-btn');
        btn.innerHTML = '<i class="ion-ios-checkmark-circle"></i> เชื่อมต่อ LINE แล้ว';
        btn.style.background = '#15803d';
        btn.style.opacity    = '0.8';
        btn.disabled         = true;
      } else if (cb.linked) {
        showToast('LINE นี้ผูกบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วย LINE แทน', 'error');
      } else {
        showToast('ไม่สามารถรับข้อมูล LINE ได้', 'error');
      }
    };

    window.addEventListener('message', onMsg);

    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        _regLinePopupOpen = false;
        window.removeEventListener('message', onMsg);
      }
    }, 800);

  } catch (err) {
    _regLinePopupOpen = false;
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}
// ── reset ค่า LINE เมื่อปิด modal ──
function closeRegisterModal() {
  document.getElementById('register-modal').style.display = 'none';
  _regLineUserId = null;
  _regLinePopupOpen = false;
  // reset ปุ่ม LINE กลับ
  const btn = document.getElementById('reg-line-btn');
  if (btn) {
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <path d="M12 2C6.48 2 2 6.02 2 11c0 3.54 2.29 6.53 5.47 8.11L6.5 22l3.27-1.7C10.5 20.43 11.24 20.5 12 20.5c5.52 0 10-4.02 10-9S17.52 2 12 2z"/>
    </svg> เชื่อมต่อ LINE OA`;
    btn.style.background = '#06C755';
    btn.style.opacity    = '1';
    btn.disabled         = false;
  }
  const status = document.getElementById('reg-line-status');
  if (status) status.innerHTML = 'รับการแจ้งเตือนตรงใน LINE เมื่อช่างรับงาน อัปเดตสถานะ และงานผ่าน QC';
}

// ── submitRegister — แทนที่ฟังก์ชันเดิม ──
// (ถ้ามี submitRegister อยู่แล้วใน scripts.js ให้แทนที่ด้วยอันนี้เลย)
async function submitRegister() {
  const fullname  = document.getElementById('reg-fullname').value.trim();
  const dept      = document.getElementById('reg-dept').value.trim();
  const contact   = document.getElementById('reg-contact').value.trim();
  const username  = document.getElementById('reg-username').value.trim();
  const password  = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  const errEl     = document.getElementById('reg-error');

  const showErr = (msg) => {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  };
  errEl.style.display = 'none';

  if (!fullname || !dept || !contact || !username || !password) return showErr('กรุณากรอกข้อมูลให้ครบ');
  if (password !== password2) return showErr('รหัสผ่านไม่ตรงกัน');
  if (password.length < 4)   return showErr('รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');

  const btn = document.getElementById('reg-submit-btn');
  btn.disabled     = true;
  btn.textContent  = 'กำลังสมัคร...';

  try {
    const res = await fetch('/api/users/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        username, password, fullname, dept, contact,
        lineUserId: _regLineUserId || '',   // ← ส่ง LINE ไปพร้อมกันเลย
      }),
    }).then(r => r.json());

    if (!res.success) {
      showErr(res.message || 'สมัครไม่สำเร็จ');
    } else {
      // สำเร็จ!
      closeRegisterModal();
      showToast(
        _regLineUserId
          ? 'ลงทะเบียนสำเร็จ! เชื่อม LINE เรียบร้อย'
          : 'ลงทะเบียนสำเร็จ! กรุณาเข้าสู่ระบบ',
        'success'
      );
      _regLineUserId = null;
    }
  } catch (err) {
    showErr('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    btn.disabled    = false;
    btn.innerHTML   = '<i class="ion-ios-person"></i> ลงทะเบียน';
  }
}

// ── openRegisterModal ──
function openRegisterModal() {
  document.getElementById('register-modal').style.display = 'block';
}
// ============================================================
// SEARCHABLE MACHINE SELECT (ค้นหาได้ + อื่นๆ ระบุเอง)
// ============================================================
function initSearchableSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select || select.dataset.sselInit) return;
  select.dataset.sselInit = '1';
  select.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'ssel-wrap';
  wrap.id = selectId + '-sswrap';

  const display = document.createElement('div');
  display.className = 'ssel-display';
  display.innerHTML = `<span class="ssel-display-text placeholder">เลือกเครื่องจักร</span><i class="ion-ios-arrow-down"></i>`;

  const panel = document.createElement('div');
  panel.className = 'ssel-panel';
  panel.innerHTML = `
    <div class="ssel-search-box">
      <i class="ion-ios-search"></i>
      <input type="text" class="ssel-search-input" placeholder="พิมพ์ค้นหาเครื่องจักร...">
    </div>
    <div class="ssel-list"></div>`;

  wrap.appendChild(display);
  wrap.appendChild(panel);
  select.parentNode.insertBefore(wrap, select.nextSibling);

  const otherInput = document.createElement('input');
  otherInput.type = 'text';
  otherInput.className = 'input-ctrl ssel-other-input d-none';
  otherInput.id = selectId + '-other';
  otherInput.placeholder = 'ระบุชื่อเครื่องจักร...';
  wrap.parentNode.insertBefore(otherInput, wrap.nextSibling);

  const searchInput = panel.querySelector('.ssel-search-input');
  const listEl = panel.querySelector('.ssel-list');

  function renderList(filter) {
    filter = (filter || '').trim().toLowerCase();
    const opts = Array.from(select.options).filter(o => o.value !== '');
    const filtered = opts.filter(o => o.text.toLowerCase().includes(filter));
    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = `<div class="ssel-empty"><i class="ion-ios-search"></i> ไม่พบเครื่องจักรที่ค้นหา</div>`;
      return;
    }
    filtered.forEach(o => {
      const item = document.createElement('div');
      const isOther = o.value === '__OTHER__';
      item.className = 'ssel-option' + (o.value === select.value ? ' sel' : '') + (isOther ? ' other-opt' : '');
      item.textContent = o.text;
      item.onclick = () => {
        select.value = o.value;
        updateDisplay();
        closePanel();
        toggleOtherInput();
        select.dispatchEvent(new Event('change'));
      };
      listEl.appendChild(item);
    });
  }

  function updateDisplay() {
    const opt = select.options[select.selectedIndex];
    const span = display.querySelector('.ssel-display-text');
    if (!select.value) {
      span.textContent = 'เลือกเครื่องจักร';
      span.classList.add('placeholder');
    } else {
      span.textContent = opt ? opt.text : 'เลือกเครื่องจักร';
      span.classList.remove('placeholder');
    }
  }

  function toggleOtherInput() {
    if (select.value === '__OTHER__') {
      otherInput.classList.remove('d-none');
      otherInput.focus();
    } else {
      otherInput.classList.add('d-none');
    }
  }

  function openPanel() {
    renderList(searchInput.value);
    panel.classList.add('open');
    display.classList.add('open');
    searchInput.value = '';
    setTimeout(() => searchInput.focus(), 50);
    document.addEventListener('click', outsideClick);
  }
  function closePanel() {
    panel.classList.remove('open');
    display.classList.remove('open');
    document.removeEventListener('click', outsideClick);
  }
  function outsideClick(e) {
    if (!wrap.contains(e.target)) closePanel();
  }

  display.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.contains('open') ? closePanel() : openPanel();
  });
  searchInput.addEventListener('input', (e) => renderList(e.target.value));
  searchInput.addEventListener('click', (e) => e.stopPropagation());

  // เผื่อ populateMachineDropdown เรียกซ้ำ (โหลดข้อมูลใหม่) ให้ sync UI ได้
  select._sselRefresh = function () {
    updateDisplay();
    toggleOtherInput();
  };

  updateDisplay();
}

// ดึงค่าที่ "จะใช้จริง" จาก select แบบค้นหาได้ (คืนค่าที่พิมพ์เองถ้าเลือก "อื่นๆ")
function getMachineValue(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return '';
  if (select.value === '__OTHER__') {
    return (document.getElementById(selectId + '-other')?.value || '').trim();
  }
  return select.value;
}

// ตั้งค่า select แบบค้นหาได้ (ใช้ตอนเปิดฟอร์มแก้ไข เช่น openEditPMModal)
function setSearchableSelectValue(selectId, value) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const otherInput = document.getElementById(selectId + '-other');
  const match = Array.from(select.options).find(o => o.value === value);
  if (match) {
    select.value = value;
    if (otherInput) otherInput.value = '';
  } else if (value) {
    // ค่าเดิมไม่อยู่ในลิสต์ (ข้อมูลเก่า/พิมพ์เอง) → ถือเป็น "อื่นๆ"
    select.value = '__OTHER__';
    if (otherInput) otherInput.value = value;
  } else {
    select.value = '';
    if (otherInput) otherInput.value = '';
  }
  if (select._sselRefresh) select._sselRefresh();
}

// รีเซ็ต select แบบค้นหาได้กลับเป็นค่าว่าง
function resetSearchableSelect(selectId) {
  setSearchableSelectValue(selectId, '');
}
// ============================================================
// ADMIN — PEOPLE PANEL (รวม "จัดการ Users" + "โปรไฟล์ช่าง/วิศวกร")
// ============================================================
let _peopleSubTab = 'users';

function initAdminPeoplePanel() {
  const btn = document.getElementById(_peopleSubTab === 'users' ? 'pst-users' : 'pst-tech');
  switchPeopleSubTab(_peopleSubTab, btn);
}

function switchPeopleSubTab(tab, btn) {
  _peopleSubTab = tab;
  document.querySelectorAll('.people-subtab').forEach(b => {
    b.classList.remove('active');
    b.style.background = 'var(--bg2)';
    b.style.color = 'var(--text2)';
  });
  if (btn) {
    btn.classList.add('active');
    btn.style.background = 'var(--accent)';
    btn.style.color = '#fff';
  }
  const usersView = document.getElementById('panel-admin-users');
  const techView  = document.getElementById('panel-admin-techprofiles');
  if (tab === 'users') {
    usersView.style.display = 'block';
    techView.style.display  = 'none';
    renderAdminUsersTable();
  } else {
    techView.style.display  = 'block';
    usersView.style.display = 'none';
    renderAdminTechProfiles();
  }
}