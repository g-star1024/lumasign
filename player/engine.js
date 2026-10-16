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
const welcome = document.getElementById('welcome');

const showFallback = msg => { try { fallback.innerHTML = `<div class="big">灵屏 LumaSign</div><div>${msg}</div>`; fallback.classList.remove('hidden'); } catch (e) { /* DOM 缺失也不许炸 */ } };
const hideFallback = () => { try { fallback.classList.add('hidden'); } catch (e) {} };
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ★ 播放页 HTML 版本戳：必须与 index.html 的 ?v= 同步递增（改 index.html 时一起改这里）。
//   4.4 WebView 会把旧 index.html 永久钉死在缓存里（无验证器跳过重验），引擎文件却因
//   mtime 变化总能更新 —— 引擎一旦比 HTML 新，用 sessionStorage 戳检测并强制换新 URL，
//   穿透死缓存。URL 带 _v 参数则不再跳（双保险防循环）。
const HTML_V = '1452';

// ★ Chromium 33（Android 4.4 WebView）兼容层 —— 以下方法在 33 上不存在，全项目禁用：
//   padStart/padEnd(ES2017)、Array.includes(ES2016)、startsWith/endsWith/find/findIndex/
//   Object.assign(ES6)、ParentNode.append/replaceWith(Chrome54)。
//   一律改用本文件垫片：pad2 / objAssign / appendAll。（10-08 黑屏元凶就是 padStart）
const pad2 = n => (n < 10 ? '0' + n : '' + n);
const objAssign = (t, s) => { if (s) { for (const k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } } return t; };
const appendAll = (p, ns) => { for (let i = 0; i < ns.length; i++) { if (ns[i] != null) p.appendChild(ns[i]); } return p; };

// ★ v1.3.31：24 种切换动画时长表（对齐竞品 MPlayer-5.99SM 的 24 动画集）
//   CSS keyframes 定义在 styles.css，class 前缀 t-，holder 上加 t-{name} 生效。
const TRANSITION_MS = {
  'fade': 550, 'none': 0,
  // 滑动推拉（4）
  'slide-left': 500, 'slide-right': 500, 'slide-up': 500, 'slide-down': 500,
  // 推入（4）
  'push-left': 500, 'push-right': 500, 'push-up': 500, 'push-down': 500,
  // 擦除（4）
  'wipe-left': 500, 'wipe-right': 500, 'wipe-up': 500, 'wipe-down': 500,
  // 缩放（2）
  'zoom-in': 600, 'zoom-out': 600,
  // 旋转（2）
  'spin-in': 600, 'spin-out': 600,
  // 翻转（2）
  'flip-h': 700, 'flip-v': 700,
  // 模糊（2）
  'blur-in': 400, 'blur-out': 400,
  // 特效（3）
  'glitch': 500, 'shake': 500, 'flip-book': 700,
  // 3D 视差（1）
  'cube': 700,
};
const transitionMs = name => (TRANSITION_MS[name] != null ? TRANSITION_MS[name] : 550);
const el = (tag, opts, kids) => {
  const d = document.createElement(tag);
  if (opts) { for (const k in opts) { if (!Object.prototype.hasOwnProperty.call(opts, k)) continue;
    if (k === 'text') d.textContent = opts[k]; else if (k === 'class') d.className = opts[k]; else d.setAttribute(k, opts[k]); } }
  if (kids) { for (let i = 0; i < kids.length; i++) { if (kids[i] != null) d.appendChild(kids[i]); } }
  return d;
};

// 原生桥探测：安卓 APK 注入 window.LumaBridge 暴露硬件/系统能力
const native = name => !!(window.LumaBridge && typeof window.LumaBridge[name] === 'function');

/* ---------------- 排期命中判定（与服务端 schedule.hits 语义一致） ---------------- */
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
  if (Array.isArray(sch.weekdays) && sch.weekdays.length && sch.weekdays.indexOf(when.getDay()) === -1) return false;
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
    this._serverState = {};    // ★ v1.3.31：心跳返回的服务端状态（poweroffAt/devices 等）
    this._breakpointCache = {}; // ★ v1.3.31：断点续播本地缓存 key -> {position, duration}
    this._bpTimer = null;
  }

  stop() {
    this.ctl.aborted = true;
    const rcs = this.regionCtls || [];
    for (let i = 0; i < rcs.length; i++) rcs[i].aborted = true;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    if (this.es) { try { this.es.close(); } catch {} this.es = null; }
    if (this._dsTimer) { clearInterval(this._dsTimer); this._dsTimer = null; }
    app.innerHTML = '';
    this.stage = null; this.regionCtls = []; this.hotspotsLayer = null;
    if (this.navBar && this.navBar.parentNode) this.navBar.remove();
    this.navBar = null; this.cancelNavTimer();
  }

  /* ---------------- 欢迎页（终端无展示任务时展示，对标竞品"液晶互动"空闲屏） ----------------
     竞品空闲屏展示：版本号 + 节目状态 + 鼠标/键盘交互入口。这里镜像其信息密度，
     让嵌墙设备在无任务时也清楚"我是谁、连没连上、在等什么"，而非黑屏或纯 logo。 */
  hideWelcome() {
    if (welcome) welcome.classList.add('hidden');
    if (this._welcomeTimer) { clearInterval(this._welcomeTimer); this._welcomeTimer = null; }
  }

  async showWelcome() {
    this.stop();
    hideFallback();
    if (!welcome) return;
    let ip = '';
    let ver = '';
    const hw = this._hwInfo || {};
    const model = hw.model || '';
    const playerVer = (window.__LUMA_PLAYER__ && window.__LUMA_PLAYER__.version) || '';
    try { if (native('getIpAddress')) { const r = window.LumaBridge.getIpAddress(); ip = (typeof r === 'string') ? r.trim() : ''; } } catch (e) { /* 桥不可用则留空 */ }
    // 取原生 App 版本（Android build.gradle versionName，如 1.3.28），由 LumaBridge.getNativeStatus 提供
    try { if (native('getNativeStatus')) { const raw = window.LumaBridge.getNativeStatus(); const info = (typeof raw === 'string') ? JSON.parse(raw) : raw; if (info && info.appVersion) ver = String(info.appVersion); } } catch (e) { /* 忽略 */ }
    const ok = !!this.terminalId;
    const statusText = ok ? '已连接管理端 · 等待分配播放任务' : '正在连接管理端…';
    welcome.innerHTML =
      '<div class="welcome-ip">本机IP：' + (ip || '未连接') + '</div>' +
      (ver ? '<div class="welcome-version">灵屏 v' + escapeHtml(ver) + (playerVer ? ' · 引擎 ' + escapeHtml(playerVer) : '') + '</div>' : '') +
      '<div class="welcome-center">' +
        '<div class="welcome-title">灵屏 LumaSign</div>' +
        '<div class="welcome-sub">局域网数字标牌播放端</div>' +
        (model ? '<div class="welcome-sub" style="font-size:16px;opacity:.4;margin-top:8px">' + escapeHtml(model) + '</div>' : '') +
        '<div class="welcome-status ' + (ok ? 'ok' : 'wait') + '"><span class="dot"></span>' + statusText + '</div>' +
        '<div class="welcome-pulse"></div>' +
      '</div>' +
      '<div class="welcome-hint">右键 / 菜单键：运维菜单　·　长按 2 秒：退出　·　等待播放内容中…</div>';
    welcome.classList.remove('hidden');
    // 空闲屏常驻期间，每 4s 刷新连接状态（注册成功后自动变绿），隐藏/退出即停表
    if (this._welcomeTimer) clearInterval(this._welcomeTimer);
    const statusEl = welcome.querySelector('.welcome-status');
    const self = this;
    this._welcomeTimer = setInterval(function () {
      if (!welcome || welcome.classList.contains('hidden') || !statusEl) { clearInterval(self._welcomeTimer); return; }
      const live = !!self.terminalId;
      statusEl.className = 'welcome-status ' + (live ? 'ok' : 'wait');
      statusEl.innerHTML = '<span class="dot"></span>' + (live ? '已连接管理端 · 等待分配播放任务' : '正在连接管理端…');
    }, 4000);
  }

  /** opts.resolver: (mediaId)=>url; opts.fromNav=true 表示来自导航栈跳转（不清空栈） */
  async load(layout, opts = {}) {
    ping('load-begin');
    try { this.stop(); } catch (e) { ping('stop-err:' + encodeURIComponent(String((e && e.message) || e)).slice(0, 90)); }
    this.ctl = { aborted: false };
    this.layout = layout;
    this.resolver = opts.resolver || (id => id);
    this.mode = opts.mode || 'preview';
    this.dsCache = {};          // dataSourceId -> 最新数据
    this._dsIds = [];
    if (!opts.fromNav) { this.navStack = []; this.cancelNavTimer(); }
    hideFallback();
    ping('build-stage');
    // ★ v1.3.31：拉取服务端保存的断点续播位置（本地缓存 + 服务端合并）
    if (this.mode === 'term' && this.terminalId) this.refreshBreakpoints();
    this.buildStage(layout);
    ping('stage-built');
    this.startRegions(layout);
    ping('regions-ok');
    this.primeDataSources().catch(() => {}).then(() => this.startDataSourcePolling());  // 33 无 Promise.finally
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
    const ids = [];
    const preg = (this.layout && this.layout.regions) || [];
    for (let pi = 0; pi < preg.length; pi++) {
      const pitems = preg[pi].items || [];
      for (let pj = 0; pj < pitems.length; pj++) {
        const pit = pitems[pj];
        if (pit.dataSourceId && ids.indexOf(pit.dataSourceId) === -1) ids.push(pit.dataSourceId);
      }
    }
    this._dsIds = ids;
    if (!this._dsIds.length) return;
    await Promise.all(this._dsIds.map(async id => { this.dsCache[id] = await this.fetchDataSourceData(id); }));
  }

  startDataSourcePolling() {
    if (this._dsTimer || !this._dsIds.length) return;
    this._dsTimer = setInterval(async () => {
      if (!this._dsIds.length || this.ctl?.aborted) return;
      const dsi = this._dsIds || [];
      for (let i = 0; i < dsi.length; i++) {
        const data = await this.fetchDataSourceData(dsi[i]);
        if (data !== null) this.dsCache[dsi[i]] = data;
      }
    }, 30000);
    this._dsTimer.unref?.();
  }

  buildStage(layout) {
    // v1.3.32 dual_mode：layout.mode==='dual' 时把 stage 拆为左右两块，
    // 分别承载 layout.regions（左屏）与 layout.regions2（右屏）。
    // 后续 Android 侧可扩展为真正的多 Display WebView，此处先做单 WebView 内的双区渲染。
    const isDual = layout.mode === 'dual';
    if (isDual) {
      const dualWrap = document.createElement('div');
      dualWrap.className = 'stage-dual';
      dualWrap.style.cssText = 'position:relative;display:flex;width:100%;height:100%;';
      app.appendChild(dualWrap);
      this.stageDual = dualWrap;
      this.stage = null;
      this.regions = [];
      this.regions2 = [];
      this.buildDualPane(dualWrap, layout.regions || [], 'left');
      this.buildDualPane(dualWrap, layout.regions2 || [], 'right');
      this.rescaleDual();
      window.addEventListener('resize', this._onResize = () => this.rescaleDual());
      return;
    }
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.style.width = (layout.width || 1920) + 'px';
    stage.style.height = (layout.height || 1080) + 'px';

    const bg = layout.background || {};
    if (bg.mediaId) {
      const url = this.resolver(bg.mediaId);
      const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(url) || (bg.mime && String(bg.mime).indexOf('video') === 0);
      if (isVideo) {
        const v = document.createElement('video');
        // muted + volume=0 双保险（v1.3.25）：4.4 上 muted 属性在部分时序下不生效，
        // 导致声音间歇漏出；volume 走播放器增益更可靠。两者都必须在 src 之前设置。
        v.muted = true; v.volume = 0; v.autoplay = true; v.loop = true; v.playsInline = true;
        v.src = url; v.className = 'bg-media';
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

    const regions = (layout && layout.regions) || [];
    for (let ri = 0; ri < regions.length; ri++) {
      const r = regions[ri];
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

  /* v1.3.32 dual_mode：构建单侧屏（左或右） */
  buildDualPane(parent, regions, side) {
    const stage = document.createElement('div');
    stage.className = 'stage stage-dual-pane';
    stage.dataset.side = side;
    stage.style.cssText = 'position:relative;width:50%;height:100%;overflow:hidden;background:#000;';
    const bg = (side === 'left') ? this.layout?.background : (this.layout?.background2 || {});
    if (bg && bg.mediaId) {
      const url = this.resolver(bg.mediaId);
      const img = document.createElement('img');
      img.src = url; img.className = 'bg-media'; img.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;';
      stage.appendChild(img);
    } else if (bg && bg.color) {
      stage.style.background = bg.color;
    }
    parent.appendChild(stage);
    for (let ri = 0; ri < regions.length; ri++) {
      const r = regions[ri];
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
      (side === 'left' ? this.regions : this.regions2).push(r);
    }
  }

  /* v1.3.32 dual_mode：整体缩放（按宽度而非宽度/高度比值） */
  rescaleDual() {
    if (!this.stageDual) return;
    const sw = window.innerWidth, sh = window.innerHeight;
    this.stageDual.style.transform = 'none';
    this.stageDual.style.width = '100%';
    this.stageDual.style.height = '100%';
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
    const regs = (layout && layout.regions) || [];
    const regs2 = (layout && layout.regions2) || [];
    const all = regs.concat(regs2);
    for (let ri = 0; ri < all.length; ri++) {
      const r = all[ri];
      const its = r.items || [];
      for (let ii = 0; ii < its.length; ii++) its[ii]._getData = (id) => this.dsCache[id];
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
    for (let hi = 0; hi < list.length; hi++) {
      const hs = list[hi];
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

    appendAll(bar, [backBtn, el('div', { class: 'hs-nav-crumbs' }, crumbs)]);
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
    const hs = (this.layout.hotspots || []).filter(x => x.id === id)[0];
    if (!hs) return;
    objAssign(hs, patch);
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
    // P1-3.4 触摸防误触：冷却期内忽略重复点击（默认 0.8s，可按热区配置）
    const cooldown = (hs.cooldownMs || 800);
    if (this._hsCooldownMap == null) this._hsCooldownMap = new Map();
    const lastClick = this._hsCooldownMap.get(hs.id) || 0;
    if (Date.now() - lastClick < cooldown) return;
    this._hsCooldownMap.set(hs.id, Date.now());

    // 涟漪动效：在点击位置生成涟漪元素
    this.spawnRipple(hs);

    // 交互埋点：热区被点击（仅播放端上报）
    this.trackInteraction('hotspot_click', hs.id);
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

  /* ---------------- 交互埋点（P1 交互式节目） ---------------- */
  trackInteraction(type, itemId) {
    if (this.mode !== 'term') return;            // 仅播放端上报
    const layoutId = this.layout && this.layout.id;
    if (!layoutId) return;
    this._iaQueue = this._iaQueue || [];
    this._iaQueue.push({ layoutId, itemId: itemId || '', type, terminalId: this.terminalId || '' });
    if (this._iaTimer) return;
    this._iaTimer = setTimeout(() => { this._iaTimer = null; this._flushInteractions(); }, 1200);
  }

  async _flushInteractions() {
    const q = this._iaQueue;
    if (!q || !q.length) return;
    this._iaQueue = [];
    const hdr = { 'Content-Type': 'application/json', 'x-terminal-id': this.terminalId || '' };
    for (let qi = 0; qi < q.length; qi++) {
      try { await fetch('/api/interaction', { method: 'POST', headers: hdr, body: JSON.stringify(q[qi]) }); }
      catch (e) { /* 离线或失败：丢弃该条，不影响播放 */ }
    }
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

  /** P1-3.4 热区点击涟漪动效（纯 CSS，零依赖） */
  spawnRipple(hs) {
    if (!this.hotspotsLayer) return;
    const el = this.hotspotsLayer.querySelector(`[data-id="${hs.id}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const stageRect = this.stage.getBoundingClientRect();
    // 在热区中心生成涟漪
    const ripple = document.createElement('div');
    ripple.className = 'hs-ripple';
    ripple.style.cssText = `
      position:absolute;left:${rect.left - stageRect.left + rect.width/2}px;top:${rect.top - stageRect.top + rect.height/2}px;
      width:10px;height:10px;margin-left:-5px;margin-top:-5px;
      border-radius:50%;background:rgba(37,99,235,.5);
      pointer-events:none;z-index:99999;
      animation:hsRipple .5s ease-out forwards;`;
    this.stage.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
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
      let showing = null;   // 当前展示层 { holder, stop }（下一层淡入完成前垫底，杜绝黑屏间隙）
      while (!ctl.aborted) {
        const items = live();
        if (!items) {                       // 本区所有内容都过期了：留空等待，不播过期内容
          region._el.innerHTML = '';
          showing = null;
          await this.wait(30000, () => false, ctl);
          continue;
        }
        const item = items[idx % items.length];
        // 图片解码预热：4.4 上大图 decode 100~300ms，切换时才开始加载必然露黑一瞬。
        // 当前张 + 下一张都提前热身（利用展示时间做解码缓冲）。
        try {
          const warm = it => { if (it && it.mediaId && (!it.widget || it.widget === 'image')) { const im = new Image(); im.src = this.resolver(it.mediaId); } };
          warm(item); warm(items[(idx + 1) % items.length]);
        } catch (e) { /* 预热失败不影响播放 */ }

        const holder = document.createElement('div');
        holder.className = 'widget-holder';
        region._el.appendChild(holder);

        let ended = false;
        const onEnd = () => { ended = true; };
        let stop = () => {};
        try { stop = renderWidget(holder, item, this.resolver, onEnd) || (() => {}); }
        catch (e) { console.error('widget render error', e); }

        requestAnimationFrame(() => holder.classList.add('show'));

        // ★ 交叉淡入淡出：新层盖在旧层之上淡入，完成后才移除旧层 —— 切换全程无黑屏。
        //   旧实现先淡出旧层（450ms 露出黑色舞台背景）再淡入新层，图片切换必闪一下黑。
        //   ★ v1.3.31：24 种切换动画。tName 从 region.transition 读取（默认 fade），
        //   给 holder 加 t-{name} class，CSS keyframes 按 name 触发；过渡时长查 TRANSITION_MS 表。
        const tName = region.transition || 'fade';
        if (tName !== 'none') holder.classList.add('t-' + tName);
        const tDur = transitionMs(tName);
        const prev = showing;
        showing = { holder, stop };
        setTimeout(() => {
          if (prev) { try { prev.stop(); } catch (e) { /* ignore */ } if (prev.holder.parentNode) prev.holder.remove(); }
        }, (tName === 'none') ? 30 : tDur);

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

        if (!loop && idx >= items.length - 1) {
          // 不循环的最后一项：淡出后收尾（循环播放的切换由下一轮交叉淡入接管，不做淡出）
          holder.classList.remove('show');
          holder.classList.add('hide');
          const tName2 = region.transition || 'fade';
          await this.wait((tName2 === 'none') ? 0 : transitionMs(tName2), () => true, ctl);
          try { stop(); } catch (e2) { /* ignore */ }
          if (holder.parentNode) holder.remove();
          showing = null;
          break;
        }
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
    if (this.pollTimer) return;   // 防重入：欢迎页与播放态都要有轮询，切换时不重复建
    this.pollTimer = setInterval(() => this.refreshTerm(), 30000);
  }

  async refreshTerm() {
    try {
      // 未注册先注册：terminalId 无效时拉清单必然 401（曾以 terminalId=null 的字面串打到服务端）
      if (!this.terminalId) await this.ensureTerminal();
      const r = await fetch(`/api/t/manifest?terminalId=${encodeURIComponent(this.terminalId || '')}&token=${encodeURIComponent(this.token || '')}`);
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
    ping('sched-n=' + ((man.schedules || []).length) + ' hit=' + (sch ? sch.scheduleId : 'null') + ' cur=' + this.currentScheduleId);
    const id = sch ? sch.scheduleId : null;
    if (id !== this.currentScheduleId) {
      this.currentScheduleId = id;
      if (sch) {
        try {
          this.hideWelcome();
          await this.load(sch.layout, { resolver: this.resolver, mode: 'term' });
          ping('load-ok');
        } catch (e) { ping('load-err:' + encodeURIComponent(String((e && e.message) || e)).slice(0, 90)); }
      } else {
        this.showWelcome();
        // showWelcome() 内部 stop() 会清掉网络通道 —— 终端模式必须立即重启，
        // 否则欢迎页 = 零心跳零轮询，管理端永远显示离线（死锁）
        this.startPolling(); this.startCommands(); this.startHeartbeat();
      }
    }
    // 网络三件套自愈：注册成功而 SSE/心跳尚未建立时（延迟注册场景）在此补齐
    if (this.terminalId) {
      if (!this.es) this.startCommands();
      if (!this.hbTimer) this.startHeartbeat();
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
    ping('reg-start');
    let serial = null;
    try { serial = localStorage.getItem('luma_term_serial'); } catch { serial = null; }
    if (!serial) {
      serial = (crypto.randomUUID ? crypto.randomUUID() : 'web-' + Math.random().toString(36).slice(2));
      try { localStorage.setItem('luma_term_serial', serial); } catch { /* 隐私模式等，忽略 */ }
    }
    const W = this.layout?.width || window.screen.width || 1920;
    const H = this.layout?.height || window.screen.height || 1080;
    // kind 是唯一可靠的区分信号：安卓原生端（有 LumaBridge）为 device，纯浏览器为 web。
    // 即便安卓拿不到 MAC/序列号，只要走了 LumaBridge 就仍是 device——绝不误判真实设备。
    const body = { serial, name: 'Web 播放器', model: 'Browser', resolution: `${W}x${H}`, kind: 'web', platform: 'web' };
    // 安卓原生端：用桥上报真实硬件信息（mac/serial 作为幂等键，重装不重复）
    if (native('getHardwareInfo')) {
      try {
        // raceBridge：4.4 桥调用绝不能卡死注册流程（Promise 微任务不可靠）
        const r = raceBridge(window.LumaBridge.getHardwareInfo());
        const raw = (r && typeof r.then === 'function') ? await r : r;
        const hw = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (hw) {
          this._hwInfo = hw;
          objAssign(body, {
            mac: hw.mac || '', serial: hw.serial || serial, model: hw.model || 'Android',
            androidVersion: hw.androidVersion || '', resolution: hw.resolution || `${W}x${H}`,
            orientation: hw.orientation || 'landscape', firmware: hw.firmware || '',
            storageTotal: hw.storageTotal || 0, storageFree: hw.storageFree || 0,
          });
          body.kind = 'device';
          body.platform = 'android';
          this.native = true;
        }
      } catch {}
    }
    try {
      ping('reg-fetch');
      const r = await fetch('/api/t/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (r.ok) { const d = await r.json(); this.terminalId = sanId(d.terminalId); this.token = sanId(d.token); }
      ping('reg-done-ok=' + (r.ok ? '1' : r.status));
    } catch { ping('reg-done-err'); }
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
    if (this.hbTimer) return;     // 防重入
    const iv = 15;
    this._hbLatency = null;
    // ★ 桥状态改为「后台异步采集 + 心跳只读缓存」（v1.3.25 加固软掉线）。
    //   背景：@JavascriptInterface 方法是在 WebView 的 JS 线程上同步执行的，而 getNativeStatus
    //   内部是同步文件 IO（存储 / CPU / 温度 / 电量），rk312x 上慢时上百毫秒。原先在心跳里
    //   await 桥调用，一旦 IO 卡住就堵死 JS 线程 → 心跳 fetch 永远发不出去 → 服务端 60s 判
    //   离线，而画面其实还在正常播放（典型的"假掉线"）。
    //   现在心跳只读缓存，桥在后台刷新；Java 侧另有 2s 采集限流，双保险。
    this._nsCache = null;
    this._nsAt = 0;
    const pullNativeStatus = () => {
      if (!native('getNativeStatus')) return;
      const now = Date.now();
      if (now - this._nsAt < 5000) return;   // 5s 内不重复采（Java 侧另有 2s 限流）
      this._nsAt = now;
      try {
        Promise.resolve(window.LumaBridge.getNativeStatus()).then(raw => {
          try {
            const info = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (info) this._nsCache = info;
          } catch (e) { /* ignore */ }
        }).catch(() => {});
      } catch (e) { /* ignore */ }
    };
    pullNativeStatus();
    this.hbTimer = setInterval(async () => {
      if (!this.terminalId) return;
      try {
        const body = {
          terminalId: this.terminalId, token: this.token,
          playing: this.layout?.name || null,
          latency: this._hbLatency || undefined,
        };
        pullNativeStatus();
        const info = this._nsCache;
        if (info) {
          if (info.volume != null) body.volume = info.volume;
          if (info.storageFree != null) { body.storageFree = info.storageFree; body.storageTotal = info.storageTotal; }
          if (info.appVersion) body.appVersion = info.appVersion;
          if (info.cpuTemp != null) body.cpuTemp = info.cpuTemp;
          if (info.cpu != null) body.cpu = info.cpu;
          if (info.mem != null) body.mem = info.mem;
          if (info.uptime != null) body.uptime = info.uptime;
          if (info.crashCount != null) body.crashCount = info.crashCount;
          // ★ v1.3.31：存储热插拔设备列表（对齐竞品 DeviceChangeListener）
          if (Array.isArray(info.devices)) body.devices = info.devices;
        } else if (typeof performance !== 'undefined') {
          body.uptime = Math.floor(performance.now() / 1000);
        }
        const t0 = performance.now();
        // ★ v1.3.31：读取心跳响应保存服务端状态（poweroffAt / devices 存储列表 / powerSchedule 等）
        try {
          const hr = await fetch('/api/t/heartbeat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify(body),
          });
          if (hr.ok) {
            const js = await hr.json();
            if (js && js.ok !== false) this._serverState = js;
          }
        } catch { /* 心跳失败不影响主循环 */ }
        const dt = Math.round(performance.now() - t0);
        if (dt > 0 && dt < 60000) this._hbLatency = dt;
      } catch {}
    }, Math.max(10, iv) * 1000);
  }

  // ★ v1.3.31：暴露服务端状态给 widget（PowerOff / TimerPlay 等）
  getServerState() { return this._serverState || {}; }

  // ★ v1.3.31：断点续播（对齐竞品 BreakPointDBAdapter）
  //   key 格式：itemId|mediaId 或 itemId|url；返回 {position, duration} 或 null
  loadBreakpoint(key) {
    const c = this._breakpointCache;
    const b = c[key];
    if (!b) return null;
    if (b.expired && b.expired < Date.now()) return null;
    return { position: b.position || 0, duration: b.duration || 0 };
  }

  // ★ v1.3.31：断点续播上报（本地缓存 + 服务端持久化）
  reportBreakpoint(key, position, duration) {
    if (!key || !position) return;
    const now = Date.now();
    const expireMs = 24 * 3600 * 1000; // 断点 24 小时后失效
    this._breakpointCache[key] = { position, duration, at: now, expired: now + expireMs };
    // 定期清理过期
    if (!this._bpTimer) {
      this._bpTimer = setInterval(() => {
        const t = Date.now();
        for (const k in this._breakpointCache) {
          if (this._breakpointCache[k].expired < t) delete this._breakpointCache[k];
        }
      }, 60 * 60 * 1000);
    }
    if (!this.terminalId) return;
    fetch('/api/t/breakpoint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ terminalId: this.terminalId, token: this.token || '', key, position, duration }),
    }).catch(() => {});
  }

  // ★ v1.3.31：请求服务端刷新断点缓存（新节目加载时拉取最近 24h 保存的进度）
  async refreshBreakpoints() {
    if (!this.terminalId) return;
    try {
      const r = await fetch(`/api/t/breakpoints?terminalId=${encodeURIComponent(this.terminalId)}&token=${encodeURIComponent(this.token || '')}`);
      if (!r.ok) return;
      const js = await r.json();
      if (js && js.ok && js.breakpoints) {
        for (const b of js.breakpoints) {
          if (b.key && b.position > 0) {
            const now = Date.now();
            this._breakpointCache[b.key] = { position: b.position, duration: b.duration || 0, at: now, expired: now + 24 * 3600 * 1000 };
          }
        }
      }
    } catch { /* ignore */ }
  }

  // ★ v1.3.31：退出播放（PowerOff 倒计时归零、管理员触发等场景）
  exit(reason) {
    try { if (typeof window.LumaBridge !== 'undefined' && window.LumaBridge && window.LumaBridge.exitApp) window.LumaBridge.exitApp(); } catch { /* ignore */ }
    try { if (typeof window.LumaBridge !== 'undefined' && window.LumaBridge && window.LumaBridge.shutdown) window.LumaBridge.shutdown(); } catch { /* ignore */ }
    // 兜底：Android 4.4 无 bridge 时走 location 触发关闭意图（浏览器环境无害）
    try { if (this.terminalId) fetch(`/api/t/ping?stage=exit&reason=${encodeURIComponent(reason || 'js-exit')}&t=${Date.now()}`).catch(() => {}); } catch { /* ignore */ }
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
    es.onerror = () => {
      // 33 的 EventSource 放弃重连后必须自愈：5s 后人工重开（若已有更新连接则让位）
      try { es.close(); } catch (e2) { /* ignore */ }
      setTimeout(() => { if (this.terminalId && this.es === es) this.startCommands(); }, 5000);
    };
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
        case 'upgrade_apk': if (native('downloadAndInstallApk') && cmd.payload?.url) window.LumaBridge.downloadAndInstallApk(cmd.payload.url, cmd.payload?.sha256 || null); break;
        case 'clear_cache':
          try { if (native('clearCache')) window.LumaBridge.clearCache(); } catch {}
          try { localStorage.removeItem('luma_manifest'); } catch {}
          break;
        case 'show': case 'play':
          if (cmd.payload?.layoutId) {
            this.hideWelcome();
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
      if (native('capture')) { window.LumaBridge.capture('window.__lumaPlayer.onCaptureShot'); return; }
      // 浏览器端降级：仅能绘制当前背景色块（DOM 无法被 canvas 快照），用于占位
      const W = this.layout?.width || 1920, H = this.layout?.height || 1080;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = getComputedStyle(this.stage).backgroundColor || '#000';
      c.fillRect(0, 0, W, H);
      const blob = (typeof cv.toBlob === 'function') ? await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.8)) : null;
      if (blob) await this.uploadBlob(blob);
    } catch { /* 截屏失败时静默 */ }
  }

  onCaptureShot(dataUrl) { if (dataUrl) this.uploadShot(dataUrl); }

  async uploadShot(dataUrl) {
    try {
      let blob;
      if (dataUrl && dataUrl.indexOf('data:') === 0) {
        const parts = dataUrl.split(',');
        const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
        const bstr = atob(parts[1]);
        const u8 = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
        blob = new Blob([u8], { type: mime });
      } else {
        blob = await (await fetch(dataUrl)).blob();
      }
      await this.uploadBlob(blob);
    } catch {}
  }

  async uploadBlob(blob) {
    try {
      // 服务端 /api/t/shot 读裸体（JPEG 字节）+ 查询串鉴权（terminalId/token），非 multipart
      const q = `terminalId=${encodeURIComponent(this.terminalId || '')}&token=${encodeURIComponent(this.token || '')}`;
      await fetch(`/api/t/shot?${q}`, { method: 'POST', body: blob, credentials: 'same-origin' });
    } catch {}
  }
}

/* ---------------- 启动 ---------------- */
// 诊断信标：用 Image 发 GET（零依赖、不依赖 fetch/polyfill），服务端 access 日志记录 URL，
// 用于 4.4 真机定位"bootstrap 卡在哪一步"——每个 stage 都会出现在 access-debug.jsonl
function ping(stage) {
  try { new Image().src = '/api/t/ping?stage=' + encodeURIComponent(stage) + '&t=' + Date.now(); } catch { /* ignore */ }
}
// terminalId/token 净化：URL 参数或桥返回的 "null"/"undefined"/空串一律视为无效
function sanId(v) { return (v && v !== 'null' && v !== 'undefined') ? String(v) : null; }
// 桥调用竞速保护：4.4 Chromium33 的 Promise 微任务实现不可靠，await 可能永不恢复——
// 任何可能返回 Promise 的桥调用都加 2s 超时，卡死也绝不能阻塞后续代码
function raceBridge(p) {
  return Promise.race([Promise.resolve(p), new Promise(r => setTimeout(() => r(null), 2000))]);
}

async function bootstrap() {
  ping('boot-start');
  const q = new URLSearchParams(location.search);
  let mode = q.get('mode') || (q.get('terminalId') ? 'term' : 'preview');
  const terminalId = sanId(q.get('terminalId'));
  const token = sanId(q.get('token'));
  const layoutId = q.get('layoutId');
  const inline = q.get('data');
  const player = new Player();
  window.__lumaPlayer = player;   // 调试/远程诊断句柄：CDP 可直接调 showWelcome()/refreshTerm() 验证链路
  if (mode === 'term') { player.terminalId = terminalId; player.token = token; }
  ping('boot-bridge-probed');

  // 网络恢复钩子：原生端 ConnectivityManager 监听到重连后调用，重开指令流(SSE)+刷新清单
  window.__onNetworkChange = (online) => {
    if (!online) return;
    try {
      player.startCommands();      // 重开 SSE（旧连接已死）
      player.refreshTerm();        // 立即重新拉取清单，避免最长 30s 空窗
    } catch (e) { /* 忽略 */ }
  };

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
    ping('term-branch');
    try {
      if (terminalId) { player.terminalId = terminalId; player.token = token; }
      else { await player.ensureTerminal(); }
      ping('term-id=' + (player.terminalId ? 'ok' : 'null'));

      // ★ 铁律：定时器先行 —— 渲染链任何一环炸掉，终端也必须保持在线、可被管理端远程触达。
      //   （17:16 事故：排期命中分支先渲染后启动定时器，load 之前一炸终端即"植物机"：
      //   无心跳/无轮询/无 SSE，任何指令都送不进去，只能断电重启）
      player.startPolling(); player.startCommands(); player.startHeartbeat();
      ping('timers-started');

      // ★ HTML 自升级：sessionStorage 戳与引擎 HTML_V 不匹配 → 说明 HTML 可能是旧缓存，
      //   强制以带 _v 的新 URL 重导航穿透（服务端 302 会保留 _v 并追加新 cb 桶）。
      let sv = null; try { sv = sessionStorage.getItem('luma_html_v'); } catch (e) {}
      if (sv !== HTML_V && location.search.indexOf('_v=') === -1) {
        try { sessionStorage.setItem('luma_html_v', HTML_V); } catch (e) {}
        ping('html-upgrade-' + HTML_V);
        location.replace('/player/?mode=term&_v=' + HTML_V);
        return;
      }

      // 10 秒兜底自愈：若注册仍未成功（桥/网络怪异状态），强制再试并上报
      setTimeout(() => {
        if (mode === 'term' && !player.terminalId) {
          ping('stuck-10s-retry');
          player.ensureTerminal();
        }
      }, 10000);
      let man = null;
      try {
        const r = await fetch(`/api/t/manifest?terminalId=${encodeURIComponent(player.terminalId || '')}&token=${encodeURIComponent(player.token || '')}`);
        if (r.ok) { man = await r.json(); try { localStorage.setItem('luma_manifest', JSON.stringify(man)); } catch { /* ignore */ } }
      } catch { /* 开机时服务端未就绪，退回缓存清单继续播 */ }
      if (!man) { try { man = JSON.parse(localStorage.getItem('luma_manifest') || 'null'); } catch { man = null; } }
      if (!man) { showFallback('终端清单获取失败，请检查终端ID/令牌'); return; }
      ping('m1-ok');
      player.lastManifest = man;
      let sch = null;
      try { sch = pickActiveSchedule(man); } catch (e) { ping('pick-err:' + encodeURIComponent(String((e && e.message) || e)).slice(0, 80)); }
      ping('sched=' + (sch ? sch.scheduleId : 'null'));
      player.currentScheduleId = sch ? sch.scheduleId : null;
      if (sch) {
        try { player.hideWelcome(); } catch (e) { ping('hw-err:' + encodeURIComponent(String((e && e.message) || e)).slice(0, 80)); }
        try {
          await player.load(sch.layout, { resolver: id => `/api/t/media/${id}?terminalId=${encodeURIComponent(player.terminalId || '')}&token=${encodeURIComponent(player.token || '')}`, mode: 'term' });
          ping('boot-load-ok');
        } catch (e) {
          ping('boot-load-err:' + encodeURIComponent(String((e && e.message) || e)).slice(0, 90));
          showFallback('渲染异常：' + ((e && e.message) || e));
        }
      } else {
        player.showWelcome();
        // 无排期也必须常开心跳/轮询/SSE：欢迎页终端必须对管理端可见、可下发指令，
        // 否则"没排期的终端永远离线、永远收不到排期通知"——死锁
        player.startPolling(); player.startCommands(); player.startHeartbeat();
      }
    } catch (e) {
      // ★ 最外层安全网：boot 链任何未预料异常都不得静默——上报信标 + 兜底提示
      ping('boot-err:' + encodeURIComponent(String((e && e.message) || e)).slice(0, 90));
      showFallback('启动异常：' + ((e && e.message) || e));
    }
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
window.__LUMA_PLAYER__ = { version: '1.1.0' };
