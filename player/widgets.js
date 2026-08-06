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
  wrap.append(valEl, unitEl, labelEl);
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
      w.append(l, i); return { wrap: w, input: i };
    };
    const nameRow = row('姓名（选填）', '您的姓名');
    const phoneRow = row('联系电话', '手机号码');
    d.append(nameRow.wrap, phoneRow.wrap);
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

const RENDERERS = {
  image: renderImage,
  video: renderVideo,
  text: renderText,
  marquee: renderMarquee,
  clock: renderClock,
  qrcode: renderQR,
  meeting: renderMeeting,
  html: renderHtml,
  'data-text': renderDataText,
  'data-number': renderDataNumber,
  'data-chart': renderDataChart,
  'form': renderForm,
};

export function renderWidget(holder, item, resolver, onEnd) {
  const fn = RENDERERS[item.widget] || renderText;
  return fn(holder, item, resolver, onEnd) || (() => {});
}
