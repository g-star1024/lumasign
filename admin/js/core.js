/**
 * 灵屏 LumaSign · 管理端核心库
 * API 客户端（同源，自动带会话 Cookie）、全局状态、UI 辅助。
 */

const BASE = '';

async function req(method, path, body, isForm) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    if (isForm) opts.body = body;                 // FormData（multipart）
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const r = await fetch(BASE + path, opts);
  let data = null;
  try { data = await r.json(); } catch { /* 非 JSON（如文件下载） */ }
  if (!r.ok) {
    const msg = (data && data.error) || ('请求失败 (' + r.status + ')');
    const e = new Error(msg); e.status = r.status; throw e;
  }
  if (data && data.ok === false) throw new Error(data.error || '操作失败');
  return data || {};
}

export const api = {
  get: p => req('GET', p),
  post: (p, b) => req('POST', p, b),
  put: (p, b) => req('PUT', p, b),
  del: (p, b) => req('DELETE', p, b),
  upload: (p, form) => req('POST', p, form, true),
};

export const state = {
  user: null,
  perms: new Set(),
  theme: localStorage.getItem('luma_theme') || 'system',
};

/* ---------------- UI 辅助 ---------------- */
export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(n.dataset, v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}
export function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtAgo(ts) {
  if (!ts) return '从未';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + ' 秒前';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  return Math.floor(s / 86400) + ' 天前';
}

let toastTimer;
export function toast(msg, type = '') {
  const wrap = document.getElementById('toast-wrap');
  const t = el('div', { class: 'toast ' + type, text: msg });
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2600);
}

/** 确认对话框 -> Promise<boolean> */
export function confirmModal({ title = '确认', body = '', confirmText = '确定', danger = false } = {}) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const close = () => mask.remove();
    const mask = el('div', { class: 'modal-mask' },
      el('div', { class: 'modal' },
        el('h2', { text: title }),
        el('div', { html: body, style: { marginBottom: '18px', color: 'var(--text-2)' } }),
        el('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          el('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, '取消'),
          el('button', {
            class: 'btn ' + (danger ? 'danger' : 'primary'),
            onclick: () => { close(); resolve(true); },
          }, confirmText),
        ),
      ),
    );
    mask.addEventListener('click', e => { if (e.target === mask) { close(); resolve(false); } });
    root.appendChild(mask);
  });
}

/** 通用模态：content 为 DOM 节点，返回 close() */
export function openModal(content) {
  const root = document.getElementById('modal-root');
  const close = () => mask.remove();
  const mask = el('div', { class: 'modal-mask' },
    el('div', { class: 'modal' }, content),
  );
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask._close = close;
  root.appendChild(mask);
  return close;
}

export function can(perm) {
  return state.perms.has('*') || state.perms.has(perm);
}

/* ---------------- 文件选择（避开 Electron 渲染进程崩溃） ----------------
 * 已知问题：本机 Electron（特定 Chromium + --disable-gpu-compositing）下，只要 DOM 中
 * 出现 <input type="file">（无论可见、display:none、还是 append 后立刻 remove），渲染进程
 * 都会原生崩溃（Inspector.targetCrashed，无 JS 异常）。布局编辑器 / 素材库 / APK 上传页
 * 均曾因此一点就黑屏。
 * 修复：桌面端一律走原生文件对话框（通过 lumaDesktop.pickFiles 桥，主进程 dialog 选文件后
 * 回传二进制），只在浏览器 / 安卓 WebView（file 控件安全）走普通 file input 兜底。 */
export async function pickFiles(opts = {}) {
  const accept = opts.accept || '';
  const multiple = !!opts.multiple;
  if (window.lumaDesktop && typeof window.lumaDesktop.pickFiles === 'function') {
    let files;
    try { files = await window.lumaDesktop.pickFiles({ accept, multiple }); }
    catch (e) { console.error('[pickFiles] bridge error', e); return []; }
    if (!files || !files.length) return [];
    return files.map(f => new File([f.data], f.name, { type: f.type || 'application/octet-stream' }));
  }
  // 兜底：浏览器 / 安卓 WebView（file input 在这些环境安全）
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    if (multiple) inp.multiple = multiple;
    inp.style.display = 'none';
    const done = (files) => { resolve(Array.from(files || [])); setTimeout(() => inp.remove(), 1000); };
    inp.addEventListener('change', () => done(inp.files), { once: true });
    inp.addEventListener('cancel', () => done([]), { once: true });
    document.body.appendChild(inp);
    inp.click();
  });
}
