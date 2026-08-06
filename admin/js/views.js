/**
 * 灵屏 LumaSign 管理端视图
 * 每个视图为 async (params) => HTMLElement，渲染进 #view 容器。
 */
import { api, el, esc, fmtBytes, fmtTime, fmtAgo, toast, confirmModal, openModal, can } from './core.js';

const spinner = () => el('div', { class: 'empty' }, el('span', { class: 'spin' }), ' 加载中...');
const empty = t => el('div', { class: 'empty', text: t });
const pageHead = (title, ...actions) => el('div', { class: 'page-head' },
  el('h1', { text: title }), el('div', { class: 'spacer' }), ...actions);

/* ═══ HEVC 视频扩展：模块级共享（素材预览 + 系统设置页共用） ═══ */
const HEVC_STORE_URL = 'ms-windows-store://pdp/?ProductId=9n4wgh0z6vhq';

function browserSupportsHevc() {
  try {
    const v = document.createElement('video');
    return !!v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') ||
           !!v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');
  } catch { return false; }
}

/** 一键安装 HEVC 扩展：优先桌面宿主原生安装，否则跳转 Microsoft Store */
async function installHevcFromAdmin() {
  if (window.lumaDesktop && typeof window.lumaDesktop.installHevc === 'function') {
    try {
      const r = await window.lumaDesktop.installHevc();
      if (r && r.ok) {
        toast(r.method === 'winget'
          ? '已通过 winget 静默安装 HEVC 扩展，刷新页面即可预览 H.265 视频'
          : '已打开 Microsoft Store，请点击「获取 / 安装」HEVC 视频扩展，完成后刷新页面', 'ok');
      } else {
        toast((r && r.message) ? r.message : '安装触发失败，请手动前往 Microsoft Store 搜索「HEVC 视频扩展」', 'err');
      }
      return;
    } catch { /* 回退到商店链接 */ }
  }
  window.open(HEVC_STORE_URL, '_blank');
  toast('已打开 Microsoft Store，请点击「获取 / 安装」HEVC 视频扩展后刷新页面', 'ok');
}

/** 生命周期徽标：pending/active/expiring/expired/archived → 配色徽标
 *  永久有效（无有效期且非归档）不显示，避免列表噪声。*/
function lcBadge(state, daysLeft, validFrom, validUntil) {
  if (state === 'archived') return el('span', { class: 't-badge off', text: '已归档' });
  const hasWindow = validFrom || validUntil;
  if (!hasWindow) return null;
  const TONE = { pending: 'w', active: 's', expiring: 'w', expired: 'd' };
  let label = '限时';
  if (state === 'pending') label = '待生效';
  else if (state === 'expiring' && daysLeft != null) label = `即将到期 ${Math.max(0, daysLeft)}天`;
  else if (state === 'expired') label = '已过期';
  else if (state === 'active') label = '限时';
  return el('span', { class: `t-badge ${TONE[state] || 'off'}`, text: label });
}

/* ---------------- 仪表盘 ---------------- */
async function renderDashboard() {
  const box = el('div', {}, spinner());
  (async () => {
    let d;
    try { d = await api.get('/api/dashboard'); } catch (e) { box.replaceWith(empty(e.message)); return; }
    const s = d.stats || {};
    const stats = [
      { label: '终端总数', value: s.terminalTotal ?? 0, sub: `在线 ${s.terminalOnline ?? 0} / 离线 ${s.terminalOffline ?? 0}` },
      { label: '素材总量', value: fmtBytes(s.mediaSize ?? 0), sub: `${s.mediaTotal ?? 0} 个文件` },
      { label: '节目数', value: s.layoutTotal ?? 0, sub: `待审批 ${s.pendingApprove ?? 0}` },
      { label: '激活排期', value: s.scheduleActive ?? 0, sub: `待准入终端 ${s.waitingTerminals ?? 0}` },
    ];
    const statsRow = el('div', { class: 'grid cols-4' },
      ...stats.map(x => el('div', { class: 'stat' },
        el('div', { class: 'label', text: x.label }),
        el('div', { class: 'value', text: String(x.value) }),
        el('div', { class: 'sub', text: x.sub }),
      )),
    );
    const alerts = (d.alerts || []).slice(0, 6);
    const alertCard = el('div', { class: 'card' },
      el('h3', { style: { marginBottom: '10px' }, text: '告警' }),
      alerts.length ? el('div', {}, ...alerts.map(a => el('div', { style: { padding: '8px 0', borderBottom: '1px solid var(--border)' } },
        el('span', { class: 'badge ' + (a.level === 'error' ? 'danger' : a.level === 'warn' ? 'warn' : 'ok'), text: a.type }),
        ' ', a.title)))
        : el('div', { class: 'empty', text: '暂无告警' }),
    );
    const termCard = el('div', { class: 'card' },
      el('h3', { style: { marginBottom: '10px' }, text: '最近终端' }),
      (d.recentTerminals || []).map(t => el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' } },
        el('span', { class: 'dot ' + (t.status === 'online' ? 'ok' : 'off') }),
        el('span', { text: t.name || t.code || t.id, style: { flex: 1 } }),
        el('span', { class: 'badge ' + (t.status === 'online' ? 'ok' : 'off'), text: t.status === 'online' ? '在线' : '离线' }),
      )),
    );
    const auditCard = el('div', { class: 'card' },
      el('h3', { style: { marginBottom: '10px' }, text: '操作日志' }),
      (d.recentAudit || []).map(a => el('div', { style: { padding: '5px 0', fontSize: '13px', color: 'var(--text-2)' } },
        el('span', { style: { color: 'var(--text-3)' }, text: fmtTime(a.ts) + ' ' }),
        a.action + (a.username ? ` | ${a.username}` : ''))),
    );
    const wrap = el('div', { class: 'page-dashboard' },
      pageHead('仪表盘'),
      statsRow,
      el('div', { class: 'grid cols-3', style: { marginTop: '16px' } }, alertCard, termCard, auditCard),
    );
    box.replaceWith(wrap);
  })();
  return box;
}

/* ---------------- 终端管理（新设计系统） ---------------- */
function statusBadge(st) {
  const map = { online: ['s', '在线'], offline: ['d', '离线'] };
  const [tone, txt] = map[st] || ['w', st || '未知'];
  return el('span', { class: `t-badge ${tone}`, text: txt });
}

/** 健康度徽标：score 0–100 + 四档配色（good/warn/bad/crit → s/w/d/r） */
const HEALTH_TONE = { good: 's', warn: 'w', bad: 'd', crit: 'r' };
const HEALTH_LABEL = { good: '良好', warn: '注意', bad: '告警', crit: '严重' };
function healthBadge(score, level) {
  if (score == null || level == null) return el('span', { class: 't-badge off', text: '—' });
  const tone = HEALTH_TONE[level] || 'off';
  const lbl = HEALTH_LABEL[level] || level;
  return el('span', { class: `t-badge ${tone}`, text: `${score} · ${lbl}` });
}
/** 终端列表里的「需关注」计数（含离线+crit/warn/bad） */
function attentionCount(items) {
  return items.filter(t => (t.healthLevel || 'good') !== 'good').length;
}

async function renderTerminals() {
  const root = el('div', { class: 'page-terminals' });
  let all = [];

  const statCard = (label, value, hint, tone) => el('div', { class: 't-stat' },
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: String(value) }),
    el('div', { class: `hint ${tone || ''}`, text: hint || '' }),
  );
  const buildTable = (items) => {
    if (!items.length) return el('div', { class: 'empty', text: '暂无终端，设备上电后将自动出现在列表中' });
    return el('table', { class: 't-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: '名称' }), el('th', { text: '编号' }), el('th', { text: '状态' }),
        el('th', { text: 'IP · MAC' }), el('th', { text: '型号' }), el('th', { text: '心跳' }),
        el('th', { text: '健康度' }), el('th', { text: '' }),
      )),
      el('tbody', {}, ...items.map(t => el('tr', { style: { cursor: 'pointer' }, onclick: () => openTerminalDetail(t) },
        el('td', { text: t.name || t.code || t.id }),
        el('td', { class: 'mono', text: t.code || '-' }),
        el('td', {}, statusBadge(t.status)),
        el('td', { class: 'mono', text: `${t.net?.ip || '-'} · ${t.hardware?.mac || '-'}` }),
        el('td', { text: t.hardware?.model || '-' }),
        el('td', { text: fmtAgo(t.lastHeartbeat) }),
        el('td', {}, healthBadge(t.healthScore, t.healthLevel)),
        el('td', {}, can('terminal:control') ? el('button', { class: 't-btn ghost', onclick: (e) => { e.stopPropagation(); openTerminalDetail(t); } }, '控制') : ''),
      ))),
    );
  };

  const statsRow = el('div', { class: 't-stats', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } });
  const tableWrap = el('div', { class: 't-card' }, spinner());
  const searchInput = el('input', { placeholder: '搜索名称、编号、IP、MAC…', oninput: (e) => paint(e.target.value, statusSel.value) });
  const statusSel = el('select', { class: 't-select', onchange: (e) => paint(searchInput.value, e.target.value) },
    el('option', { value: 'all', text: '全部状态' }),
    el('option', { value: 'online', text: '在线' }),
    el('option', { value: 'offline', text: '离线' }),
  );

  function paint(filterText = '', filterStatus = 'all') {
    const txt = (filterText || '').trim().toLowerCase();
    const items = all.filter(t => {
      const m = !txt || [t.name, t.code, t.net?.ip, t.hardware?.mac].some(v => (v || '').toLowerCase().includes(txt));
      const s = filterStatus === 'all' || t.status === filterStatus;
      return m && s;
    });
    const total = all.length;
    const online = all.filter(t => t.status === 'online').length;
    const offline = total - online;
    statsRow.innerHTML = '';
    statsRow.appendChild(statCard('终端总数', total, '', ''));
    statsRow.appendChild(statCard('在线', online, '运行正常', 'g'));
    statsRow.appendChild(statCard('离线', offline, offline ? '需关注' : '全部在线', 'd'));
    const attention = attentionCount(all);
    statsRow.appendChild(statCard('需关注', attention, attention ? '健康度非良好' : '全部健康', attention ? 'd' : 'g'));
    statsRow.appendChild(statCard('当前筛选', items.length, '条结果', ''));
    tableWrap.innerHTML = '';
    tableWrap.appendChild(buildTable(items));
  }

  root.appendChild(el('div', { class: 't-head' }, el('div', { class: 't-title', text: '终端管理' })));
  root.appendChild(statsRow);
  root.appendChild(el('div', { class: 't-toolbar' },
    el('div', { class: 't-search' }, el('span', { text: '🔍' }), searchInput),
    statusSel,
    el('div', { class: 't-spacer' }),
    can('terminal:edit') ? el('button', { class: 't-btn primary', onclick: () => toast('新终端上电后自动发现，无需手动添加') }, '+ 添加终端') : '',
  ));
  root.appendChild(tableWrap);

  let d;
  try { d = await api.get('/api/terminals'); }
  catch (e) { root.innerHTML = ''; root.appendChild(empty(e.message)); return root; }
  all = d.items || [];
  paint();
  return root;
}

function openTerminalDetail(t) {
  const cap = t.powerCapabilities || {};
  const field = (label, valueNode) => el('div', { class: 't-dfield' },
    el('div', { class: 't-dlabel', text: label }),
    typeof valueNode === 'string' ? el('div', { class: 't-dval', text: valueNode }) : valueNode,
  );
  const body = el('div', {},
    el('div', { class: 't-dgrid' },
      field('名称', t.name || t.code || t.id),
      field('编号', t.code || '-'),
      field('状态', statusBadge(t.status)),
      field('IP', t.net?.ip || '-'),
      field('MAC', t.hardware?.mac || '-'),
      field('型号', t.hardware?.model || '-'),
      field('版本', t.version || '-'),
      field('心跳', fmtAgo(t.lastHeartbeat)),
    ),
    el('div', { class: 't-dpower' },
      el('span', { class: `t-badge ${cap.trueOffSupported ? 's' : 'w'}`, text: cap.trueOffSupported ? '支持真熄屏' : '仅假熄屏（亮度0）' }),
      cap.root ? el('span', { class: 't-dnote', text: '· 已获取 root' }) : '',
      cap.systemPower ? el('span', { class: 't-dnote', text: '· 系统签名' }) : '',
    ),
    el('div', { class: 't-dhealth' },
      el('div', { class: 't-dhrow' },
        el('span', { class: 't-dlabel', text: '健康度' }),
        healthBadge(t.healthScore, t.healthLevel),
      ),
      (t.healthIssues && t.healthIssues.length)
        ? el('div', { class: 't-dhissues' },
            ...t.healthIssues.map(i => el('span', { class: `t-chip ${i.sev === 'crit' ? 'd' : 'w'}` }, i.msg)))
        : el('div', { class: 't-dnote', text: '无异常项' }),
      t.healthUpdatedAt ? el('div', { class: 't-dnote', text: `最后评估 ${fmtTime(t.healthUpdatedAt)}` }) : '',
    ),
    el('div', { class: 't-dactions' },
      cmdBtn('截图', 'screenshot', t),
      cmdBtn('刷新内容', 'reload', t),
      cmdBtn('重启', 'restart', t),
      cmdBtn('关机', 'shutdown', t),
      can('terminal:upgrade') ? el('button', { class: 't-btn', onclick: async () => {
        try { const r = await api.post(`/api/admin/health/${t.id}/cleanup`); toast(r.message || '已下发清理缓存指令', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      } }, '清理缓存') : '',
    ),
  );
  openModal(el('div', {}, el('h2', { text: `终端 ${t.name || t.code || t.id}` }), body));
}
function cmdBtn(label, type, t) {
  return el('button', { class: 't-btn', onclick: async () => {
    try { await api.post('/api/terminals/command', { terminalIds: [t.id], type, payload: {} }); toast(`已下发「${label}」指令`); }
    catch (e) { toast(e.message, 'err'); }
  } }, label);
}

/* ---------------- 终端健康看板（P0-3） ---------------- */
async function renderHealth() {
  const root = el('div', { class: 'page-health' });
  const summaryBox = el('div', { class: 't-card' }, spinner());
  const listWrap = el('div', { class: 'h-grid' }, spinner());

  const BANDS = [
    { key: 'good', label: '良好', color: 'var(--c-success)' },
    { key: 'warn', label: '注意', color: 'var(--c-warning)' },
    { key: 'bad', label: '告警', color: 'var(--c-danger)' },
    { key: 'crit', label: '严重', color: '#ef4444' },
    { key: 'offline', label: '离线', color: 'var(--c-text-3)' },
  ];

  function paintSummary(d) {
    const bands = d.bands || {};
    const total = d.total || 0;
    const seg = (n) => total ? `${Math.round((n / total) * 100)}%` : '0%';
    summaryBox.innerHTML = '';
    summaryBox.append(
      el('div', { class: 'h-overview' },
        el('div', { class: 'h-score' },
          el('div', { class: 'h-score-num', text: String(d.avgScore ?? 0) }),
          el('div', { class: 'h-score-lbl', text: '平均健康度 / 100' }),
        ),
        el('div', { class: 'h-bands' },
          el('div', { class: 'h-stack' },
            ...BANDS.map(b => bands[b.key] ? el('div', {
              class: 'h-seg', style: { width: seg(bands[b.key]), background: b.color }, title: `${b.label} ${bands[b.key]}`,
            }) : ''),
          ),
          el('div', { class: 'h-legend' },
            ...BANDS.map(b => el('span', { class: 'h-leg' },
              el('i', { style: { background: b.color } }),
              `${b.label} ${bands[b.key] || 0}`)),
          ),
        ),
      ),
    );
  }

  function paintList(terms) {
    listWrap.innerHTML = '';
    if (!terms.length) { listWrap.append(el('div', { class: 'empty', text: '暂无终端' })); return; }
    for (const t of terms) {
      const issues = (t.issues || []).map(i => el('span', { class: `t-chip ${i.sev === 'crit' ? 'd' : 'w'}` }, i.msg));
      listWrap.append(el('div', { class: 'h-card', onclick: () => openTerminalDetail(fullMap[t.id] || t) },
        el('div', { class: 'h-card-top' },
          el('span', { class: 'h-card-name', text: t.name || t.code || t.id }),
          healthBadge(t.score, t.level),
        ),
        el('div', { class: 'h-card-issues' }, issues.length ? issues : el('span', { class: 't-dnote', text: '无异常项' })),
        el('div', { class: 'h-card-foot' },
          el('span', { class: 't-dnote', text: t.offline ? '已失联' : `心跳 ${fmtAgo(t.lastHeartbeat)}` }),
          t.playing ? el('span', { class: 't-dnote', text: `播放中 ${t.playing}` }) : '',
        ),
      ));
    }
  }

  async function load() {
    let d, terms;
    try { d = await api.get('/api/admin/health/summary'); }
    catch (e) { summaryBox.replaceWith(empty(e.message)); listWrap.replaceWith(el('div')); return; }
    try { terms = await api.get('/api/terminals'); } catch { terms = { items: [] }; }
    fullMap = Object.fromEntries((terms.items || []).map(t => [t.id, t]));
    last = d.terminals || [];
    paintSummary(d);
    paintList(last);
  }

  async function openHealthConfig() {
    let cfg;
    try { cfg = (await api.get('/api/admin/health/config')).config; }
    catch (e) { toast(e.message, 'err'); return; }
    const FIELDS = [
      ['storageWarn', '存储剩余·警告 (%)', 0], ['storageCrit', '存储剩余·严重 (%)', 0],
      ['tempWarn', 'CPU 温度·警告 (°C)', 0], ['tempCrit', 'CPU 温度·严重 (°C)', 0],
      ['cpuWarn', 'CPU 占用·警告 (%)', 0], ['cpuCrit', 'CPU 占用·严重 (%)', 0],
      ['memWarn', '内存占用·警告 (%)', 0], ['memCrit', '内存占用·严重 (%)', 0],
      ['latWarn', '网络延迟·警告 (ms)', 0], ['latCrit', '网络延迟·严重 (ms)', 0],
      ['crashWarn', '崩溃次数·警告', 0], ['crashCrit', '崩溃次数·严重', 0],
    ];
    const inputs = {};
    const form = el('div', { class: 'h-cfg' },
      ...FIELDS.map(([k, label]) => {
        const inp = el('input', { class: 't-input', type: 'number', value: cfg[k] ?? '' });
        inputs[k] = inp;
        return el('label', { class: 'h-cfg-row' }, el('span', { text: label }), inp);
      }),
    );
    const save = async () => {
      const body = {};
      for (const [k] of FIELDS) { const v = Number(inputs[k].value); if (!Number.isNaN(v) && v >= 0) body[k] = v; }
      try { await api.post('/api/admin/health/config', body); toast('健康阈值已保存', 'ok'); load(); }
      catch (e) { toast(e.message, 'err'); }
    };
    openModal(el('div', {}, el('h2', { text: '健康度阈值配置' }), form,
      el('div', { class: 't-dactions', style: { marginTop: '16px' } },
        el('button', { class: 't-btn primary', onclick: save }, '保存'))));
  }

  const searchInput = el('input', { placeholder: '搜索终端…', oninput: (e) => filter(e.target.value) });
  root.append(
    el('div', { class: 't-head' },
      el('div', { class: 't-title', text: '终端健康看板' }),
      el('div', { class: 't-head-actions' },
        el('div', { class: 't-search', style: { width: '240px' } }, el('span', { text: '🔍' }), searchInput),
        can('system:setting') ? el('button', { class: 't-btn', onclick: openHealthConfig }, '⚙ 阈值配置') : '',
      ),
    ),
    summaryBox,
    listWrap,
  );

  let last = [];
  let fullMap = {};   // id -> 完整终端对象（供详情弹窗）
  function filter(q) {
    const txt = (q || '').trim().toLowerCase();
    paintList(txt ? last.filter(t => (t.name || t.code || '').toLowerCase().includes(txt)) : last);
  }

  await load();
  const iv = setInterval(async () => {
    if (!root.isConnected) { clearInterval(iv); return; }
    try { const d = await api.get('/api/admin/health/summary'); last = d.terminals || []; paintSummary(d); paintList(last); } catch { /* ignore */ }
  }, 15000);

  return root;
}

/* ---------------- 素材库 ---------------- */
async function renderMedia() {
  const root = el('div', { class: 'page-media' });

  const statCard = (label, value, hint) => el('div', { class: 't-stat' },
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: String(value) }),
    el('div', { class: 'hint', text: hint || '' }),
  );

  const fileInput = el('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: async (e) => {
    const files = [...e.target.files];
    for (const f of files) {
      const fd = new FormData(); fd.append('file', f);
      try { await api.upload('/api/media/upload', fd); } catch (err) { toast(err.message, 'err'); }
    }
    toast('上传完成', 'ok'); load();
  } });

  const typeSel = el('select', { class: 't-select', onchange: () => paint() },
    el('option', { value: '', text: '全部类型' }),
    el('option', { value: 'image', text: '图片' }),
    el('option', { value: 'video', text: '视频' }),
    el('option', { value: 'audio', text: '音频' }),
    el('option', { value: 'text', text: '文本' }),
  );
  const search = el('div', { class: 't-search' },
    el('span', { text: '🔍' }),
    el('input', { placeholder: '搜索素材名称', oninput: () => paint() }),
  );

  const statsEl = el('div', { class: 't-stats' });
  const grid = el('div', { class: 'm-grid' });

  const kindMeta = {
    image: { icon: '🖼', label: '图片' },
    video: { icon: '▶', label: '视频' },
    audio: { icon: '♪', label: '音频' },
    text:  { icon: '📄', label: '文本' },
    file:  { icon: '📄', label: '文件' },
  };

  function openPreview(m) {
    const km = kindMeta[m.kind] || kindMeta.file;
    const head = el('div', {},
      el('h2', { text: m.name || m.id, style: { marginBottom: '4px' } }),
      el('div', { class: 't-dnote', text: `${km.label} · ${fmtBytes(m.size || 0)}` }),
    );
    const mediaBox = el('div', { style: { background: '#0F1214', borderRadius: 'var(--c-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '12px' } });
    if (m.kind === 'image') {
      mediaBox.style.minHeight = '240px';
      mediaBox.append(el('img', { src: `/api/media/${m.id}/raw`, style: { maxWidth: '100%', maxHeight: '520px', display: 'block' } }));
    } else if (m.kind === 'video') {
      // 先尝试用 <video> 直接播放：H.264 正常预览；装了 HEVC 扩展的浏览器也能播 HEVC。
      // 仅在"确实无法解码"时（error 事件 / 超时无时长）降级为说明卡片，避免一律拦截导致能播的也看不了。
      const ve = el('video', { src: `/api/media/${m.id}/raw`, controls: true, preload: 'metadata', playsInline: true, style: { maxWidth:'100%', maxHeight:'520px', display:'block', background:'#000', borderRadius:'8px' } });
      const isHevc = m.codec === 'hevc' || m.browserPlayable === false;
      const degrade = (reason) => {
        if (ve.parentNode !== mediaBox) return; // 已降级或已被替换
        const card = el('div', { style: { padding:'36px 24px', textAlign:'center', borderRadius:'8px', background:'var(--c-surface-2)', maxWidth:'460px' } },
          el('div', { style: { fontSize:'32px', marginBottom:'12px' }, text: isHevc ? '🎬' : '⚠' }),
          el('p', { style: { fontWeight:600, fontSize:'15px', marginBottom:'8px', color:'var(--c-text-1)' }, text: isHevc ? '该视频为 H.265/HEVC 编码' : '视频加载失败' }),
          el('p', { style: { fontSize:'13px', color:'var(--c-text-2)', lineHeight:'1.6', marginBottom:'16px' },
            text: isHevc
              ? '当前浏览器未启用 HEVC 解码（Windows 版 Chrome/Edge 默认不支持）。点击下方一键安装「HEVC 视频扩展」后即可预览，或直接用安卓终端播放。'
              : '文件可能损坏或格式不受浏览器支持，请在终端上验证播放。' }
          ),
          el('div', { style: { display:'flex', gap:'8px', justifyContent:'center', flexWrap:'wrap', marginBottom:'8px' } },
            isHevc ? el('button', { class: 't-btn primary', onclick: () => installHevcFromAdmin(), text: '⚡ 一键安装 HEVC 扩展' }) : null,
            el('a', { href: `/api/media/${m.id}/raw`, target: '_blank', class: 't-btn', style: { textDecoration:'none' }, text: '⬇ 下载原文件' }),
          ),
          isHevc ? el('p', { style: { fontSize:'12px', color:'var(--c-text-3)', marginTop:'10px', marginBottom:'0' },
            text: '安装方式类似 ADB：点击后弹出 Microsoft Store，点「获取」即完成，刷新页面即可预览。' }) : null,
        );
        ve.replaceWith(card);
      };
      ve.addEventListener('error', () => degrade('error'));
      // HEVC 在无扩展浏览器可能不触发 error，而是长时间黑屏无时长 → 超时探测降级
      if (isHevc) {
        let done = false;
        const probe = () => { if (done) return; if (!ve.duration || isNaN(ve.duration)) { done = true; degrade('timeout'); } };
        ve.addEventListener('loadedmetadata', () => setTimeout(probe, 800));
        ve.addEventListener('stalled', () => setTimeout(probe, 1500));
        setTimeout(probe, 3000);
      }
      mediaBox.append(ve);
    } else if (m.kind === 'audio') {
      mediaBox.append(el('audio', { src: `/api/media/${m.id}/raw`, controls: true, style: { width: '100%', marginTop: '40px', marginBottom: '40px' } }));
    } else {
      mediaBox.style.height = '200px';
      mediaBox.style.fontSize = '44px';
      mediaBox.style.color = 'var(--c-text-3)';
      mediaBox.textContent = km.icon;
    }
    openModal(el('div', { class: 'page-media' }, head, mediaBox));
  }

  function card(m) {
    const km = kindMeta[m.kind] || kindMeta.file;
    const thumb = el('div', { class: 'm-thumb' }, el('div', { class: 'ph', text: km.icon }));
    if (m.kind === 'image') thumb.style.backgroundImage = `url(/api/media/${m.id}/raw)`;
    const badge = lcBadge(m.lifecycleState, m.daysLeft, m.validFrom, m.validUntil);
    const delBtn = can('media:delete') ? el('button', {
      class: 'm-del', text: '✕', title: '删除素材',
      onclick: (e) => { e.stopPropagation(); if (!confirm(`确定删除「${m.name || m.id}」？此操作不可撤销`)) return; api.del(`/api/media/${m.id}`).then(() => { toast('已删除'); load(); }).catch(err => toast(err.message, 'err')); }
    }) : '';
    return el('div', { class: 'm-card', onclick: () => openPreview(m) },
      el('div', { style: { position: 'relative' } }, thumb, delBtn),
      el('div', { class: 'm-meta' },
        el('div', { class: 'm-name', text: m.name || m.id }),
        el('div', { class: 'm-sub', text: `${km.label} · ${fmtBytes(m.size || 0)}` }),
        el('span', { class: 'm-kind', text: km.label }),
        badge ? el('span', { style: { marginLeft: '6px' } }, badge) : '',
      ),
    );
  }

  function paint() {
    const q = (search.querySelector('input').value || '').trim().toLowerCase();
    const kt = typeSel.value;
    let items = all;
    if (q) items = items.filter(m => (m.name || m.id || '').toLowerCase().includes(q));
    if (kt) items = items.filter(m => m.kind === kt);
    const total = all.length;
    const totalSize = all.reduce((s, m) => s + (m.size || 0), 0);
    const imgs = all.filter(m => m.kind === 'image').length;
    const vids = all.filter(m => m.kind === 'video').length;
    const auds = all.filter(m => m.kind === 'audio').length;
    statsEl.innerHTML = '';
    statsEl.append(
      statCard('素材总数', total, `${imgs} 图片 · ${vids} 视频 · ${auds} 音频`),
      statCard('总大小', fmtBytes(totalSize), '全部素材占用'),
      statCard('图片', imgs, '图像类素材'),
      statCard('视频', vids, '视频类素材'),
    );
    grid.innerHTML = '';
    if (!items.length) grid.append(el('div', { class: 'empty', text: all.length ? '没有匹配的素材' : '暂无素材，点击右上角上传' }));
    else items.forEach(m => grid.append(card(m)));
  }

  let all = [];
  async function load() {
    try {
      const d = await api.get('/api/media');
      all = d.items || [];
      paint();
    } catch (e) { root.replaceWith(empty(e.message)); }
  }

  root.append(
    el('div', { class: 't-head' },
      el('div', { class: 't-title', text: '素材库' }),
      can('media:upload') ? el('button', { class: 't-btn primary', onclick: () => fileInput.click() }, '⬆ 上传素材') : '',
    ),
    fileInput,
    el('div', { class: 't-toolbar' }, search, typeSel),
    statsEl,
    el('div', { class: 't-card', style: { padding: '16px' } }, grid),
  );

  load();
  return root;
}

/* ---------------- 节目制作 ---------------- */
async function renderLayouts() {
  const root = el('div', { class: 'page-layouts' });

  const approvalBadge = (state) => {
    const map = { approved: ['s', '已批准'], pending: ['w', '待审'], draft: ['d', '草稿'], rejected: ['r', '已驳回'] };
    const [tone, txt] = map[state] || ['d', state || '草稿'];
    return el('span', { class: `t-badge ${tone}`, text: txt });
  };

  const search = el('div', { class: 't-search' },
    el('span', { text: '🔍' }),
    el('input', { placeholder: '搜索节目名称', oninput: () => paint() }),
  );
  const statusSel = el('select', { class: 't-select', onchange: () => paint() },
    el('option', { value: '', text: '全部状态' }),
    el('option', { value: 'approved', text: '已批准' }),
    el('option', { value: 'pending', text: '待审' }),
    el('option', { value: 'draft', text: '草稿' }),
  );

  const table = el('table', { class: 't-table' });
  const tableWrap = el('div', { class: 't-scroll t-card' }, table);

  function buildTable(items) {
    const rows = items.map(l => el('tr', {},
      el('td', { text: l.name }),
      el('td', { text: l.customer || '-' }),
      el('td', { class: 'mono', text: `${l.width}×${l.height}` }),
      el('td', { text: l.orientation === 'portrait' ? '竖屏' : '横屏' }),
      el('td', {}, approvalBadge(l.approval?.state)),
      el('td', {}, lcBadge(l.lifecycleState, l.daysLeft, l.validFrom, l.validUntil)),
      el('td', {},
        el('button', { class: 't-btn ghost', style: { height: '28px', padding: '0 10px', marginRight: '6px' }, onclick: () => { location.hash = `#/editor/${l.id}`; } }, '编辑'),
        can('layout:delete') ? el('button', { class: 't-btn ghost danger', style: { height: '28px', padding: '0 10px' }, onclick: async () => {
          if (await confirmModal({ title: '删除节目', body: `确认删除「${esc(l.name)}」？`, danger: true })) {
            try { await api.del(`/api/layouts/${l.id}`); toast('已删除', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          }
        } }, '删除') : '',
      ),
    ));
    table.innerHTML = '';
    table.append(
      el('thead', {}, el('tr', {},
        el('th', { text: '名称' }),
        el('th', { text: '客户' }),
        el('th', { text: '分辨率' }),
        el('th', { text: '方向' }),
        el('th', { text: '审批' }),
        el('th', { text: '有效期' }),
        el('th', { text: '操作' }),
      )),
      el('tbody', {}, ...rows),
    );
  }

  function paint() {
    const q = (search.querySelector('input').value || '').trim().toLowerCase();
    const st = statusSel.value;
    let items = all.filter(l => !l.builtin);
    if (q) items = items.filter(l => (l.name || '').toLowerCase().includes(q));
    if (st) items = items.filter(l => (l.approval?.state || 'draft') === st);
    buildTable(items);
  }

  let all = [];
  async function load() {
    try {
      const d = await api.get('/api/layouts');
      all = d.items || [];
      paint();
    } catch (e) { root.replaceWith(empty(e.message)); }
  }

  root.append(
    el('div', { class: 't-head' },
      el('div', { class: 't-title', text: '节目制作' }),
      can('layout:edit') ? el('button', { class: 't-btn primary', onclick: () => createLayout() }, '+ 新建节目') : '',
    ),
    el('div', { class: 't-toolbar' }, search, statusSel),
    tableWrap,
  );

  load();
  return root;
}

async function createLayout() {
  const name = el('input', { class: 't-input', placeholder: '节目名称', value: '新节目' });
  const customer = el('input', { class: 't-input', placeholder: '客户名称（可选，用于播放证明归集）' });
  const orient = el('select', { class: 't-input' },
    el('option', { value: 'landscape', text: '横屏 1920×1080' }),
    el('option', { value: 'portrait', text: '竖屏 1080×1920' }),
  );
  const box = el('div', { class: 'page-layouts' },
    el('h2', { text: '新建节目', style: { marginBottom: '16px' } }),
    el('div', { class: 't-field' }, el('label', { text: '名称' }), name),
    el('div', { class: 't-field', style: { marginTop: '12px' } }, el('label', { text: '客户' }), customer),
    el('div', { class: 't-field', style: { marginTop: '12px' } }, el('label', { text: '画布' }), orient),
    el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '20px' } },
      el('button', { class: 't-btn primary', onclick: async () => {
        const portrait = orient.value === 'portrait';
        const body = { name: name.value || '新节目', width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080 };
        if (customer.value.trim()) body.customer = customer.value.trim();
        try {
          const d = await api.post('/api/layouts', body);
          document.querySelector('.modal-mask')?._close?.();
          location.hash = `#/editor/${d.item.id}`;
        } catch (e) { toast(e.message, 'err'); }
      } }, '创建并编辑'),
    ),
  );
  openModal(box);
}

/* ---------------- 节目编辑器（实时预览 = 终端渲染） ---------------- */
let ed = null;
function renderEditor(params) {
  const id = params.id;
  const root = el('div', { class: 'page-editor' }, spinner());
  (async () => {
    let d; try { d = await api.get(`/api/layouts/${id}`); } catch (e) { root.replaceWith(empty(e.message)); return; }
    const L = JSON.parse(JSON.stringify(d.item));
    let dsList = [];
    try { dsList = (await api.get('/api/admin/datasources')).items || []; } catch {}
    ed = { L, id, selRegion: L.regions?.[0]?.id || null, selItem: null, iframe: null, history: [], historyIdx: -1,
      hsMode: false, selHsId: null, layoutsList: [], mediaList: [] };

    /* ── iframe 画布 ── */
    const iframe = el('iframe', { src: '/player/index.html' });
    const canvasWrap = el('div', { class: 'ed-canvas-wrap' }, iframe);

    /* ── 推送预览 ── */
    const pushPreview = () => { iframe.contentWindow?.postMessage({ type: 'luma:preview', layout: L }, '*'); };
    /* ── 历史记录（撤销/重做） ── */
    const saveHistory = () => {
      const snap = JSON.stringify(L);
      if (ed.history[ed.historyIdx] !== snap) { ed.history = ed.history.slice(0, ed.historyIdx + 1); ed.history.push(snap); ed.historyIdx = ed.history.length - 1; if (ed.history.length > 50) { ed.history.shift(); ed.historyIdx--; } }
      updateStatus();
    };
    const undo = () => { if (ed.historyIdx > 0) { ed.historyIdx--; Object.assign(L, JSON.parse(ed.history[ed.historyIdx])); refreshAll(); } };
    const redo = () => { if (ed.historyIdx < ed.history.length - 1) { ed.historyIdx++; Object.assign(L, JSON.parse(ed.history[ed.historyIdx])); refreshAll(); } };

    /* ── 左栏：组件库 ── */
    const libPanel = el('div', { class: 'ed-lib' });
    function buildLib() {
      // 添加组件到选中区域
      const addWidget = (widgetType) => {
        const r = L.regions.find(x => x.id === ed.selRegion);
        if (!r) { toast('请先在画布中选择或创建一个区域'); return; }
        const it = defaultItem(widgetType);
        r.items.push(it);
        ed.selItem = it.id;
        saveHistory(); refreshAll();
      };

      return el('div', {},
        el('button', { class: 'ed-lib-type', style: { width: '100%', justifyContent: 'center', marginBottom: '8px', background: (!ed.selRegion && !ed.hsMode) ? 'rgba(37,99,235,.12)' : 'transparent' }, onclick: () => {
          ed.hsMode = false; ed.selRegion = null; ed.selItem = null;
          if (hsToggle) { hsToggle.classList.remove('active'); hsToggle.textContent = '◉ 交互热区'; }
          iframe.contentWindow?.postMessage({ type: 'luma:hs-mode', on: false }, '*');
          refreshAll();
        } }, '🎛 节目设置'),
        el('div', { class: 'ed-lib-head', text: '组件库' }),
        // 媒体类型按钮
        el('div', { class: 'ed-lib-types' },
          el('div', { class: 'ed-lib-type', onclick: () => addWidget('image') },
            el('span', { class: 'ico', text: '🖼' }), el('span', {}, '图片')),
          el('div', { class: 'ed-lib-type', onclick: () => addWidget('video') },
            el('span', { class: 'ico', text: '🎬' }), el('span', {}, '视频')),
          el('div', { class: 'ed-lib-type', onclick: () => addWidget('text') },
            el('span', { class: 'ico', text: 'T' }), el('span', {}, '文字')),
          el('div', { class: 'ed-lib-type', onclick: () => addWidget('clock') },
            el('span', { class: 'ico', text: '🕐' }), el('span', {}, '时钟')),
        ),
        // 图部 widget 列表
        el('div', { class: 'ed-lib-sect' }),
        el('div', { class: 'ed-lib-sect-title', text: '图部' }),
        el('div', {},
          el('div', { class: 'ed-lib-item active', onclick: () => addWidget('image') },
            el('span', { class: 'ico', text: '▦' }), el('span', {}, '主视视图')),
          el('div', { class: 'ed-lib-item', onclick: () => addWidget('marquee') },
            el('span', { class: 'ico', text: 'T' }), el('span', {}, '超链文字')),
          el('div', { class: 'ed-lib-item', onclick: () => addWidget('clock') },
            el('span', { class: 'ico', text: '时' }), el('span', {}, '实时时钟')),
        ),
        // 动态数据组件（P1）
        el('div', { class: 'ed-lib-sect' }),
        el('div', { class: 'ed-lib-sect-title', text: '动态数据' }),
        el('div', {},
          el('div', { class: 'ed-lib-item', onclick: () => addWidget('data-text') },
            el('span', { class: 'ico', text: '∑' }), el('span', {}, '模板文本')),
          el('div', { class: 'ed-lib-item', onclick: () => addWidget('data-number') },
            el('span', { class: 'ico', text: '#' }), el('span', {}, '数字牌')),
          el('div', { class: 'ed-lib-item', onclick: () => addWidget('data-chart') },
            el('span', { class: 'ico', text: '▤' }), el('span', {}, '图表')),
        ),
        // 区域列表（可切换选中区域）
        ...(L.regions && L.regions.length ? [
          el('div', { class: 'ed-lib-sect' }),
          el('div', { class: 'ed-lib-sect-title', text: '区域 (' + L.regions.length + ')' }),
          el('div', { class: 'ed-region-list' }, ...L.regions.map(r =>
            el('div', { class: 'ed-region-item ' + (ed.selRegion === r.id ? 'active' : ''), onclick: () => { ed.selRegion = r.id; ed.selItem = null; refreshAll(); } },
              el('span', {}, r.name || r.id),
              el('span', { class: 'del', text: '✕', onclick: (e) => { e.stopPropagation(); L.regions = L.regions.filter(x => x.id !== r.id); ed.selRegion = L.regions[0]?.id || null; ed.selItem = null; saveHistory(); refreshAll(); } }),
            )
          )),
          el('div', { style: { padding: '8px' } },
            el('button', { class: 't-btn ghost', style: { width: '100%', fontSize: '12px' }, onclick: () => {
              const r = { id: 'r_' + Math.random().toString(36).slice(2, 8), name: '区域' + (L.regions.length + 1), x: 0, y: 0, w: L.width, h: L.height, z: 1, loop: true, transition: 'fade', items: [] };
              L.regions.push(r); ed.selRegion = r.id; ed.selItem = null; saveHistory(); refreshAll();
            } }, '+ 新建区域'),
          )
        ] : []),
      );
    }

    /* ── 右栏：属性面板 ── */
    const propsPanel = el('div', { class: 'ed-props' });
    function buildProps() {
      if (ed.hsMode) { buildHotspotPanel(); return; }

      const r = L.regions.find(x => x.id === ed.selRegion);
      const it = r ? r.items.find(x => x.id === ed.selItem) : null;

      // 面板标题
      let title = '属性';
      if (it) {
        if (it.widget === 'image') title = '图片属性';
        else if (it.widget === 'video') title = '视频属性';
        else if (it.widget === 'text' || it.widget === 'marquee') title = '文字属性';
        else if (it.widget === 'clock') title = '时钟属性';
        else if (it.widget === 'qrcode') title = '二维码属性';
        else title = it.widget + ' 属性';
      } else if (r) {
        title = '区域属性';
      } else {
        title = '节目设置';
      }

      const children = [];

      if (!r) {
        // === 节目级设置：导航栈自动返回 ===
        children.push(
          el('div', { class: 'ed-hint', text: '交互热区从其他节目跳转到【本节目】后，顶部会出现「← 返回」导航栏。设置下方超时，可在无人操作时自动返回上一级。' }),
          el('div', { class: 'ed-field' },
            el('label', { class: 'ed-field-label', text: '节目名称' }),
            el('input', { class: 'ed-input', value: L.name || '', oninput: e => { L.name = e.target.value; updateStatus(); } })),
          el('div', { class: 'ed-field' },
            el('label', { class: 'ed-field-label', text: '跳转自动返回 (秒, 0=不自动)' }),
            el('input', { class: 'ed-input', type: 'number', value: L._autoReturnSeconds ?? 0, min: 0, oninput: e => { L._autoReturnSeconds = Math.max(0, parseInt(e.target.value, 10) || 0); pushPreview(); updateStatus(); } })),
          el('div', { class: 'ed-hint', style: { marginTop: '8px' }, text: '超时从进入本节目起计时；期间点击「返回」或再次跳转会重置计时。' }),
        );
      } else if (!it) {
        // === 区域属性 ===
        children.push(
          el('div', { class: 'ed-field' },
            el('label', { class: 'ed-field-label', text: '名称' }),
            el('input', { class: 'ed-input', value: r.name || '', oninput: e => { r.name = e.target.value; pushPreview(); } })),
          el('div', { class: 'ed-field' },
            el('label', { class: 'ed-field-label', text: 'X' }),
            el('input', { class: 'ed-input', type: 'number', value: r.x ?? 0, oninput: e => { r.x = parseFloat(e.target.value) || 0; pushPreview(); } })),
          el('div', { class: 'ed-field' },
            el('label', { class: 'ed-field-label', text: 'Y' }),
            el('input', { class: 'ed-input', type: 'number', value: r.y ?? 0, oninput: e => { r.y = parseFloat(e.target.value) || 0; pushPreview(); } })),
          el('div', { class: 'ed-field' },
            el('label', { class: 'ed-field-label', text: '宽度' }),
            el('input', { class: 'ed-input', type: 'number', value: r.w ?? L.width, oninput: e => { r.w = parseFloat(e.target.value) || L.width; pushPreview(); } })),
          el('div', { class: 'ed-field' },
            el('label', { class: 'ed-field-label', text: '高度' }),
            el('input', { class: 'ed-input', type: 'number', value: r.h ?? L.height, oninput: e => { r.h = parseFloat(e.target.value) || L.height; pushPreview(); } })),
          el('div', { class: 'ed-field' },
            el('label', { class: 'ed-field-label', text: '转场效果' }),
            el('select', { class: 'ed-select', onchange: e => { r.transition = e.target.value; pushPreview(); } },
              ...['fade', 'slide', 'none'].map(o => el('option', { value: o, selected: o === (r.transition || 'fade'), text: o === 'fade' ? '淡入淡出' : o === 'slide' ? '滑动' : '无' })))),
          // 区域内条目列表
          ...(r.items && r.items.length ? [
            el('div', { style: { marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)' } }),
            el('div', { class: 'ed-field-label', style: { marginBottom: '6px' }, text: '条目列表 (' + r.items.length + ')' }),
            ...r.items.map(item => el('div', { class: 'ed-region-item ' + (ed.selItem === item.id ? 'active' : ''), onclick: () => { ed.selItem = item.id; refreshProps(); pushPreview(); } },
              el('span', {}, { image: '🖼 图片', video: '🎬 视频', text: 'T 文字', marquee: 'T 跑马灯', clock: '🕐 时钟', q: '二维码', meeting: '会议室' }[item.widget] || item.widget),
            ))
          ] : [
            el('div', { style: { textAlign: 'center', color: 'var(--text-3)', padding: '20px', fontSize: '12px' } }, '暂无条目，从左侧组件库添加')
          ]),
        );
      } else {
        // === 条目属性（按 widget 类型） ===
        const changeField = (key, val) => { it[key] = val; pushPreview(); };

        // 素材类：图片/视频
        if (it.widget === 'image' || it.widget === 'video') {
          children.push(
            // 素材占位/缩略图
            it.mediaId
              ? el('div', { class: 'ed-media-thumb' }, el('img', { src: '/api/media/' + it.mediaId + '/raw', alt: it.mediaId }))
              : el('div', { class: 'ed-media-slot', onclick: () => openMediaPicker(it) },
                  el('span', { class: 'ico', text: '🖼' }), el('span', {}, '未选择素材')),
            // 操作按钮
            el('div', { class: 'ed-prop-actions' },
              el('button', { class: 'ed-prop-btn primary', onclick: () => openMediaPicker(it) }, '从素材库选择'),
              el('button', { class: 'ed-prop-btn secondary', onclick: () => uploadMediaForItem(it) }, it.widget === 'video' ? '上传新视频' : '上传新图片'),
            ),
            // 位置尺寸
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: 'X 坐标' }),
              el('input', { class: 'ed-input', type: 'number', value: it.x ?? 0, oninput: e => changeField('x', parseFloat(e.target.value) || 0) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: 'Y 坐标' }),
              el('input', { class: 'ed-input', type: 'number', value: it.y ?? 0, oninput: e => changeField('y', parseFloat(e.target.value) || 0) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '宽度' }),
              el('input', { class: 'ed-input', type: 'number', value: it.w ?? 300, oninput: e => changeField('w', parseFloat(e.target.value) || 300) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '高度' }),
              el('input', { class: 'ed-input', type: 'number', value: it.h ?? 180, oninput: e => changeField('h', parseFloat(e.target.value) || 180) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '适配方式' }),
              el('select', { class: 'ed-select', onchange: e => changeField('fit', e.target.value) },
                ...['cover', 'contain', 'stretch'].map(o => el('option', { value: o, selected: o === (it.fit || 'cover'), text: o === 'cover' ? '覆盖' : o === 'contain' ? '包含' : '拉伸' })))),
            // 时长
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '时长（秒，0=常驻）' }),
              el('input', { class: 'ed-input', type: 'number', value: it.duration ?? 8, min: 0, oninput: e => changeField('duration', parseFloat(e.target.value) || 0) })),
          );
        }
        // 文字类
        else if (it.widget === 'text' || it.widget === 'marquee') {
          children.push(
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '文本内容' }),
              el('textarea', { class: 'ed-input', rows: 3, style: { resize: 'vertical' }, value: it.text || it.html || '', oninput: e => { changeField('text', e.target.value); changeField('html', e.target.value); } })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '字号 (px)' }),
              el('input', { class: 'ed-input', type: 'number', value: it.fontSize || 36, min: 8, oninput: e => changeField('fontSize', parseInt(e.target.value) || 36) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '颜色' }),
              el('input', { class: 'ed-input', type: 'color', value: it.color || '#ffffff', style: { height: '36px', padding: '2px' }, oninput: e => changeField('color', e.target.value) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: 'X 坐标' }),
              el('input', { class: 'ed-input', type: 'number', value: it.x ?? 0, oninput: e => changeField('x', parseFloat(e.target.value) || 0) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: 'Y 坐标' }),
              el('input', { class: 'ed-input', type: 'number', value: it.y ?? 0, oninput: e => changeField('y', parseFloat(e.target.value) || 0) })),
            ...(it.widget === 'marquee' ? [
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '滚动速度 (px/s)' }),
                el('input', { class: 'ed-input', type: 'number', value: it.speed || 60, min: 10, oninput: e => changeField('speed', parseFloat(e.target.value) || 60) }))
            ] : []),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '时长（秒，0=常驻）' }),
              el('input', { class: 'ed-input', type: 'number', value: it.duration ?? 8, min: 0, oninput: e => changeField('duration', parseFloat(e.target.value) || 0) })),
          );
        }
        // 时钟
        else if (it.widget === 'clock') {
          children.push(
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '格式' }),
              el('select', { class: 'ed-select', onchange: e => changeField('format', e.target.value) },
                el('option', { value: 'digital', selected: (it.format || 'digital') === 'digital', text: '数字时钟' }),
                el('option', { value: 'analog', selected: it.format === 'analog', text: '模拟时钟' }))),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '字号 (px)' }),
              el('input', { class: 'ed-input', type: 'number', value: it.fontSize || 64, min: 16, oninput: e => changeField('fontSize', parseInt(e.target.value) || 64) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '颜色' }),
              el('input', { class: 'ed-input', type: 'color', value: it.color || '#ffffff', style: { height: '36px', padding: '2px' }, oninput: e => changeField('color', e.target.value) })),
            el('div', { class: 'ed-field' },
              el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-2)' }, text: '显示日期' },
                el('input', { type: 'checkbox', checked: !!it.showDate, onchange: e => changeField('showDate', e.target.checked), style: { width: '16px', height: '16px' } }))),
          );
        }
        // 二维码
        else if (it.widget === 'qrcode') {
          children.push(
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '内容 (URL 或文本)' }),
              el('input', { class: 'ed-input', value: it.content || '', oninput: e => changeField('content', e.target.value) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: 'X 坐标' }),
              el('input', { class: 'ed-input', type: 'number', value: it.x ?? 0, oninput: e => changeField('x', parseFloat(e.target.value) || 0) })),
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: 'Y 坐标' }),
              el('input', { class: 'ed-input', type: 'number', value: it.y ?? 0, oninput: e => changeField('y', parseFloat(e.target.value) || 0) })),
          );
        }

        // 动态数据源组件（P1）
        else if (it.widget === 'data-text' || it.widget === 'data-number' || it.widget === 'data-chart') {
          const dsSel = el('select', { class: 'ed-select', onchange: e => changeField('dataSourceId', e.target.value) },
            el('option', { value: '', text: '— 选择数据源 —', selected: !it.dataSourceId ? 'selected' : null }),
            ...dsList.map(x => el('option', { value: x.id, selected: x.id === it.dataSourceId ? 'selected' : null, text: x.name + ' (' + x.type + ')' })),
          );
          children.push(
            el('div', { class: 'ed-field' },
              el('label', { class: 'ed-field-label', text: '数据源' }), dsSel),
            el('button', { class: 't-btn ghost', style: { marginBottom: '8px' }, onclick: () => { location.hash = '#/datasources'; } }, '管理数据源 →'),
          );
          if (it.widget === 'data-text') {
            children.push(
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '模板（支持 {{data.字段}}）' }),
                el('textarea', { class: 'ed-input', rows: 3, value: it.html || '', oninput: e => changeField('html', e.target.value), placeholder: '例如：当前值：{{data.value}}' })),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '降级文本（加载失败显示）' }),
                el('input', { class: 'ed-input', value: it.fallback || '', oninput: e => changeField('fallback', e.target.value) })),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '字号' }),
                el('input', { class: 'ed-input', type: 'number', value: it.fontSize ?? 48, oninput: e => changeField('fontSize', parseFloat(e.target.value) || 48) })),
            );
          } else if (it.widget === 'data-number') {
            children.push(
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '数值字段' }),
                el('input', { class: 'ed-input', value: it.valueField || '', oninput: e => changeField('valueField', e.target.value), placeholder: '如 value' })),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '标签' }),
                el('input', { class: 'ed-input', value: it.label || '', oninput: e => changeField('label', e.target.value) })),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '单位' }),
                el('input', { class: 'ed-input', value: it.unit || '', oninput: e => changeField('unit', e.target.value), placeholder: '如 人 / %' })),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '降级文本' }),
                el('input', { class: 'ed-input', value: it.fallback || '', oninput: e => changeField('fallback', e.target.value) })),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '字号' }),
                el('input', { class: 'ed-input', type: 'number', value: it.fontSize ?? 96, oninput: e => changeField('fontSize', parseFloat(e.target.value) || 96) })),
            );
          } else if (it.widget === 'data-chart') {
            children.push(
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '图表类型' }),
                el('select', { class: 'ed-select', onchange: e => changeField('chartType', e.target.value) },
                  ...['bar', 'line', 'pie', 'donut'].map(o => el('option', { value: o, selected: o === (it.chartType || 'bar') ? 'selected' : null, text: o === 'bar' ? '柱状图' : o === 'line' ? '折线图' : o === 'pie' ? '饼图' : '环形图' })))),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '标签字段' }),
                el('input', { class: 'ed-input', value: it.labelField || '', oninput: e => changeField('labelField', e.target.value), placeholder: '如 label' })),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '数值字段' }),
                el('input', { class: 'ed-input', value: it.valueField || '', oninput: e => changeField('valueField', e.target.value), placeholder: '如 value' })),
              el('div', { class: 'ed-field' },
                el('label', { class: 'ed-field-label', text: '降级文本' }),
                el('input', { class: 'ed-input', value: it.fallback || '', oninput: e => changeField('fallback', e.target.value) })),
            );
          }
        }
        // 通用：删除按钮
        children.push(
          el('div', { style: { marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)' } }),
          el('button', { class: 't-btn danger', style: { width: '100%' }, onclick: () => {
            r.items = r.items.filter(x => x.id !== it.id);
            ed.selItem = null;
            saveHistory(); refreshAll();
          } }, '删除此条目'),
        );
      }

      propsPanel.innerHTML = '';
      propsPanel.appendChild(el('div', { class: 'ed-props-head', text: title }));
      propsPanel.appendChild(el('div', { class: 'ed-props-body' }, ...children));
    }

    /* ── 交互热区属性面板（P1） ── */
    function buildHotspotPanel() {
      const list = L.hotspots || [];
      const sel = list.find(h => h.id === ed.selHsId);
      const children = [];

      children.push(el('div', { class: 'ed-hint', text: '在画布上按住拖拽即可绘制热区；点击热区可选中，拖动移动、拖右下角把手缩放。' }));
      children.push(el('button', { class: 't-btn ghost', style: { width: '100%', marginBottom: '10px' },
        onclick: () => iframe.contentWindow?.postMessage({ type: 'luma:hs-add-center' }, '*') }, '+ 在中心添加热区'));

      children.push(el('div', { class: 'ed-field-label', style: { marginTop: '4px', marginBottom: '6px' }, text: `热区列表 (${list.length})` }));
      if (list.length) {
        children.push(el('div', { class: 'ed-region-list' }, ...list.map(h =>
          el('div', { class: 'ed-region-item ' + (h.id === ed.selHsId ? 'active' : ''), onclick: () => { ed.selHsId = h.id; refreshProps(); } },
            el('span', {}, (h.action && h.action.label) || (h.action && h.action.type) || '热区'),
            el('span', { class: 'del', text: '✕', onclick: (e) => { e.stopPropagation(); iframe.contentWindow?.postMessage({ type: 'luma:hs-remove', id: h.id }, '*'); if (ed.selHsId === h.id) ed.selHsId = null; refreshProps(); } }),
          )
        )));
      } else {
        children.push(el('div', { style: { textAlign: 'center', color: 'var(--c-text-3)', padding: '16px', fontSize: '12px' } }, '暂无热区，先绘制一个吧'));
      }

      if (sel) {
        const a = sel.action || (sel.action = { type: 'popup', target: '', label: '', duration: 10 });
        const send = (patch) => { iframe.contentWindow?.postMessage({ type: 'luma:hs-update', id: sel.id, patch }, '*'); };
        const sendAction = (na) => send({ action: na });
        children.push(el('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--c-border)' } }));
        children.push(el('div', { class: 'ed-field' },
          el('label', { class: 'ed-field-label', text: '标签（显示名）' }),
          el('input', { class: 'ed-input', value: a.label || '', oninput: e => { a.label = e.target.value; sendAction({ ...a, label: e.target.value }); } })));

        const typeSel = el('select', { class: 'ed-select', onchange: (e) => {
          const t = e.target.value;
          const na = { type: t, target: '', label: a.label, duration: 10, mediaId: '', text: '' };
          sendAction(na); refreshProps();
        } }, ...['none', 'popup', 'url', 'layout'].map(o => el('option', { value: o, selected: o === (a.type || 'popup'), text: o === 'none' ? '无操作' : o === 'popup' ? '弹窗' : o === 'url' ? '打开链接' : '跳转节目' })));
        children.push(el('div', { class: 'ed-field' }, el('label', { class: 'ed-field-label', text: '动作类型' }), typeSel));

        if (a.type === 'popup') {
          const mediaOpts = [el('option', { value: '', text: '— 纯文本 —' })].concat((ed.mediaList || []).map(m => el('option', { value: m.id, selected: m.id === a.mediaId, text: m.name || m.id })));
          children.push(el('div', { class: 'ed-field' }, el('label', { class: 'ed-field-label', text: '弹窗素材（留空则用文本）' }),
            el('select', { class: 'ed-select', onchange: e => sendAction({ ...a, mediaId: e.target.value }) }, ...mediaOpts)));
          children.push(el('div', { class: 'ed-field' }, el('label', { class: 'ed-field-label', text: '弹窗文本（无素材时显示）' }),
            el('textarea', { class: 'ed-input', rows: 2, value: a.text || '', oninput: e => { a.text = e.target.value; sendAction({ ...a, text: e.target.value }); } })));
          children.push(el('div', { class: 'ed-field' }, el('label', { class: 'ed-field-label', text: '自动关闭(秒, 0=不自动)' }),
            el('input', { class: 'ed-input', type: 'number', value: a.duration ?? 10, oninput: e => sendAction({ ...a, duration: parseInt(e.target.value, 10) || 0 }) })));
        } else if (a.type === 'url') {
          children.push(el('div', { class: 'ed-field' }, el('label', { class: 'ed-field-label', text: '链接 URL' }),
            el('input', { class: 'ed-input', value: a.target || '', placeholder: 'https://...', oninput: e => sendAction({ ...a, target: e.target.value }) })));
        } else if (a.type === 'layout') {
          const lopts = [el('option', { value: '', text: '— 选择节目 —' })].concat((ed.layoutsList || []).map(l => el('option', { value: l.id, selected: l.id === a.target, text: l.name || l.id })));
          children.push(el('div', { class: 'ed-field' }, el('label', { class: 'ed-field-label', text: '跳转到的节目' }),
            el('select', { class: 'ed-select', onchange: e => sendAction({ ...a, target: e.target.value }) }, ...lopts)));
          children.push(el('div', { class: 'ed-field' }, el('label', { class: 'ed-field-label', text: '自动返回(秒, 0=不自动/用节目默认)' }),
            el('input', { class: 'ed-input', type: 'number', min: '0', max: '3600', value: a.autoReturnSeconds ?? '', placeholder: '留空则使用节目设置', oninput: e => { const v = parseInt(e.target.value, 10); sendAction({ ...a, autoReturnSeconds: isNaN(v) ? null : v }); } })));
        }

        children.push(el('button', { class: 't-btn danger', style: { width: '100%', marginTop: '12px' },
          onclick: () => { iframe.contentWindow?.postMessage({ type: 'luma:hs-remove', id: sel.id }, '*'); ed.selHsId = null; refreshProps(); } }, '删除此热区'));
      }

      propsPanel.innerHTML = '';
      propsPanel.appendChild(el('div', { class: 'ed-props-head', text: '交互热区' }));
      propsPanel.appendChild(el('div', { class: 'ed-props-body' }, ...children));
    }

    /* ── 素材库选择器（弹窗） ── */
    async function openMediaPicker(targetItem) {
      let md; try { md = await api.get('/api/media'); } catch (e) { toast('加载素材失败：' + e.message, 'err'); return; }
      const items = (md.items || []).filter(m => targetItem.widget === 'video' ? m.kind === 'video' : m.kind === 'image');
      const list = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, maxHeight: '300px', overflowY: 'auto' } });
      items.forEach(m => {
        list.appendChild(el('div', { style: { cursor: 'pointer', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg)' }, onclick: () => {
          targetItem.mediaId = m.id;
          targetItem.src = '/api/media/' + m.id + '/raw';
          document.querySelector('.modal-mask')?._close?.();
          saveHistory(); refreshAll(); pushPreview();
          toast('已选择素材：' + (m.name || m.id));
        }},
          m.kind === 'image'
            ? el('img', { src: '/api/media/' + m.id + '/raw', style: { width: '100%', height: '80px', objectFit: 'cover' } })
            : el('div', { style: { height: '80px', display: 'grid', placeItems: 'center', background: 'var(--bg-elev)', color: 'var(--text-3)', fontSize: '12px' }}, '▶ ' + (m.name || m.id)),
          el('div', { style: { padding: '4px 6px', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-2)' }}, m.name || m.id),
        ));
      });
      if (!items.length) list.appendChild(el('div', { style: { gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-3)', padding: '30px' }}, '素材库为空，请先上传'));
      openModal(el('div', {},
        el('h3', { style: { marginBottom: '12px' }, text: '选择素材' }),
        list,
      ));
    }

    /* ── 上传素材到条目 ── */
    async function uploadMediaForItem(targetItem) {
      const inp = el('input', { type: 'file', accept: targetItem.widget === 'video' ? 'video/*' : 'image/*', style: { display: 'none' }, onchange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const fd = new FormData(); fd.append('file', f);
        try {
          const res = await api.upload('/api/media/upload', fd);
          const uploaded = (res.items && res.items[0]) || res;
          targetItem.mediaId = uploaded.id;
          targetItem.src = '/api/media/' + targetItem.mediaId + '/raw';
          saveHistory(); refreshAll(); pushPreview();
          toast('已上传并绑定：' + (f.name));
        } catch (err) { toast(err.message, 'err'); }
      }});
      document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 5000);
    }

    /* ── 底部状态栏 ── */
    const statusEl = el('span', { class: 'saved', text: '所有更改已保存' });
    const zoomEl = el('span', { class: 'zoom', text: `缩放 50% | ${L.width || 1920} × ${L.height || 1080} px` });
    function updateStatus() { statusEl.textContent = ed.historyIdx >= 0 && ed.history[ed.historyIdx] === JSON.stringify(L) ? '所有更改已保存' : '有未保存的更改'; }

    /* ── 刷新全部 ── */
    const refreshLib = () => { libPanel.innerHTML = ''; libPanel.appendChild(buildLib()); };
    const refreshProps = () => buildProps();
    const refreshAll = () => { refreshLib(); refreshProps(); pushPreview(); updateStatus(); };

    iframe.addEventListener('load', () => { pushPreview(); saveHistory(); });

    /* ── 交互热区（P1）：选项懒加载 + 消息桥 ── */
    async function loadHsOptions() {
      try { ed.layoutsList = (await api.get('/api/layouts?type=program')).items || []; } catch {}
      try { ed.mediaList = (await api.get('/api/media')).items || []; } catch {}
    }

    const hsToggle = el('button', { class: 'ed-btn', title: '交互热区', onclick: () => {
      ed.hsMode = !ed.hsMode;
      ed.selHsId = null;
      hsToggle.classList.toggle('active', ed.hsMode);
      hsToggle.textContent = ed.hsMode ? '✕ 退出热区' : '◉ 交互热区';
      iframe.contentWindow?.postMessage({ type: 'luma:hs-mode', on: ed.hsMode }, '*');
      if (ed.hsMode) loadHsOptions();
      refreshProps();
    } }, '◉ 交互热区');

    // 接收来自播放 iframe 的热区选择/变更回传
    window.addEventListener('message', (ev) => {
      const d = ev.data; if (!d || !d.type) return;
      if (d.type === 'luma:hs-select') {
        ed.selHsId = d.hs ? d.hs.id : null;
        if (ed.hsMode) refreshProps();
      } else if (d.type === 'luma:hs-change') {
        L.hotspots = d.hotspots || [];
        if (ed.hsMode) { saveHistory(); updateStatus(); refreshProps(); }
      }
    });

    /* ── 提交审批 ── */
    const doSubmitForApproval = async () => {
      try {
        await api.put(`/api/layouts/${id}`, L);
        await api.post(`/api/layouts/${id}/submit`, { comment: '', urgency: 'normal' });
        toast('已保存并提交审批', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };

    /* ── 组装页面 ── */
    const wrap = el('div', { class: 'page-editor' },
      // 顶栏
      el('div', { class: 'ed-topbar' },
        el('span', { class: 'ed-title', text: `编辑 · ${L.name}` }),
        el('input', { class: 't-input', style: { width: '140px', height: '28px', fontSize: '12px' }, placeholder: '客户（可选）', value: L.customer || '', oninput: (e) => { L.customer = e.target.value.trim() || undefined; } }),
        el('div', { class: 'ed-actions' },
          el('button', { class: 'ed-btn ed-btn-icon', title: '撤销', onclick: undo }, '↶'),
          el('button', { class: 'ed-btn ed-btn-icon', title: '重做', onclick: redo }, '↷'),
          el('a', { class: 'ed-btn', href: `/player/index.html?layoutId=${id}`, target: '_blank', text: '新窗口预览' }),
          hsToggle,
          el('button', { class: 'ed-btn primary', onclick: async () => {
            try { await api.put(`/api/layouts/${id}`, L); saveHistory(); toast('已保存', 'ok'); updateStatus(); }
            catch (e) { toast(e.message, 'err'); }
          } }, '保存'),
          el('button', { class: 'ed-btn primary', onclick: doSubmitForApproval, text: '提交审批' }),
        ),
      ),
      // 三栏主体
      el('div', { class: 'ed-body' },
        libPanel,
        canvasWrap,
        propsPanel,
      ),
      // 底部状态栏
      el('div', { class: 'ed-statusbar' }, statusEl, zoomEl),
    );

    refreshAll();
    root.replaceWith(wrap);
  })();
  return root;
}
function defaultItem(w) {
  const base = { id: 'i_' + Math.random().toString(36).slice(2, 8), widget: w, duration: 8 };
  if (w === 'text') return { ...base, text: '示例文本', fontSize: 48, color: '#ffffff', align: 'center' };
  if (w === 'marquee') return { ...base, text: '滚动播报内容', fontSize: 40, color: '#ffffff', bg: 'rgba(0,0,0,0.5)', speed: 60 };
  if (w === 'clock') return { ...base, format: 'digital', showDate: true, fontSize: 64, color: '#ffffff' };
  if (w === 'qrcode') return { ...base, content: 'https://example.com', showText: true };
  if (w === 'meeting') return { ...base, roomName: '会议室 A', busy: false };
  if (w === 'data-text') return { id: base.id, widget: w, duration: 0, dataSourceId: '', html: '当前值：{{data.value}}', fallback: '数据加载中…', fontSize: 48, color: '#ffffff', align: 'center' };
  if (w === 'data-number') return { id: base.id, widget: w, duration: 0, dataSourceId: '', valueField: 'value', label: '指标', unit: '', fallback: '—', fontSize: 96, color: '#ffffff', align: 'center' };
  if (w === 'data-chart') return { id: base.id, widget: w, duration: 0, dataSourceId: '', chartType: 'bar', labelField: 'label', valueField: 'value', fallback: '暂无数据' };
  return base;
}
const field = (label, input) => el('div', { class: 'prop-row' }, el('label', { text: label }), input);
const num = (v, on) => el('input', { class: 'input', type: 'number', value: v ?? 0, style: { maxWidth: '110px' }, oninput: e => on(parseFloat(e.target.value) || 0) });
const sel = (opts, v, on) => el('select', { class: 'input', onchange: e => on(e.target.value) }, ...opts.map(o => el('option', { value: o, selected: o === v ? 'selected' : null, text: o })));

/* ---------------- 排期下发 ---------------- */
async function renderSchedules() {
  const root = el('div', { class: 'page-schedules' });
  const cardWrap = el('div', { class: 'card' });
  let all = [], layouts = [];
  const modeLabel = { default: '默认', cycle: '周期', insert: '插播', exclusive: '独占' };
  const paint = () => {
    const table = el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: '名称' }), el('th', { text: '节目' }), el('th', { text: '方式' }), el('th', { text: '审批' }), el('th', { text: '有效期' }), el('th', { text: '状态' }), el('th', { text: '' }))),
      el('tbody', {}, ...all.map(s => {
        const lo = layouts.find(l => l.id === s.layoutId);
        const ap = lo?.approval?.state;
        const apBadge = ap === 'approved' ? el('span', { class: 'badge s', text: '已审' })
          : ap === 'pending' ? el('span', { class: 'badge w', text: '待审' })
          : ap === 'rejected' ? el('span', { class: 'badge r', text: '驳回' })
          : el('span', { class: 'badge d', text: '-' });
        return el('tr', {},
          el('td', { text: s.name }),
          el('td', { text: lo?.name || s.layoutId || '-' }),
          el('td', { text: modeLabel[s.mode] || s.mode }),
          el('td', {}, apBadge),
          el('td', {}, lcBadge(s.lifecycleState, s.daysLeft, s.validFrom, s.validUntil)),
          el('td', {}, el('span', { class: 'badge ' + (s.enabled !== false ? 'ok' : 'off'), text: s.enabled !== false ? '已发布' : '草稿' })),
          el('td', {},
            !s.enabled && can('schedule:publish') ? el('button', { class: 'btn sm primary', onclick: () => openPublishModal(s) }, '发布') : '',
            s.enabled && can('schedule:publish') ? el('button', { class: 'btn sm', style: { marginLeft: '4px' }, onclick: async () => {
              try { await api.put(`/api/schedules/${s.id}`, { enabled: false }); toast('已停用', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
            } }, '停用') : '',
            can('schedule:publish') ? el('button', { class: 'btn sm', style: { marginLeft: '4px' }, onclick: () => openDeployHistory(s) }, '版本记录') : '',
            can('schedule:edit') ? el('button', { class: 'btn sm danger', style: { marginLeft: '6px' }, onclick: async () => {
              if (await confirmModal({ title: '删除排期', body: `确认删除「${esc(s.name)}」？`, danger: true })) {
                try { await api.del(`/api/schedules/${s.id}`); toast('已删除', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
              }
            } }, '删除') : '',
          ),
        );
      })),
    );
    cardWrap.innerHTML = '';
    cardWrap.appendChild(all.length ? table : empty('暂无排期'));
  };
  const reload = async () => {
    let d, ls;
    try { d = await api.get('/api/schedules'); ls = await api.get('/api/layouts'); }
    catch (e) { cardWrap.innerHTML = ''; cardWrap.appendChild(empty(e.message)); return; }
    all = d.items || [];
    layouts = (ls.items || []).filter(l => !l.builtin);
    paint();
    // rebuild head (for modal fresh selects)
    root.childNodes[0].replaceWith(buildHead());
  };
  const buildHead = () => {
    const name = el('input', { class: 'input', placeholder: '排期名称' });
    const layoutSel = el('select', { class: 'input' }, ...layouts.map(l => el('option', { value: l.id, text: l.name })));
    const modeSel = el('select', { class: 'input' }, ...Object.entries(modeLabel).map(([k, v]) => el('option', { value: k, text: v })));
    return pageHead('排期管理',
      can('schedule:edit') ? el('button', { class: 'btn primary', onclick: () => openModal(el('div', {},
        el('h2', { text: '新建排期' }), field('名称', name), field('节目', layoutSel), field('播放方式', modeSel),
        el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '16px' } },
          el('button', { class: 'btn primary', onclick: async () => {
            try { await api.post('/api/schedules', { name: name.value || '新排期', layoutId: layoutSel.value, mode: modeSel.value, target: { all: true }, enabled: false }); document.querySelector('.modal-mask')?._close?.(); toast('排期已创建（草稿状态，请点击「发布」下发）', 'ok'); reload(); }
            catch (e) { toast(e.message, 'err'); }
          } }, '创建')),
      )) }, '+ 新建排期') : '',
    );
  };
  root.appendChild(buildHead());
  root.appendChild(cardWrap);
  reload();
  return root;
}

/* ---------------- 下发版本管理（回滚 + 灰度） ---------------- */
const DEPLOY_MODE_LABEL = { full: '全量', pilot: '灰度试点', rollback: '回滚', promote: '灰度转全量' };
const DEPLOY_MODE_TONE = { full: 's', pilot: 'w', rollback: 'd', promote: 's' };
function deployModeBadge(mode) {
  return el('span', { class: `t-badge ${DEPLOY_MODE_TONE[mode] || 'off'}`, text: DEPLOY_MODE_LABEL[mode] || mode });
}

function openPublishModal(s) {
  const all = el('input', { type: 'radio', name: 'pmode', value: 'full', checked: 'checked' });
  const pilot = el('input', { type: 'radio', name: 'pmode', value: 'pilot' });
  const selWrap = el('div', { style: { display: 'none', marginTop: '10px' } });
  pilot.addEventListener('change', () => { selWrap.style.display = pilot.checked ? 'block' : 'none'; });
  all.addEventListener('change', () => { selWrap.style.display = 'none'; });
  const box = el('div', {},
    el('h2', { text: `发布排期 · ${s.name}` }),
    el('label', { class: 't-check' }, all, el('span', { text: '全量发布（推送到全部目标终端）' })),
    el('label', { class: 't-check', style: { marginTop: '8px' } }, pilot, el('span', { text: '灰度试点（先选 1–3 台确认，再推广全量）' })),
    selWrap,
    el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '18px', gap: '8px' } },
      el('button', { class: 't-btn', onclick: () => document.querySelector('.modal-mask')?._close?.() }, '取消'),
      el('button', { class: 't-btn primary', onclick: async () => {
        const isPilot = pilot.checked;
        let pilotIds = [];
        if (isPilot) {
          pilotIds = [...selWrap.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
          if (pilotIds.length < 1) { toast('请至少选择 1 台试点终端', 'err'); return; }
        }
        try {
          const d = await api.post(`/api/schedules/${s.id}/publish`, { pilotTerminalIds: pilotIds });
          toast(isPilot ? `已灰度下发到 ${d.pushed} 台试点，确认无误后可在「版本记录」中推广全量` : `已全量下发到 ${d.pushed} 台终端`, 'ok');
          document.querySelector('.modal-mask')?._close?.(); reload();
        } catch (e) { toast(e.message, 'err'); }
      } }, '发布'),
    ),
  );
  api.get('/api/terminals').then(r => {
    const ts = (r.items || []).filter(t => t.approved);
    if (!ts.length) { selWrap.append(el('div', { class: 't-dnote', text: '当前没有已准入的终端，无法灰度试点' })); return; }
    selWrap.append(el('div', { class: 't-dnote', text: '选择试点终端（建议 1–3 台）：' }));
    ts.forEach(t => selWrap.append(el('label', { class: 't-check' },
      el('input', { type: 'checkbox', value: t.id }),
      el('span', { text: `${t.name || t.code || t.id}${t.net?.ip ? ' · ' + t.net.ip : ''}` }))));
  }).catch(() => {});
  openModal(box);
}

function openDeployHistory(s) {
  const box = el('div', {}, el('h2', { text: `下发版本记录 · ${s.name}` }),
    el('div', { class: 't-dnote', text: '每次发布/灰度/回滚都会留痕，可一键回到任意正常版本。' }), spinner());
  openModal(box);
  const body = el('div', { style: { marginTop: '12px' } });
  box.append(body);
  (async () => {
    let d;
    try { d = await api.get(`/api/deploy/versions?scheduleId=${s.id}`); }
    catch (e) { body.replaceChildren(empty(e.message)); return; }
    const items = d.items || [];
    if (!items.length) { body.replaceChildren(empty('暂无下发记录')); return; }
    const rows = items.map(v => el('div', { class: 'card', style: { padding: '12px', marginBottom: '8px' } },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        deployModeBadge(v.mode),
        el('span', { style: { color: 'var(--c-text-3)', fontSize: '12px' }, text: `${new Date(v.createdAt).toLocaleString()} · ${v.createdBy || ''}` }),
        el('span', { style: { marginLeft: 'auto', color: 'var(--c-text-3)', fontSize: '12px' }, text: `目标 ${v.targets?.length || 0} 台` }),
      ),
      v.note ? el('div', { style: { fontSize: '12px', color: 'var(--c-text-2)', marginTop: '6px' }, text: v.note }) : '',
      el('div', { style: { marginTop: '10px', display: 'flex', gap: '8px' } },
        can('schedule:publish') ? el('button', { class: 't-btn ghost', onclick: async () => {
          if (await confirmModal({ title: '一键回滚', body: '确认回滚到该版本？将还原当时的排期与节目内容并重新推送。', danger: true })) {
            try { const r = await api.post('/api/deploy/rollback', { versionId: v.id }); toast(`已回滚，重新推送 ${r.pushed} 台`, 'ok'); openDeployHistory(s); reload(); } catch (e) { toast(e.message, 'err'); }
          }
        } }, '回滚到此版本') : '',
        (v.mode === 'pilot' && can('schedule:publish')) ? el('button', { class: 't-btn primary', onclick: async () => {
          try { const r = await api.post('/api/deploy/promote', { versionId: v.id }); toast(`已推广全量，推送 ${r.pushed} 台`, 'ok'); openDeployHistory(s); reload(); } catch (e) { toast(e.message, 'err'); }
        } }, '推广全量') : '',
        can('schedule:publish') ? el('button', { class: 't-btn ghost', onclick: async () => {
          try { const r = await api.post('/api/deploy/retry', { versionId: v.id }); toast(`已重推 ${r.pushed} 台`, 'ok'); } catch (e) { toast(e.message, 'err'); }
        } }, '重试') : '',
      ),
    ));
    body.replaceChildren(...rows);
  })();
}

/* ---------------- 审批中心 ---------------- */
async function renderApprovals() {
  const root = el('div', { class: 'page-approvals' });
  const cardWrap = el('div', { class: 'card' });
  let all = [];
  const paint = () => {
    // 合并 pending + draft + rejected
    const items = all.filter(l => l.approval?.state !== 'approved');
    const table = el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: '名称' }), el('th', { text: '状态' }), el('th', { text: '' }))),
      el('tbody', {}, ...items.map(l => {
        const st = l.approval?.state || 'draft';
        const badge = st === 'pending' ? el('span', { class: 'badge w', text: '待审批' })
          : st === 'rejected' ? el('span', { class: 'badge r', text: '已驳回' })
          : el('span', { class: 'badge d', text: '草稿' });
        return el('tr', {},
          el('td', { text: l.name }),
          el('td', {}, badge),
          el('td', {},
            can('layout:approve') && st === 'pending' ? el('button', { class: 'btn sm primary', onclick: async () => {
              try {
                await api.post(`/api/layouts/${l.id}/approve`, { pass: true, comment: '' });
                // 审批通过后自动创建排期草稿，方便直接进入下发流程
                try {
                  await api.post('/api/schedules', { name: `${l.name}（已审批）`, layoutId: l.id, mode: 'default', target: { all: true }, enabled: false });
                  toast('已批准，已自动加入排期列表', 'ok');
                } catch { toast('已批准（加入排期失败，可手动新建）', 'ok'); }
                reload();
              } catch (e) { toast(e.message, 'err'); }
            } }, '批准') : '',
            can('layout:approve') && st === 'pending' ? el('button', { class: 'btn sm danger', style: { marginLeft: '4px' }, onclick: async () => {
              try { await api.post(`/api/layouts/${l.id}/approve`, { pass: false, comment: '' }); toast('已驳回', 'ok'); reload(); }
              catch (e) { toast(e.message, 'err'); }
            } }, '驳回') : '',
            (st === 'rejected' || st === 'draft') ? el('button', { class: 'btn sm', style: { marginLeft: '6px' }, onclick: () => { location.hash = `#/editor/${l.id}`; } }, '编辑') : '',
          ),
        );
      })),
    );
    cardWrap.innerHTML = '';
    cardWrap.appendChild(items.length ? table : empty('没有待处理的节目'));
  };
  const reload = async () => {
    let d;
    try { d = await api.get('/api/approvals?state=pending'); } catch (e) { cardWrap.innerHTML = ''; cardWrap.appendChild(empty(e.message)); return; }
    all = d.items || [];
    // 同时拉取 draft 和 rejected 的节目
    try {
      const dd = await api.get('/api/approvals?state=draft');
      all = [...all, ...(dd.items || []).filter(l => !all.some(a => a.id === l.id))];
    } catch {}
    try {
      const rd = await api.get('/api/approvals?state=rejected');
      all = [...all, ...(rd.items || []).filter(l => !all.some(a => a.id === l.id))];
    } catch {}
    paint();
  };
  root.appendChild(pageHead('审批中心'));
  root.appendChild(cardWrap);
  reload();
  return root;
}

/* ---------------- 用户与角色 ---------------- */
async function renderUsers() {
  const root = el('div', { class: 'page-users' });
  const cardWrap = el('div', { class: 'card' });
  let all = [], roleMap = {};
  const paint = () => {
    const table = el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: '用户名' }), el('th', { text: '姓名' }), el('th', { text: '角色' }), el('th', { text: '状态' }), el('th', { text: '最近登录' }))),
      el('tbody', {}, ...all.map(u => el('tr', {},
        el('td', { text: u.username }), el('td', { text: u.name || '-' }),
        el('td', { text: (u.roleIds || []).map(rid => roleMap[rid] || rid).join(', ') }),
        el('td', {}, el('span', { class: 'badge ' + (u.disabled ? 'off' : 'ok'), text: u.disabled ? '停用' : '正常' })),
        el('td', { text: fmtAgo(u.lastLoginAt) }),
      ))),
    );
    cardWrap.innerHTML = '';
    cardWrap.appendChild(all.length ? table : empty('暂无用户'));
  };
  const reload = async () => {
    let d, rs;
    try { d = await api.get('/api/users'); rs = await api.get('/api/roles'); }
    catch (e) { cardWrap.innerHTML = ''; cardWrap.appendChild(empty(e.message)); return; }
    roleMap = Object.fromEntries((rs.items || []).map(r => [r.id, r.name]));
    all = d.items || [];
    paint();
    // rebuild head for fresh role options in modal
    root.childNodes[0].replaceWith(buildHead(rs));
  };
  const buildHead = (rs) => {
    const username = el('input', { class: 'input', placeholder: '用户名' });
    const name = el('input', { class: 'input', placeholder: '姓名' });
    const pw = el('input', { class: 'input', type: 'password', placeholder: '初始密码' });
    const roleSel = el('select', { class: 'input' }, ...(rs?.items || []).map(r => el('option', { value: r.id, text: r.name })));
    return pageHead('用户与角色', can('user:edit') ? el('button', { class: 'btn primary', onclick: () => openModal(el('div', {},
      el('h2', { text: '新建用户' }), field('用户名', username), field('姓名', name), field('密码', pw), field('角色', roleSel),
      el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '16px' } },
        el('button', { class: 'btn primary', onclick: async () => {
          try { await api.post('/api/users', { username: username.value, name: name.value, password: pw.value, roleIds: [roleSel.value] }); document.querySelector('.modal-mask')?._close?.(); toast('已创建', 'ok'); reload(); }
          catch (e) { toast(e.message, 'err'); }
        } }, '创建')),
    )) }, '+ 新建用户') : '');
  };
  root.appendChild(buildHead());
  root.appendChild(cardWrap);
  reload();
  return root;
}

/* ---------------- 日志与播放证明 ---------------- */
async function renderLogs() {
  const root = el('div', { class: 'page-logs' });
  const cardWrap = el('div', { class: 'card' });
  const kind = el('select', { class: 't-select', style: { maxWidth: '180px' } },
    el('option', { value: 'audit', text: '审计日志' }), el('option', { value: 'task', text: '任务链路' }), el('option', { value: 'play', text: '播放证明' }));
  const fromI = el('input', { class: 't-input', type: 'date', style: { maxWidth: '160px' } });
  const toI = el('input', { class: 't-input', type: 'date', style: { maxWidth: '160px' } });
  const qI = el('input', { class: 't-input', placeholder: '搜索…', style: { maxWidth: '200px', flex: 1 } });
  let all = [];

  const paint = () => {
    if (kind.value === 'play') {
      // 播放证明：聚合表格
      const table = el('table', { class: 't-table' },
        el('thead', {}, el('tr', {},
          el('th', { text: '终端' }), el('th', { text: '素材' }), el('th', { text: '节目' }),
          el('th', { text: '次数' }), el('th', { text: '时长(秒)' }), el('th', { text: '首次' }), el('th', { text: '最近' }),
        )),
        el('tbody', {}, ...all.map(r => el('tr', {},
          el('td', { text: r.terminalName || r.terminalId || '-' }),
          el('td', { text: r.mediaName || r.mediaId || '-' }),
          el('td', { text: r.layoutName || '-' }),
          el('td', { text: String(r.count || 0) }),
          el('td', { text: Math.round(r.seconds || 0).toLocaleString() }),
          el('td', { text: fmtTime(r.firstAt) }),
          el('td', { text: fmtTime(r.lastAt) }),
        ))),
      );
      cardWrap.innerHTML = '';
      cardWrap.appendChild(all.length ? table : empty('暂无播放记录'));
    } else {
      // 审计/任务/系统：明细表格
      const table = el('table', { class: 't-table' },
        el('thead', {}, el('tr', {},
          el('th', { text: '时间' }), el('th', { text: '操作人' }), el('th', { text: '动作' }),
          el('th', { text: '目标' }), el('th', { text: '详情' }),
        )),
        el('tbody', {}, ...all.slice(0, 300).map(r => el('tr', {},
          el('td', { class: 'mono', text: fmtTime(r.ts), style: { fontSize: '12px', whiteSpace: 'nowrap' } }),
          el('td', { text: r.username || '-' }),
          el('td', { text: r.action || r.kind || '-' }),
          el('td', { text: r.name || r.target || r.terminalId || '-', style: { maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
          el('td', { style: { maxWidth: '280px', fontSize: '12px', color: 'var(--c-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: r.ip ? `${r.ip}` : (r.diff ? `变更 ${Object.keys(r.diff).length} 字段` : (r.message || r.cmdId || '')) }),
        ))),
      );
      cardWrap.innerHTML = '';
      cardWrap.appendChild(all.length ? table : empty('暂无日志'));
      if (all.length > 300) cardWrap.appendChild(el('div', { class: 't-dnote', style: { textAlign: 'center', marginTop: '8px' }, text: `仅显示前 300 条，共 ${all.length} 条。请缩小日期范围或使用导出功能获取全部数据。` }));
    }
  };
  const load = async () => {
    let d; try { d = await api.get(`/api/logs?kind=${kind.value}&from=${fromI.value || ''}&to=${toI.value || ''}&q=${encodeURIComponent(qI.value)}&limit=2000`); }
    catch (e) { cardWrap.innerHTML = ''; cardWrap.appendChild(empty(e.message)); return; }
    all = d.items || [];
    paint();
  };

  const exportBtn = el('button', { class: 't-btn', onclick: async () => {
    exportBtn.disabled = true; exportBtn.textContent = '导出中…';
    try {
      const url = `/api/logs/export?kind=${kind.value}&from=${fromI.value || ''}&to=${toI.value || ''}`;
      const a = document.createElement('a'); a.href = url; a.click();
      toast(`已导出 ${all.length} 条记录`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { exportBtn.disabled = false; exportBtn.textContent = '📥 导出 CSV'; }
  } }, '📥 导出 CSV');

  kind.onchange = load;
  fromI.onchange = load;
  toI.onchange = load;
  let qTimer; qI.oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(load, 400); };

  root.append(
    pageHead('日志与播放证明',
      el('div', { class: 't-head' },
        el('div', { class: 't-head-actions', style: { flexWrap: 'wrap', gap: '8px' } },
          kind, fromI, toI, qI, exportBtn,
        ),
      ),
    ),
    cardWrap,
  );
  load();
  return root;
}

/* ---------------- 系统设置 ---------------- */
async function renderSettings() {
  const box = el('div', {}, spinner());
  (async () => {
    let d; try { d = await api.get('/api/settings'); } catch (e) { box.replaceWith(empty(e.message)); return; }
    const s = d.item || d.settings || d;
    const name = el('input', { class: 'input', value: s.serverName || '' });
    const hb = el('input', { class: 'input', type: 'number', value: s.heartbeatInterval || 15 });
    const off = el('input', { class: 'input', type: 'number', value: s.offlineThreshold || 60 });
    const auto = el('input', { type: 'checkbox', checked: !!s.autoApproveTerminal });
    const approvalLv = el('select', { class: 'input' },
      el('option', { value: '0', text: '免审批（直接发布）' }),
      el('option', { value: '1', text: '一级审批' }),
      el('option', { value: '2', text: '二级审批' }),
    );
    approvalLv.value = String(s.approvalLevel ?? 0);
    const view = el('div', { class: 'page-settings' },
      pageHead('系统设置'),
      el('div', { class: 'card', style: { maxWidth: '560px' } },
        field('服务名称', name), field('心跳间隔(秒)', hb), field('离线判定(秒)', off),
        field('新终端自动准入', auto), field('节目审批级别', approvalLv),
        el('div', { style: { marginTop: '16px' } }, el('button', { class: 'btn primary', onclick: async () => {
          try { await api.put('/api/settings', { serverName: name.value, heartbeatInterval: +hb.value, offlineThreshold: +off.value, autoApproveTerminal: auto.checked, approvalLevel: +approvalLv.value }); toast('已保存', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        } }, '保存设置')),
      ),
    );
    /* HEVC 解码支持状态 + 一键安装 */
    const hevcCard = el('div', { class: 'card', style: { maxWidth: '560px', marginTop: '16px' } },
      el('h3', { text: '媒体解码（HEVC）', style: { margin: '0 0 12px', fontSize: '15px', color: 'var(--c-text-1)' } }),
    );
    (async () => {
      let supported = null, viaDesktop = false;
      try { supported = browserSupportsHevc(); } catch {}
      if (window.lumaDesktop && typeof window.lumaDesktop.detectHevc === 'function') {
        viaDesktop = true;
        try { const d = await window.lumaDesktop.detectHevc(); if (typeof d === 'boolean') supported = d; } catch {}
      }
      hevcCard.append(
        field('当前环境 HEVC 解码', supported === null
          ? el('span', { class: 'badge', text: '未知' })
          : supported
            ? el('span', { class: 'badge ok', text: '已支持，可预览 H.265 视频' })
            : el('span', { class: 'badge warn', text: '未启用，预览 H.265 会黑屏' })),
        el('p', { class: 'sub', style: { margin: '0 0 12px' }, text: viaDesktop
          ? '检测到灵屏桌面客户端：点击下方按钮可一键安装 Windows HEVC 视频扩展。'
          : 'Windows 版 Chrome/Edge 默认不解码 H.265。可点击下方按钮跳转 Microsoft Store 安装「HEVC 视频扩展」，或用安卓终端播放。' }),
        el('button', { class: 'btn primary', onclick: () => installHevcFromAdmin() }, '⚡ 安装 HEVC 视频扩展'),
      );
    })();
    view.append(hevcCard);
    box.replaceWith(view);
  })();
  return box;
}

/* ---------------- 设备开通（远程推送 APK） ---------------- */
async function renderFleet() {
  const box = el('div', { class: 'page-fleet' }, spinner());
  (async () => {
    let apks = [], adb = { available: false, output: '' };
    try { adb = await api.get('/api/admin/fleet/adb'); } catch {}

    /* APK 升级包管理：上传 / 列表 / 删除（fleet 推送与终端自升级都从这里取） */
    const apkListEl = el('div', {});
    const apkFile = el('input', { type: 'file', accept: '.apk,application/vnd.android.package-archive', style: { maxWidth: '240px' } });
    const apkVer = el('input', { class: 'input', placeholder: '版本名 如 1.0.0', style: { width: '120px' } });
    const apkCode = el('input', { class: 'input', placeholder: '版本号', style: { width: '90px' } });
    const apkNote = el('input', { class: 'input', placeholder: '备注（可选）', style: { flex: '1 1 160px' } });
    const apkUp = el('button', { class: 'btn primary', onclick: async () => {
      const f = apkFile.files[0];
      if (!f) return toast('请先选择 APK 文件', 'err');
      const fd = new FormData();
      fd.append('file', f); fd.append('versionName', apkVer.value);
      fd.append('versionCode', apkCode.value); fd.append('note', apkNote.value);
      apkUp.disabled = true;
      try { await api.upload('/api/apks', fd); toast('APK 已上传', 'ok'); loadApks(); apkFile.value = ''; apkVer.value = ''; apkCode.value = ''; apkNote.value = ''; }
      catch (e) { toast(e.message, 'err'); }
      finally { apkUp.disabled = false; }
    } }, '上传 APK');

    const apkSel = el('select', { class: 'input', style: { minWidth: '220px' } });
    function refreshApkSel() {
      apkSel.replaceChildren(el('option', { value: '' }, apks.length ? '选择播放端 APK' : '（请先上传 APK 升级包）'),
        ...apks.map(a => el('option', { value: a.id }, a.name + ' | v' + (a.versionName || '?'))));
    }
    function renderApkList() {
      if (!apks.length) { apkListEl.replaceChildren(el('div', { class: 'empty', text: '尚未上传任何播放端 APK' })); return; }
      apkListEl.replaceChildren(...apks.map(a => el('div', { class: 'apk-row' },
        el('div', {},
          el('div', { class: 'apk-name', text: a.name }),
          el('div', { class: 'sub', text: `v${a.versionName || '?'} · ${((a.size || 0) / 1048576).toFixed(1)}MB · ${(a.createdAt ? new Date(a.createdAt).toLocaleString() : '')}` })),
        el('div', { class: 'row', style: { gap: '6px' } },
          el('a', { class: 'btn sm', href: a.url, target: '_blank', rel: 'noopener' }, '下载'),
          can('terminal:upgrade') ? el('button', { class: 'btn sm danger', onclick: async () => {
            if (await confirmModal({ title: '删除 APK', body: `确认删除「${esc(a.name)}」？`, danger: true })) {
              try { await api.del(`/api/apks/${a.id}`); toast('已删除', 'ok'); loadApks(); } catch (e) { toast(e.message, 'err'); }
            }
          } }, '删除') : null,
        ),
      )));
    }
    async function loadApks() { try { apks = (await api.get('/api/apks')).items || []; } catch {} refreshApkSel(); renderApkList(); }

    const ipInput = el('textarea', {
      class: 'input', rows: 4,
      placeholder: '逐行填写设备 IP，例如：' + '\n' + '192.168.1.21' + '\n' + '192.168.1.22',
      style: { width: '100%', fontFamily: 'ui-monospace, monospace', resize: 'vertical' },
    });
    const subnet = el('input', { class: 'input', placeholder: '或填子网 192.168.1', style: { width: '160px' } });
    const start = el('input', { class: 'input', placeholder: '起', style: { width: '64px' } });
    const end = el('input', { class: 'input', placeholder: '止', style: { width: '64px' } });

    const resultsEl = el('div', {});
    const status = el('div', { class: 'sub', style: { marginBottom: '10px' } });

    const scan = async () => {
      const targets = ipInput.value.split('\n').map(s => s.trim()).filter(Boolean);
      const body = { targets };
      if (subnet.value.trim()) {
        body.subnet = subnet.value.trim();
        body.start = parseInt(start.value || '1', 10);
        body.end = parseInt(end.value || '254', 10);
      }
      if (!body.targets.length && !body.subnet) return toast('请填写 IP 或子网', 'err');
      resultsEl.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'spin' }), ' 扫描中...'));
      try {
        const d = await api.post('/api/admin/fleet/scan', body);
        renderResults(d.items || []);
      } catch (e) { resultsEl.replaceChildren(empty(e.message)); }
    };

    const renderResults = (items) => {
      if (!items.length) { resultsEl.replaceChildren(empty('未发现任何存活设备')); return; }
      const rows = items.map((it, idx) => {
        const methodLabel = {
          already: ['已开通', 'ok'], adb: ['ADB 网络开通', 'warn'],
          vendor: ['厂商 API 开通', 'warn'], manual: ['需手动/一次性开启 ADB', 'danger'],
        }[it.method] || ['未知', ''];
        const provBtn = (it.method === 'adb' || it.method === 'vendor')
          ? el('button', { class: 'btn sm primary', onclick: () => provision(it) }, '推送 APK')
          : null;
        const probeBtn = el('button', { class: 'btn sm', onclick: () => vendorProbe(it) }, '厂商探测');
        return el('tr', {},
          el('td', { text: it.ip }),
          el('td', { text: (it.openPorts || []).join(', ') || '-' }),
          el('td', { text: (it.fingerprint || []).join(', ') || '-' }),
          el('td', {}, el('span', { class: 'badge ' + methodLabel[1] }, methodLabel[0])),
          el('td', {}, provBtn || probeBtn, provBtn ? probeBtn : null),
        );
      });
      resultsEl.replaceChildren(el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'IP' }), el('th', { text: '开放端口' }), el('th', { text: '指纹' }),
          el('th', { text: '可开通方式' }), el('th', { text: '操作' }))),
        el('tbody', {}, ...rows),
      ));
    };

    const provision = async (it) => {
      if (!apkSel.value) return toast('请先选择播放端 APK', 'err');
      const method = it.method === 'vendor' ? 'vendor' : 'adb';
      if (!confirm(`确认向 ${it.ip} 推送 APK（${method === 'adb' ? 'ADB 网络安装' : '厂商 API'}）？`)) return;
      toast(`正在向 ${it.ip} 推送...`);
      try {
        const d = await api.post('/api/admin/fleet/provision', { ip: it.ip, method, apkId: apkSel.value });
        openModal(el('div', {},
          el('h2', { text: (d.ok ? '开通成功' : '开通未完成') + ' | ' + it.ip }),
          el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', maxHeight: '320px', overflow: 'auto', background: 'var(--bg-2)', padding: '12px', borderRadius: '8px' } }, d.output || '（无输出）'),
        ));
      } catch (e) { toast(e.message, 'err'); }
    };

    const vendorProbe = async (it) => {
      try {
        const d = await api.post('/api/admin/fleet/vendor-probe', { ip: it.ip });
        openModal(el('div', {},
          el('h2', { text: '厂商端点探测 | ' + it.ip }),
          el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', maxHeight: '320px', overflow: 'auto', background: 'var(--bg-2)', padding: '12px', borderRadius: '8px' } },
            (d.output || '') + '\n\n' + JSON.stringify(d.probe || [], null, 2)),
        ));
      } catch (e) { toast(e.message, 'err'); }
    };

    const head = pageHead('设备开通',
      el('button', { class: 'btn primary', onclick: scan }, '扫描设备'),
    );

    const adbBox = el('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } });
    const installBtn = el('button', { class: 'btn', onclick: installAdb }, '一键安装 ADB');
    function paintAdb(a) {
      adbBox.replaceChildren(
        a.available
          ? el('span', { class: 'badge ok', text: 'adb 就绪' })
          : el('span', { class: 'badge warn', text: 'adb 未安装（IP 扫描可用，APK 推送需 adb）' }),
        a.available ? '' : installBtn,
      );
    }
    paintAdb(adb);

    async function installAdb() {
      installBtn.disabled = true;
      installBtn.textContent = '安装中…';
      try {
        const d = await api.post('/api/admin/fleet/install-adb');
        if (d.ok) { toast('adb 安装完成：' + d.adbPath, 'ok'); }
        else { toast('安装失败：' + (d.output || '未知错误'), 'err'); const m = openModal(el('div', {}, el('h2', { text: 'ADB 安装日志' }), el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', maxHeight: '340px', overflow: 'auto', background: 'var(--bg-2)', padding: '12px', borderRadius: '8px' } }, (d.log || []).join('\n')))); }
        const refreshed = await api.get('/api/admin/fleet/adb').catch(() => null);
        if (refreshed) paintAdb(refreshed);
      } catch (e) { toast(e.message, 'err'); }
      finally { installBtn.disabled = false; installBtn.textContent = '一键安装 ADB'; }
    }

    box.replaceChildren(
      head,
      el('div', { class: 'card', style: { marginBottom: '14px' } },
        el('h3', { text: '场景说明' }),
        el('p', { class: 'sub', style: { lineHeight: '1.7' },
          text: '电子屏已嵌墙、无法逐台拆机装 APK，但你知道全部设备 IP。本页可：1 扫描已知 IP，识别设备类型与可开通方式；2 通过「ADB 网络调试(5555)」或「厂商 API」把播放端 APK 远程推送到设备上，全程无需物理接触。设备首次开通后，后续升级由播放端自动完成。' }),
      ),
      el('div', { class: 'card', style: { marginBottom: '14px' } },
        el('h3', { text: '播放端 APK 升级包' }),
        el('p', { class: 'sub', style: { marginBottom: '10px' }, text: '远程开通与终端自升级都从这里取 APK。上传后在下方的「播放端 APK」下拉中选择即可推送。' }),
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          apkFile, apkVer, apkCode, apkNote, apkUp),
        apkListEl,
      ),
      el('div', { class: 'card', style: { marginBottom: '14px' } },
        el('div', { class: 'row', style: { alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' } },
          el('div', { style: { flex: '1 1 320px' } },
            el('label', { class: 'fld', text: '设备 IP 列表（每行一个）' }), ipInput),
          el('div', {},
            el('label', { class: 'fld', text: '或子网扫描' }),
            el('div', { class: 'row', style: { gap: '6px' } }, subnet, el('span', { text: '~' }), start, el('span', { text: '-' }), end)),
          el('div', {},
            el('label', { class: 'fld', text: '播放端 APK' }), apkSel),
        ),
        el('div', { class: 'row', style: { marginTop: '10px', gap: '10px', alignItems: 'center' } },
          el('button', { class: 'btn primary', onclick: scan }, '开始扫描'),
          adbBox,
          el('span', { class: 'sub', text: adb.available ? `(${adb.path})` : '点击「一键安装 ADB」可自动下载官方工具，无需手动配置' }),
        ),
      ),
      resultsEl,
      renderScanSection(),
    );
    loadApks();
  })();
  return box;
}

/* ================= 局域网扫描与设备台账 ================= */
async function renderScanSection() {
  const root = el('div', { class: 'card', style: { marginTop: '14px' } }, spinner());
  (async () => {
    let nets = [], cfg = {};
    try { const d = await api.get('/api/admin/scan/networks'); nets = d.networks || []; } catch {}
    try { const d = await api.get('/api/admin/scan/config'); cfg = d.config || {}; } catch {}

    const subnetSel = el('select', { class: 'input', style: { minWidth: '200px' } },
      el('option', { value: '' }, '自动（本机主网段）'),
      ...nets.map(n => el('option', { value: n.subnet || '' }, (n.subnet || '') + ' · ' + (n.interface || ''))));
    if (cfg.subnet) subnetSel.value = cfg.subnet;
    const manualIps = el('textarea', { class: 'input', rows: 2, placeholder: '或手动填 IP，每行一个（如 192.168.1.21）', style: { width: '100%', resize: 'vertical' } });
    const progress = el('div', { class: 'sub', text: '尚未扫描' });
    const devWrap = el('div', {});

    const loadDevices = async () => {
      try {
        const d = await api.get('/api/admin/scan/devices');
        const items = d.items || [];
        if (!items.length) { devWrap.replaceChildren(empty('暂无设备台账，点击「开始扫描」建立')); return; }
        devWrap.replaceChildren(el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'IP' }), el('th', { text: '类型' }), el('th', { text: '名称/厂商' }),
            el('th', { text: '状态' }), el('th', { text: '最后发现' }), el('th', { text: '操作' }))),
          el('tbody', {}, ...items.map(it => el('tr', {},
            el('td', { text: it.ip }),
            el('td', {}, el('span', { class: 'badge ' + (it.kind === 'android' ? 'warn' : (it.kind === 'screen' || it.kind === 'chuto' || it.kind === 'luma') ? 'ok' : '') }, it.kindLabel || it.kind || '未知')),
            el('td', { text: ((it.name || '') + ' ' + (it.vendor || '')).trim() || '-' }),
            el('td', {}, el('span', { class: 'badge ' + (it.status === 'online' ? 'ok' : 'off'), text: it.status === 'online' ? '在线' : (it.status === 'gone' ? '失联' : '未知') })),
            el('td', { text: fmtAgo(it.lastSeen) }),
            el('td', {}, el('button', { class: 'btn sm', onclick: async () => { try { await api.post('/api/admin/scan/ack', { ids: [it.id] }); toast('已确认', 'ok'); loadDevices(); } catch (e) { toast(e.message, 'err'); } } }, '确认'),
              el('button', { class: 'btn sm', onclick: async () => { if (!confirm('确认移除该台账记录？')) return; try { await api.post('/api/admin/scan/forget', { ids: [it.id] }); toast('已移除'); loadDevices(); } catch (e) { toast(e.message, 'err'); } } }, '移除')),
          ))),
        ));
      } catch (e) { devWrap.replaceChildren(empty(e.message)); }
    };

    let timer = null;
    const poll = () => {
      api.get('/api/admin/scan/progress').then(d => {
        if (d.running) { progress.replaceChildren(el('span', { class: 'spin' }), ' 扫描进行中…'); if (!timer) timer = setInterval(poll, 1500); }
        else { if (timer) { clearInterval(timer); timer = null; } progress.replaceChildren(el('span', { class: 'sub', text: '上次扫描：' + (d.lastRun ? fmtAgo(d.lastRun) : '尚未扫描') })); loadDevices(); }
      }).catch(() => {});
    };

    const runScan = async () => {
      const targets = manualIps.value.split('\n').map(s => s.trim()).filter(Boolean);
      const body = targets.length ? { targets } : (subnetSel.value ? { subnet: subnetSel.value } : {});
      try { await api.post('/api/admin/scan/run', body); toast('扫描已启动', 'ok'); poll(); }
      catch (e) { toast(e.message, 'err'); }
    };

    const autoChk = el('input', { type: 'checkbox', checked: !!cfg.enabled });
    const interval = el('input', { class: 'input', type: 'number', value: cfg.intervalMin || 30, style: { width: '80px' } });
    const saveCfg = async () => { try { await api.post('/api/admin/scan/config', { enabled: autoChk.checked, intervalMin: +interval.value || 30 }); toast('自动巡检设置已保存', 'ok'); } catch (e) { toast(e.message, 'err'); } };

    root.replaceChildren(
      el('h3', { text: '局域网扫描与设备台账' }),
      el('p', { class: 'sub', style: { marginBottom: '12px' }, text: '自动（按配置定时）或手动扫描局域网，识别安卓屏、电子屏、摄像头、交换机等设备并建立资产台账；新设备或失联设备触发告警，让"接入即可见"。' }),
      el('div', { class: 'row', style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        subnetSel,
        el('button', { class: 'btn primary', onclick: runScan }, '开始扫描'),
        el('button', { class: 'btn', onclick: loadDevices }, '刷新台账'),
      ),
      manualIps,
      progress,
      el('div', { class: 'card', style: { marginTop: '14px', background: 'var(--bg-2)' } },
        el('div', { class: 'sub', style: { fontWeight: 600, marginBottom: '8px' }, text: '自动巡检（无人值守周期扫描）' }),
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
          el('label', { class: 'sub', text: '启用' }), autoChk,
          el('label', { class: 'sub', text: '间隔(分)' }), interval,
          el('button', { class: 'btn sm primary', onclick: saveCfg }, '保存'),
        ),
      ),
      el('div', { style: { margin: '12px 0 4px' } }, el('b', { text: '设备台账' })),
      devWrap,
    );
    poll();
  })();
  return root;
}

/* ================= 监看墙（一块大屏监控所有屏） ================= */
let monitorTimer = null;
async function renderMonitor() {
  if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }

  const root = el('div', { class: 'page-monitor' });
  const grid = el('div', { class: 'mn-grid' });
  const statEl = el('div', { class: 'mn-bar' });
  const tokenEl = el('div', { class: 'mn-token' });

  const refreshBtn = el('button', { class: 't-btn primary', onclick: async () => {
    refreshBtn.disabled = true; refreshBtn.textContent = '截屏指令已下发...';
    try { await api.post('/api/monitor/refresh', { onlineOnly: true }); toast('已向在线终端下发截屏指令'); }
    catch (e) { toast('刷新失败：' + (e.message || e)); }
    setTimeout(() => { refreshBtn.disabled = false; refreshBtn.textContent = '刷新全部截屏'; load(); }, 2500);
  } }, '刷新全部截屏');

  let auto = true;
  const autoBtn = el('button', { class: 't-btn ghost', onclick: () => {
    auto = !auto;
    autoBtn.textContent = auto ? '自动刷新：开' : '自动刷新：关';
    if (auto) startTimer(); else if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
  } }, '自动刷新：开');

  function card(t) {
    const thumb = t.lastShot && t.lastShot.url
      ? el('div', { class: 'mn-shot' }, el('img', { src: t.lastShot.url, loading: 'lazy' }))
      : el('div', { class: 'mn-shot', text: t.online ? '暂无截屏' : '离线' });
    return el('div', { class: 'mn-card' + (t.online ? '' : ' dim') },
      thumb,
      el('div', { class: 'mn-info' },
        el('div', { class: 'mn-row' },
          el('span', { class: 'mn-dot ' + (t.online ? 'on' : 'off') }),
          el('span', { class: 'mn-name', text: t.name || t.code }),
          el('span', { class: 'mn-code', text: t.code || '' }),
        ),
        el('div', { class: 'mn-meta' },
          el('div', { class: 'mn-playing', text: (t.playing ? '播放中：' : '空闲：') + (t.playing || '无排期') }),
          el('div', { text: (t.ip || '?') + ' · ' + (t.resolution || '') + ' · ' + (t.lastShot ? '截屏 ' + fmtAgo(t.lastShot.ts) : '未截屏') }),
        ),
      ),
    );
  }

  async function load() {
    try {
      const d = await api.get('/api/monitor/wall');
      const items = d.items || [];
      const online = items.filter(t => t.online).length;
      statEl.innerHTML = '';
      statEl.append(
        el('span', { class: 'mn-pill ok', text: `在线 ${online}/${items.length}` }),
        el('span', { class: 'mn-pill', text: '更新于 ' + fmtAgo(d.serverTime || Date.now()) }),
      );
      tokenEl.innerHTML = '';
      const url = location.origin + (d.monitorUrl || '/player/monitor.html');
      tokenEl.append(
        el('span', { text: '大屏 / 手机监看地址：' }),
        el('code', {}, url),
        el('button', { class: 't-btn ghost', style: { height: '28px', padding: '0 10px' }, onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url); toast('已复制监看地址'); } }, '复制'),
        el('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--c-text-3)', lineHeight: '1.6' },
          text: '用手机浏览器打开此地址 → 点浏览器菜单「添加到主屏幕 / 安装应用」即可固定为 App；离线也能看到上一次的各屏画面。' }),
      );
      grid.innerHTML = '';
      if (!items.length) grid.append(el('div', { class: 'empty', text: '暂无终端，请先到「设备开通」或「终端管理」接入设备' }));
      else items.forEach(t => grid.append(card(t)));
    } catch (e) {
      grid.innerHTML = '';
      grid.append(el('div', { class: 'empty', text: '加载失败：' + (e.message || e) }));
    }
  }

  function startTimer() { if (monitorTimer) clearInterval(monitorTimer); monitorTimer = setInterval(load, 12000); }

  root.append(
    el('div', { class: 't-head' },
      el('div', {},
        el('div', { class: 't-title', text: '监看墙' }),
        el('div', { style: { fontSize: '13px', color: 'var(--c-text-2)', marginTop: '4px' }, text: '一块大屏集中查看所有终端正在显示的内容' }),
      ),
      el('div', { style: { display: 'flex', gap: '8px' } }, refreshBtn, autoBtn),
    ),
    statEl, tokenEl, grid,
  );

  await load();
  if (auto) startTimer();
  return root;
}

/* ================= 安全中心 ================= */
async function renderSecurity() {
  const box = el('div', { class: 'page-security' }, spinner());
  (async () => {
    let overview = null, settings = { security: {} }, moderation = { config: {}, stats: { categories: [] } };
    try { overview = await api.get('/api/admin/security/overview'); } catch {}
    try { settings = await api.get('/api/admin/security/settings'); } catch {}
    try { moderation = await api.get('/api/admin/security/moderation'); } catch {}

    const sec = settings.security || {};
    const p = overview?.posture || {};
    const mcfg0 = moderation.config || {};
    const mstats0 = moderation.stats || {};
    let mcfg = mcfg0, mstats = mstats0;
    const isAdmin = can('system:setting');
    const canModerate = can('layout:view');

    /* 1. 态势概览 */
    const stat = (label, val, tone) => el('div', { class: 'stat-card' + (tone ? ' ' + tone : '') },
      el('div', { class: 'val', text: String(val) }), el('div', { class: 'lab', text: label }));
    const postureCards = el('div', { class: 'stat-grid' },
      stat('网络隔离 LAN-only', p.lanOnly ? '已开启' : '关闭', p.lanOnly ? 'ok' : ''),
      stat('IP 白名单', p.allowlist ?? 0), stat('IP 黑名单', p.denylist ?? 0),
      stat('内容合规', mcfg.enabled ? '启用' : '停用', mcfg.enabled ? 'ok' : 'warn'),
      stat('URL 白名单', p.urlWhitelistCount ?? 0),
      stat('当前封禁 IP', p.bannedNow ?? 0, p.bannedNow ? 'warn' : ''),
      stat('近 7 天安全事件', p.recentSecurityEvents ?? 0),
      stat('敏感词总数', mstats.totalWords ?? 0),
    );

    /* 2. 网络隔离 */
    const lanOnlyChk = el('input', { type: 'checkbox', checked: !!sec.lanOnly, ...(isAdmin ? {} : { disabled: true }) });
    const allowTa = el('textarea', { class: 'input', rows: 3, value: (sec.allowIps || []).join('\n'), placeholder: '每行一个，支持 192.168.1.* 与 10.0.0.0/24', ...(isAdmin ? {} : { disabled: true }) });
    const denyTa = el('textarea', { class: 'input', rows: 3, value: (sec.denyIps || []).join('\n'), placeholder: '每行一个，支持通配与 CIDR', ...(isAdmin ? {} : { disabled: true }) });
    const saveNetwork = async () => {
      try {
        await api.post('/api/admin/security/settings', {
          lanOnly: lanOnlyChk.checked,
          allowIps: allowTa.value.split('\n').map(s => s.trim()).filter(Boolean),
          denyIps: denyTa.value.split('\n').map(s => s.trim()).filter(Boolean),
        });
        toast('网络隔离设置已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
    const networkCard = el('div', { class: 'card' },
      el('h3', { text: '网络隔离（仅允许局域网 / 指定 IP 访问）' }),
      el('p', { class: 'sub', style: { marginBottom: '12px' }, text: '开启后，只有来自局域网或白名单的 IP 能访问管理端与接口，可彻底阻断来自公网的探测与攻击。' }),
      field('仅允许局域网', lanOnlyChk),
      field('IP 白名单（留空 = 不限制来源）', allowTa),
      field('IP 黑名单（优先级高于白名单）', denyTa),
      isAdmin ? el('div', { style: { marginTop: '10px' } }, el('button', { class: 'btn primary', onclick: saveNetwork }, '保存网络隔离设置'))
        : el('div', { class: 'sub', text: '（需要 system:setting 权限）' }),
    );

    /* 3. IP 封禁 */
    const banIp = el('input', { class: 'input', placeholder: 'IP，如 10.20.30.40', style: { width: '180px' } });
    const banMin = el('input', { class: 'input', type: 'number', value: '60', style: { width: '80px' } });
    const banList = el('div', {});
    const renderBans = (bans) => {
      if (!bans || !bans.length) { banList.replaceChildren(empty('当前没有被封禁的 IP')); return; }
      banList.replaceChildren(el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', { text: 'IP' }), el('th', { text: '剩余' }), el('th', { text: '操作' }))),
        el('tbody', {}, ...bans.map(b => el('tr', {},
          el('td', { text: b.ip }), el('td', { text: fmtAgo(Date.now() + b.remainSec * 1000) }),
          el('td', {}, el('button', { class: 'btn sm', onclick: async () => { try { await api.post('/api/admin/security/unban', { ip: b.ip }); toast('已解封 ' + b.ip, 'ok'); loadBans(); } catch (e) { toast(e.message, 'err'); } } }, '解封')),
        ))),
      ));
    };
    const loadBans = async () => { try { const d = await api.get('/api/admin/security/bans'); renderBans(d.bans); } catch {} };
    const banCard = el('div', { class: 'card' },
      el('h3', { text: 'IP 封禁（抗爆破 / 抗扫描）' }),
      el('p', { class: 'sub', style: { marginBottom: '12px' }, text: '暴力破解、异常扫描会触发自动限速并临时封禁；也可在此手动封禁可疑来源。' }),
      isAdmin ? el('div', { class: 'row', style: { gap: '8px', marginBottom: '12px', alignItems: 'center' } },
        banIp, el('span', { text: '封禁' }), banMin, el('span', { text: '分钟' }),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!banIp.value.trim()) return toast('请填写 IP', 'err');
          try { await api.post('/api/admin/security/ban', { ip: banIp.value.trim(), minutes: +banMin.value || 60 }); toast('已封禁', 'ok'); banIp.value = ''; loadBans(); }
          catch (e) { toast(e.message, 'err'); }
        } }, '手动封禁')) : el('div', { class: 'sub', text: '（需要 system:setting 权限）' }),
      banList,
    );
    loadBans();

    /* 4. 审计哈希链 */
    const chainOut = el('div', {});
    const chainCard = el('div', { class: 'card' },
      el('h3', { text: '审计日志完整性校验（防篡改链）' }),
      el('p', { class: 'sub', style: { marginBottom: '12px' }, text: '每条审计记录都带前序哈希，形成不可篡改的链。任何人直接修改日志文件都会断链 —— 点击即可立即发现内鬼痕迹。' }),
      el('button', { class: 'btn', onclick: async () => {
        chainOut.replaceChildren(el('div', { class: 'sub' }, el('span', { class: 'spin' }), ' 校验中...'));
        try {
          const d = await api.post('/api/admin/security/audit/verify');
          if (d.ok) chainOut.replaceChildren(el('div', { class: 'badge ok', text: '✓ 审计链完整（已校验 ' + d.checked + ' 条记录）' }));
          else chainOut.replaceChildren(el('div', { class: 'badge danger', text: '✗ 检测到篡改：第 ' + (d.broken?.index ?? '?') + ' 条记录哈希不匹配' }));
        } catch (e) { chainOut.replaceChildren(empty(e.message)); }
      } }, '校验审计链完整性'),
      chainOut,
    );

    /* 5. 内容合规 */
    const modEnabled = el('input', { type: 'checkbox', checked: !!mcfg.enabled, ...(isAdmin ? {} : { disabled: true }) });
    const urlWhitelistTa = el('textarea', { class: 'input', rows: 3, value: (mcfg.urlWhitelist || []).join('\n'), placeholder: '每行一个可信域名，如 trusted.example.com', ...(isAdmin ? {} : { disabled: true }) });
    const catItem = (c) => el('div', { class: 'cat-item' },
      el('span', { class: 'badge ' + (c.level === 'block' ? 'danger' : c.level === 'review' || c.level === 'warn' ? 'warn' : 'ok'), text: ({ block: '拒绝', review: '复核', warn: '提示', pass: '通过' }[c.level] || c.level) }),
      el('span', { class: 'cat-name', text: c.label }),
      el('span', { class: 'cat-count', text: (c.count || 0) + ' 词' }),
      el('span', { class: 'sub', text: c.builtin ? '内置' : '自定义' }),
    );
    const catWrap = el('div', { class: 'cat-list' }, ...(mstats.categories || []).map(c => catItem(c)));
    const wordCat = el('select', { class: 'input', style: { minWidth: '160px' } },
      ...(mstats.categories || []).map(c => el('option', { value: c.key }, c.label)),
      el('option', { value: 'custom', text: '＋ 新建自定义类目' }));
    const wordCatNew = el('input', { class: 'input', placeholder: '自定义类目名', style: { width: '140px' } });
    const wordsTa = el('textarea', { class: 'input', rows: 3, placeholder: '每行一个词' });
    const refreshMod = () => { try { api.get('/api/admin/security/moderation').then(d => {
      mcfg = d.config || mcfg; mstats = d.stats || mstats;
      catWrap.replaceChildren(...(mstats.categories || []).map(c => catItem(c)));
    }); } catch {} };
    const modCard = el('div', { class: 'card' },
      el('h3', { text: '内容合规审核' }),
      el('p', { class: 'sub', style: { marginBottom: '12px' }, text: '所有节目在写入、提交审批、下发三道环节都会被机器审核，命中违规词 / 引流 / 外链会拦截或强制人工复核，从源头杜绝不良内容上屏。' }),
      field('启用内容审核', modEnabled),
      field('网页组件 URL 白名单（仅允许嵌入这些域名）', urlWhitelistTa),
      isAdmin ? el('div', { style: { margin: '10px 0' } }, el('button', { class: 'btn primary', onclick: async () => {
        try { await api.post('/api/admin/security/moderation/config', { enabled: modEnabled.checked, urlWhitelist: urlWhitelistTa.value.split('\n').map(s => s.trim()).filter(Boolean) }); toast('合规设置已保存', 'ok'); } catch (e) { toast(e.message, 'err'); }
      } }, '保存合规设置')) : el('div', { class: 'sub', text: '（需要 system:setting 权限）' }),
      el('div', { style: { margin: '14px 0 6px' } }, el('b', { text: '敏感词类目（' + (mstats.totalWords || 0) + ' 词 / ' + (mstats.categories || []).length + ' 类）' })),
      catWrap,
      isAdmin ? el('div', { class: 'mod-words', style: { marginTop: '14px' } },
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          el('span', { text: '类目' }), wordCat, wordCatNew, el('span', { text: '词（每行一个）' })),
        wordsTa,
        el('div', { class: 'row', style: { marginTop: '8px', gap: '8px' } },
          el('button', { class: 'btn primary', onclick: async () => {
            const cat = wordCat.value === 'custom' ? wordCatNew.value.trim() : wordCat.value;
            if (!cat) return toast('请选择或填写类目', 'err');
            try { const d = await api.post('/api/admin/security/moderation/words', { category: cat, action: 'add', words: wordsTa.value.split('\n').map(s => s.trim()).filter(Boolean) }); toast('已新增 ' + d.count + ' 词', 'ok'); wordsTa.value = ''; refreshMod(); } catch (e) { toast(e.message, 'err'); }
          } }, '新增词'),
          el('button', { class: 'btn', onclick: async () => {
            const cat = wordCat.value === 'custom' ? wordCatNew.value.trim() : wordCat.value;
            if (!cat) return toast('请选择或填写类目', 'err');
            try { const d = await api.post('/api/admin/security/moderation/words', { category: cat, action: 'remove', words: wordsTa.value.split('\n').map(s => s.trim()).filter(Boolean) }); toast('已移除 ' + d.count + ' 词', 'ok'); wordsTa.value = ''; refreshMod(); } catch (e) { toast(e.message, 'err'); }
          } }, '移除词'),
        ),
      ) : null,
    );

    /* 6. 试审沙盒 */
    const testTa = el('textarea', { class: 'input', rows: 3, placeholder: '粘贴一段文本或链接，测试会被如何处置（不上屏、不入库）' });
    const testOut = el('div', {});
    const testCard = el('div', { class: 'card' },
      el('h3', { text: '合规试审（沙盒）' }),
      el('p', { class: 'sub', style: { marginBottom: '12px' }, text: '输入文本或链接，查看审核引擎会给出什么处置，用于验证词库与规则。' }),
      testTa,
      canModerate ? el('div', { style: { marginTop: '8px' } }, el('button', { class: 'btn', onclick: async () => {
        const v = testTa.value.trim(); if (!v) return;
        testOut.replaceChildren(el('div', { class: 'sub' }, el('span', { class: 'spin' }), ' 检测中...'));
        try {
          const isUrl = /^https?:\/\//i.test(v);
          const d = await api.post('/api/admin/security/moderation/test', isUrl ? { url: v } : { text: v });
          const r = isUrl ? d.url : d.text;
          const tone = ({ block: 'danger', review: 'warn', warn: 'warn', pass: 'ok' }[r?.level] || '');
          testOut.replaceChildren(
            el('div', { class: 'badge ' + tone, text: '处置：' + ({ block: '拒绝入库', review: '需人工复核', warn: '提示', pass: '通过' }[r?.level] || r?.level) }),
            el('div', { class: 'sub', style: { marginTop: '6px' }, text: r?.summary || '未发现违规' }),
          );
        } catch (e) { testOut.replaceChildren(empty(e.message)); }
      } }, '试审')) : el('div', { class: 'sub', text: '（需要 layout:view 权限）' }),
      testOut,
    );

    /* 7. 待复核清单 */
    const pendingWrap = el('div', {});
    const loadPending = async () => {
      try {
        const d = await api.get('/api/admin/security/moderation/pending');
        if (!d.items || !d.items.length) { pendingWrap.replaceChildren(empty('没有待复核的内容')); return; }
        pendingWrap.replaceChildren(el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', { text: '节目' }), el('th', { text: '类型' }), el('th', { text: '命中' }), el('th', { text: '审批状态' }))),
          el('tbody', {}, ...d.items.map(it => el('tr', {},
            el('td', { text: it.name || it.id }), el('td', { text: it.type || '-' }),
            el('td', {}, el('span', { class: 'badge warn', text: (it.hitCount || 0) + ' 处' })),
            el('td', { text: it.approvalState || '-' }),
          ))),
        ));
      } catch (e) { pendingWrap.replaceChildren(empty(e.message)); }
    };
    const pendingCard = el('div', { class: 'card' },
      el('h3', { text: '待人工复核清单' }),
      el('p', { class: 'sub', style: { marginBottom: '12px' }, text: '被标记为「需人工复核」的节目，在复核确认前不可下发到大屏。' }),
      pendingWrap,
      canModerate ? el('div', { style: { marginTop: '8px' } }, el('button', { class: 'btn', onclick: loadPending }, '刷新清单')) : null,
    );
    if (canModerate) loadPending();

    const view = el('div', { class: 'page-security' },
      pageHead('安全中心', isAdmin ? null : el('span', { class: 'badge', text: '只读' })),
      el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', { text: '安全态势概览' }), postureCards),
      el('div', { class: 'grid-2' }, networkCard, banCard),
      chainCard,
      el('div', { class: 'grid-2' }, modCard, testCard),
      pendingCard,
    );
    box.replaceWith(view);
  })();
  return box;
}

/* ---------------- 内容生命周期（有效期与自动下线） ---------------- */
const TYPE_LABEL = { media: '素材', layouts: '节目', schedules: '排期' };
function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dateInput(value, placeholder) {
  return el('input', { class: 't-input', type: 'date', value: value || '', placeholder: placeholder || '' });
}

async function renderLifecycle() {
  const root = el('div', { class: 'page-lifecycle' });

  const typeSel = el('select', { class: 't-select', onchange: reload },
    el('option', { value: '', text: '全部类型' }),
    el('option', { value: 'media', text: '素材' }),
    el('option', { value: 'layouts', text: '节目' }),
    el('option', { value: 'schedules', text: '排期' }),
  );
  const stateSel = el('select', { class: 't-select', onchange: reload },
    el('option', { value: '', text: '全部状态' }),
    el('option', { value: 'pending', text: '待生效' }),
    el('option', { value: 'expiring', text: '即将到期' }),
    el('option', { value: 'expired', text: '已过期' }),
    el('option', { value: 'archived', text: '已归档' }),
    el('option', { value: 'active', text: '生效中/限时' }),
  );
  const qInput = el('input', { class: 't-input', placeholder: '搜索名称…', oninput: debounce(reload, 300) });

  const statsEl = el('div', { class: 't-stats' });
  const cfgCard = el('div', { class: 't-card', style: { padding: '20px 24px' } });
  const tableWrap = el('div', { class: 't-scroll t-card', style: { marginTop: '16px' } }, spinner());

  let lastItems = [];

  const debT = {};
  function debounce(fn, ms) {
    return (...a) => { clearTimeout(debT[fn]); debT[fn] = setTimeout(() => fn(...a), ms); };
  }

  function statCard(label, value, hint, tone) {
    return el('div', { class: 't-stat' },
      el('div', { class: 'label', text: label }),
      el('div', { class: 'value', text: String(value) }),
      hint ? el('div', { class: `hint ${tone || ''}`, text: hint }) : '',
    );
  }

  function paintSummary(d) {
    const b = d.buckets || {};
    statsEl.innerHTML = '';
    statsEl.append(
      statCard('生效中', b.active || 0, '', 'g'),
      statCard('即将到期', b.expiring || 0, '需关注', 'w'),
      statCard('已过期', b.expired || 0, '已自动下线', 'd'),
      statCard('已归档', b.archived || 0, '可恢复', ''),
      statCard('待生效', b.pending || 0, '未到开始日', 'w'),
      statCard('永久有效', b.none || 0, '无有效期', ''),
    );
  }

  function paintConfig(c, defs) {
    const enabled = el('input', { type: 'checkbox', checked: c.enabled ? 'checked' : null });
    const autoArchive = el('input', { type: 'checkbox', checked: c.autoArchive ? 'checked' : null });
    const warnDays = el('input', { class: 't-input', type: 'number', min: '0', max: '90', value: c.warnDays });
    const sweep = el('input', { class: 't-input', type: 'number', min: '1', max: '1440', value: c.sweepMinutes });
    const grace = el('input', { class: 't-input', type: 'number', min: '0', max: '365', value: c.archiveGraceDays });
    const save = el('button', { class: 't-btn primary', onclick: async () => {
      try {
        await api.post('/api/admin/lifecycle/config', {
          enabled: enabled.checked, autoArchive: autoArchive.checked,
          warnDays: +warnDays.value, sweepMinutes: +sweep.value, archiveGraceDays: +grace.value,
        });
        toast('配置已保存', 'ok'); reload();
      } catch (e) { toast(e.message, 'err'); }
    } }, '保存配置');
    cfgCard.innerHTML = '';
    cfgCard.append(
      el('div', { class: 't-title', style: { marginBottom: '12px' }, text: '生命周期策略' }),
      el('div', { class: 't-grid-2' },
        el('label', { class: 't-check' }, enabled, el('span', { text: '启用自动巡检与到期下线' })),
        el('label', { class: 't-check' }, autoArchive, el('span', { text: '过期后自动归档（不删除）' })),
        el('div', { class: 't-field' }, el('label', { text: '到期前提醒（天）' }), warnDays),
        el('div', { class: 't-field' }, el('label', { text: '巡检间隔（分钟）' }), sweep),
        el('div', { class: 't-field' }, el('label', { text: '过期后宽限（天，0=立即归档）' }), grace),
      ),
      el('div', { style: { marginTop: '14px' } }, save),
    );
  }

  function paintTable() {
    if (!lastItems.length) { tableWrap.innerHTML = ''; tableWrap.append(empty('没有符合条件的内容')); return; }
    const rows = lastItems.map(it => el('tr', {},
      el('td', {}, el('span', { class: 't-badge off', text: TYPE_LABEL[it.type] || it.type })),
      el('td', { text: it.name }),
      el('td', {}, lcBadge(it.state, it.daysLeft, it.from ? new Date(it.from).toISOString().slice(0, 10) : null, it.until ? new Date(it.until).toISOString().slice(0, 10) : null) || el('span', { text: '—' })),
      el('td', { class: 'mono', text: fmtDate(it.from) }),
      el('td', { class: 'mono', text: fmtDate(it.until) }),
      el('td', { class: 'mono', text: it.daysLeft != null ? `${it.daysLeft} 天` : '—' }),
      el('td', {}, rowActions(it)),
    ));
    tableWrap.innerHTML = '';
    tableWrap.append(el('table', { class: 't-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: '类型' }), el('th', { text: '名称' }), el('th', { text: '状态' }),
        el('th', { text: '生效' }), el('th', { text: '失效' }), el('th', { text: '剩余' }), el('th', { text: '操作' }),
      )),
      el('tbody', {}, ...rows),
    ));
  }

  function rowActions(it) {
    const acts = [];
    if (can('media:upload')) {
      acts.push(el('button', { class: 't-btn ghost', style: { height: '28px', padding: '0 8px', marginRight: '4px' }, onclick: () => openSetModal(it) }, '设有效期'));
    }
    if (it.state === 'archived') {
      if (can('media:upload')) acts.push(el('button', { class: 't-btn ghost', style: { height: '28px', padding: '0 8px' }, onclick: () => openRestoreModal(it) }, '恢复'));
    } else {
      if (can('media:upload')) acts.push(el('button', { class: 't-btn ghost danger', style: { height: '28px', padding: '0 8px' }, onclick: async () => {
        if (await confirmModal({ title: '归档', body: `确认归档「${esc(it.name)}」？归档后停止播放，可随时恢复。`, danger: true })) {
          try { await api.post('/api/admin/lifecycle/archive', { type: it.type, id: it.id }); toast('已归档', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
        }
      } }, '归档'));
    }
    return acts;
  }

  function openSetModal(it) {
    const from = it.from ? new Date(it.from).toISOString().slice(0, 10) : '';
    const until = it.until ? new Date(it.until).toISOString().slice(0, 10) : '';
    const fIn = dateInput(from), uIn = dateInput(until);
    const box = el('div', {},
      el('h2', { text: `设置有效期 · ${TYPE_LABEL[it.type] || it.type}` }),
      el('div', { class: 't-dnote', text: it.name }),
      el('div', { class: 't-field', style: { marginTop: '12px' } }, el('label', { text: '生效日期（留空=永久生效）' }), fIn),
      el('div', { class: 't-field', style: { marginTop: '12px' } }, el('label', { text: '失效日期（留空=永久有效，纯日期=当日 23:59:59 止）' }), uIn),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '18px', gap: '8px' } },
        el('button', { class: 't-btn', onclick: () => document.querySelector('.modal-mask')?._close?.() }, '取消'),
        el('button', { class: 't-btn primary', onclick: async () => {
          try {
            await api.post('/api/admin/lifecycle/set', { type: it.type, id: it.id, validFrom: fIn.value || null, validUntil: uIn.value || null });
            toast('有效期已更新，终端将自动重新拉取', 'ok'); document.querySelector('.modal-mask')?._close?.(); reload();
          } catch (e) { toast(e.message, 'err'); }
        } }, '保存'),
      ),
    );
    openModal(box);
  }

  function openRestoreModal(it) {
    const uIn = dateInput(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    const box = el('div', {},
      el('h2', { text: '恢复归档' }),
      el('div', { class: 't-dnote', text: it.name }),
      el('div', { class: 't-field', style: { marginTop: '12px' } }, el('label', { text: '失效日期（恢复后通常需顺延到未来日期才会重新播出）' }), uIn),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '18px', gap: '8px' } },
        el('button', { class: 't-btn', onclick: () => document.querySelector('.modal-mask')?._close?.() }, '取消'),
        el('button', { class: 't-btn primary', onclick: async () => {
          try {
            const d = await api.post('/api/admin/lifecycle/restore', { type: it.type, id: it.id, validUntil: uIn.value || null });
            toast(d.warn || '已恢复', d.warn ? 'err' : 'ok'); document.querySelector('.modal-mask')?._close?.(); reload();
          } catch (e) { toast(e.message, 'err'); }
        } }, '恢复'),
      ),
    );
    openModal(box);
  }

  async function bulkSet() {
    if (!lastItems.length) { toast('当前筛选无内容', 'err'); return; }
    const fIn = dateInput(''), uIn = dateInput('');
    const box = el('div', {},
      el('h2', { text: '批量设置有效期' }),
      el('div', { class: 't-dnote', text: `将对当前筛选的 ${lastItems.length} 个对象生效` }),
      el('div', { class: 't-field', style: { marginTop: '12px' } }, el('label', { text: '生效日期（留空=不变更/永久）' }), fIn),
      el('div', { class: 't-field', style: { marginTop: '12px' } }, el('label', { text: '失效日期（留空=不变更/永久）' }), uIn),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '18px', gap: '8px' } },
        el('button', { class: 't-btn', onclick: () => document.querySelector('.modal-mask')?._close?.() }, '取消'),
        el('button', { class: 't-btn primary', onclick: async () => {
          try {
            const ids = lastItems.map(x => x.id);
            const r = await api.post('/api/admin/lifecycle/bulk', { type: typeSel.value || 'media', ids, validFrom: fIn.value || null, validUntil: uIn.value || null });
            toast(`已更新 ${r.updated} 个对象`, 'ok'); document.querySelector('.modal-mask')?._close?.(); reload();
          } catch (e) { toast(e.message, 'err'); }
        } }, '批量应用'),
      ),
    );
    openModal(box);
  }

  async function reload() {
    try { const d = await api.get('/api/admin/lifecycle/summary'); paintSummary(d); } catch {}
    try { const c = await api.get('/api/admin/lifecycle/config'); paintConfig(c.config, c.defaults); } catch {}
    try {
      const qs = new URLSearchParams({ type: typeSel.value, state: stateSel.value, q: qInput.value }).toString();
      const d = await api.get('/api/admin/lifecycle/items?' + qs);
      lastItems = d.items || [];
      paintTable();
    } catch (e) { toast(e.message, 'err'); }
  }

  const sweepBtn = el('button', { class: 't-btn', onclick: async () => {
    try { const r = await api.post('/api/admin/lifecycle/sweep'); toast(`巡检完成：扫描 ${r.scanned} 项，过期 ${r.expired?.length || 0}，归档 ${r.archived || 0}`, 'ok'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  } }, '立即巡检');

  root.append(
    pageHead('内容生命周期',
      can('media:upload') ? el('button', { class: 't-btn', onclick: bulkSet }, '批量设有效期') : '',
      sweepBtn,
    ),
    el('div', { class: 't-sub', text: '为素材 / 节目 / 排期设置有效期，到期自动从所有终端下线并归档；断网时终端也会按本地缓存的失效时间自行停播。' }),
    statsEl,
    el('div', { class: 't-toolbar', style: { marginTop: '16px', marginBottom: '16px' } }, typeSel, stateSel, qInput),
    cfgCard,
    tableWrap,
  );

  reload();
  return root;
}

/* ---------------- 播放证明与合规存证包（P0-4） ---------------- */
async function renderPlayProof() {
  const root = el('div', { class: 'page-health' });
  const tableWrap = el('div', { class: 't-card' }, spinner());

  const termSel = el('select', { class: 't-select' });
  const custSel = el('select', { class: 't-select' });
  const mediaSel = el('select', { class: 't-select' });
  const fromI = el('input', { class: 't-input', type: 'date', style: { width: '150px' } });
  const toI = el('input', { class: 't-input', type: 'date', style: { width: '150px' } });
  const limitI = el('input', { class: 't-input', type: 'number', value: '500', style: { width: '90px' } });

  function fillSel(sel, opts, allLabel) {
    sel.innerHTML = '';
    sel.append(el('option', { value: '', text: allLabel }));
    for (const o of (opts || [])) sel.append(el('option', { value: o, text: o }));
  }

  async function loadFilters() {
    try {
      const f = await api.get('/api/admin/playproof/filters');
      fillSel(termSel, f.terminals, '全部终端');
      fillSel(custSel, f.customers, '全部客户');
      fillSel(mediaSel, f.materials, '全部素材');
    } catch { /* ignore */ }
  }

  function buildQuery() {
    const p = new URLSearchParams();
    if (termSel.value) p.set('terminalId', termSel.value);
    if (custSel.value) p.set('customer', custSel.value);
    if (mediaSel.value) p.set('mediaId', mediaSel.value);
    if (fromI.value) p.set('from', String(Date.parse(fromI.value + 'T00:00:00')));
    if (toI.value) p.set('to', String(Date.parse(toI.value + 'T23:59:59')));
    const lim = Number(limitI.value) || 500; p.set('limit', String(lim));
    return p.toString();
  }

  function paint(rows) {
    if (!rows.length) { tableWrap.innerHTML = ''; tableWrap.append(el('div', { class: 'empty', text: '暂无播放记录。终端开始播放后将自动上报。' })); return; }
    tableWrap.innerHTML = '';
    tableWrap.append(el('table', { class: 't-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: '终端' }), el('th', { text: '素材' }), el('th', { text: '客户' }),
        el('th', { text: '开始' }), el('th', { text: '结束' }), el('th', { text: '时长(s)' }),
      )),
      el('tbody', {}, ...rows.map(r => el('tr', {},
        el('td', { text: r.terminalName || r.terminalId }),
        el('td', { text: r.mediaName || r.mediaId || '-' }),
        el('td', { text: r.customer || '-' }),
        el('td', { class: 'mono', text: fmtTime(r.startedAt) }),
        el('td', { class: 'mono', text: fmtTime(r.endedAt) }),
        el('td', { class: 'mono', text: String(r.duration) }),
      ))),
    ));
  }

  async function load() {
    try {
      const d = await api.get('/api/admin/playproof/query?' + buildQuery());
      paint(d.items || []);
    } catch (e) { tableWrap.innerHTML = ''; tableWrap.append(el('div', { class: 'empty', text: e.message })); }
  }

  const exportUrl = (fmt) => `/api/admin/playproof/export?fmt=${fmt}&` + buildQuery();
  const doExport = (fmt) => {
    const a = el('a', { href: exportUrl(fmt), style: { display: 'none' } });
    document.body.appendChild(a); a.click(); a.remove();
  };

  root.append(
    el('div', { class: 't-head' },
      el('div', { class: 't-title', text: '播放证明与合规存证包' }),
      el('div', { class: 'spacer' }),
      el('button', { class: 't-btn', onclick: () => doExport('json') }, '⤓ 导出 JSON'),
      el('button', { class: 't-btn', onclick: () => doExport('pdf') }, '⤓ 导出 PDF'),
      el('button', { class: 't-btn primary', onclick: () => doExport('zip') }, '📦 导出完整存证包(ZIP)'),
    ),
    el('div', { class: 't-card', style: { padding: '16px', marginBottom: '16px' } },
      el('div', { class: 'pf-filters' },
        el('label', { class: 'pf-f' }, el('span', { text: '终端' }), termSel),
        el('label', { class: 'pf-f' }, el('span', { text: '客户' }), custSel),
        el('label', { class: 'pf-f' }, el('span', { text: '素材' }), mediaSel),
        el('label', { class: 'pf-f' }, el('span', { text: '起' }), fromI),
        el('label', { class: 'pf-f' }, el('span', { text: '止' }), toI),
        el('label', { class: 'pf-f' }, el('span', { text: '条数' }), limitI),
        el('button', { class: 't-btn', onclick: load }, '查询'),
      ),
    ),
    tableWrap,
  );

  for (const s of [termSel, custSel, mediaSel]) s.onchange = load;
  fromI.onchange = load; toI.onchange = load;
  await loadFilters();
  await load();
  return root;
}

/* ---------------- 动态内容数据源（P1 数据驱动） ---------------- */
async function renderDataSources() {
  const root = el('div', { class: 'page-datasource' }, spinner());

  const canManage = can('datasource:manage');

  const statCard = (label, value, sub) => el('div', { class: 't-stat' },
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: String(value) }),
    el('div', { class: 'hint', text: sub || '' }),
  );
  const statsEl = el('div', { class: 't-stats' });
  const tableWrap = el('div', { class: 'ds-table-wrap' });

  const TYPE_LABEL = { 'http-json': 'HTTP/JSON', 'csv': 'CSV' };
  const STATUS_TONE = { ok: 's', error: 'd', idle: 'off', '' : 'off' };
  const statusBadge = (s, err) => {
    const tone = STATUS_TONE[s] || 'off';
    const label = s === 'ok' ? '正常' : s === 'error' ? '失败' : s === 'idle' ? '未运行' : String(s || '未知');
    const b = el('span', { class: `t-badge ${tone}`, text: label });
    if (s === 'error' && err) b.title = err;
    return b;
  };

  function openForm(existing) {
    const isEdit = !!existing;
    const f = {
      name: existing?.name || '',
      type: existing?.type || 'http-json',
      url: existing?.url || '',
      method: existing?.method || 'GET',
      path: existing?.path || '',
      delimiter: existing?.delimiter || ',',
      auth: existing?.auth || 'none',
      basicUser: existing?.basicUser || '',
      basicPass: existing?.basicPass || '',
      refreshSec: existing?.refreshSec || 60,
      timeoutSec: existing?.timeoutSec || 15,
      enabled: existing?.enabled !== false,
    };

    const nameI = el('input', { class: 'input', value: f.name, placeholder: '如：门店实时客流' });
    const typeI = el('select', { class: 't-select' },
      el('option', { value: 'http-json', text: 'HTTP / JSON' }),
      el('option', { value: 'csv', text: 'CSV（远程文件）' }),
    );
    typeI.value = f.type;
    const urlI = el('input', { class: 'input', value: f.url, placeholder: 'https://.../api/data' });
    const methodI = el('select', { class: 't-select' },
      el('option', { value: 'GET', text: 'GET' }),
      el('option', { value: 'POST', text: 'POST' }),
    );
    methodI.value = f.method;
    const pathI = el('input', { class: 'input', value: f.path, placeholder: 'JSONPath，如 data.list（留空取根）' });
    const delimI = el('input', { class: 'input', value: f.delimiter, placeholder: '如 , 或 ; 或 \\t' });
    const authI = el('select', { class: 't-select' },
      el('option', { value: 'none', text: '无鉴权' }),
      el('option', { value: 'basic', text: 'HTTP Basic' }),
    );
    authI.value = f.auth;
    const userI = el('input', { class: 'input', value: f.basicUser, placeholder: 'Basic 用户名' });
    const passI = el('input', { class: 'input', type: 'password', value: f.basicPass, placeholder: 'Basic 密码' });
    const refreshI = el('input', { class: 'input', type: 'number', min: '5', value: f.refreshSec });
    const timeoutI = el('input', { class: 'input', type: 'number', min: '1', value: f.timeoutSec });
    const enabledI = el('input', { type: 'checkbox' });
    enabledI.checked = f.enabled;

    const methodRow = el('label', { class: 'ds-f' }, el('span', { text: '请求方法' }), methodI);
    const pathRow = el('label', { class: 'ds-f' }, el('span', { text: 'JSONPath 提取' }), pathI);
    const delimRow = el('label', { class: 'ds-f' }, el('span', { text: '分隔符' }), delimI);
    const userRow = el('label', { class: 'ds-f' }, el('span', { text: '用户名' }), userI);
    const passRow = el('label', { class: 'ds-f' }, el('span', { text: '密码' }), passI);

    function syncType() {
      const isJson = typeI.value === 'http-json';
      methodRow.style.display = isJson ? '' : 'none';
      pathRow.style.display = isJson ? '' : 'none';
      delimRow.style.display = isJson ? 'none' : '';
    }
    function syncAuth() {
      const show = authI.value === 'basic';
      userRow.style.display = show ? '' : 'none';
      passRow.style.display = show ? '' : 'none';
    }
    typeI.onchange = syncType;
    authI.onchange = syncAuth;
    syncType(); syncAuth();

    const saveBtn = el('button', { class: 't-btn primary' }, isEdit ? '保存修改' : '创建数据源');
    const form = el('div', { class: 'ds-form' },
      el('label', { class: 'ds-f' }, el('span', { text: '名称' }), nameI),
      el('label', { class: 'ds-f' }, el('span', { text: '类型' }), typeI),
      el('label', { class: 'ds-f' }, el('span', { text: '数据源 URL' }), urlI),
      methodRow, pathRow, delimRow,
      el('label', { class: 'ds-f' }, el('span', { text: '鉴权' }), authI),
      userRow, passRow,
      el('div', { class: 'ds-grid2' },
        el('label', { class: 'ds-f' }, el('span', { text: '刷新间隔(秒)' }), refreshI),
        el('label', { class: 'ds-f' }, el('span', { text: '超时(秒)' }), timeoutI),
      ),
      el('label', { class: 'ds-f row', style: { alignItems: 'center' } },
        enabledI, el('span', { text: '启用（关闭后不再自动拉取）' })),
    );

    let close;
    const modalBody = el('div', { class: 'page-datasource' },
      el('h2', { text: isEdit ? '编辑数据源' : '新建数据源', style: { marginBottom: '10px' } }),
      el('div', { class: 't-dnote', text: '拉取结果由服务端缓存，播放端经终端鉴权读取，不直连外网、不暴露 token。' }),
      form,
      el('div', { class: 'ds-actions' },
        saveBtn,
        el('button', { class: 't-btn', onclick: () => close?.(), text: '取消' }),
      ),
    );
    close = openModal(modalBody);

    saveBtn.onclick = async () => {
      const payload = {
        name: nameI.value.trim() || '未命名数据源',
        type: typeI.value,
        url: urlI.value.trim(),
        method: methodI.value,
        path: pathI.value.trim(),
        delimiter: delimI.value.trim() || ',',
        auth: authI.value,
        basicUser: userI.value.trim(),
        basicPass: passI.value,
        refreshSec: Math.max(5, parseInt(refreshI.value, 10) || 60),
        timeoutSec: Math.max(1, parseInt(timeoutI.value, 10) || 15),
        enabled: enabledI.checked,
      };
      if (!payload.url) return toast('请填写数据源 URL', 'err');
      saveBtn.disabled = true;
      try {
        if (isEdit) await api.put(`/api/admin/datasources/${existing.id}`, payload);
        else await api.post('/api/admin/datasources', payload);
        toast(isEdit ? '已保存' : '数据源已创建', 'ok');
        close(); await load();
      } catch (e) { toast(e.message, 'err'); }
      finally { saveBtn.disabled = false; }
    };
  }

  function showPreview(ds, r) {
    const head = el('div', {},
      el('h2', { text: ds.name || ds.id, style: { marginBottom: '4px' } }),
      el('div', { class: 't-dnote', text: `${TYPE_LABEL[ds.type] || ds.type} · 耗时 ${r.tookMs ?? '?'}ms · ${r.ok ? '拉取成功' : '拉取失败'}` }),
    );
    let body;
    if (r.ok) {
      body = el('pre', { class: 'ds-preview', text: r.sampleStr || '(空数据)' });
    } else {
      body = el('div', { class: 'empty', text: '拉取失败：' + (r.error || '未知错误') });
    }
    openModal(el('div', { class: 'page-datasource' }, head, body));
  }

  async function refreshDs(ds) {
    try {
      const r = await api.post(`/api/admin/datasources/${ds.id}/refresh`);
      if (r.ok) toast(`已刷新：${ds.name}`, 'ok');
      else toast('刷新失败：' + (r.error || '未知错误'), 'err');
      showPreview(ds, r);
      await load();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function removeDs(ds) {
    if (!(await confirmModal({ title: '删除数据源', body: `确认删除「${esc(ds.name)}」？关联节目中将无法取数。`, danger: true }))) return;
    try { await api.del(`/api/admin/datasources/${ds.id}`); toast('已删除', 'ok'); await load(); }
    catch (e) { toast(e.message, 'err'); }
  }

  function row(ds) {
    const actions = el('div', { class: 'row', style: { gap: '6px' } },
      el('button', { class: 'btn sm', onclick: () => refreshDs(ds) }, '刷新'),
      canManage ? el('button', { class: 'btn sm', onclick: () => openForm(ds) }, '编辑') : '',
      canManage ? el('button', { class: 'btn sm danger', onclick: () => removeDs(ds) }, '删除') : '',
    );
    return el('tr', {},
      el('td', {}, el('div', { class: 'ds-name', text: ds.name }), el('div', { class: 'sub', text: ds.id })),
      el('td', { text: TYPE_LABEL[ds.type] || ds.type }),
      el('td', {}, statusBadge(ds.status, ds.lastError)),
      el('td', { class: 'mono', text: ds.lastFetch ? fmtAgo(ds.lastFetch) : '—' }),
      el('td', { class: 'mono', text: ds.tookMs != null ? ds.tookMs + 'ms' : '—' }),
      el('td', {}, actions),
    );
  }

  function paint(items) {
    const total = items.length;
    const okN = items.filter(x => x.status === 'ok').length;
    const errN = items.filter(x => x.status === 'error').length;
    statsEl.replaceChildren(
      statCard('数据源总数', total, `${okN} 正常 · ${errN} 异常`),
      statCard('刷新周期', items.length ? Math.min(...items.map(x => x.refreshSec || 60)) + 's 起' : '—', '服务端定时拉取'),
      statCard('缓存方式', '服务端', '播放端经终端鉴权读取'),
    );
    if (!items.length) {
      tableWrap.replaceChildren(el('div', { class: 'empty', text: '暂无数据源。点击右上角「新建数据源」接入实时数据。' }));
      return;
    }
    tableWrap.replaceChildren(el('table', { class: 't-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: '名称' }), el('th', { text: '类型' }), el('th', { text: '状态' }),
        el('th', { text: '最后刷新' }), el('th', { text: '耗时' }), el('th', { text: '操作' }),
      )),
      el('tbody', {}, ...items.map(row)),
    ));
  }

  let all = [];
  async function load() {
    try {
      const d = await api.get('/api/admin/datasources');
      all = d.items || [];
      paint(all);
    } catch (e) { root.replaceWith(empty(e.message)); }
  }

  root.replaceChildren(
    el('div', { class: 't-head' },
      el('div', { class: 't-title', text: '动态内容数据源' }),
      el('div', { class: 'spacer' }),
      canManage ? el('button', { class: 't-btn primary', onclick: () => openForm() }, '＋ 新建数据源') : '',
    ),
    el('div', { class: 't-sub', text: '接入 HTTP/JSON 或 CSV 实时数据，在节目中绑定「动态数据」组件即可自动填充数据。' }),
    statsEl,
    el('div', { class: 't-card', style: { padding: '0', marginTop: '16px' } }, tableWrap),
  );

  await load();
  return root;
}

async function renderInteractions() {
  const root = el('div', { class: 'page-interactions' }, spinner());
  (async () => {
    let items = [], layouts = [];
    try { items = (await api.get('/api/admin/interactions')).items || []; } catch (e) { root.replaceWith(empty(e.message)); return; }
    try { layouts = (await api.get('/api/layouts')).items || []; } catch {}
    const nameOf = id => (layouts.find(l => l.id === id) || {}).name || id || '—';

    const layoutSel = el('select', { class: 'input', onchange: () => load() });
    layoutSel.append(el('option', { value: '', text: '全部节目' }));
    layouts.forEach(l => layoutSel.append(el('option', { value: l.id, text: l.name || l.id })));

    const tbody = el('tbody');
    const paint = () => {
      const filtered = (!layoutSel.value) ? items : items.filter(x => x.layoutId === layoutSel.value);
      if (!filtered.length) {
        tbody.replaceChildren(el('tr', {}, el('td', { colspan: '6' }, empty('暂无交互数据。在触摸屏节目中点击热区后，这里会统计点击次数。'))));
        return;
      }
      tbody.replaceChildren(...filtered.map(x => el('tr', {},
        el('td', {}, nameOf(x.layoutId)),
        el('td', { text: x.itemId || '—' }),
        el('td', {}, el('span', { class: 'badge', text: x.type })),
        el('td', { text: String(x.count) }),
        el('td', { text: x.lastAt ? new Date(x.lastAt).toLocaleString() : '—' }),
        el('td', { text: String(x.terminals) }),
      )));
    };
    async function load() {
      try { items = (await api.get('/api/admin/interactions' + (layoutSel.value ? '?layoutId=' + encodeURIComponent(layoutSel.value) : ''))).items || []; }
      catch (e) { toast(e.message, 'err'); }
      paint();
    }

    const view = el('div', { class: 'page-interactions' },
      pageHead('交互统计',
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
          el('span', { class: 'sub', text: '节目：' }), layoutSel,
          can('layout:manage') ? el('button', { class: 'btn sm danger', onclick: async () => {
            if (await confirmModal({ title: '清空交互统计', body: '确认清空全部交互点击记录？', danger: true })) {
              try { await api.post('/api/admin/interactions/reset', {}); toast('已清空', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
            }
          } }, '清空') : null,
        ),
      ),
      el('p', { class: 't-dnote', style: { margin: '0 0 12px' }, text: '统计播放端触摸屏上热区被点击的次数（哪个按钮被点了多少次）。数据由各终端实时上报。' }),
      el('div', { class: 'card' },
        el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {},
            el('th', { text: '节目' }), el('th', { text: '元素 ID' }), el('th', { text: '交互类型' }),
            el('th', { text: '次数' }), el('th', { text: '最近一次' }), el('th', { text: '涉及终端' }))),
          tbody,
        ),
      ),
    );
    root.replaceWith(view);
    paint();
  })();
  return root;
}

export const views = {
  security: renderSecurity,
  dashboard: renderDashboard,
  terminals: renderTerminals,
  media: renderMedia,
  layouts: renderLayouts,
  editor: renderEditor,
  schedules: renderSchedules,
  approvals: renderApprovals,
  monitor: renderMonitor,
  health: renderHealth,
  proof: renderPlayProof,
  users: renderUsers,
  logs: renderLogs,
  settings: renderSettings,
  fleet: renderFleet,
  lifecycle: renderLifecycle,
  dataSources: renderDataSources,
  interactions: renderInteractions,
};
