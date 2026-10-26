/**
 * 灵屏 LumaSign · 播放引擎 widget 渲染器
 * 每个 render 函数：renderWidget(holder, item, resolver, onEnd) -> stop()
 *  - holder: 区域容器（.widget-holder）
 *  - item:   节目项（含 widget 类型与属性）
 *  - resolver: (mediaId) => 可访问的素材 URL
 *  - onEnd:  素材自然播放结束时的回调（用于视频播完即切换）
 */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

// ★ Chromium 33 兼容垫片（与 engine.js 同款）：33 无 padStart/Object.assign/append/replaceWith
const pad2 = n => (n < 10 ? '0' + n : '' + n);
const objAssign = (t, s) => { if (s) { for (const k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } } return t; };
const appendAll = (p, ns) => { for (let i = 0; i < ns.length; i++) { if (ns[i] != null) p.appendChild(ns[i]); } return p; };

/* ---------------- 媒体 blob 缓存（v1.3.45） ----------------
 * 现场事故（2026-10-22 · RK312x/Android 4.4 终端 t_ac4790/192.168.2.221）：
 *   ① Chromium 33 的 <video> 媒体栈直连网络，绕过 WebView HTTP 缓存，也绕过 APK 的
 *      shouldInterceptRequest（MediaCache 只拦得住 <img>/XHR——同节目图片单日仅 2 次
 *      下载，视频却被重下 1638 次）→ 每轮轮播全量重下同一视频（单日 ≈6.2GB 流量）；
 *   ② 叠加 10-19 上传的 High profile 旧转码产物（baseline 修复 v1.3.25 之前的文件）
 *      解不动 → 8s 看门狗反复跳过 → 下载+解码双满载 → 1GB 内存设备 WebView 渲染进程
 *      被 LMKD 杀 → 黑屏 + 心跳/SSE 断（管理端「已断开」toast，偶发恢复「已连接」）。
 * 修复：XHR（走正常资源栈，可被 MediaCache 拦截本地回源）拉取 → Blob URL 内存缓存，
 *   次播起零网络请求；XHR 失败回退直连 URL（保底，旧行为）。
 * 说明：仅覆盖 <video>；音乐走 LumaBridge 原生 MediaPlayer（另一条链路，后续同样处理）。
 */
/* ★★★ v1.3.46 教训：此处初版（v1.3.45）用 `new Map()` 做缓存——Chromium 33
 * （Android 4.4 系统 WebView = Chrome 33）**没有 Map**（Chrome 38 才引入），模块级
 * `new Map()` 直接抛 ReferenceError → 整个 legacy 引擎加载即死（零心跳零打点全黑屏，
 * 现场表现为「发了新版本反而彻底不播」）。凡 4.4 兼容代码禁用 Map/Set/let/const/箭头/
 * Promise/Symbol.iterator——统一 ES5 对象 + 数组实现。 */
const _mediaBlobs = {};        // key -> { url, size, at }（ES5 对象代替 Map）
const _mediaBlobOrder = [];    // key 插入序（近似 LRU：越靠前越旧）
const MEDIA_BLOB_CACHE_MAX = 8; // 约 40MB 上限，1GB 内存设备无压力

function _mediaBlobHas(k) { return Object.prototype.hasOwnProperty.call(_mediaBlobs, k); }

/* ★ v1.3.47 现场事故（RK312x/Chromium 33 实测）：<video src="blob:..."> 在该媒体栈
 * 直接抛 MEDIA_ERR_SRC_NOT_SUPPORTED(4)——Chromium 33 的 Android 媒体播放器不认 blob:
 * 协议，XHR 拿到的字节没问题、直连 URL 同文件播放完美（CDP 实测 loadedmetadata→playing
 * →全程 10.5s 走完）。因此：一旦某视频 blob 播放失败，永久标记 _blobMediaBroken，
 * 此后一律直连 URL（重下载由 APK 侧 MediaCache 的 shouldInterceptRequest 本地回源消灭，
 * 不需要引擎层 blob）。现代浏览器（桌面端预览）不受影响，blob 缓存仍生效。 */
var _blobMediaBroken = false;

/** v1.3.47：供 engine.js 背景视频等外部使用——blob 媒体是否仍可用 */
export function blobMediaUsable() { return !_blobMediaBroken; }
/** v1.3.47：标记 blob 媒体不可用（Chromium 33 媒体栈实测不支持 blob: 协议） */
export function noteBlobMediaBroken() { _blobMediaBroken = true; }

function _mediaBlobEvictOne() {
  if (_mediaBlobOrder.length === 0) return;
  const oldestKey = _mediaBlobOrder.shift();
  if (_mediaBlobHas(oldestKey)) {
    const old = _mediaBlobs[oldestKey];
    try { URL.revokeObjectURL(old.url); } catch (e) { /* ignore */ }
    delete _mediaBlobs[oldestKey];
  }
}

/** 取媒体 Blob URL。命中内存缓存立即回调；未命中 XHR 拉取（缓存后回调）。
 *  任何失败都回调 null，调用方应回退到直连 URL。key 传 mediaId（重传会换新 id，不可变）。 */
export function mediaBlobUrl(key, url, cb) {
  if (_mediaBlobHas(key)) {
    _mediaBlobs[key].at = Date.now();
    cb(_mediaBlobs[key].url);
    return;
  }
  if (!url) { cb(null); return; }
  let settled = false;
  const done = (u) => { if (!settled) { settled = true; cb(u); } };
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 60000;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200 || xhr.status === 304) {
        try {
          const ct = (xhr.getResponseHeader('Content-Type') || 'video/mp4').split(';')[0];
          // ★ Chromium 33 兜底：老引擎可能传回字符串 response，统一转 Uint8Array 再构造 Blob
          let body = xhr.response;
          if (typeof body === 'string') {
            const arr = new Uint8Array(body.length);
            for (let i = 0; i < body.length; i++) arr[i] = body.charCodeAt(i) & 0xff;
            body = arr;
          } else if (body && !body.byteLength && typeof body.length === 'number') {
            const arr2 = new Uint8Array(body.length);
            for (let j = 0; j < body.length; j++) arr2[j] = body[j];
            body = arr2;
          }
          const blob = new Blob([body], { type: ct });
          const blobUrl = URL.createObjectURL(blob);
          while (_mediaBlobOrder.length >= MEDIA_BLOB_CACHE_MAX) _mediaBlobEvictOne();
          _mediaBlobs[key] = { url: blobUrl, size: blob.size, at: Date.now() };
          _mediaBlobOrder.push(key);
          done(blobUrl);
        } catch (e) { done(null); }
      } else { done(null); }
    };
    xhr.onerror = () => done(null);
    xhr.ontimeout = () => done(null);
    xhr.send();
  } catch (e) { done(null); }
}

/* ---------------- 图片 ---------------- */
function renderImage(holder, item, resolver) {
  const img = document.createElement('img');
  const url = item.mediaId ? resolver(item.mediaId) : (item.url || '');
  img.className = 'w-img ' + (item.fit || 'cover');
  img.alt = item.alt || '';
  let attempts = 0;
  const showMiss = () => { const miss = objAssign(document.createElement('div'), { className: 'w-img', textContent: '图片缺失' }); if (img.parentNode) img.parentNode.replaceChild(miss, img); };
  // ★ 加载失败自动重试（v1.3.33）：现场事故——同一节目里视频正常播放、图片却显示「图片缺失」，
  //   服务端取图接口 200、PNG 为基线可解码、CSP 放行，根因在旧端 WebView（Chromium 33 / Android 4.4）：
  //   ① immutable 长期缓存污染（早期一次瞬时错误响应被缓存一年，之后一直命中缓存错误）；
  //   ② 预热 new Image() 与 <img> 共用同一 URL，被 GC 取消导致竞态加载失败。
  //   两者都让 <img>.onerror 触发却无重试 → 常驻「图片缺失」。重试附 cache-bust 查询参数
  //   （服务端忽略 _r/_t），既穿透污染缓存也让瞬时失败自愈；仍失败才显示「图片缺失」。
  img.onerror = () => {
    attempts += 1;
    if (attempts <= 3 && url) {
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      setTimeout(() => { img.src = url + sep + '_r=' + attempts + '&_t=' + Date.now(); }, 400 * attempts);
    } else {
      showMiss();
    }
  };
  img.src = url;
  holder.appendChild(img);
  return () => {};
}

/* ---------------- 视频 ---------------- */
function renderVideo(holder, item, resolver, onEnd, onReady) {
  const v = document.createElement('video');
  // ★ v1.3.49：首帧就绪通知——引擎据此把「淡入」推迟到视频真正出画为止。
  //   <video> 在首帧渲染前画面是全黑的，旧实现「创建即淡入」→ 淡入的就是一层黑，
  //   而旧层又在 450ms 后被撤掉 → 轮播切到视频时必露一段黑屏（纯图片无此问题）。
  let readyFired = false;
  const fireReady = () => {
    if (readyFired) return;
    readyFired = true;
    try { if (typeof onReady === 'function') onReady(); } catch (e) { /* ignore */ }
  };
  v.addEventListener('playing', fireReady);   // 播放已开始 = 首帧已上屏
  v.addEventListener('error', fireReady);      // 出错也别卡住切换（引擎另有 2.5s 兜底）
  const url = item.mediaId ? resolver(item.mediaId) : (item.url || '');
  // ★ v1.3.45：mediaId 不可变（重传换新 id），可安全作为 blob 缓存键
  const cacheKey = item.mediaId || url;
  // ★ v1.3.49/50：优先用屏幕端本地缓存播——4.4 上 <video> 的媒体请求由**平台媒体栈**发起
  //   （access log 里 UA=AppleCoreMedia/1.0.0.7B367 + RockFFPlayer），**绕过**
  //   WebViewClient.shouldInterceptRequest → MediaCache 本地回源对视频无效，
  //   每轮轮播都远程重下同一文件（首帧前长时间黑屏 + 连接池抢占 → SSE 闪断）。
  //   <img> 走 WebView 资源加载器、拦截生效命中本地缓存 → 纯图片轮播不黑屏，正是这个差别。
  //   原生给的是本机回环地址 http://127.0.0.1:<port>/media/<id>（APK 内 LocalMediaServer 回源缓存文件）。
  //   注：file:// 不行——Chromium 33 对 http 源页面直接拒绝「Not allowed to load local resource」。
  let src = url;
  try {
    if (window.LumaBridge && typeof window.LumaBridge.localMediaUrl === 'function') {
      const mid = item.mediaId || (String(url || '').split('?')[0].split('/').pop() || '');
      if (mid) {
        const local = window.LumaBridge.localMediaUrl(mid);
        if (local) { src = local; v._lumaLocal = true; }
      }
    }
  } catch (e) { /* 取不到本地路径就用网络 URL */ }
  // ★ Chromium 33 / Android 4.4 兼容：muted 必须在 src 之前设置，否则自动播放策略可能拦截；
  //   显式写入 muted/autoplay/playsinline(+webkit-) 属性，避免视频被系统强制全屏或无法内联自动播放。
  //   v.1.3.25：额外写 v.volume = 0 —— 现场发现 4.4 上 region 内视频每轮会重建 <video> 元素
  //   （单视频项 loop=false 时播完重渲染），新元素上 muted 属性时序不稳定，声音会间歇漏出；
  //   volume 属性走的是播放器增益，比 muted 标志位更底层可靠，两者叠加保证全程静音。
  v.muted = true; v.defaultMuted = true;
  v.setAttribute('muted', '');
  v.volume = 0;
  v.setAttribute('autoplay', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.autoplay = true; v.playsInline = true;
  v.loop = !!item.loop && !(item.duration > 0);   // 有固定时长时不循环，播完切下一条
  v.className = 'w-video ' + (item.fit || 'cover');
  v.addEventListener('ended', () => onEnd && onEnd());
  holder.appendChild(v);
  // ★ 解码停滞看门狗（v1.3.23）：HEVC 等设备不支持的编码在 RK312x/4.4 上表现为
  //   readyState 正常但 currentTime 恒为 0（硬解不出帧）→ 区域黑屏卡死。8s 仍未走针
  //   即视为不可播，回调 onEnd 切下一条素材；error 事件同理。
  let started = false;
  let watchdog = null;
  let aborted = false;
  // ★ v1.3.45：看门狗改到 src 就绪后才启动——此前 src 同步设置、看门狗 8s 从渲染时起算；
  //   现在 XHR 拉取（含 MediaCache 本地回源）期间不设 src，若看门狗提前起算会在慢网下误杀。
  const armWatchdog = () => {
    if (aborted || watchdog) return;
    watchdog = setTimeout(() => {
      if (!started && v.currentTime < 0.5) {
        // ★ v1.3.47：blob 播不动（Chromium 33 不认 blob:）→ 换直连 URL 再给一次机会，
        //   而不是当不可播跳过（跳过会黑屏 8s，直连实测可正常播放）
        if (v._lumaBlob && !_blobMediaBroken) {
          _blobMediaBroken = true;
          v._lumaBlob = false;
          try { v.src = url; } catch (e) { /* ignore */ }
          if (watchdog) { clearTimeout(watchdog); watchdog = null; }
          armWatchdog();
          try { v.play(); } catch (e) { /* ignore */ }
          return;
        }
        try { v.pause(); } catch (e) { /* ignore */ }
        onEnd && onEnd();
      }
    }, 8000);
  };
  v.addEventListener('timeupdate', () => { if (v.currentTime > 0.5) started = true; });
  v.addEventListener('error', () => {
    // ★ v1.3.47：blob 解码失败（Chromium 33 SRC_NOT_SUPPORTED）→ 立即回退直连，不跳过
    if (v._lumaBlob && !_blobMediaBroken && !started) {
      _blobMediaBroken = true;
      v._lumaBlob = false;
      try { v.src = url; } catch (e) { /* ignore */ }
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      armWatchdog();
      try { v.play(); } catch (e) { /* ignore */ }
      return;
    }
    // ★ v1.3.49：本地 file:// 播放失败（文件被系统清掉/格式不认）→ 回退网络直连
    if (v._lumaLocal && !started) {
      // ★ v1.3.51/52：媒体栈（ffmpeg/RockFFPlayer）首次 open 本地源常失败一次（logcat 可见
      //   「open fail」后重试才 read_header ok），直接回退网络等于白费本地缓存。
      //   故先原地重试一次本地源，仍失败才回退网络直连。
      if (!v._lumaLocalRetried) {
        v._lumaLocalRetried = true;
        try { v.src = src; } catch (e) { /* ignore */ }
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        armWatchdog();
        try { v.play(); } catch (e) { /* ignore */ }
        return;
      }
      v._lumaLocal = false;
      // ★ v1.3.52：向原生回报本地源失败 → 连续失败达阈值后原生自动熔断（不再提供本地地址），
      //   播放回退网络直连。老设备媒体栈行为不可控，本地源必须能自己失能。
      try {
        if (window.LumaBridge && typeof window.LumaBridge.reportLocalMediaFailed === 'function') {
          const mid = item.mediaId || (String(url || '').split('?')[0].split('/').pop() || '');
          if (mid) window.LumaBridge.reportLocalMediaFailed(mid);
        }
      } catch (e) { /* ignore */ }
      try { v.src = url; } catch (e) { /* ignore */ }
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      armWatchdog();
      try { v.play(); } catch (e) { /* ignore */ }
      return;
    }
    if (!started) { if (watchdog) clearTimeout(watchdog); onEnd && onEnd(); }
  });
  // ★ v1.3.45：媒体经 XHR→Blob URL 播放（见文件头「媒体 blob 缓存」注释）：
  //   消灭 Chromium 33 <video> 每轮重下同一文件的风暴；XHR 失败回退直连 URL（旧行为）。
  //   v1.3.47：blob 播放失败（error/看门狗）时永久回退直连 URL——Chromium 33 媒体栈
  //   不支持 blob: 协议（实测 err 4），而直连同文件可正常播放；重下载由 APK MediaCache 兜底。
  //   无 mediaId 且无 url 时直接走 error 分支由调用方处理。
  if (!blobMediaUsable()) {
    // ★ v1.3.48：Chromium 33 不认 blob: 协议，且 mediaBlobUrl 的 XHR 拉全片做 blob 会白白
    //   占内存（每轮轮播重拉一次，缓存最多 8 条≈40MB 常驻）。blob 不可用时直接走直连 URL
    //   （重下载由 APK MediaCache 的 shouldInterceptRequest 本地回源兜底），跳过 XHR，立即播放。
    // ★ v1.3.49：src 优先取屏幕端本地缓存文件（file://）——平台媒体栈绕过 shouldInterceptRequest，
    //   只有显式给本地路径才能真正「下载到本地播放」，彻底消除首帧前黑屏与重复下载。
    try { v.src = src; } catch (e) { /* ignore */ }
    armWatchdog();
    const p0 = v.play();
    if (p0 && p0.catch) p0.catch(() => {});
  } else {
    mediaBlobUrl(cacheKey, url, (blobUrl) => {
      if (aborted) return;   // 期间已被切走/移除：不设 src，blob 已进缓存供次播使用
      const useBlob = !!blobUrl && !_blobMediaBroken;
      v.src = useBlob ? blobUrl : src;
      v._lumaBlob = useBlob;
      armWatchdog();
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    });
  }

  // ★ 断点续播（v1.3.31，对齐竞品 BreakPointDBAdapter）：
  //   1. 加载完成后查询服务端保存的播放位置，有则 seek
  //   2. 播放中每 3s 上报一次进度，切换/退出前上报最终位置
  //   3. 单 region 不循环时（视频自然播完切下一条）跳过上报——避免污染下一条素材的位置
  if (window.__lumaPlayer) {
    const bpKey = (item.id || '') + '|' + (item.mediaId || url || '');
    v.addEventListener('loadedmetadata', () => {
      if (window.__lumaPlayer.loadBreakpoint) {
        const bp = window.__lumaPlayer.loadBreakpoint(bpKey);
        if (bp && bp.position > 0 && bp.position < (v.duration || Infinity)) {
          try { v.currentTime = bp.position; } catch (e) { /* ignore */ }
        }
      }
    });
    let lastReport = 0;
    v.addEventListener('timeupdate', () => {
      if (!item.duration && window.__lumaPlayer.reportBreakpoint) {
        const now = Date.now();
        if (now - lastReport > 3000 && v.currentTime > 0) {
          lastReport = now;
          try { window.__lumaPlayer.reportBreakpoint(bpKey, v.currentTime, v.duration || 0); } catch (e) { /* ignore */ }
        }
      }
    });
  }

  return () => {
    aborted = true;
    if (watchdog) clearTimeout(watchdog);
    if (window.__lumaPlayer && window.__lumaPlayer.reportBreakpoint && item.id) {
      const bpKey = (item.id || '') + '|' + (item.mediaId || url || '');
      try { if (v.currentTime > 0 && v.duration) window.__lumaPlayer.reportBreakpoint(bpKey, v.currentTime, v.duration); } catch (e) { /* ignore */ }
    }
    try { v.pause(); } catch (e) { /* ignore */ }
    // ★ v1.3.48：显式释放视频解码器缓冲——4.4 上仅从 DOM 移除 <video> 不会立即回收解码缓冲，
    //   跨轮播累积会把 1GB 设备内存撑爆（LMKD 杀渲染进程→黑屏卡死）。src 清空 + load() 强制释放，
    //   再移除元素，确保每轮切换都归还解码器资源。
    try { v.removeAttribute('src'); v.src = ''; } catch (e) { /* ignore */ }
    try { v.load(); } catch (e) { /* ignore */ }
    if (v.parentNode) { try { v.parentNode.removeChild(v); } catch (e) { /* ignore */ } }
  };
}

/* ---------------- 边框滚动字（对齐竞品 BorderTextViews） ----------------
 * 4 条 marquee 沿矩形 4 边滚动：上下水平 + 左右垂直，形成"沿边框绕圈"的公告效果。
 * Chromium 33 支持 <marquee>（vertical 属性）。
 */
function renderBorderMarquee(holder, item) {
  const wrap = document.createElement('div');
  wrap.className = 'w-border-marquee';
  const fs = item.fontSize ? `font-size:${item.fontSize}px;` : 'font-size:28px;';
  const color = item.color ? `color:${item.color};` : 'color:#ffffff;';
  const bg = item.bg ? `background:${item.bg};` : 'background:rgba(0,0,0,0.5);';
  const pad = item.padding != null ? item.padding : 4;
  wrap.style.cssText = fs + color + bg + `padding:${pad}px;box-sizing:border-box;`;
  const text = item.text || '欢迎光临，请多多关照';
  const speed = item.speed || 4; // marquee 默认速度（1-10）
  const behavior = item.behavior || 'scroll'; // scroll | slide | alternate
  const makeLine = (vertical) => {
    const m = document.createElement('marquee');
    m.textContent = text + '　　' + text;
    m.setAttribute('scrollamount', String(speed));
    m.setAttribute('scrolldelay', item.delay || '90');
    m.setAttribute('behavior', behavior);
    if (vertical) m.setAttribute('direction', 'up');
    m.className = vertical ? 'bm-v' : 'bm-h';
    return m;
  };
  // 4 条：上、下、左、右
  appendAll(wrap, [makeLine(false), makeLine(true), makeLine(true), makeLine(false)]);
  holder.appendChild(wrap);
  return () => {};
}

/* ---------------- 定时起播（对齐竞品 PlayListTimerInfo + ChooseTimePlayDialog） ----------------
 * 到达配置时间点后显示节目内容，未到/结束时间后显示倒计时卡片。
 * startTime / endTime 均为 "HH:MM" 格式，跨天（endTime < startTime）时视为次日。
 *
 * v1.3.32 新增 mode:
 *   'inline'（默认）：内容填充当前 region（原有行为）
 *   'overlay'：显示为右上角悬浮徽章，点开弹全屏对话框显示倒计时/内容
 */
function renderTimerPlay(holder, item) {
  if (item.mode === 'overlay') return renderTimerPlayOverlay(holder, item);
  const d = document.createElement('div');
  d.className = 'w-timer-play';
  const fs = item.fontSize || 44;
  const color = item.color || '#ffffff';
  const bg = item.bg || 'rgba(0,0,0,0.6)';
  d.style.cssText = `width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:${bg};color:${color};font-size:${fs}px;font-weight:600;text-align:center;line-height:1.4;`;
  holder.appendChild(d);

  const startStr = item.startTime || '00:00';
  const endStr = item.endTime || startStr;
  const content = item.content || '节目内容';
  const title = item.title || '';
  const render = () => {
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const [sh, sm] = String(startStr).split(':').map(Number);
    const [eh, em] = String(endStr).split(':').map(Number);
    const startSec = sh * 3600 + sm * 60;
    const endSec = eh * 3600 + em * 60;
    let inWindow, diff;
    if (startSec <= endSec) {
      inWindow = nowSec >= startSec && nowSec <= endSec;
      if (!inWindow) diff = (nowSec > endSec) ? (startSec + 86400 - nowSec) : (startSec - nowSec);
    } else {
      // 跨天：[startSec, 86400) 或 [0, endSec]
      inWindow = nowSec >= startSec || nowSec <= endSec;
      if (!inWindow) diff = startSec - nowSec;
    }
    if (inWindow) {
      d.innerHTML = `<div><div style="font-size:${fs + 8}px;margin-bottom:8px;">${esc(title || '节目播放中')}</div><div>${esc(content)}</div></div>`;
    } else {
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      const pad2n = n => (n < 10 ? '0' + n : '' + n);
      d.innerHTML = `<div><div style="opacity:.7;font-size:${fs - 8}px;margin-bottom:6px;">${esc(title || '节目')}</div><div>距离开始还有 <span style="font-variant-numeric:tabular-nums;">${pad2n(h)}:${pad2n(m)}:${pad2n(s)}</span></div><div style="opacity:.5;font-size:${fs - 16}px;margin-top:4px;">${esc(startStr)} ~ ${esc(endStr)}</div></div>`;
    }
  };
  render();
  const id = setInterval(render, 1000);
  return () => clearInterval(id);
}

/* ---------------- ChooseTimePlayDialog 独立弹窗（v1.3.32） ----------------
 * mode='overlay' 时使用：右上角悬浮小徽章显示倒计时，点击弹出全屏对话框。
 * 徽章默认 48px；对话框覆盖全屏，含标题/倒计时/起播范围/内容摘要。
 */
function renderTimerPlayOverlay(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-timer-play-overlay';
  d.style.cssText = 'position:absolute;top:12px;right:12px;display:flex;align-items:center;gap:8px;padding:8px 14px;background:' + (item.bg || 'rgba(0,0,0,0.7)') + ';color:' + (item.color || '#ffffff') + ';border-radius:22px;font-size:' + (item.fontSize || 16) + 'px;font-weight:600;cursor:pointer;z-index:20;box-shadow:0 2px 12px rgba(0,0,0,0.3);';
  d.innerHTML = '<span style="opacity:.7;">⏱</span><span class="ttm-badge-txt">--:--:--</span>';
  holder.style.position = 'relative';
  holder.appendChild(d);

  const startStr = item.startTime || '00:00';
  const endStr = item.endTime || startStr;
  const content = item.content || '节目内容';
  const title = item.title || '节目';
  const pad2n = n => (n < 10 ? '0' + n : '' + n);
  const startSecCached = parseInt(startStr.split(':')[0], 10) * 3600 + (parseInt(startStr.split(':')[1], 10) || 0) * 60;
  const endSecCached = parseInt(endStr.split(':')[0], 10) * 3600 + (parseInt(endStr.split(':')[1], 10) || 0) * 60;

  const computeWindow = () => {
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    let inWindow, diff;
    if (startSecCached <= endSecCached) {
      inWindow = nowSec >= startSecCached && nowSec <= endSecCached;
      if (!inWindow) diff = (nowSec > endSecCached) ? (startSecCached + 86400 - nowSec) : (startSecCached - nowSec);
    } else {
      inWindow = nowSec >= startSecCached || nowSec <= endSecCached;
      if (!inWindow) diff = startSecCached - nowSec;
    }
    return { inWindow, diff };
  };

  const tick = () => {
    const w = computeWindow();
    const h = Math.floor(w.diff / 3600), m = Math.floor((w.diff % 3600) / 60), s = w.diff % 60;
    const badge = d.querySelector('.ttm-badge-txt');
    if (badge) badge.textContent = w.inWindow ? '▶ ' + startStr + '~' + endStr : pad2n(h) + ':' + pad2n(m) + ':' + pad2n(s);
  };

  const showDialog = () => {
    if (document.getElementById('ttm-dialog-mask')) return;
    const mask = document.createElement('div');
    mask.id = 'ttm-dialog-mask';
    mask.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:9998;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'width:640px;max-width:90%;background:#1e1e1e;color:#fff;border-radius:12px;padding:28px;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
    box.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
        '<div style="font-size:22px;font-weight:600;">' + esc(title) + '</div>' +
        '<button class="ttm-close" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:0 6px;">×</button>' +
      '</div>' +
      '<div class="ttm-dialog-body" style="text-align:center;font-size:64px;font-weight:700;font-variant-numeric:tabular-nums;margin:24px 0;">--:--:--</div>' +
      '<div style="text-align:center;opacity:.7;margin-bottom:8px;">起播时段：' + esc(startStr) + ' ~ ' + esc(endStr) + '</div>' +
      '<div style="text-align:center;font-size:18px;margin-top:12px;">' + esc(content) + '</div>';
    mask.appendChild(box);
    document.body.appendChild(mask);
    const body = box.querySelector('.ttm-dialog-body');
    let closed = false;
    const di = setInterval(() => {
      if (closed) { clearInterval(di); return; }
      const w = computeWindow();
      const h2 = Math.floor(w.diff / 3600), m2 = Math.floor((w.diff % 3600) / 60), s2 = w.diff % 60;
      body.textContent = w.inWindow ? '▶ 播放中' : pad2n(h2) + ':' + pad2n(m2) + ':' + pad2n(s2);
    }, 1000);
    const close = () => { closed = true; clearInterval(di); mask.remove(); };
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    box.querySelector('.ttm-close').addEventListener('click', close);
  };

  d.addEventListener('click', showDialog);
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

/* ---------------- 关机倒计时提醒（对齐竞品 PowerOffRem） ----------------
 * 读取 window.__lumaPlayer.getServerState().poweroffAt（服务端下发的计划关机时间戳）；
 * 显示 HH:MM:SS 倒计时；倒计时归零后可选自动调用 exit() 触发退出静默期流程。
 */
function renderPoweroff(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-poweroff';
  const fs = item.fontSize || 48;
  const color = item.color || '#ffffff';
  const bg = item.bg || 'rgba(255,0,0,0.6)';
  const title = item.title || '即将关机';
  d.style.cssText = `width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${bg};color:${color};font-size:${fs}px;font-weight:700;text-align:center;line-height:1.4;`;
  holder.appendChild(d);

  let autoExitFired = false;
  const render = () => {
    const st = (window.__lumaPlayer && window.__lumaPlayer.getServerState) ? window.__lumaPlayer.getServerState() : null;
    const target = (st && st.poweroffAt) || item.fixedAt || 0;
    if (!target) {
      d.innerHTML = `<div style="opacity:.8;font-size:${fs - 8}px;">未设置关机计划</div>`;
      return;
    }
    const diff = Math.max(0, target - Date.now());
    if (diff === 0 && !autoExitFired) {
      autoExitFired = true;
      if (item.autoExit && window.__lumaPlayer && window.__lumaPlayer.exit) {
        try { window.__lumaPlayer.exit('poweroff-scheduled'); } catch (e) { /* ignore */ }
      }
    }
    const s = Math.floor(diff / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad2n = n => (n < 10 ? '0' + n : '' + n);
    d.innerHTML = `<div style="opacity:.9;font-size:${fs - 8}px;margin-bottom:8px;">${esc(title)}</div><div style="font-variant-numeric:tabular-nums;letter-spacing:.05em;">${pad2n(h)}:${pad2n(m)}:${pad2n(sec)}</div><div style="opacity:.7;font-size:${fs - 20}px;margin-top:6px;">${esc(item.subtitle || '距下次关机')}</div>`;
  };
  render();
  const id = setInterval(render, 1000);
  return () => clearInterval(id);
}

/* ---------------- 文本 ---------------- */
function renderText(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-text ' + (item.align || 'center');
  const fs = item.fontSize ? `font-size:${item.fontSize}px;` : '';
  const color = item.color ? `color:${item.color};` : '';
  const bg = item.bg ? `background:${item.bg};` : '';
  d.style.cssText = fs + color + bg;
  d.innerHTML = item.html || esc(item.text) || '';
  holder.appendChild(d);
  return () => {};
}

/* ---------------- 滚动字幕 ---------------- */
function renderMarquee(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-marquee';
  const fs = item.fontSize ? `font-size:${item.fontSize}px;` : 'font-size:36px;';
  const color = item.color ? `color:${item.color};` : '';
  const bg = item.bg ? `background:${item.bg};` : '';
  d.style.cssText = fs + color + bg;
  const text = esc(item.text || '');
  const inner = document.createElement('span');
  inner.textContent = text + '　　' + text;          // 双份实现无缝循环
  // 速度 -> 时长（speed 为像素/秒）
  const speed = item.speed || 60;
  const dur = Math.max(8, Math.ceil((text.length * (item.fontSize || 36)) / speed));
  inner.style.animationDuration = dur + 's';
  d.appendChild(inner);
  holder.appendChild(d);
  return () => {};
}

/* ---------------- 时钟 ---------------- */
function renderClock(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-clock';
  const color = item.color ? `color:${item.color};` : '';
  const fs = item.fontSize ? `font-size:${item.fontSize}px;` : '';
  d.style.cssText = color + fs;
  const timeEl = document.createElement('div'); timeEl.className = 'time';
  const dateEl = document.createElement('div'); dateEl.className = 'date';
  d.appendChild(timeEl); if (item.showDate) d.appendChild(dateEl);
  holder.appendChild(d);

  const pad = n => pad2(n);
  const tick = () => {
    const now = new Date();
    if (item.format === 'analog') {
      timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    } else {
      timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }
    if (item.showDate) {
      const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
      dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${wd}`;
    }
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

/* ---------------- 日期（对齐竞品 DateWindowPosition） ----------------
 * 独立日期窗：不显示时间。支持 format:
 *   'long'  2024年5月3日
 *   'md'    05-03
 *   'ym'    2024/05
 *   'dmy'   2024-05-03
 */
function renderDate(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-date';
  const fs = item.fontSize ? `font-size:${item.fontSize}px;` : '';
  const color = item.color ? `color:${item.color};` : '';
  const bg = item.bg ? `background:${item.bg};` : '';
  d.style.cssText = fs + color + bg;
  holder.appendChild(d);
  const fmt = item.format || 'long';
  const tick = () => {
    const now = new Date();
    if (fmt === 'md') d.textContent = pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    else if (fmt === 'ym') d.textContent = now.getFullYear() + '/' + pad(now.getMonth() + 1);
    else if (fmt === 'dmy') d.textContent = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    else d.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  };
  tick();
  const id = setInterval(tick, 30000); // 30s 刷新足够，日期变化频率低
  return () => clearInterval(id);
}

/* ---------------- 星期（对齐竞品 WeekWindowPosition） ----------------
 * 中文星期显示。format:
 *   'cn'      星期四
 *   'cn-short' 四
 *   'en'      Thursday
 *   'en-short' Thu
 */
function renderWeekday(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-weekday';
  const fs = item.fontSize ? `font-size:${item.fontSize}px;` : '';
  const color = item.color ? `color:${item.color};` : '';
  const bg = item.bg ? `background:${item.bg};` : '';
  d.style.cssText = fs + color + bg;
  holder.appendChild(d);
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  const cnFull = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const enFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const enShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = item.format || 'cn';
  const tick = () => {
    const i = new Date().getDay();
    d.textContent = fmt === 'cn-short' ? cn[i] : fmt === 'en' ? enFull[i] : fmt === 'en-short' ? enShort[i] : cnFull[i];
  };
  tick();
  const id = setInterval(tick, 30000);
  return () => clearInterval(id);
}

/* ---------------- 天气（对齐竞品 WeatherWindowPosition + city.db） ----------------
 * 竞品方案：本地 city.db 城市库 + 服务器拉取天气。
 * LumaSign 方案：终端直连 wttr.in 天气 API（返回 JSON，纯文本无鉴权），本地缓存 30 分钟；
 * 降级链：wttr.in JSON → wttr.in 纯文本 → 提示卡。全部离线时显示 fallback 或占位。
 * 兼容 Chromium 33：fetch + JSON.parse 走 polyfill。
 */
function renderWeather(holder, item) {
  const box = document.createElement('div');
  box.className = 'w-weather';
  const color = item.color || '#ffffff';
  const bg = item.bg || 'rgba(0,0,0,0.4)';
  box.style.cssText = `width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:${bg};color:${color};padding:10px;box-sizing:border-box;`;
  holder.appendChild(box);
  const city = (item.city || 'Beijing').trim();
  const ttl = Math.max(5, item.ttl || 30) * 60 * 1000;
  const fallback = item.fallback || '';
  let cache = null;
  let cacheExp = 0;
  let lastErr = null;

  const icon = (w) => {
    w = (w || '').toLowerCase();
    if (/clear|晴|sunshine/.test(w)) return '☀';
    if (/partly|多云|云/.test(w)) return '☁';
    if (/cloudy|阴/.test(w)) return '☁';
    if (/rain|雨/.test(w)) return '🌧';
    if (/snow|雪/.test(w)) return '❄';
    if (/fog|mist|雾|霾/.test(w)) return '🌫';
    if (/thunder|雷/.test(w)) return '⚡';
    if (/haze|霾/.test(w)) return '🌫';
    return '🌤';
  };

  const renderCard = (data) => {
    const t = data.temperature_2m?.current != null ? Math.round(data.temperature_2m.current) : null;
    const tMin = data.temperature_2m?.min_24h != null ? Math.round(data.temperature_2m.min_24h) : null;
    const tMax = data.temperature_2m?.max_24h != null ? Math.round(data.temperature_2m.max_24h) : null;
    const desc = (data.weather_code != null || data.weather_code) ? data.weather_code_desc || '—' : '—';
    box.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';
    const head = document.createElement('div');
    head.style.cssText = `font-size:${item.fontSize || 20}px;font-weight:600;letter-spacing:1px;`;
    head.textContent = item.title || city;
    card.appendChild(head);
    const line = document.createElement('div');
    line.style.cssText = `font-size:${item.bigFontSize || 44}px;line-height:1.1;`;
    line.textContent = `${icon(desc)} ${t == null ? '—' : t + '°'}`;
    card.appendChild(line);
    const range = document.createElement('div');
    range.style.cssText = 'font-size:14px;opacity:.85;';
    range.textContent = tMin != null && tMax != null ? `${tMin}° ~ ${tMax}°` : (desc || '');
    card.appendChild(range);
    if (item.showUpdated && cacheExp) {
      const up = document.createElement('div');
      up.style.cssText = 'font-size:11px;opacity:.5;margin-top:2px;';
      up.textContent = '更新于 ' + new Date(cacheExp - ttl).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      card.appendChild(up);
    }
    box.appendChild(card);
  };

  const showError = () => {
    if (fallback) {
      box.textContent = fallback;
    } else {
      box.innerHTML = '';
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;opacity:.7;';
      const title = document.createElement('div');
      title.style.cssText = `font-size:${item.fontSize || 18}px;`;
      title.textContent = (item.title || city) + ' —';
      card.appendChild(title);
      const err = document.createElement('div');
      err.style.cssText = 'font-size:12px;opacity:.8;';
      err.textContent = lastErr || '天气加载中…';
      card.appendChild(err);
      box.appendChild(card);
    }
  };

  const doFetch = async () => {
    const url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1';
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      cache = j;
      cacheExp = Date.now() + ttl;
      if (j && j.current_condition && j.current_condition[0]) {
        // 兼容 wttr.in 顶层字段
        const cc = j.current_condition[0];
        cache.temperature_2m = { current: Number(cc.temp_C), min_24h: j.weather && j.weather[0] ? Number(j.weather[0].mintempC) : null, max_24h: j.weather && j.weather[0] ? Number(j.weather[0].maxtempC) : null };
        cache.weather_code_desc = cc.weatherDesc && cc.weatherDesc[0] ? cc.weatherDesc[0].value : '';
      }
      renderCard(cache);
    } catch (e) {
      lastErr = '网络异常';
      if (!cache) showError();
      else renderCard(cache);
    }
  };

  const refresh = () => {
    const now = Date.now();
    if (cache && now < cacheExp) { renderCard(cache); return; }
    doFetch();
  };
  refresh();
  const id = setInterval(refresh, ttl);
  return () => clearInterval(id);
}

/* ---------------- LOGO 水印（对齐竞品 LogoInfo） ----------------
 * 图片 LOGO，支持 opacity/fit 与固定/自适应尺寸。
 */
function renderLogo(holder, item) {
  const wrap = document.createElement('div');
  wrap.className = 'w-logo';
  wrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;';
  holder.appendChild(wrap);
  const img = document.createElement('img');
  const fit = item.fit || 'contain';
  img.style.cssText = `object-fit:${fit};opacity:${item.opacity == null ? 0.9 : item.opacity};`;
  if (item.w) img.style.width = item.w + (String(item.w).indexOf('%') >= 0 ? '%' : 'px');
  if (item.h) img.style.height = item.h + (String(item.h).indexOf('%') >= 0 ? '%' : 'px');
  img.className = 'w-logo-img';
  img.onerror = () => {
    wrap.textContent = item.fallback || '';
  };
  wrap.appendChild(img);
  const url = item.mediaId ? (typeof resolver === 'function' ? resolver(item.mediaId) : item.mediaId) : (item.url || '');
  if (url) img.src = url;
  else wrap.textContent = item.fallback || '';
  return () => {};
}

/* ---------------- 二维码 ----------------
 * 若宿主页面注入了 window.LumaQRGen(text) -> dataURL，则渲染真实可扫码二维码；
 * 否则优雅降级为明显的占位卡（显示内容文本），保证内容可见、可用。
 * 启用真实二维码：将 qrcode-generator / qrcodejs 等库放入 player/vendor/，
 * 并在其加载后注册 window.LumaQRGen = (text)=>dataURL。
 */
function renderQR(holder, item) {
  const content = item.content || item.text || '';
  const wrap = document.createElement('div');
  wrap.className = 'w-qr-wrap';

  if (typeof window.LumaQRGen === 'function') {
    const img = document.createElement('img');
    try { img.src = window.LumaQRGen(content); } catch { img.remove(); }
    img.className = 'w-qr';
    wrap.appendChild(img);
  } else {
    const box = document.createElement('div');
    box.className = 'w-qr-fallback';
    box.innerHTML = `<div class="qr-glyph"></div><div class="qr-text">${esc(content)}</div>`;
    wrap.appendChild(box);
  }
  if (item.showText !== false && content) {
    const cap = document.createElement('div');
    cap.className = 'w-qr-caption';
    cap.textContent = content;
    wrap.appendChild(cap);
  }
  holder.appendChild(wrap);
  return () => {};
}

/* ---------------- 会议占位 ---------------- */
function renderMeeting(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-meeting';
  const fs = item.fontSize ? `font-size:${item.fontSize}px;` : '';
  d.style.cssText = fs;
  const room = esc(item.roomName || '会议室');
  const status = item.busy ? '使用中' : '空闲';
  d.innerHTML =
    `<div class="room">${room}</div>` +
    `<div class="status">当前状态：${status}</div>` +
    (item.next ? `<div class="next">下一场：${esc(item.next)}</div>` : '');
  holder.appendChild(d);
  return () => {};
}

/* ---------------- 原始 HTML ---------------- */
function renderHtml(holder, item) {
  const d = document.createElement('div');
  d.style.cssText = 'width:100%;height:100%;';
  d.innerHTML = item.html || item.content || '';
  holder.appendChild(d);
  return () => {};
}

/* ================= P1 动态内容数据源组件 ================= */
function pickPath(obj, path) {
  if (obj == null || !path) return obj;
  return String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
/** 模板变量 {{data.xxx}} 替换（数据值做 HTML 转义，模板静态 HTML 保留） */
function renderTemplate(tpl, data) {
  if (!tpl) return '';
  return tpl.replace(/\{\{\s*data\.([^}]+?)\s*\}\}/g, (m, p) => {
    const v = pickPath(data, p.trim());
    return v == null ? '' : esc(v);
  });
}
function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx, cy, r, a0, a1) {
  const s = polar(cx, cy, r, a1), e = polar(cx, cy, r, a0);
  const large = (a1 - a0) <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y} Z`;
}
function donutSeg(cx, cy, rO, rI, a0, a1) {
  const p0o = polar(cx, cy, rO, a0), p1o = polar(cx, cy, rO, a1);
  const p1i = polar(cx, cy, rI, a1), p0i = polar(cx, cy, rI, a0);
  const large = (a1 - a0) <= 180 ? 0 : 1;
  return `M ${p0o.x} ${p0o.y} A ${rO} ${rO} 0 ${large} 1 ${p1o.x} ${p1o.y} L ${p1i.x} ${p1i.y} A ${rI} ${rI} 0 ${large} 0 ${p0i.x} ${p0i.y} Z`;
}

/** 模板文本：支持 {{data.field}}，定时刷新，降级显示 fallback */
function renderDataText(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-text ' + (item.align || 'center');
  const fs = item.fontSize ? `font-size:${item.fontSize}px;` : '';
  const color = item.color ? `color:${item.color};` : '';
  const bg = item.bg ? `background:${item.bg};` : '';
  d.style.cssText = fs + color + bg;
  holder.appendChild(d);
  const fallback = item.fallback || '数据加载中…';
  const render = () => {
    const data = item._getData ? item._getData(item.dataSourceId) : null;
    if (data == null) { d.textContent = fallback; return; }
    d.innerHTML = renderTemplate(item.html || item.text || '', data);
  };
  render();
  const id = setInterval(render, 1000);
  return () => clearInterval(id);
}

/** 数字翻牌：取数字字段大字号展示 */
function renderDataNumber(holder, item) {
  const wrap = document.createElement('div');
  wrap.className = 'w-number ' + (item.align || 'center');
  wrap.style.cssText = item.color ? `color:${item.color};` : '';
  const valEl = document.createElement('div'); valEl.className = 'num';
  const unitEl = document.createElement('div'); unitEl.className = 'unit';
  const labelEl = document.createElement('div'); labelEl.className = 'label';
  appendAll(wrap, [valEl, unitEl, labelEl]);
  holder.appendChild(wrap);
  const render = () => {
    const data = item._getData ? item._getData(item.dataSourceId) : null;
    if (data == null) { valEl.textContent = item.fallback || '—'; return; }
    const v = pickPath(data, item.valueField || 'value');
    const num = Number(v);
    valEl.textContent = isNaN(num) ? (v == null ? (item.fallback || '—') : String(v)) : num.toLocaleString('zh-CN');
    unitEl.textContent = item.unit || '';
    labelEl.textContent = item.label || '';
  };
  render();
  const id = setInterval(render, 1000);
  return () => clearInterval(id);
}

/** SVG 图表：柱状 / 折线 / 环形 / 饼图（纯手写，零依赖） */
function renderDataChart(holder, item) {
  const box = document.createElement('div');
  box.className = 'w-chart';
  holder.appendChild(box);
  const W = 460, H = 260, palette = ['#2563EB', '#2DD4A7', '#F5B544', '#FF6B6E', '#8B5CF6', '#3B82F6', '#14B8A6', '#F97316'];
  const render = () => {
    const data = item._getData ? item._getData(item.dataSourceId) : null;
    const arr = Array.isArray(data) ? data : (data ? [data] : []);
    if (!arr.length) { box.innerHTML = `<div class="empty">${esc(item.fallback || '暂无数据')}</div>`; return; }
    const labelF = item.labelField || 'label';
    const valueF = item.valueField || 'value';
    const rows = arr.map(r => ({ label: String(r[labelF] ?? ''), value: Number(r[valueF]) || 0 }));
    const type = item.chartType || 'bar';
    let svg = '';
    if (type === 'pie' || type === 'donut') {
      const total = rows.reduce((s, r) => s + r.value, 0) || 1;
      const cx = W / 2, cy = H / 2, rO = Math.min(W, H) / 2 - 10, rI = type === 'donut' ? rO * 0.55 : 0;
      let a0 = 0;
      svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">`;
      rows.forEach((r, i) => {
        const a1 = a0 + (r.value / total) * 360;
        const color = palette[i % palette.length];
        svg += type === 'donut'
          ? `<path d="${donutSeg(cx, cy, rO, rI, a0, a1)}" fill="${color}"/>`
          : `<path d="${arcPath(cx, cy, rO, a0, a1)}" fill="${color}"/>`;
        a0 = a1;
      });
      svg += `</svg>`;
    } else if (type === 'line') {
      const maxV = Math.max(1, ...rows.map(r => r.value));
      const n = rows.length;
      const pad = 30;
      const bw = (W - pad * 2) / Math.max(1, n - 1);
      const pts = rows.map((r, i) => `${pad + i * bw},${H - pad - (r.value / maxV) * (H - pad * 2)}`);
      svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">` +
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${palette[0]}" stroke-width="3"/>` +
        rows.map((r, i) => `<circle cx="${pad + i * bw}" cy="${H - pad - (r.value / maxV) * (H - pad * 2)}" r="4" fill="${palette[0]}"/>`).join('') +
        `</svg>`;
    } else { // bar
      const maxV = Math.max(1, ...rows.map(r => r.value));
      const n = rows.length;
      const padB = 28, padT = 10;
      const slot = W / n;
      const bw = slot * 0.6;
      svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">`;
      rows.forEach((r, i) => {
        const h = (r.value / maxV) * (H - padB - padT);
        const x = i * slot + (slot - bw) / 2;
        const y = H - padB - h;
        const color = palette[i % palette.length];
        svg += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" fill="${color}"/>`;
        svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor">${esc(r.label).slice(0, 8)}</text>`;
      });
      svg += `</svg>`;
    }
    box.innerHTML = svg;
  };
  render();
  const id = setInterval(render, 2000);
  return () => clearInterval(id);
}

/* ============ P1-3.4 交互式表单组件（触摸屏反馈收集） ============ */

/** 渲染星级评分控件 */
function renderStars(container, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'form-stars';
  wrap.style.cssText = 'display:flex;gap:8px;justify-content:center;';
  let rating = 0;
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.textContent = '★';
    s.style.cssText = `font-size:${opts.size || 36}px;color:${i <= rating ? '#F5B544' : 'rgba(255,255,255,.2)'};cursor:pointer;transition:transform .15s,color .2s;line-height:1;`;
    s.dataset.v = i;
    s.addEventListener('click', () => { rating = i; stars.forEach((st, idx) => st.style.color = idx < i ? '#F5B544' : 'rgba(255,255,255,.2)'); if (opts.onChange) opts.onChange(i); });
    s.addEventListener('mouseenter', () => { stars.forEach((st, idx) => st.style.color = idx < i ? '#F5B544' : 'rgba(255,255,255,.2)'); });
    s.addEventListener('mouseleave', () => { stars.forEach((st, idx) => st.style.color = idx < rating ? '#F5B544' : 'rgba(255,255,255,.2)'); });
    stars.push(s);
    wrap.appendChild(s);
  }
  container.appendChild(wrap);
  return { getRating: () => rating };
}

/**
 * 交互式表单：支持 satisfaction（满意度评分）、message（留言板）、phone（电话收集）
 * 提交后 POST /api/t/form-feedback，带终端鉴权
 */
function renderForm(holder, item) {
  const d = document.createElement('div');
  d.className = 'w-form';
  d.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;gap:16px;overflow:auto;';
  holder.appendChild(d);

  const formType = item.formType || 'satisfaction'; // satisfaction | message | phone
  const title = item.formTitle || (formType === 'satisfaction' ? '您对我们的服务满意吗？' : formType === 'message' ? '留言板' : '留下联系方式');
  const color = item.color || '#ffffff';

  // 标题
  const titleEl = document.createElement('div');
  titleEl.style.cssText = `font-size:${item.titleSize || 28}px;font-weight:600;color:${color};text-align:center;`;
  titleEl.textContent = title;
  d.appendChild(titleEl);

  let getValue;
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:16px;opacity:0;height:0;overflow:hidden;transition:opacity .3s;';
  d.appendChild(statusEl);

  const showStatus = (msg, ok) => {
    statusEl.textContent = msg;
    statusEl.style.color = ok ? '#2DD4A7' : '#FF6B6E';
    statusEl.style.opacity = '1'; statusEl.style.height = 'auto';
    setTimeout(() => { statusEl.style.opacity = '0'; statusEl.style.height = '0'; }, 3000);
  };

  const submitFeedback = async (payload) => {
    try {
      const r = await fetch('/api/t/form-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      if (r.ok) { showStatus('提交成功，感谢！', true); return true; }
      showStatus('提交失败，请稍后重试', false);
    } catch { showStatus('网络异常', false); }
    return false;
  };

  if (formType === 'satisfaction') {
    const { getRating } = renderStars(d, { size: item.starSize || 48 });
    getValue = () => ({ rating: getRating() });
    const btn = document.createElement('button');
    btn.textContent = '提交评价';
    btn.className = 'form-btn';
    btn.style.cssText = 'margin-top:8px;padding:12px 40px;font-size:20px;background:#2563EB;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;';
    btn.onclick = async () => {
      const v = getValue();
      if (!v.rating) return showStatus('请先选择星级', false);
      await submitFeedback({ formType, layoutId: item._layoutId, itemId: item.id, ...v });
    };
    d.appendChild(btn);
  } else if (formType === 'message') {
    const ta = document.createElement('textarea');
    ta.placeholder = item.placeholder || '请输入您的意见或建议…';
    ta.style.cssText = 'width:min(480px,90%);height:120px;padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-size:18px;resize:none;font-family:inherit;outline:none;';
    ta.addEventListener('focus', () => { ta.style.borderColor = '#2563EB'; });
    ta.addEventListener('blur', () => { ta.style.borderColor = 'rgba(255,255,255,.25)'; });
    d.appendChild(ta);
    getValue = () => ({ message: ta.value.trim() });
    const btn = document.createElement('button');
    btn.textContent = '提交留言';
    btn.className = 'form-btn';
    btn.style.cssText = 'margin-top:8px;padding:12px 40px;font-size:20px;background:#2563EB;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;';
    btn.onclick = async () => {
      const v = getValue();
      if (!v.message) return showStatus('请输入内容', false);
      btn.disabled = true; btn.textContent = '提交中…';
      const ok = await submitFeedback({ formType, layoutId: item._layoutId, itemId: item.id, ...v });
      if (ok) { ta.value = ''; }
      btn.disabled = false; btn.textContent = '提交留言';
    };
    d.appendChild(btn);
  } else if (formType === 'phone') {
    const row = (label, pholder) => {
      const w = document.createElement('div'); w.style.cssText = 'display:flex;flex-direction:column;gap:4px;width:min(400px,90%);';
      const l = document.createElement('label'); l.textContent = label; l.style.cssText = 'font-size:15px;opacity:.7;';
      const i = document.createElement('input'); i.type = pholder === '电话' ? 'tel' : 'text'; i.placeholder = pholder;
      i.style.cssText = 'padding:12px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-size:18px;outline:none;';
      i.addEventListener('focus', () => { i.style.borderColor = '#2563EB'; });
      i.addEventListener('blur', () => { i.style.borderColor = 'rgba(255,255,255,.25)'; });
      appendAll(w, [l, i]); return { wrap: w, input: i };
    };
    const nameRow = row('姓名（选填）', '您的姓名');
    const phoneRow = row('联系电话', '手机号码');
    appendAll(d, [nameRow.wrap, phoneRow.wrap]);
    getValue = () => ({ name: nameRow.input.value.trim(), phone: phoneRow.input.value.trim() });
    const btn = document.createElement('button');
    btn.textContent = '提交';
    btn.className = 'form-btn';
    btn.style.cssText = 'margin-top:8px;padding:12px 40px;font-size:20px;background:#2563EB;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;';
    btn.onclick = async () => {
      const v = getValue();
      if (!v.phone) return showStatus('请输入联系电话', false);
      btn.disabled = true; btn.textContent = '提交中…';
      await submitFeedback({ formType, layoutId: item._layoutId, itemId: item.id, ...v });
      btn.disabled = false; btn.textContent = '提交';
    };
    d.appendChild(btn);
  }

  return () => {};
}

/* ---------------- 音乐播放 + 歌词（v1.3.32 · MediaService） ----------------
 * 输入：
 *   item.audioUrl / item.audioMediaId —— 音频源
 *   item.lyricsUrl / item.lyricsMediaId —— LRC 歌词（可选）
 *   item.title, item.artist —— 显示信息（可选）
 *   item.loop, item.volume —— 循环 / 音量
 * 播放策略：
 *   优先 Android LumaBridge.musicPlay（MediaPlayer 前台服务，含 MediaSession）
 *   回退到 HTMLAudio（Chromium 33+ 均可）
 * 歌词同步：requestAnimationFrame + setInterval 双通道；onTimeUpdate 优先。
 */
function renderMusic(holder, item, resolver) {
  const d = document.createElement('div');
  d.className = 'w-music';
  const bg = item.bg || 'rgba(0,0,0,0.55)';
  const color = item.color || '#ffffff';
  const fs = item.fontSize || 22;
  d.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:' + bg + ';color:' + color + ';font-size:' + fs + 'px;padding:12px;box-sizing:border-box;';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:' + (fs + 4) + 'px;font-weight:600;margin-bottom:4px;opacity:.95;';
  const artistEl = document.createElement('div');
  artistEl.style.cssText = 'font-size:' + Math.max(14, fs - 6) + 'px;opacity:.7;margin-bottom:16px;';
  const lyricEl = document.createElement('div');
  lyricEl.style.cssText = 'font-size:' + Math.max(16, fs - 2) + 'px;text-align:center;line-height:1.5;margin-bottom:10px;max-height:' + Math.max(60, fs * 3) + 'px;overflow:hidden;';
  const nowEl = document.createElement('div');
  nowEl.style.cssText = 'font-size:' + Math.max(12, fs - 10) + 'px;opacity:.55;font-variant-numeric:tabular-nums;';

  d.appendChild(titleEl);
  d.appendChild(artistEl);
  d.appendChild(lyricEl);
  d.appendChild(nowEl);
  holder.appendChild(d);

  titleEl.textContent = item.title || '音乐播放中';
  artistEl.textContent = item.artist || (item.playlistId ? 'Playlist #' + item.playlistId : '♪');

  const audioUrl = item.audioUrl || (item.audioMediaId ? (resolver ? resolver(item.audioMediaId) : item.audioMediaId) : null);
  const lyricsUrl = item.lyricsUrl || (item.lyricsMediaId ? (resolver ? resolver(item.lyricsMediaId) : item.lyricsMediaId) : null);

  let audio = null;
  let parsedLrc = null;
  let native = null;
  let lyricTimer = null;

  const is44 = (window.navigator && /Chrome\/3[0-9]/.test(window.navigator.userAgent));

  const fmt = (ms) => {
    if (!ms || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    const pad = n => (n < 10 ? '0' + n : '' + n);
    return pad(m) + ':' + pad(ss);
  };

  const updateLyric = () => {
    if (!parsedLrc || !parsedLrc.lines.length) return;
    const t = (audio && audio.currentTime) ? audio.currentTime * 1000 : 0;
    const idx = window.LRCParser ? window.LRCParser.findIndex(parsedLrc, t) : -1;
    lyricEl.textContent = idx >= 0 ? parsedLrc.lines[idx].text : '';
    nowEl.textContent = fmt(t);
  };

  // 优先尝试 Android 前台服务桥
  try {
    if (window.LumaBridge && typeof window.LumaBridge.musicPlay === 'function') {
      native = window.LumaBridge.musicPlay(audioUrl);
    }
  } catch (e) { /* 回退 HTMLAudio */ }

  if (audioUrl) {
    try {
      audio = new Audio(audioUrl);
      audio.loop = !!item.loop;
      audio.volume = (typeof item.volume === 'number') ? Math.min(1, Math.max(0, item.volume)) : 1;
      audio.addEventListener('loadedmetadata', updateLyric);
      audio.addEventListener('timeupdate', updateLyric);
      // 4.4 上 audio.play() 可能受 autoplay 策略限制，try 兜底
      const p = audio.play && audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* 无 audio 也 OK */ }
  }

  // LRC 加载
  if (lyricsUrl && window.fetch) {
    fetch(lyricsUrl).then(r => r.ok ? r.text() : '').then(t => {
      if (t && window.LRCParser) {
        parsedLrc = window.LRCParser.parse(t);
        // 元信息补齐 title/artist
        if (parsedLrc.meta.ti && !item.title) titleEl.textContent = parsedLrc.meta.ti;
        if (parsedLrc.meta.ar && !item.artist) artistEl.textContent = parsedLrc.meta.ar;
      }
    }).catch(() => {});
  }

  // 每 250ms 刷一次歌词（4.4 上 audio timeupdate 频率低）
  lyricTimer = setInterval(updateLyric, 250);

  return () => {
    if (lyricTimer) clearInterval(lyricTimer);
    try {
      if (audio) { audio.pause(); audio.src = ''; audio = null; }
    } catch (e) {}
    try {
      if (window.LumaBridge && typeof window.LumaBridge.musicStop === 'function') {
        window.LumaBridge.musicStop();
      }
    } catch (e) {}
  };
}

const RENDERERS = {
  image: renderImage,
  video: renderVideo,
  text: renderText,
  marquee: renderMarquee,
  'border-marquee': renderBorderMarquee,
  'timer-play': renderTimerPlay,
  poweroff: renderPoweroff,
  clock: renderClock,
  date: renderDate,
  weekday: renderWeekday,
  weather: renderWeather,
  logo: renderLogo,
  qrcode: renderQR,
  meeting: renderMeeting,
  html: renderHtml,
  'data-text': renderDataText,
  'data-number': renderDataNumber,
  'data-chart': renderDataChart,
  'form': renderForm,
  music: renderMusic,
};

export function renderWidget(holder, item, resolver, onEnd, onReady) {
  const fn = RENDERERS[item.widget] || renderText;
  return fn(holder, item, resolver, onEnd, onReady) || (() => {});
}
