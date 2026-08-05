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

/* ---------------- 图片 ---------------- */
function renderImage(holder, item, resolver) {
  const img = document.createElement('img');
  const url = item.mediaId ? resolver(item.mediaId) : (item.url || '');
  img.src = url;
  img.className = 'w-img ' + (item.fit || 'cover');
  img.alt = item.alt || '';
  img.onerror = () => { img.replaceWith(Object.assign(document.createElement('div'), { className: 'w-img', textContent: '图片缺失' })); };
  holder.appendChild(img);
  return () => {};
}

/* ---------------- 视频 ---------------- */
function renderVideo(holder, item, resolver, onEnd) {
  const v = document.createElement('video');
  const url = item.mediaId ? resolver(item.mediaId) : (item.url || '');
  v.src = url;
  v.autoplay = true; v.muted = true; v.playsInline = true;
  v.loop = !!item.loop && !(item.duration > 0);   // 有固定时长时不循环，播完切下一条
  v.className = 'w-video ' + (item.fit || 'cover');
  v.addEventListener('ended', () => onEnd && onEnd());
  holder.appendChild(v);
  const p = v.play();
  if (p && p.catch) p.catch(() => {});
  return () => { try { v.pause(); } catch {} };
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

  const pad = n => String(n).padStart(2, '0');
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

const RENDERERS = {
  image: renderImage,
  video: renderVideo,
  text: renderText,
  marquee: renderMarquee,
  clock: renderClock,
  qrcode: renderQR,
  meeting: renderMeeting,
  html: renderHtml,
};

export function renderWidget(holder, item, resolver, onEnd) {
  const fn = RENDERERS[item.widget] || renderText;
  return fn(holder, item, resolver, onEnd) || (() => {});
}
