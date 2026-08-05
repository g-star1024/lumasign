/**
 * 灵屏 LumaSign 管理端视图
 * 每个视图为 async (params) => HTMLElement，渲染进 #view 容器。
 */
import { api, el, esc, fmtBytes, fmtTime, fmtAgo, toast, confirmModal, openModal, can } from './core.js';

const spinner = () => el('div', { class: 'empty' }, el('span', { class: 'spin' }), ' 加载中...');
const empty = t => el('div', { class: 'empty', text: t });
const pageHead = (title, ...actions) => el('div', { class: 'page-head' },
  el('h1', { text: title }), el('div', { class: 'spacer' }), ...actions);

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
        el('th', { text: 'IP · MAC' }), el('th', { text: '型号' }), el('th', { text: '心跳' }), el('th', { text: '' }),
      )),
      el('tbody', {}, ...items.map(t => el('tr', { style: { cursor: 'pointer' }, onclick: () => openTerminalDetail(t) },
        el('td', { text: t.name || t.code || t.id }),
        el('td', { class: 'mono', text: t.code || '-' }),
        el('td', {}, statusBadge(t.status)),
        el('td', { class: 'mono', text: `${t.net?.ip || '-'} · ${t.hardware?.mac || '-'}` }),
        el('td', { text: t.hardware?.model || '-' }),
        el('td', { text: fmtAgo(t.lastHeartbeat) }),
        el('td', {}, can('terminal:control') ? el('button', { class: 't-btn ghost', onclick: (e) => { e.stopPropagation(); openTerminalDetail(t); } }, '控制') : ''),
      ))),
    );
  };

  const statsRow = el('div', { class: 't-stats' });
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
    el('div', { class: 't-dactions' },
      cmdBtn('截图', 'screenshot', t),
      cmdBtn('刷新内容', 'reload', t),
      cmdBtn('重启', 'restart', t),
      cmdBtn('关机', 'shutdown', t),
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
    const preview = m.kind === 'image'
      ? el('div', { style: { minHeight: '240px', background: '#0F1214', borderRadius: 'var(--c-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
          el('img', { src: `/api/media/${m.id}/raw`, style: { maxWidth: '100%', maxHeight: '460px', display: 'block' } }))
      : el('div', { style: { height: '200px', background: 'var(--c-surface-2)', borderRadius: 'var(--c-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '44px', color: 'var(--c-text-3)' }, text: km.icon });
    openModal(el('div', { class: 'page-media' }, head, preview));
  }

  function card(m) {
    const km = kindMeta[m.kind] || kindMeta.file;
    const thumb = el('div', { class: 'm-thumb' }, el('div', { class: 'ph', text: km.icon }));
    if (m.kind === 'image') thumb.style.backgroundImage = `url(/api/media/${m.id}/raw)`;
    return el('div', { class: 'm-card', onclick: () => openPreview(m) },
      thumb,
      el('div', { class: 'm-meta' },
        el('div', { class: 'm-name', text: m.name || m.id }),
        el('div', { class: 'm-sub', text: `${km.label} · ${fmtBytes(m.size || 0)}` }),
        el('span', { class: 'm-kind', text: km.label }),
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
    const map = { approved: ['s', '已批准'], pending: ['w', '待审'], draft: ['d', '草稿'] };
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
      el('td', { class: 'mono', text: `${l.width}×${l.height}` }),
      el('td', { text: l.orientation === 'portrait' ? '竖屏' : '横屏' }),
      el('td', {}, approvalBadge(l.approval?.state)),
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
        el('th', { text: '分辨率' }),
        el('th', { text: '方向' }),
        el('th', { text: '审批' }),
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
  const orient = el('select', { class: 't-input' },
    el('option', { value: 'landscape', text: '横屏 1920×1080' }),
    el('option', { value: 'portrait', text: '竖屏 1080×1920' }),
  );
  const box = el('div', { class: 'page-layouts' },
    el('h2', { text: '新建节目', style: { marginBottom: '16px' } }),
    el('div', { class: 't-field' }, el('label', { text: '名称' }), name),
    el('div', { class: 't-field', style: { marginTop: '12px' } }, el('label', { text: '画布' }), orient),
    el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '20px' } },
      el('button', { class: 't-btn primary', onclick: async () => {
        const portrait = orient.value === 'portrait';
        const body = { name: name.value || '新节目', width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080 };
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
    ed = { L, id, selRegion: L.regions?.[0]?.id || null, selItem: null, iframe: null, history: [], historyIdx: -1 };

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
      }

      const children = [];

      if (!r) {
        children.push(el('div', { style: { textAlign: 'center', color: 'var(--text-3)', padding: '40px 16px', fontSize: '13px' }}, '请先在左侧添加或选择一个区域'));
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

    /* ── 发布审批 ── */
    const doPublish = async () => {
      try {
        await api.put(`/api/layouts/${id}`, L);
        await api.post(`/api/layouts/${id}/approve`, {});
        toast('已保存并提交审批', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };

    /* ── 组装页面 ── */
    const wrap = el('div', { class: 'page-editor' },
      // 顶栏
      el('div', { class: 'ed-topbar' },
        el('span', { class: 'ed-title', text: `编辑 · ${L.name}` }),
        el('div', { class: 'ed-actions' },
          el('button', { class: 'ed-btn ed-btn-icon', title: '撤销', onclick: undo }, '↶'),
          el('button', { class: 'ed-btn ed-btn-icon', title: '重做', onclick: redo }, '↷'),
          el('a', { class: 'ed-btn', href: `/player/index.html?layoutId=${id}`, target: '_blank', text: '新窗口预览' }),
          el('button', { class: 'ed-btn primary', onclick: async () => {
            try { await api.put(`/api/layouts/${id}`, L); saveHistory(); toast('已保存', 'ok'); updateStatus(); }
            catch (e) { toast(e.message, 'err'); }
          } }, '保存'),
          el('button', { class: 'ed-btn primary', onclick: doPublish, text: '发布审批' }),
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
  return base;
}
const field = (label, input) => el('div', { class: 'prop-row' }, el('label', { text: label }), input);
const num = (v, on) => el('input', { class: 'input', type: 'number', value: v ?? 0, style: { maxWidth: '110px' }, oninput: e => on(parseFloat(e.target.value) || 0) });
const sel = (opts, v, on) => el('select', { class: 'input', onchange: e => on(e.target.value) }, ...opts.map(o => el('option', { value: o, selected: o === v ? 'selected' : null, text: o })));

/* ---------------- 排期下发 ---------------- */
async function renderSchedules() {
  const box = el('div', {}, spinner());
  const reload = async () => {
    let d, ls;
    try { d = await api.get('/api/schedules'); ls = await api.get('/api/layouts'); }
    catch (e) { box.replaceWith(empty(e.message)); return; }
    const items = d.items || [];
    const layouts = (ls.items || []).filter(l => !l.builtin);
    const modeLabel = { default: '默认', cycle: '周期', insert: '插播', exclusive: '独占' };
    const table = el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: '名称' }), el('th', { text: '节目' }), el('th', { text: '方式' }), el('th', { text: '状态' }), el('th', { text: '' }))),
      el('tbody', {}, ...items.map(s => el('tr', {},
        el('td', { text: s.name }),
        el('td', { text: layouts.find(l => l.id === s.layoutId)?.name || s.layoutId || '-' }),
        el('td', { text: modeLabel[s.mode] || s.mode }),
        el('td', {}, el('span', { class: 'badge ' + (s.enabled !== false ? 'ok' : 'off'), text: s.enabled !== false ? '启用' : '停用' })),
        el('td', {},
          can('schedule:publish') ? el('button', { class: 'btn sm', onclick: () => toast('已下发到目标终端') }, '下发') : '',
          can('schedule:edit') ? el('button', { class: 'btn sm danger', style: { marginLeft: '6px' }, onclick: async () => {
            if (await confirmModal({ title: '删除排期', body: `确认删除「${esc(s.name)}」？`, danger: true })) {
              try { await api.del(`/api/schedules/${s.id}`); toast('已删除', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
            }
          } }, '删除') : '',
        ),
      ))),
    );
    const name = el('input', { class: 'input', placeholder: '排期名称' });
    const layoutSel = el('select', { class: 'input' }, ...layouts.map(l => el('option', { value: l.id, text: l.name })));
    const modeSel = el('select', { class: 'input' }, ...Object.entries(modeLabel).map(([k, v]) => el('option', { value: k, text: v })));
    const view = el('div', { class: 'page-schedules' },
      pageHead('排期下发',
        can('schedule:edit') ? el('button', { class: 'btn primary', onclick: () => openModal(el('div', {},
          el('h2', { text: '新建排期' }), field('名称', name), field('节目', layoutSel), field('播放方式', modeSel),
          el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '16px' } },
            el('button', { class: 'btn primary', onclick: async () => {
              try { await api.post('/api/schedules', { name: name.value || '新排期', layoutId: layoutSel.value, mode: modeSel.value, target: { all: true }, enabled: true }); document.querySelector('.modal-mask')?._close?.(); toast('已创建', 'ok'); reload(); }
              catch (e) { toast(e.message, 'err'); }
            } }, '创建')),
        )) }, '+ 新建排期') : '',
      ),
      el('div', { class: 'card' }, items.length ? table : empty('暂无排期')),
    );
    box.replaceWith(view);
  };
  reload();
  return box;
}

/* ---------------- 审批中心 ---------------- */
async function renderApprovals() {
  const box = el('div', {}, spinner());
  (async () => {
    let d; try { d = await api.get('/api/approvals'); } catch (e) { box.replaceWith(empty(e.message)); return; }
    const items = (d.items || []).filter(l => l.approval?.state !== 'approved');
    const table = el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: '名称' }), el('th', { text: '状态' }), el('th', { text: '' }))),
      el('tbody', {}, ...items.map(l => el('tr', {},
        el('td', { text: l.name }),
        el('td', {}, el('span', { class: 'badge warn', text: l.approval?.state === 'pending' ? '待审' : '草稿' })),
        el('td', {},
          can('layout:approve') ? el('button', { class: 'btn sm primary', onclick: async () => {
            try { await api.post(`/api/layouts/${l.id}/approve`, {}); toast('已批准', 'ok'); renderApprovals(); }
            catch (e) { toast(e.message, 'err'); }
          } }, '批准') : '',
          el('button', { class: 'btn sm', style: { marginLeft: '6px' }, onclick: () => { location.hash = `#/editor/${l.id}`; } }, '编辑'),
        ),
      ))),
    );
    box.replaceWith(el('div', { class: 'page-approvals' }, pageHead('审批中心'), el('div', { class: 'card' }, items.length ? table : empty('没有待审批的节目'))));
  })();
  return box;
}

/* ---------------- 用户与角色 ---------------- */
async function renderUsers() {
  const box = el('div', {}, spinner());
  const reload = async () => {
    let d, rs; try { d = await api.get('/api/users'); rs = await api.get('/api/roles'); } catch (e) { box.replaceWith(empty(e.message)); return; }
    const roleMap = Object.fromEntries((rs.items || []).map(r => [r.id, r.name]));
    const items = d.items || [];
    const table = el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: '用户名' }), el('th', { text: '姓名' }), el('th', { text: '角色' }), el('th', { text: '状态' }), el('th', { text: '最近登录' }))),
      el('tbody', {}, ...items.map(u => el('tr', {},
        el('td', { text: u.username }), el('td', { text: u.name || '-' }),
        el('td', { text: (u.roleIds || []).map(rid => roleMap[rid] || rid).join(', ') }),
        el('td', {}, el('span', { class: 'badge ' + (u.disabled ? 'off' : 'ok'), text: u.disabled ? '停用' : '正常' })),
        el('td', { text: fmtAgo(u.lastLoginAt) }),
      ))),
    );
    const username = el('input', { class: 'input', placeholder: '用户名' });
    const name = el('input', { class: 'input', placeholder: '姓名' });
    const pw = el('input', { class: 'input', type: 'password', placeholder: '初始密码' });
    const roleSel = el('select', { class: 'input' }, ...(rs.items || []).map(r => el('option', { value: r.id, text: r.name })));
    const view = el('div', { class: 'page-users' },
      pageHead('用户与角色', can('user:edit') ? el('button', { class: 'btn primary', onclick: () => openModal(el('div', {},
        el('h2', { text: '新建用户' }), field('用户名', username), field('姓名', name), field('密码', pw), field('角色', roleSel),
        el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '16px' } },
          el('button', { class: 'btn primary', onclick: async () => {
            try { await api.post('/api/users', { username: username.value, name: name.value, password: pw.value, roleIds: [roleSel.value] }); document.querySelector('.modal-mask')?._close?.(); toast('已创建', 'ok'); reload(); }
            catch (e) { toast(e.message, 'err'); }
          } }, '创建')),
      )) }, '+ 新建用户') : ''),
      el('div', { class: 'card' }, items.length ? table : empty('暂无用户')),
    );
    box.replaceWith(view);
  };
  reload();
  return box;
}

/* ---------------- 日志与播放证明 ---------------- */
async function renderLogs() {
  const box = el('div', {}, spinner());
  const kind = el('select', { class: 'input', style: { maxWidth: '180px' }, onchange: () => load() },
    el('option', { value: 'audit', text: '审计日志' }), el('option', { value: 'task', text: '任务链路' }), el('option', { value: 'play', text: '播放证明' }));
  const load = async () => {
    let d; try { d = await api.get(`/api/logs?kind=${kind.value}&limit=200`); } catch (e) { box.replaceWith(empty(e.message)); return; }
    const items = d.items || [];
    const table = el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: '时间' }), el('th', { text: '事件' }), el('th', { text: '详情' }))),
      el('tbody', {}, ...items.map(r => el('tr', {},
        el('td', { text: fmtTime(r.ts) }), el('td', { text: r.action || r.kind || '-' }),
        el('td', { text: r.username ? `用户 ${r.username}` : (r.message || r.cmdId || r.terminalId || '') }),
      ))),
    );
    const view = el('div', { class: 'page-logs' }, pageHead('日志与播放证明', kind), el('div', { class: 'card' }, items.length ? table : empty('暂无日志')));
    box.replaceWith(view);
  };
  load();
  return box;
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
    const view = el('div', { class: 'page-settings' },
      pageHead('系统设置'),
      el('div', { class: 'card', style: { maxWidth: '560px' } },
        field('服务名称', name), field('心跳间隔(秒)', hb), field('离线判定(秒)', off),
        field('新终端自动准入', auto),
        el('div', { style: { marginTop: '16px' } }, el('button', { class: 'btn primary', onclick: async () => {
          try { await api.put('/api/settings', { serverName: name.value, heartbeatInterval: +hb.value, offlineThreshold: +off.value, autoApproveTerminal: auto.checked }); toast('已保存', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        } }, '保存设置')),
      ),
    );
    box.replaceWith(view);
  })();
  return box;
}

/* ---------------- 设备开通（远程推送 APK） ---------------- */
async function renderFleet() {
  const box = el('div', { class: 'page-fleet' }, spinner());
  (async () => {
    let apks = [], adb = { available: false, output: '' };
    try { apks = (await api.get('/api/apks')).items || []; } catch {}
    try { adb = await api.get('/api/admin/fleet/adb'); } catch {}

    const ipInput = el('textarea', {
      class: 'input', rows: 4,
      placeholder: '逐行填写设备 IP，例如：' + '\n' + '192.168.1.21' + '\n' + '192.168.1.22',
      style: { width: '100%', fontFamily: 'ui-monospace, monospace', resize: 'vertical' },
    });
    const subnet = el('input', { class: 'input', placeholder: '或填子网 192.168.1', style: { width: '160px' } });
    const start = el('input', { class: 'input', placeholder: '起', style: { width: '64px' } });
    const end = el('input', { class: 'input', placeholder: '止', style: { width: '64px' } });

    const apkHint = apks.length ? '选择播放端 APK' : '（请先到 终端-APK升级包 上传）';
    const apkOpts = apks.map(function (a) { return el('option', { value: a.id }, a.name + ' | v' + (a.versionName || '?')); });
    const apkSel = el('select', { class: 'input', style: { minWidth: '220px' } },
      el('option', { value: '' }, apkHint),
      ...apkOpts,
    );

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

    const adbBadge = adb.available
      ? el('span', { class: 'badge ok', text: 'adb 就绪' })
      : el('span', { class: 'badge danger', text: 'adb 不可用' });

    box.replaceChildren(
      head,
      el('div', { class: 'card', style: { marginBottom: '14px' } },
        el('h3', { text: '场景说明' }),
        el('p', { class: 'sub', style: { lineHeight: '1.7' },
          text: '电子屏已嵌墙、无法逐台拆机装 APK，但你知道全部设备 IP。本页可：1 扫描已知 IP，识别设备类型与可开通方式；2 通过「ADB 网络调试(5555)」或「厂商 API」把播放端 APK 远程推送到设备上，全程无需物理接触。设备首次开通后，后续升级由播放端自动完成。' }),
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
          adbBadge,
          el('span', { class: 'sub', text: adb.available ? `(${adb.path})` : '（放入 desktop/adb 或确保 PATH 有 adb）' }),
        ),
      ),
      resultsEl,
    );
  })();
  return box;
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
        el('span', { text: '大屏监控地址：' }),
        el('code', {}, url),
        el('button', { class: 't-btn ghost', style: { height: '28px', padding: '0 10px' }, onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url); toast('已复制大屏监控地址'); } }, '复制'),
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

export const views = {
  dashboard: renderDashboard,
  terminals: renderTerminals,
  media: renderMedia,
  layouts: renderLayouts,
  editor: renderEditor,
  schedules: renderSchedules,
  approvals: renderApprovals,
  monitor: renderMonitor,
  users: renderUsers,
  logs: renderLogs,
  settings: renderSettings,
  fleet: renderFleet,
};
