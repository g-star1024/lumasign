/**
 * 灵屏 LumaSign · 播放引擎核心
 * 三处复用：编辑器预览 = 终端实际渲染 = 浏览器预览，共用同一份代码。
 *
 * 启动参数：
 *   ?terminalId=ID&token=TOKEN        终端模式：拉取 /api/t/manifest 并按时段切换
 *   ?mode=term（无 ID）                终端模式（浏览器）：自动注册为可控终端
 *   ?layoutId=ID                      预览模式：拉取 /api/layouts/:id
 *   ?data=<urlencoded JSON layout>    内联预览：直接渲染（编辑器实时推送）
 *   ?mode=term|preview                强制模式
 *
 * 编辑器实时预览：父页面 postMessage({type:'luma:preview', layout}) 即可热更新。
 */
import { renderWidget } from './widgets.js';

const app = document.getElementById('app');
const fallback = document.getElementById('fallback');

const showFallback = msg => { fallback.innerHTML = `<div class="big">灵屏 LumaSign</div><div>${msg}</div>`; fallback.classList.remove('hidden'); };
const hideFallback = () => fallback.classList.add('hidden');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 原生桥探测：安卓 APK 注入 window.LumaBridge 暴露硬件/系统能力
const native = name => !!(window.LumaBridge && typeof window.LumaBridge[name] === 'function');

/* ---------------- 排期命中判定（与服务端 schedule.hits 语义一致） ---------------- */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };

/** 有效期本地兜底：断网时终端靠清单里的绝对时间戳自己下线过期内容 */
function inWindow(w, now = Date.now()) {
  if (!w) return true;
  if (w.from != null && now < w.from) return false;
  if (w.until != null && now > w.until) return false;
  return true;
}

function hits(sch, when = new Date()) {
  if (sch.enabled === false) return false;
  const nowMs = when.getTime();
  if (!inWindow(sch.validity, nowMs)) return false;
  if (!inWindow(sch.layoutValidity, nowMs)) return false;
  const dk = ymd(when);
  if (sch.dateRange && sch.dateRange.length === 2) {
    const [from, to] = sch.dateRange;
    if (from && dk < from) return false;
    if (to && dk > to) return false;
  }
  if (Array.isArray(sch.weekdays) && sch.weekdays.length && !sch.weekdays.includes(when.getDay())) return false;
  const slots = sch.timeSlots;
  if (Array.isArray(slots) && slots.length) {
    const cur = when.getHours() * 60 + when.getMinutes();
    const inSlot = slots.some(([a, b]) => {
      const s = toMin(a), e = toMin(b);
      return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
    });
    if (!inSlot) return false;
  }
  if (sch.mode === 'insert' && sch.expireAt && Date.now() > sch.expireAt) return false;
  return true;
}

function pickActiveSchedule(manifest, now = new Date()) {
  const active = (manifest.schedules || []).filter(s => hits(s, now));
  if (!active.length) return null;
  active.sort((a, b) => (b.priority - a.priority) || ((a.order || 0) - (b.order || 0)));
  return active[0];
}

/* ---------------- Player ---------------- */
class Player {
  constructor() {
    this.ctl = { aborted: false };
    this.regionCtls = [];
    this.stage = null;
    this.layout = null;
    this.resolver = id => id;
    this.mode = 'preview';
    this.terminalId = null;
    this.token = null;
    this.pollTimer = null;
    this.hbTimer = null;
    this.es = null;
    this.currentScheduleId = null;
    this.lastManifest = null;
    this._cachedTried = false;
    this.navStack = [];        // 热区跳转导航栈：[{id, name}, ...]
    this.navBar = null;        // 返回按钮容器 DOM
    this.navTimer = null;      // 自动返回定时器
  }

  stop() {
    this.ctl.aborted = true;
    for (const c of this.regionCtls) c.aborted = true;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    if (this.es) { try { this.es.close(); } catch {} this.es = null; }
    if (this._dsTimer) { clearInterval(this._dsTimer); this._dsTimer = null; }
    app.innerHTML = '';
    this.stage = null; this.regionCtls = []; this.hotspotsLayer = null;
    if (this.navBar && this.navBar.parentNode) this.navBar.remove();
    this.navBar = null; this.cancelNavTimer();
  }

  /** opts.resolver: (mediaId)=>url; opts.fromNav=true 表示来自导航栈跳转（不清空栈） */
  async load(layout, opts = {}) {
    this.stop();
    this.ctl = { aborted: false };
    this.layout = layout;
    this.resolver = opts.resolver || (id => id);
    this.mode = opts.mode || 'preview';
    this.dsCache = {};          // dataSourceId -> 最新数据
    this._dsIds = [];
    if (!opts.fromNav) { this.navStack = []; this.cancelNavTimer(); }
    hideFallback();
    this.buildStage(layout);
    this.startRegions(layout);
    this.primeDataSources().catch(() => {}).finally(() => this.startDataSourcePolling());
    if (this._keepEditMode) this.setEditMode(true);
    if (this.mode === 'term') { this.startPolling(); this.startCommands(); this.startHeartbeat(); }
  }

  /* ---------------- P1 动态数据源：拉取与缓存 ---------------- */
  async fetchDataSourceData(id) {
    if (!id) return null;
    const base = (this.mode === 'term' && this.terminalId)
      ? `/api/t/datasource/${id}?terminalId=${encodeURIComponent(this.terminalId)}&token=${encodeURIComponent(this.token || '')}`
      : `/api/admin/datasources/${id}/data`;
    try {
      const r = await fetch(base, { credentials: 'same-origin' });
      if (!r.ok) return null;
      const d = await r.json();
      return d.data ?? null;
    } catch { return null; }
  }

  async primeDataSources() {
    const ids = new Set();
    for (const r of (this.layout?.regions || [])) {
      for (const it of (r.items || [])) if (it.dataSourceId) ids.add(it.dataSourceId);
    }
    this._dsIds = [...ids];
    if (!this._dsIds.length) return;
    await Promise.all(this._dsIds.map(async id => { this.dsCache[id] = await this.fetchDataSourceData(id); }));
  }

  startDataSourcePolling() {
    if (this._dsTimer || !this._dsIds.length) return;
    this._dsTimer = setInterval(async () => {
      if (!this._dsIds.length || this.ctl?.aborted) return;
      for (const id of this._dsIds) {
        const data = await this.fetchDataSourceData(id);
        if (data !== null) this.dsCache[id] = data;
      }
    }, 30000);
    this._dsTimer.unref?.();
  }

  buildStage(layout) {
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.style.width = (layout.width || 1920) + 'px';
    stage.style.height = (layout.height || 1080) + 'px';

    const bg = layout.background || {};
    if (bg.mediaId) {
      const url = this.resolver(bg.mediaId);
      const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(url) || (bg.mime && bg.mime.startsWith('video'));
      if (isVideo) {
        const v = document.createElement('video');
        v.src = url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
        v.className = 'bg-media';
        stage.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = url; img.className = 'bg-media';
        stage.appendChild(img);
      }
    } else {
      stage.style.background = bg.color || '#000';
    }
    app.appendChild(stage);
    this.stage = stage;

    for (const r of (layout.regions || [])) {
      const el = document.createElement('div');
      el.className = 'region';
      el.dataset.transition = r.transition || 'fade';
      el.style.left = (r.x || 0) + 'px';
      el.style.top = (r.y || 0) + 'px';
      el.style.width = (r.w || 0) + 'px';
      el.style.height = (r.h || 0) + 'px';
      el.style.zIndex = r.z || 1;
      stage.appendChild(el);
      r._el = el;
    }
    this.hotspotsLayer = null;
    this.renderHotspots();
    this.renderNavBar();
    this.rescale();
    window.addEventListener('resize', this._onResize = () => this.rescale());
  }

  rescale() {
    if (!this.stage || !this.layout) return;
    const W = this.layout.width || 1920, H = this.layout.height || 1080;
    const sw = window.innerWidth, sh = window.innerHeight;
    const s = Math.min(sw / W, sh / H);
    const ox = (sw - W * s) / 2, oy = (sh - H * s) / 2;
    this.stage.style.transform = `translate(${ox}px, ${oy}px) scale(${s})`;
  }

  startRegions(layout) {
    for (const r of (layout.regions || [])) {
      for (const it of (r.items || [])) it._getData = (id) => this.dsCache[id];
      if (r._el) this.runRegion(r);
    }
  }

  /* ================= P1 交互式触摸热区 ================= */
  /** 编辑器可挂载的回调：选中热区 / 热区变更（用于同步侧栏面板与持久化） */
  onHotspotSelect(hs) { if (this._onSelect) this._onSelect(hs); }
  onHotspotChange() { if (this._onChange) this._onChange(); }

  setHotspotHandlers({ onSelect, onChange }) { this._onSelect = onSelect; this._onChange = onChange; }

  setEditMode(on) {
    this.editMode = !!on;
    this._keepEditMode = !!on;
    if (this.hotspotsLayer) {
      this.hotspotsLayer.classList.toggle('editing', this.editMode);
      this.renderHotspots();
    }
  }

  ensureHotspotLayer() {
    if (this.hotspotsLayer) return this.hotspotsLayer;
    const layer = document.createElement('div');
    layer.className = 'hotspot-layer';
    layer.classList.toggle('editing', this.editMode);
    this.stage.appendChild(layer);
    this.hotspotsLayer = layer;
    // 编辑模式下，在空白区域按下即开始绘制新热区
    layer.addEventListener('pointerdown', (e) => {
      if (!this.editMode || e.target !== layer) return;
      e.preventDefault();
      const rect = this.stage.getBoundingClientRect();
      const sx = this.layout.width / rect.width, sy = this.layout.height / rect.height;
      const ox = (e.clientX - rect.left) * sx, oy = (e.clientY - rect.top) * sy;
      const tmp = { x: ox, y: oy, w: 0, h: 0 };
      const move = (ev) => {
        tmp.w = Math.max(0, (ev.clientX - rect.left) * sx - ox);
        tmp.h = Math.max(0, (ev.clientY - rect.top) * sy - oy);
        const el = layer.querySelector('.hs-draft');
        if (el) { el.style.width = tmp.w + 'px'; el.style.height = tmp.h + 'px'; }
      };
      const up = (ev) => {
        layer.removeEventListener('pointermove', move);
        layer.removeEventListener('pointerup', up);
        const draft = layer.querySelector('.hs-draft'); if (draft) draft.remove();
        const w = Math.max(0, (ev.clientX - rect.left) * sx - ox);
        const h = Math.max(0, (ev.clientY - rect.top) * sy - oy);
        if (w < 20 || h < 20) return; // 太小忽略
        const hs = {
          id: 'hs_' + Math.random().toString(36).slice(2, 9),
          x: Math.round(ox), y: Math.round(oy), w: Math.round(w), h: Math.round(h),
          shape: 'rect', action: { type: 'popup', target: '', label: '', duration: 10 },
        };
        this.layout.hotspots = this.layout.hotspots || [];
        this.layout.hotspots.push(hs);
        this.renderHotspots();
        this.onHotspotSelect(hs);
        this.onHotspotChange();
      };
      const draft = document.createElement('div');
      draft.className = 'hotspot hs-draft';
      draft.style.left = ox + 'px'; draft.style.top = oy + 'px';
      layer.appendChild(draft);
      layer.addEventListener('pointermove', move);
      layer.addEventListener('pointerup', up);
    });
    return layer;
  }

  renderHotspots() {
    if (!this.stage) return;
    const layer = this.ensureHotspotLayer();
    layer.innerHTML = '';
    const interactive = this.editMode || this.mode === 'term';
    layer.style.pointerEvents = interactive ? 'auto' : 'none';
    layer.classList.toggle('editing', this.editMode);
    const list = (this.layout && this.layout.hotspots) || [];
    for (const hs of list) {
      const el = document.createElement('div');
      el.className = 'hotspot' + (hs.shape === 'circle' ? ' circle' : '');
      el.dataset.id = hs.id;
      el.style.left = hs.x + 'px'; el.style.top = hs.y + 'px';
      el.style.width = hs.w + 'px'; el.style.height = hs.h + 'px';
      el.style.pointerEvents = interactive ? 'auto' : 'none';
      if (this.editMode) {
        el.classList.add('editing');
        const lbl = document.createElement('span');
        lbl.className = 'hs-label';
        lbl.textContent = (hs.action && hs.action.label) || (hs.action && hs.action.type) || '热区';
        el.appendChild(lbl);
        const handle = document.createElement('div');
        handle.className = 'hs-handle';
        el.appendChild(handle);
        this._bindHotspotInteractions(el, hs);
      } else if (this.mode === 'term') {
        el.addEventListener('click', (e) => { e.stopPropagation(); this.dispatchHotspot(hs); });
      }
      layer.appendChild(el);
    }
  }

  _bindHotspotInteractions(el, hs) {
    const startMove = (e) => {
      if (e.target.classList.contains('hs-handle')) return; // 由缩放处理
      e.preventDefault(); e.stopPropagation();
      this.onHotspotSelect(hs);
      const rect = this.stage.getBoundingClientRect();
      const sx = this.layout.width / rect.width, sy = this.layout.height / rect.height;
      const ox = e.clientX, oy = e.clientY;
      const orig = { x: hs.x, y: hs.y };
      const move = (ev) => {
        hs.x = Math.round(orig.x + (ev.clientX - ox) * sx);
        hs.y = Math.round(orig.y + (ev.clientY - oy) * sy);
        el.style.left = hs.x + 'px'; el.style.top = hs.y + 'px';
      };
      const up = () => {
        layer_unbind();
        this.onHotspotChange();
      };
      const layer_unbind = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    const handle = el.querySelector('.hs-handle');
    const startResize = (e) => {
      e.preventDefault(); e.stopPropagation();
      const rect = this.stage.getBoundingClientRect();
      const sx = this.layout.width / rect.width, sy = this.layout.height / rect.height;
      const ox = e.clientX, oy = e.clientY;
      const orig = { x: hs.x, y: hs.y, w: hs.w, h: hs.h };
      const move = (ev) => {
        hs.w = Math.max(20, Math.round(orig.w + (ev.clientX - ox) * sx));
        hs.h = Math.max(20, Math.round(orig.h + (ev.clientY - oy) * sy));
        el.style.width = hs.w + 'px'; el.style.height = hs.h + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.onHotspotChange();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    el.addEventListener('pointerdown', startMove);
    if (handle) handle.addEventListener('pointerdown', startResize);
  }

  renderNavBar() {
    // 移除旧的导航栏
    if (this.navBar && this.navBar.parentNode) this.navBar.remove();
    if (this.navStack.length === 0) { this.navBar = null; return; }

    const bar = document.createElement('div');
    bar.className = 'hs-navbar';
    const prev = this.navStack[this.navStack.length - 1];

    // 面包屑：主界面 > 子页面1 > ... > 当前
    const crumbs = [el('span', { text: '🏠 主界面' })];
    for (let i = 0; i < this.navStack.length; i++) {
      crumbs.push(el('span', { class: 'hs-nav-sep', text: ' › ' }));
      crumbs.push(el('span', { text: this.navStack[i].name || `节目${i + 1}` }));
    }

    const backBtn = document.createElement('button');
    backBtn.className = 'hs-nav-back';
    backBtn.textContent = '← 返回';
    backBtn.onclick = () => this.goBack();

    bar.append(backBtn, el('div', { class: 'hs-nav-crumbs' }, ...crumbs));
    document.body.appendChild(bar);
    this.navBar = bar;

    // 热区级自动返回优先，其次用节目级默认值
    const autoReturnSecs = this._pendingAutoReturn ?? (this.layout?._autoReturnSeconds || 0);
    if (autoReturnSecs > 0) this.startAutoReturn(autoReturnSecs);
  }

  addHotspot(hs) {
    this.layout.hotspots = this.layout.hotspots || [];
    this.layout.hotspots.push(hs);
    this.renderHotspots(); this.onHotspotChange();
  }
  updateHotspot(id, patch) {
    const hs = (this.layout.hotspots || []).find(x => x.id === id);
    if (!hs) return;
    Object.assign(hs, patch);
    this.renderHotspots(); this.onHotspotChange();
  }
  removeHotspot(id) {
    this.layout.hotspots = (this.layout.hotspots || []).filter(x => x.id !== id);
    this.renderHotspots(); this.onHotspotChange();
  }
  addHotspotCenter() {
    const W = this.layout.width || 1920, H = this.layout.height || 1080;
    const w = Math.round(W * 0.3), h = Math.round(H * 0.2);
    const hs = {
      id: 'hs_' + Math.random().toString(36).slice(2, 9),
      x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h,
      shape: 'rect', action: { type: 'popup', target: '', label: '热区', duration: 10 },
    };
    this.addHotspot(hs);
    this.onHotspotSelect(hs);
  }

  dispatchHotspot(hs) {
    const a = hs.action || { type: 'none' };
    if (a.type === 'url') {
      const url = a.target || '';
      if (!url) return;
      if (window.LumaBridge && window.LumaBridge.openUrl) window.LumaBridge.openUrl(url);
      else window.open(url, '_blank');
    } else if (a.type === 'layout') {
      if (a.target) this.gotoLayout(a.target, a.autoReturnSeconds);
    } else if (a.type === 'popup') {
      this.showPopup(a);
    }
    // type 'none' → 无操作
  }

  async gotoLayout(id, autoReturnSecs) {
    // 将当前节目压入导航栈
    if (this.layout && this.layout.id) {
      this.navStack.push({ id: this.layout.id, name: this.layout.name || '主界面' });
    }
    this.cancelNavTimer();
    // 热区级自动返回优先于节目级默认值
    if (typeof autoReturnSecs === 'number' && autoReturnSecs > 0) {
      this._pendingAutoReturn = autoReturnSecs;
    } else {
      this._pendingAutoReturn = null;
    }
    const base = (this.mode === 'term' && this.terminalId)
      ? `/api/t/layout/${encodeURIComponent(id)}?terminalId=${encodeURIComponent(this.terminalId)}&token=${encodeURIComponent(this.token || '')}`
      : `/api/layouts/${encodeURIComponent(id)}`;
    try {
      const r = await fetch(base, { credentials: 'same-origin' });
      if (!r.ok) { console.warn('gotoLayout failed', r.status); return; }
      const d = await r.json();
      const item = d.item || d;
      if (item && item.regions) this.load(item, { resolver: this.resolver, mode: this.mode, fromNav: true });
    } catch (e) { console.warn('gotoLayout error', e); }
  }

  goBack() {
    if (this.navStack.length === 0) return;
    this.cancelNavTimer();
    const prev = this.navStack.pop();
    // 直接用栈中的 id 重新加载，不再压栈（fromNav=true 但不 push）
    const base = (this.mode === 'term' && this.terminalId)
      ? `/api/t/layout/${encodeURIComponent(prev.id)}?terminalId=${encodeURIComponent(this.terminalId)}&token=${encodeURIComponent(this.token || '')}`
      : `/api/layouts/${encodeURIComponent(prev.id)}`;
    fetch(base, { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { const item = d?.item || d; if (item?.regions) this.load(item, { resolver: this.resolver, mode: this.mode, fromNav: true }); })
      .catch(() => {});
  }

  cancelNavTimer() {
    if (this.navTimer) { clearTimeout(this.navTimer); this.navTimer = null; }
  }

  startAutoReturn(seconds) {
    this.cancelNavTimer();
    if (!seconds || seconds <= 0) return;
    this.navTimer = setTimeout(() => {
      if (this.navStack.length > 0) this.goBack();
      else this.cancelNavTimer();
    }, seconds * 1000);
  }

  showPopup(a) {
    if (!this.stage) return;
    const overlay = document.createElement('div');
    overlay.className = 'hs-popup';
    const box = document.createElement('div');
    box.className = 'hs-popup-box';
    const close = () => { overlay.remove(); };
    const mediaId = a.mediaId || a.target || '';
    if (mediaId) {
      const url = this.resolver ? this.resolver(mediaId) : `/api/media/${mediaId}/raw`;
      const m = document.createElement('img');
      m.src = url; m.className = 'hs-popup-media';
      box.appendChild(m);
    } else if (a.text) {
      const t = document.createElement('div');
      t.className = 'hs-popup-text';
      t.textContent = a.text;
      box.appendChild(t);
    } else {
      const t = document.createElement('div');
      t.className = 'hs-popup-text';
      t.textContent = (a.label || '提示');
      box.appendChild(t);
    }
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    this.stage.appendChild(overlay);
    const dur = Number(a.duration) || 0;
    if (dur > 0) setTimeout(close, dur * 1000);
  }

  runRegion(region) {
    const ctl = { aborted: false };
    this.regionCtls.push(ctl);
    const loop = region.loop !== false;
    const all = region.items || [];
    if (!all.length) return;
    // 每轮重算：素材有效期可能在长时间播放途中到点，必须当场生效
    const live = () => {
      const now = Date.now();
      const f = all.filter(it => inWindow(it.validity, now));
      return f.length ? f : null;
    };
    let idx = 0;

    const tick = async () => {
      while (!ctl.aborted) {
        const items = live();
        if (!items) {                       // 本区所有内容都过期了：留空等待，不播过期内容
          region._el.innerHTML = '';
          await this.wait(30000, () => false, ctl);
          continue;
        }
        const item = items[idx % items.length];
        const holder = document.createElement('div');
        holder.className = 'widget-holder';
        region._el.appendChild(holder);

        let ended = false;
        const onEnd = () => { ended = true; };
        let stop = () => {};
        try { stop = renderWidget(holder, item, this.resolver, onEnd) || (() => {}); }
        catch (e) { console.error('widget render error', e); }

        requestAnimationFrame(() => holder.classList.add('show'));

        const single = items.length === 1;
        let ms;
        if (item.widget === 'video' && !(item.duration > 0)) ms = -1;       // 等视频自然播完
        else if (item.duration > 0) ms = item.duration * 1000;
        else if (single) ms = -1;                                           // 单图/单文本常驻
        else ms = 8000;

        const startedAt = Date.now();
        this.reportPlay({ itemId: item.id, mediaId: item.mediaId || null, startedAt, endedAt: startedAt });

        await this.wait(ms, () => ended, ctl);

        const endedAt = Date.now();
        this.reportPlay({ itemId: item.id, mediaId: item.mediaId || null, startedAt, endedAt });

        holder.classList.remove('show');
        holder.classList.add('hide');
        await this.wait((region.transition === 'none') ? 0 : 450, () => true, ctl);

        try { stop(); } catch {}
        holder.remove();

        if (!loop && idx >= items.length - 1) break;
        idx = (idx + 1) % Math.max(1, items.length);
      }
    };
    tick();
  }

  /** ms>=0 计时；ms<0 等 predicate 为真；ctl.aborted 立即结束 */
  wait(ms, predicate, ctl) {
    return new Promise(resolve => {
      if (ctl.aborted) return resolve();
      if (ms >= 0) { const id = setTimeout(() => resolve(), ms); return; }
      const iv = setInterval(() => {
        if (ctl.aborted || predicate()) { clearInterval(iv); resolve(); }
      }, 250);
    });
  }

  startPolling() {
    this.pollTimer = setInterval(() => this.refreshTerm(), 30000);
  }

  async refreshTerm() {
    try {
      const r = await fetch(`/api/t/manifest?terminalId=${encodeURIComponent(this.terminalId)}&token=${encodeURIComponent(this.token || '')}`);
      if (r.ok) {
        const man = await r.json();
        this.lastManifest = man;
        try { localStorage.setItem('luma_manifest', JSON.stringify(man)); } catch { /* 配额满则跳过 */ }
      }
    } catch (e) { /* 离线：走本地缓存清单重算 */ }

    // 不管在线离线都重算一次 —— 有效期到点必须自己下线，不能等服务端推
    const man = this.lastManifest || this._loadCachedManifest();
    if (!man) return;
    const sch = pickActiveSchedule(man);
    const id = sch ? sch.scheduleId : null;
    if (id !== this.currentScheduleId) {
      this.currentScheduleId = id;
      const layout = sch ? sch.layout : fallbackLayout();
      this.load(layout, { resolver: this.resolver, mode: 'term' });
    }
  }

  _loadCachedManifest() {
    if (this._cachedTried) return this.lastManifest || null;
    this._cachedTried = true;
    try {
      const raw = localStorage.getItem('luma_manifest');
      if (raw) this.lastManifest = JSON.parse(raw);
    } catch { /* ignore */ }
    return this.lastManifest || null;
  }

  /* ---------------- 终端能力：注册 / 心跳 / 指令 ---------------- */
  async ensureTerminal() {
    if (this.terminalId) return;
    let serial = localStorage.getItem('luma_term_serial');
    if (!serial) {
      serial = (crypto.randomUUID ? crypto.randomUUID() : 'web-' + Math.random().toString(36).slice(2));
      localStorage.setItem('luma_term_serial', serial);
    }
    const W = this.layout?.width || window.screen.width || 1920;
    const H = this.layout?.height || window.screen.height || 1080;
    const body = { serial, name: 'Web 播放器', model: 'Browser', resolution: `${W}x${H}` };
    // 安卓原生端：用桥上报真实硬件信息（mac/serial 作为幂等键，重装不重复）
    if (native('getHardwareInfo')) {
      try {
        const r = window.LumaBridge.getHardwareInfo();
        const raw = (r && typeof r.then === 'function') ? await r : r;
        const hw = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (hw) {
          Object.assign(body, {
            mac: hw.mac || '', serial: hw.serial || serial, model: hw.model || 'Android',
            androidVersion: hw.androidVersion || '', resolution: hw.resolution || `${W}x${H}`,
            orientation: hw.orientation || 'landscape', firmware: hw.firmware || '',
            storageTotal: hw.storageTotal || 0, storageFree: hw.storageFree || 0,
          });
          this.native = true;
        }
      } catch {}
    }
    try {
      const r = await fetch('/api/t/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (r.ok) { const d = await r.json(); this.terminalId = d.terminalId; this.token = d.token; }
    } catch {}
  }

  /** 上报播放证明事件（P0-4）：item 开始/结束各记一次 */
  reportPlay(ev) {
    if (!this.terminalId) return;
    const body = {
      terminalId: this.terminalId, token: this.token || '',
      events: [{
        layoutId: this.layout?.id || null,
        itemId: ev.itemId || null,
        mediaId: ev.mediaId || null,
        customer: this.layout?.customer || null,
        startedAt: ev.startedAt,
        endedAt: ev.endedAt,
      }],
    };
    try {
      fetch('/api/t/playlog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(body),
      }).catch(() => {});
    } catch {}
  }

  startHeartbeat() {
    const iv = 15;
    this._hbLatency = null;
    this.hbTimer = setInterval(async () => {
      if (!this.terminalId) return;
      try {
        const body = {
          terminalId: this.terminalId, token: this.token,
          playing: this.layout?.name || null,
          latency: this._hbLatency || undefined,
        };
        if (native('getNativeStatus')) {
          try {
            const st = window.LumaBridge.getNativeStatus();
            const raw = (st && typeof st.then === 'function') ? await st : st;
            const info = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (info) {
              if (info.volume != null) body.volume = info.volume;
              if (info.storageFree != null) { body.storageFree = info.storageFree; body.storageTotal = info.storageTotal; }
              if (info.appVersion) body.appVersion = info.appVersion;
              if (info.cpuTemp != null) body.cpuTemp = info.cpuTemp;
              if (info.cpu != null) body.cpu = info.cpu;
              if (info.mem != null) body.mem = info.mem;
              if (info.uptime != null) body.uptime = info.uptime;
              if (info.crashCount != null) body.crashCount = info.crashCount;
            }
          } catch {}
        } else if (typeof performance !== 'undefined') {
          body.uptime = Math.floor(performance.now() / 1000);
        }
        const t0 = performance.now();
        await fetch('/api/t/heartbeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify(body),
        });
        const dt = Math.round(performance.now() - t0);
        if (dt > 0 && dt < 60000) this._hbLatency = dt;
      } catch {}
    }, Math.max(10, iv) * 1000);
  }

  startCommands() {
    if (this.es) try { this.es.close(); } catch {}
    if (!this.terminalId) return;
    const url = `/api/t/events?terminalId=${encodeURIComponent(this.terminalId)}&token=${encodeURIComponent(this.token || '')}`;
    const es = new EventSource(url);
    this.es = es;
    es.addEventListener('command', ev => {
      let cmd; try { cmd = JSON.parse(ev.data); } catch { return; }
      this.handleCommand(cmd);
    });
    es.onerror = () => {};
  }

  async handleCommand(cmd) {
    let ok = true, message = '';
    try {
      switch (cmd.type) {
        case 'reload': await this.refreshTerm(); break;
        case 'restart': if (native('restartApp')) window.LumaBridge.restartApp(); else location.reload(); break;
        case 'screenshot': await this.captureAndSend(); break;
        case 'volume': if (native('setVolume')) window.LumaBridge.setVolume(cmd.payload?.volume ?? this.volume ?? 60); else this.volume = cmd.payload?.volume; break;
        case 'reboot': if (native('reboot')) window.LumaBridge.reboot(); break;
        case 'screen_on': if (native('screenOn')) window.LumaBridge.screenOn(); break;
        case 'screen_off': if (native('screenOff')) window.LumaBridge.screenOff(); break;
        case 'set_brightness': if (native('setBrightness')) window.LumaBridge.setBrightness(cmd.payload?.level ?? 100); break;
        case 'power_schedule': if (native('setPowerSchedule')) window.LumaBridge.setPowerSchedule(JSON.stringify(cmd.payload?.schedule || [])); break;
        case 'upgrade_apk': if (native('downloadAndInstallApk') && cmd.payload?.url) window.LumaBridge.downloadAndInstallApk(cmd.payload.url); break;
        case 'clear_cache':
          try { if (native('clearCache')) window.LumaBridge.clearCache(); } catch {}
          try { localStorage.removeItem('luma_manifest'); } catch {}
          break;
        case 'show': case 'play':
          if (cmd.payload?.layoutId) {
            const r = await fetch(`/api/layouts/${encodeURIComponent(cmd.payload.layoutId)}`);
            if (r.ok) { const data = await r.json(); this.load(data.item || data, { resolver: this.resolver, mode: 'term' }); }
          }
          break;
        default: break;
      }
    } catch (e) { ok = false; message = String(e.message || e); }
    this.ack(cmd.cmdId, ok, message);
  }

  ack(cmdId, ok, message) {
    fetch('/api/t/ack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ terminalId: this.terminalId, token: this.token, cmdId, ok, message }),
    }).catch(() => {});
  }

  async captureAndSend() {
    try {
      // 原生端：由桥截取真实 WebView 画面（含视频/动画），返回 dataURL 后上报
      if (native('capture')) { window.LumaBridge.capture(d => { if (d) this.uploadShot(d); }); return; }
      // 浏览器端降级：仅能绘制当前背景色块（DOM 无法被 canvas 快照），用于占位
      const W = this.layout?.width || 1920, H = this.layout?.height || 1080;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = getComputedStyle(this.stage).backgroundColor || '#000';
      c.fillRect(0, 0, W, H);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.8));
      if (blob) await this.uploadBlob(blob);
    } catch { /* 截屏失败时静默 */ }
  }

  async uploadShot(dataUrl) {
    try { await this.uploadBlob(await (await fetch(dataUrl)).blob()); } catch {}
  }

  async uploadBlob(blob) {
    try {
      const fd = new FormData();
      fd.append('shot', blob, 'shot.jpg');
      fd.append('terminalId', this.terminalId);
      fd.append('token', this.token || '');
      await fetch('/api/t/shot', { method: 'POST', body: fd, credentials: 'same-origin' });
    } catch {}
  }
}

function fallbackLayout() {
  return {
    width: 1920, height: 1080, background: { color: '#0b0f17' },
    regions: [{ id: 'r1', x: 0, y: 0, w: 1920, h: 1080, items: [
      { widget: 'text', html: '<div style="font-size:64px;color:#fff;font-weight:600">灵屏 LumaSign</div><div style="font-size:28px;opacity:.7;margin-top:12px">当前暂无排期节目</div>' }
    ] }],
  };
}

/* ---------------- 启动 ---------------- */
async function bootstrap() {
  const q = new URLSearchParams(location.search);
  let mode = q.get('mode') || (q.get('terminalId') ? 'term' : 'preview');
  const terminalId = q.get('terminalId');
  const token = q.get('token');
  const layoutId = q.get('layoutId');
  const inline = q.get('data');
  const player = new Player();

  // 编辑器实时预览：监听 postMessage
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || !d.type) return;
    if (d.type === 'luma:preview' && d.layout) {
      player.load(d.layout, { resolver: id => `/api/media/${id}/raw`, mode: 'preview' });
    } else if (d.type === 'luma:hs-mode') {
      player.setEditMode(!!d.on);
    } else if (d.type === 'luma:hs-update') {
      player.updateHotspot(d.id, d.patch || {});
    } else if (d.type === 'luma:hs-remove') {
      player.removeHotspot(d.id);
    } else if (d.type === 'luma:hs-add-center') {
      player.addHotspotCenter();
    }
  });

  // 交互热区：把选择/变更回传给编辑器父窗口
  player.setHotspotHandlers({
    onSelect: (hs) => { try { window.parent.postMessage({ type: 'luma:hs-select', hs }, '*'); } catch {} },
    onChange: () => { try { window.parent.postMessage({ type: 'luma:hs-change', hotspots: player.layout.hotspots || [] }, '*'); } catch {} },
  });

  // 1) 内联数据
  if (inline) {
    try {
      const layout = JSON.parse(decodeURIComponent(inline));
      player.load(layout, { resolver: id => `/api/media/${id}/raw`, mode: 'preview' });
      return;
    } catch (e) { showFallback('预览数据解析失败'); return; }
  }

  // 2) 终端模式
  if (mode === 'term') {
    if (terminalId) { player.terminalId = terminalId; player.token = token; }
    else { await player.ensureTerminal(); }
    let man = null;
    try {
      const r = await fetch(`/api/t/manifest?terminalId=${encodeURIComponent(player.terminalId || '')}&token=${encodeURIComponent(player.token || '')}`);
      if (r.ok) { man = await r.json(); try { localStorage.setItem('luma_manifest', JSON.stringify(man)); } catch { /* ignore */ } }
    } catch { /* 开机时服务端未就绪，退回缓存清单继续播 */ }
    if (!man) { try { man = JSON.parse(localStorage.getItem('luma_manifest') || 'null'); } catch { man = null; } }
    if (!man) { showFallback('终端清单获取失败，请检查终端ID/令牌'); return; }
    player.lastManifest = man;
    const sch = pickActiveSchedule(man);
    player.currentScheduleId = sch ? sch.scheduleId : null;
    const layout = sch ? sch.layout : fallbackLayout();
    player.load(layout, { resolver: id => `/api/t/media/${id}?terminalId=${encodeURIComponent(player.terminalId || '')}&token=${encodeURIComponent(player.token || '')}`, mode: 'term' });
    return;
  }

  // 3) 预览模式：拉取指定节目
  if (layoutId) {
    const r = await fetch(`/api/layouts/${encodeURIComponent(layoutId)}`);
    if (!r.ok) { showFallback('节目获取失败'); return; }
    const data = await r.json();
    const layout = data.item || data;
    player.load(layout, { resolver: id => `/api/media/${id}/raw`, mode: 'preview' });
    return;
  }

  showFallback('未指定播放内容（需 terminalId / layoutId / data 参数）');
}

bootstrap();

// 供桌面端 / 测试探测
window.__LUMA_PLAYER__ = { version: '1.0.0' };
