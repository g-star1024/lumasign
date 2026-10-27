/* 灵屏 LumaSign · 管理端 Service Worker
 * 作用：静态资源缓存优先（离线可用），API 请求网络优先并兜底缓存。
 * 注册：admin/index.html
 *
 * v2（2026-10-19）：修「管理端样式全乱」事故——v1 对 HTML 导航也缓存优先，
 * 服务器文件丢失/恢复窗口里浏览器经 SW 缓存了坏版 index.html（<style> 泄漏成
 * 可见文本、theme.css 丢失 → 统计卡片间距异常），且 activate 不清当前缓存名，
 * 毒缓存跨重启存活，磁盘修复后仍不恢复。
 *   - CACHE 升 v2：激活时自动删除 v1 毒缓存；
 *   - 导航请求（HTML）改网络优先：在线时永远拿最新页面，杜绝坏页被长期缓存；
 *   - 其余静态资源（js/css/图片）仍缓存优先，保留离线能力。
 *
 * v3（2026-10-27）：修「管理端改了代码、浏览器却跑旧版」——admin 的 JS（views.js
 * 等 ES module）经 `import` 加载，URL 不带版本号，v2 对静态资源 cache-first 导致
 * 浏览器永远吐 SW 里的旧 JS；服务端改了预览/播放逻辑、甚至重部署，用户侧毫无变化。
 *   - CACHE 升 v3：激活时自动删除 v2 旧缓存，强制重新拉取；
 *   - JS（.js）改网络优先：JS 常改，绝不能 cache-first，确保部署即时生效；
 *   - CSS/图片/字体仍缓存优先，保留离线能力与加载速度。
 */
const CACHE = 'lumasign-admin-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API：网络优先，失败兜底缓存
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 导航（HTML）：网络优先，失败兜底缓存——页面永不缓存优先，防坏页长期滞留
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); return r; })
        .catch(() => caches.match(req).then(m => m || caches.match('/admin/')))
    );
    return;
  }

  // 其余静态资源
  const isJs = /\.js(\?|$|#)/.test(url.pathname);
  if (isJs) {
    // JS（含 views.js 等 ES module，URL 无版本号）：网络优先，确保部署即时生效，
    // 失败再兜底缓存（离线时仍能跑旧版）。
    e.respondWith(
      fetch(req)
        .then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); } return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // CSS / 图片 / 字体：缓存优先，保留离线能力
  e.respondWith(
    caches.match(req).then(m =>
      m || fetch(req).then(r => {
        if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); }
        return r;
      }).catch(() => caches.match(req))
    )
  );
});
