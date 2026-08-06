/* 灵屏 LumaSign · 监看墙 Service Worker
 * 作用：预缓存监看墙外壳实现离线打开；截屏（/api/ 下）网络优先并兜底上次缓存，
 *       断网也能看到上一次的各屏画面。
 * 注册：player/monitor.html
 */
const CACHE = 'lumasign-monitor-v1';
const SHELL = [
  '/player/monitor.html',
  '/player/monitor.js',
  '/player/manifest.webmanifest',
  '/player/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

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

  // 截屏与监看数据：网络优先，失败用上次缓存（断网可见旧画面）
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 外壳静态资源：缓存优先
  e.respondWith(
    caches.match(req).then(m => m || fetch(req).then(r => {
      const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); return r;
    }).catch(() => caches.match(req)))
  );
});
