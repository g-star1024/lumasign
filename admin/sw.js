/* 灵屏 LumaSign · 管理端 Service Worker
 * 作用：静态资源缓存优先（离线可用），API 请求网络优先并兜底缓存。
 * 注册：admin/index.html
 */
const CACHE = 'lumasign-admin-v1';

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

  // 静态资源：缓存优先，缺失则网络并缓存
  e.respondWith(
    caches.match(req).then(m =>
      m || fetch(req).then(r => {
        if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); }
        return r;
      }).catch(() => caches.match(req))
    )
  );
});
