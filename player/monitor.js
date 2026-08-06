/* 灵屏 LumaSign · 大屏监看墙（免登录，凭只读 token 轮询）
 * 部署：把一台大屏的浏览器指向  http://<管理端IP>:7788/player/monitor.html?key=<monitorToken>
 * 即可化身"监控墙"，集中查看所有终端正在显示的内容。
 */
(function () {
  // 优先用 URL 中的 key；无则回退到上次保存的（已安装的 PWA 从桌面图标打开时 URL 不带 key）
  let key = new URLSearchParams(location.search).get('key') || '';
  try {
    if (key) localStorage.setItem('luma_monitor_key', key);
    else key = localStorage.getItem('luma_monitor_key') || '';
  } catch (_) {}
  const grid = document.getElementById('grid');
  const stat = document.getElementById('stat');
  const clock = document.getElementById('clock');
  const errBox = document.getElementById('err');
  let timer = null, errTimer = null;

  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function fmtAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + '秒前';
    if (s < 3600) return Math.floor(s / 60) + '分钟前';
    return Math.floor(s / 3600) + '小时前';
  }
  function tick() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    clock.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function showErr(msg) {
    errBox.textContent = msg; errBox.style.display = 'block';
    clearTimeout(errTimer); errTimer = setTimeout(() => (errBox.style.display = 'none'), 4000);
  }

  function card(t) {
    const c = el('div', 'card' + (t.online ? '' : ' off'));
    const shotBox = el('div', 'shot');
    if (t.lastShot && t.lastShot.url) {
      const img = el('img');
      img.src = t.lastShot.url + (t.lastShot.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);
      img.alt = t.name || '';
      img.loading = 'lazy';
      shotBox.appendChild(img);
    } else {
      shotBox.appendChild(el('div', 'ph', t.online ? '暂无截屏' : '离线'));
    }
    c.appendChild(shotBox);

    const bar = el('div', 'bar');
    bar.appendChild(el('span', 'dot ' + (t.online ? 'on' : 'off')));
    bar.appendChild(el('span', 'name', t.name || t.code || '未命名'));
    bar.appendChild(el('span', 'code', t.code || ''));
    c.appendChild(bar);

    const meta = el('div', 'meta');
    meta.appendChild(el('div', 'playing', (t.playing ? '播放中：' : '空闲：') + (t.playing || '无排期')));
    meta.appendChild(el('div', 'sub', (t.ip || '?') + ' · ' + (t.resolution || '') + ' · ' + (t.lastShot ? '截屏 ' + fmtAgo(t.lastShot.ts) : '未截屏')));
    c.appendChild(meta);
    return c;
  }

  async function load() {
    try {
      const r = await fetch('/api/monitor/wall?key=' + encodeURIComponent(key));
      if (!r.ok) { showErr('监看墙鉴权失败（token 无效）'); return; }
      const d = await r.json();
      const items = (d.items || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
      const online = items.filter(t => t.online).length;
      stat.textContent = '在线 ' + online + ' / ' + items.length + ' 台';
      grid.innerHTML = '';
      if (!items.length) grid.appendChild(el('div', 'empty', '暂无终端，请先接入设备'));
      else items.forEach(t => grid.appendChild(card(t)));
    } catch (e) {
      showErr('拉取监看数据失败：' + (e.message || e));
    }
  }

  async function init() {
    tick(); setInterval(tick, 1000);
    await load();
    timer = setInterval(load, 12000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { load(); timer = setInterval(load, 12000); }
    });
  }
  init();
})();
