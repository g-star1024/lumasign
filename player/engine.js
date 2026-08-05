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

function hits(sch, when = new Date()) {
  if (sch.enabled === false) return false;
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
  }

  stop() {
    this.ctl.aborted = true;
    for (const c of this.regionCtls) c.aborted = true;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    if (this.es) { try { this.es.close(); } catch {} this.es = null; }
    app.innerHTML = '';
    this.stage = null; this.regionCtls = [];
  }

  /** opts.resolver: (mediaId)=>url */
  async load(layout, opts = {}) {
    this.stop();
    this.ctl = { aborted: false };
    this.layout = layout;
    this.resolver = opts.resolver || (id => id);
    this.mode = opts.mode || 'preview';
    hideFallback();
    this.buildStage(layout);
    this.startRegions(layout);
    if (this.mode === 'term') { this.startPolling(); this.startCommands(); this.startHeartbeat(); }
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
      if (r._el) this.runRegion(r);
    }
  }

  runRegion(region) {
    const ctl = { aborted: false };
    this.regionCtls.push(ctl);
    const loop = region.loop !== false;
    const items = region.items || [];
    if (!items.length) return;
    let idx = 0;

    const tick = async () => {
      while (!ctl.aborted) {
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

        await this.wait(ms, () => ended, ctl);

        holder.classList.remove('show');
        holder.classList.add('hide');
        await this.wait((region.transition === 'none') ? 0 : 450, () => true, ctl);

        try { stop(); } catch {}
        holder.remove();

        if (!loop && idx >= items.length - 1) break;
        idx++;
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
      if (!r.ok) return;
      const man = await r.json();
      const sch = pickActiveSchedule(man);
      const id = sch ? sch.scheduleId : null;
      if (id !== this.currentScheduleId) {
        this.currentScheduleId = id;
        const layout = sch ? sch.layout : fallbackLayout();
        this.load(layout, { resolver: this.resolver, mode: 'term' });
      }
    } catch (e) { /* 离线期间保持当前画面 */ }
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

  startHeartbeat() {
    const iv = 15;
    this.hbTimer = setInterval(async () => {
      try {
        const body = {
          terminalId: this.terminalId, token: this.token,
          playing: this.layout?.name || null,
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
            }
          } catch {}
        }
        await fetch('/api/t/heartbeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify(body),
        });
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
    if (d && d.type === 'luma:preview' && d.layout) {
      player.load(d.layout, { resolver: id => `/api/media/${id}/raw`, mode: 'preview' });
    }
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
    const r = await fetch(`/api/t/manifest?terminalId=${encodeURIComponent(player.terminalId || '')}&token=${encodeURIComponent(player.token || '')}`);
    if (!r.ok) { showFallback('终端清单获取失败，请检查终端ID/令牌'); return; }
    const man = await r.json();
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
