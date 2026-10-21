/**
 * 灵屏 LumaSign · 管理端外壳（macOS 风格侧栏 + 顶栏 + 主题 + 实时事件）
 */
import { el, state, can, toast } from './core.js';

// Electron 桌面端：给 <html> 打 in-desktop 标记。theme.css 据此关闭 backdrop-filter 等特效——
// 本机 Chromium(打包版) + 显卡驱动组合下，backdrop-filter 会静默杀死渲染进程，导致
// lifecycle/settings/proof 等页渲染即崩溃（窗口黑屏）。仅作用于桌面端，浏览器端保留毛玻璃。
if (window.lumaDesktop) document.documentElement.classList.add('in-desktop');

const NAV = [
  { group: '总览', items: [
    { id: 'dashboard', label: '仪表盘', icon: '◧', perm: 'dashboard:view', hash: '#/dashboard' },
  ] },
  { group: '运营', items: [
    { id: 'terminals', label: '终端管理', icon: '▦', perm: 'terminal:view', hash: '#/terminals' },
    { id: 'media', label: '素材库', icon: '❖', perm: 'media:view', hash: '#/media' },
    { id: 'layouts', label: '节目制作', icon: '◳', perm: 'layout:view', hash: '#/layouts' },
    { id: 'dataSources', label: '动态数据源', icon: '◈', perm: 'datasource:view', hash: '#/dataSources' },
    { id: 'approvals', label: '审批中心', icon: '✔', perm: 'layout:view', hash: '#/approvals' },
    { id: 'schedules', label: '排期下发', icon: '▤', perm: 'schedule:view', hash: '#/schedules' },
    { id: 'lifecycle', label: '内容生命周期', icon: '⧗', perm: 'media:view', hash: '#/lifecycle' },
    { id: 'monitor', label: '监看墙', icon: '◫', perm: 'terminal:view', hash: '#/monitor' },
    { id: 'health', label: '健康看板', icon: '♥', perm: 'terminal:view', hash: '#/health' },
    { id: 'proof', label: '播放证明', icon: '▣', perm: 'log:view', hash: '#/proof' },
    { id: 'interactions', label: '交互统计', icon: '◎', perm: 'layout:view', hash: '#/interactions' },
    { id: 'siqian', label: '56iq兼容', icon: '⇄', perm: 'terminal:view', hash: '#/siqian' },
  ] },
  { group: '系统', items: [
    { id: 'fleet', label: '设备开通', icon: '⚡', perm: 'terminal:view', hash: '#/fleet' },
    { id: 'crashLogs', label: '崩溃日志', icon: '⚠', perm: 'terminal:view', hash: '#/crashLogs' },
    { id: 'users', label: '用户与角色', icon: '◍', perm: 'user:view', hash: '#/users' },
    { id: 'logs', label: '日志与播放证明', icon: '≣', perm: 'log:view', hash: '#/logs' },
    { id: 'security', label: '安全中心', icon: '⛨', perm: 'system:setting', hash: '#/security' },
    { id: 'settings', label: '系统设置', icon: '⚙', perm: 'system:setting', hash: '#/settings' },
  ] },
];

export function applyTheme(theme) {
  state.theme = theme;
  localStorage.setItem('luma_theme', theme);
  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  const dark = theme === 'dark' || (theme === 'system' && mq && mq.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function mountShell(root, { onNavigate }) {
  const sidebar = el('aside', { class: 'sidebar' });
  const content = el('main', { class: 'main' },
    el('header', { class: 'topbar' },
      el('div', { class: 'title', id: 'top-title', text: '灵屏标牌管理中心' }),
      el('div', { class: 'spacer' }),
      el('div', { class: 'search' }, el('span', { text: '⌕' }), el('input', { placeholder: '搜索…', id: 'global-search' })),
      el('button', { class: 'icon-btn', title: '切换语言 / Switch Language', id: 'lang-toggle', onclick: cycleLang }, langShort()),
      el('button', { class: 'icon-btn', title: '切换主题', onclick: cycleTheme }, '◐'),
      el('div', { class: 'avatar', id: 'user-avatar', title: '账户', onclick: showUserMenu }, '?'),
    ),
    el('div', { class: 'content', id: 'view' }),
  );
  const shell = el('div', { class: 'shell' }, sidebar, content);
  root.innerHTML = '';
  root.appendChild(shell);

  buildNav(sidebar, onNavigate);
  updateVersionFooter();
  applyTheme(state.theme);
  connectEvents();
  initSidebarCollapse(sidebar);
  showServerAddr();
  applyI18n();
  if (window.I18N) window.I18N.on(function () { applyI18n(); });

  return {
    viewEl: content.querySelector('#view'),
    titleEl: content.querySelector('#top-title'),
  };
}

function buildNav(sidebar, onNavigate) {
  sidebar.innerHTML = '';
  sidebar.appendChild(
    el('div', { class: 'brand' },
      el('div', { class: 'logo', text: '灵' }),
      el('div', { class: 'name', text: '灵屏 LumaSign' }),
    ),
  );
  const navWrap = el('div', { class: 'nav-scroll' });
  for (const grp of NAV) {
    const visible = grp.items.filter(it => !it.perm || can(it.perm));
    if (!visible.length) continue;
    navWrap.appendChild(el('div', { class: 'nav-group', text: grp.group }));
    for (const it of visible) {
      navWrap.appendChild(el('div', { class: 'nav-item', dataset: { id: it.id, label: it.label }, onclick: () => onNavigate(it.hash) },
        el('span', { class: 'ico', text: it.icon }),
        el('span', { text: it.label }),
      ));
    }
  }
  sidebar.appendChild(navWrap);
  sidebar.appendChild(el('div', { class: 'sidebar-foot', id: 'sidebar-foot', text: '版本加载中…' }));
}

async function updateVersionFooter() {
  try {
    const r = await fetch('/health');
    if (!r.ok) return;
    const d = await r.json();
    const foot = document.getElementById('sidebar-foot');
    if (foot && d && d.version) foot.textContent = `${d.version} · 局域网数字标牌`;
  } catch { /* 健康接口失败时保留初始文字 */ }
}

/* 侧栏折叠 */
function initSidebarCollapse(sidebar) {
  const key = 'luma_sidebar_collapsed';
  const collapsed = localStorage.getItem(key) === 'true';
  // 小屏（≤1000px）由 CSS 媒体查询自动折叠，JS 不重复处理
  const isSmall = window.matchMedia('(max-width: 1000px)').matches;
  if (collapsed && !isSmall) sidebar.classList.add('collapsed');

  const btn = el('button', { class: 'sidebar-toggle', title: '收起/展开侧栏', onclick: () => {
    sidebar.classList.toggle('collapsed');
    const c = sidebar.classList.contains('collapsed');
    localStorage.setItem(key, c);
    btn.textContent = c ? '▶' : '◀';
  }}, collapsed && !isSmall ? '▶' : '◀');
  sidebar.appendChild(btn);

  // 窗口尺寸变化时同步状态
  window.matchMedia('(max-width: 1000px)').addEventListener('change', e => {
    if (!e.matches && localStorage.getItem(key) !== 'true') {
      sidebar.classList.remove('collapsed');
    }
  });
}

export function setActiveNav(id) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.id === id));
}

function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(state.theme) + 1) % 3];
  applyTheme(next);
  const I18N = window.I18N;
  const label = !I18N ? ({ light: '浅色', dark: '深色', system: '跟随系统' }[next])
    : I18N.t('common.theme.' + next, ({ light: '浅色', dark: '深色', system: '跟随系统' }[next]));
  toast('主题：' + label);
}

/* v1.3.32 · 多语言切换 LanguageSelectDialog */
function langShort() {
  const I18N = window.I18N;
  if (!I18N) return '中';
  const list = I18N.languages();
  const cur = I18N.lang();
  for (var i = 0; i < list.length; i++) if (list[i].code === cur) return list[i].short;
  return '中';
}

function cycleLang() {
  const I18N = window.I18N;
  if (!I18N) { toast('i18n 未加载', 'err'); return; }
  const list = I18N.languages();
  const cur = I18N.lang();
  let idx = 0;
  for (var i = 0; i < list.length; i++) if (list[i].code === cur) { idx = i; break; }
  const next = list[(idx + 1) % list.length];
  I18N.setLang(next.code);
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = next.short;
  toast('语言 / Language：' + next.label);
}

function applyI18n() {
  const I18N = window.I18N;
  if (!I18N) return;
  const t = I18N.t;
  // 顶栏标题
  const title = document.getElementById('top-title');
  if (title) title.textContent = t('app.name', '灵屏标牌管理中心');
  // 全局搜索占位
  const g = document.getElementById('global-search');
  if (g) g.placeholder = t('common.search', '搜索…');
  // 语言按钮短标
  const lb = document.getElementById('lang-toggle');
  if (lb) lb.textContent = langShort();
  // 侧栏导航（按 dataset.id 匹配 nav.* key）
  const navMap = {
    dashboard: 'nav.dashboard', terminals: 'nav.terminals', media: 'nav.media',
    layouts: 'nav.layouts', dataSources: 'nav.datasources', approvals: 'nav.approvals',
    schedules: 'nav.schedules', lifecycle: 'nav.lifecycle', monitor: 'nav.monitors',
    health: 'nav.health', proof: 'nav.proof', interactions: 'nav.interactions',
    siqian: 'nav.siqian',
    fleet: 'nav.fleet', crashLogs: 'nav.crashLogs', users: 'nav.users',
    logs: 'nav.logs', security: 'nav.security', settings: 'nav.settings'
  };
  document.querySelectorAll('.nav-item').forEach(n => {
    const id = n.dataset && n.dataset.id;
    const key = navMap[id];
    if (!key) return;
    const span = n.querySelector('span:last-child');
    if (span) span.textContent = t(key, span.textContent);
  });
  // 侧栏分组
  const grpMap = { '总览': 'nav.group.overview', '运营': 'nav.group.ops', '系统': 'nav.group.system' };
  document.querySelectorAll('.nav-group').forEach(g => {
    const k = grpMap[g.textContent];
    if (k) g.textContent = t(k, g.textContent);
  });
  // sidebar 品牌
  const brandName = document.querySelector('.sidebar .brand .name');
  if (brandName) brandName.textContent = t('app.name', '灵屏 LumaSign');
}

function showUserMenu(e) {
  const u = state.user || {};
  const menu = el('div', { class: 'card', style: { position: 'fixed', right: '16px', top: '52px', zIndex: 60, minWidth: '200px', padding: '12px' } },
    el('div', { style: { fontWeight: 600 }, text: u.name || u.username || '用户' }),
    el('div', { style: { color: 'var(--text-3)', fontSize: '12px', marginBottom: '10px' }, text: u.username || '' }),
    el('button', { class: 'btn sm', style: { width: '100%', marginBottom: '6px' }, onclick: () => { document.getElementById('modal-root'); openPasswordModal(); } }, '修改密码'),
    el('button', { class: 'btn sm danger', style: { width: '100%' }, onclick: doLogout }, '退出登录'),
  );
  const root = document.getElementById('modal-root');
  const close = () => menu.remove();
  menu.addEventListener('click', ev => { if (ev.target === menu) close(); });
  setTimeout(() => document.addEventListener('click', function h() { close(); document.removeEventListener('click', h); }), 0);
  root.appendChild(menu);
}

async function doLogout() {
  try { await (await import('./core.js')).api.post('/api/auth/logout'); } catch {}
  location.hash = '#/login';
  location.reload();
}

function openPasswordModal() {
  import('./core.js').then(({ api, el: E, openModal, toast }) => {
    const old = E('input', { class: 'input', type: 'password', placeholder: '原密码' });
    const neu = E('input', { class: 'input', type: 'password', placeholder: '新密码（≥8位，含字母与数字）' });
    const box = E('div', {},
      E('h2', { text: '修改密码' }),
      E('label', { class: 'fld', text: '原密码' }), old,
      E('label', { class: 'fld', text: '新密码' }), neu,
      E('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '18px' } },
        E('button', { class: 'btn primary', onclick: async () => {
          try {
            await api.post('/api/auth/password', { oldPassword: old.value, newPassword: neu.value });
            toast('密码已修改', 'ok'); document.querySelector('.modal-mask')?._close?.();
          } catch (e) { toast(e.message, 'err'); }
        } }, '保存'),
      ),
    );
    openModal(box);
  });
}

/* 右下角服务器地址指示器 */
function showServerAddr() {
  const host = location.host || 'localhost';
  const proto = location.protocol || 'http:';
  const isLocal = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(location.hostname);

  const addr = el('div', {
    class: 'server-addr' + (isLocal ? ' is-local' : ''),
    title: isLocal
      ? '⚠️ 当前是本机访问（127.0.0.1），安卓端不能填此地址！\n请填写这台电脑的局域网 IP（如 192.168.x.x:7788）'
      : `当前连接：${proto}//${host}`,
  },
    el('span', { class: 'server-addr-dot' }),
    el('div', { class: 'server-addr-info' },
      el('span', { class: 'server-addr-text', text: host }),
      isLocal ? el('span', { class: 'server-addr-hint', text: '本机地址 · 安卓端不可用' }) : null,
    ),
  );
  document.body.appendChild(addr);

  // 本机访问时，尝试通过 WebRTC 获取局域网 IP 显示给用户
  if (isLocal) tryDiscoverLanIp(addr);
}

/** 用 WebRTC ICE 候选探测本机局域网 IP（纯前端，无需后端配合）
 *  ⚠️ 多网卡机器（Hyper-V / VMware / Docker / WSL 虚拟网卡）下绝不能"取第一个候选"，
 *  否则会把 172.16-31 之类虚拟网段当成局域网地址广播给终端，终端永远连不上。
 *  这里先收集候选，再按 192.168.* > 10.* > 172.16-31 > 其他 排序取最优。 */
function tryDiscoverLanIp(addrEl) {
  // 避免重复探测
  if (addrEl.dataset.lanDone) return;
  addrEl.dataset.lanDone = '1';

  const score = (ip) => ip.startsWith('192.168.') ? 0
    : ip.startsWith('10.') ? 1
    : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;

  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('_');
    const found = [];
    let done = false;
    let timer = null;

    const apply = (ip) => {
      if (done || !ip) return;
      done = true;
      clearTimeout(timer);
      try { pc.close(); } catch {}
      // 更新显示：主文字改为局域网 IP，hint 改为可复制提示
      const textEl = addrEl.querySelector('.server-addr-text');
      const hintEl = addrEl.querySelector('.server-addr-hint');
      if (textEl) textEl.textContent = ip + ':7788';
      if (hintEl) hintEl.textContent = '局域网 IP · 安卓端填此地址';
      addrEl.classList.remove('is-local');
      addrEl.title = `局域网地址：http://${ip}:7788\n安卓端 / 其他设备请填此地址`;
    };
    const flush = () => {
      if (done || !found.length) return;
      apply(found.slice().sort((a, b) => score(a) - score(b))[0]);
    };

    timer = setTimeout(flush, 1500);
    pc.onicecandidate = (e) => {
      if (done) return;
      if (!e.candidate) { flush(); return; }
      const ip = e.candidate.candidate.split(' ')[4];
      if (!ip || !/\d+\.\d+\.\d+\.\d+/.test(ip)) return;
      if (/^(127\.|0\.|169\.254\.)/.test(ip)) return;
      if (found.indexOf(ip) < 0) found.push(ip);
      // 真·192.168.x 出现即可定案，无需继续等
      if (score(ip) === 0) apply(ip);
    };
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
  } catch {}
}

/* 实时事件（SSE）：用于在线/离线、指令回执等轻量提示 */
function connectEvents() {
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('terminal:link', e => {
      const d = JSON.parse(e.data);
      toast(`终端 ${d.terminalId} ${d.connected ? '已连接' : '已断开'}`, d.connected ? 'ok' : '');
    });
    es.addEventListener('command:ack', e => {
      const d = JSON.parse(e.data);
      if (!d.ok) toast(`指令 ${d.type} 失败：${d.message || ''}`, 'err');
    });
    es.onerror = () => { /* 自动重连由浏览器处理 */ };
  } catch {}
}
