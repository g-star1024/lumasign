/**
 * PWA 引导脚本（SW 注册 + 安装按钮）
 * 从 index.html 内联 <script> 抽出，避免 CSP script-src 'self'' 拦截。
 */
(function () {
  // PWA：注册 Service Worker（静态资源离线缓存）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/admin/sw.js').catch(() => {}));
  }
  // 「安装到手机」浮动按钮
  const btn = document.createElement('button');
  btn.id = 'pwa-install';
  btn.textContent = '📲 安装到手机';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99998;display:none;' +
    'background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;border:none;' +
    'padding:10px 16px;border-radius:24px;font:600 13px system-ui;cursor:pointer;' +
    'box-shadow:0 8px 24px rgba(29,78,216,.4);';
  document.body.appendChild(btn);
  let dp = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); dp = e; btn.style.display = ''; });
  btn.addEventListener('click', async () => { if (!dp) return; dp.prompt(); await dp.userChoice; dp = null; btn.style.display = 'none'; });
  window.addEventListener('appinstalled', () => { btn.style.display = 'none'; });
})();
