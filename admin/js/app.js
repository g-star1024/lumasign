/**
 * 灵屏 LumaSign · 管理端入口
 * 引导：校验会话 → 挂载外壳 → 哈希路由渲染视图。未登录显示登录页。
 */
import { api, state, el, toast } from './core.js';
import { mountShell, setActiveNav } from './shell.js';
import { views } from './views.js';

const TITLES = {
  dashboard: '仪表盘', terminals: '终端管理', media: '素材库', layouts: '节目制作',
  schedules: '排期下发', approvals: '审批中心', monitor: '监看墙', users: '用户与角色', logs: '日志与播放证明', settings: '系统设置', fleet: '设备开通',
  security: '安全中心', lifecycle: '内容生命周期',
};

async function loadPerms() {
  try {
    const rs = await api.get('/api/roles');
    const roleMap = Object.fromEntries((rs.items || []).map(r => [r.id, r.perms || []]));
    const perms = new Set();
    for (const rid of (state.user.roleIds || [])) (roleMap[rid] || []).forEach(p => perms.add(p));
    if ([...perms].includes('*')) state.perms.add('*');
    state.perms = perms;
  } catch { state.perms = new Set(); }
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const seg = h.split('/').filter(Boolean);
  if (!seg.length) return { name: 'dashboard', params: {} };
  if (seg[0] === 'editor') return { name: 'editor', params: { id: seg[1] } };
  return { name: seg[0], params: {} };
}

function renderLogin() {
  const u = el('input', { class: 'input', placeholder: '用户名', value: 'admin' });
  const p = el('input', { class: 'input', type: 'password', placeholder: '密码', value: 'admin123' });
  const err = el('div', { style: { color: 'var(--danger)', minHeight: '18px', marginBottom: '8px', fontSize: '13px' } });
  const submit = async () => {
    err.textContent = '';
    try {
      const d = await api.post('/api/auth/login', { username: u.value, password: p.value });
      if (d.mustChangePassword) toast('首次登录，请尽快在右上角修改密码');
      location.reload();
    } catch (e) { err.textContent = e.message; }
  };
  return el('div', { class: 'login-wrap' },
    el('div', { class: 'login-card' },
      el('h1', { text: '灵屏标牌管理中心' }),
      el('div', { class: 'sub', text: 'LumaSign · 局域网数字标牌' }),
      el('label', { class: 'fld', text: '用户名' }), u,
      el('label', { class: 'fld', text: '密码' }), p,
      err,
      el('button', { class: 'btn primary', style: { width: '100%', marginTop: '6px' }, onclick: submit }, '登 录'),
      el('div', { style: { textAlign: 'center', marginTop: '14px', fontSize: '12px', color: 'var(--text-3)' }, text: '默认账号 admin / admin123' }),
    ),
  );
}

async function boot() {
  const root = document.getElementById('root');
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user;
    if (me.user?.name) { const av = document.getElementById('user-avatar'); if (av) av.textContent = me.user.name[0]; }
    await loadPerms();
    const shell = mountShell(root, { onNavigate: hash => { location.hash = hash; } });
    route(shell);
    window.addEventListener('hashchange', () => route(shell));
  } catch (e) {
    console.error('[boot]', e);
    root.innerHTML = '';
    root.appendChild(renderLogin());
  }
}

function route(shell) {
  let { name, params } = parseHash();
  if (name === 'login') { location.hash = '#/dashboard'; return; }
  const view = views[name] || views.dashboard;
  if (name !== 'editor') setActiveNav(name);
  shell.titleEl.textContent = TITLES[name] || '灵屏标牌管理中心';
  shell.viewEl.replaceChildren();
  Promise.resolve(view(params)).then(node => { if (node) shell.viewEl.replaceChildren(node); });
}

boot();
