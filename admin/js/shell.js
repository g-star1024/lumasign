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
  ] },
  { group: '系统', items: [
    { id: 'fleet', label: '设备开通', icon: '⚡', perm: 'terminal:view', hash: '#/fleet' },
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
      sidebar.appendChild(el('div', { class: 'nav-item', dataset: { id: it.id }, onclick: () => onNavigate(it.hash) },
        el('span', { class: 'ico', text: it.icon }),
        el('span', { text: it.label }),
      ));
    }
  }
  sidebar.appendChild(el('div', { class: 'sidebar-foot', text: 'v1.0.0 · 局域网数字标牌' }));
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
