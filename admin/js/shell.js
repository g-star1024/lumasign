/**
 * 灵屏 LumaSign · 管理端外壳（macOS 风格侧栏 + 顶栏 + 主题 + 实时事件）
 */
import { el, state, can, toast } from './core.js';

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
      el('button', { class: 'icon-btn', title: '切换主题', onclick: cycleTheme }, '◐'),
      el('div', { class: 'avatar', id: 'user-avatar', title: '账户', onclick: showUserMenu }, '?'),
    ),
    el('div', { class: 'content', id: 'view' }),
  );
  const shell = el('div', { class: 'shell' }, sidebar, content);
  root.innerHTML = '';
  root.appendChild(shell);

  buildNav(sidebar, onNavigate);
  applyTheme(state.theme);
  connectEvents();
  initSidebarCollapse(sidebar);
  showServerAddr();

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
  for (const grp of NAV) {
    const visible = grp.items.filter(it => !it.perm || can(it.perm));
    if (!visible.length) continue;
    sidebar.appendChild(el('div', { class: 'nav-group', text: grp.group }));
    for (const it of visible) {
      sidebar.appendChild(el('div', { class: 'nav-item', dataset: { id: it.id, label: it.label }, onclick: () => onNavigate(it.hash) },
        el('span', { class: 'ico', text: it.icon }),
        el('span', { text: it.label }),
      ));
    }
  }
  sidebar.appendChild(el('div', { class: 'sidebar-foot', text: 'v1.0.0 · 局域网数字标牌' }));
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
  toast('主题：' + ({ light: '浅色', dark: '深色', system: '跟随系统' }[next]));
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

/** 用 WebRTC ICE 候选探测本机局域网 IP（纯前端，无需后端配合） */
function tryDiscoverLanIp(addrEl) {
  // 避免重复探测
  if (addrEl.dataset.lanDone) return;
  addrEl.dataset.lanDone = '1';

  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('_');
    let resolved = false;
    const timer = setTimeout(() => { if (!resolved) { resolved = true; pc.close(); } }, 3000);
    pc.onicecandidate = (e) => {
      if (!e.candidate || resolved) return;
      const parts = e.candidate.candidate.split(' ');
      const ip = parts[4];
      // 只要不是回环/链路本地/映射地址的 IPv4，大概率是局域网 IP
      if (ip && /^(?!127\.|0\.|169\.254\.|::1?|fe80:)/.test(ip) && /\d+\.\d+\.\d+\.\d+/.test(ip)) {
        resolved = true;
        clearTimeout(timer);
        pc.close();
        // 更新显示：主文字改为局域网 IP，hint 改为可复制提示
        const textEl = addrEl.querySelector('.server-addr-text');
        const hintEl = addrEl.querySelector('.server-addr-hint');
        if (textEl) textEl.textContent = ip + ':7788';
        if (hintEl) hintEl.textContent = '局域网 IP · 安卓端填此地址';
        addrEl.classList.remove('is-local');
        addrEl.title = `局域网地址：http://${ip}:7788\n安卓端 / 其他设备请填此地址`;
      }
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
