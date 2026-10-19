/**
 * 灵屏 LumaSign · 56iq/触拓 兼容播放 Shell（ES5，兼容 Android 4.4 Chromium 33）
 *
 * 运行方式：MainActivity 在「56iq 兼容模式」下加载
 *   <lumaServer>/player/siqian.html?cms=<56iqCMS基址>&code=<终端码>&name=<名称>&poll=<毫秒>
 *
 * 约束（Chromium 33，无 fetch / 无 let-const / 无箭头 / 无 Promise）：
 *   - 一律用 JSONP（<script> 注入）调 56iq OpenAPI —— 这也正好是 56iq 的原生跨域方式；
 *   - 桥用 window.LumaBridge（音量 / 本机 IP / 硬件）， Batch2 再补 window.Android.getDeviceInfo()。
 *
 * 控制流（拉取式模拟推送，无需 XMPP）：
 *   register → 轮询 programs/list（节目切换即渲染） + nowlist（折带了 volume/insert/command）
 *   → 应用音量 / 显示插播 / 执行 play 指令；周期性回传 /api/feedback 信标。
 */
(function () {
  'use strict';

  var qs = parseQuery();
  var CMS = qs.cms || '';
  var NAME = qs.name || ('LumaSign-' + (qs.code || ''));
  var POLL_MS = parseInt(qs.poll || '3000', 10) || 3000;

  var selfIp = '';
  var lastProgId = null;
  var lastInsertAt = 0;
  var lastCmdAt = 0;
  var lastVolume = -1;
  var insertTimer = null;
  var jsonpSeq = 0;
  var SHELL_VERSION = '1.3.41';
  // 本地轮播状态：CMS 下传 Playlist 时按各排期 durationMs 本地切换，
  // 切换节奏由本地定时器驱动，不被轮询间隔（拉模式推送）稀释
  var playlist = [];
  var plIdx = 0;
  var plTimer = null;
  var plSig = '';

  function $(id) { return document.getElementById(id); }
  function log(m) { try { console.log('[siqian] ' + m); } catch (e) {} }

  function parseQuery() {
    var out = {};
    var s = window.location.search || '';
    if (s.charAt(0) === '?') s = s.substring(1);
    var pairs = s.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      if (kv.length >= 2 && kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
    return out;
  }

  function setHud(k, v) { var el = $('hud-' + k); if (el) el.textContent = v; }
  // HUD 是底层诊断信息：有素材渲染时被内容盖住，仅无节目（等待/描述卡）时可见
  function setHudVisible(v) { var h = $('hud'); if (h) h.style.display = v ? 'block' : 'none'; }

  function bridge() { return window.LumaBridge || window.Android || null; }

  /* ---------------- JSONP ---------------- */
  function jsonp(url, cb) {
    jsonpSeq++;
    var cbName = '__siqian_cb_' + jsonpSeq + '_' + (Date.now() % 100000);
    var done = false;
    function cleanup() {
      try { window[cbName] = undefined; } catch (e) { try { delete window[cbName]; } catch (e2) {} }
      var s = $(cbName); if (s && s.parentNode) s.parentNode.removeChild(s);
    }
    window[cbName] = function (data) {
      if (done) return; done = true; cleanup(); cb(null, data);
    };
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    var s = document.createElement('script');
    s.id = cbName;
    s.src = url + sep + 'callback=' + cbName;
    s.onerror = function () { if (done) return; done = true; cleanup(); cb(new Error('jsonp network error')); };
    document.getElementsByTagName('head')[0].appendChild(s);
    setTimeout(function () { if (done) return; done = true; cleanup(); cb(new Error('jsonp timeout')); }, 8000);
  }

  /* ---------------- 业务 ---------------- */
  function register(cb) {
    jsonp(CMS + '/api/server?ip=' + encodeURIComponent(selfIp) + '&name=' + encodeURIComponent(NAME), function (err, data) {
      setHud('registered', (!err && data && data.ok) ? '是' : '否');
      log('register ' + (err ? err.message : 'ok'));
      if (cb) cb(err, data);
    });
  }

  function feedback(event, item) {
    if (!selfIp) return;
    jsonp(CMS + '/api/feedback?ip=' + encodeURIComponent(selfIp) +
      '&event=' + encodeURIComponent(event) + '&item=' + encodeURIComponent(item || ''), function () {});
  }

  function pollList() {
    jsonp(CMS + '/api/program/programs/list?ip=' + encodeURIComponent(selfIp), function (err, data) {
      if (err) { log('list ' + err.message); return; }
      // v1.3.41：灵屏 CMS 下传完整 Playlist → 本地按 durationMs 轮播（多排期不播是联调核心缺陷）
      if (data && data.Playlist && data.Playlist.length) { applyPlaylist(data.Playlist); return; }
      // 单节目模式（真 56iq CMS 无 Playlist 字段）：按节目 ID 变化重渲染
      var pid = data && (data.ProjectId || '');
      if (pid !== lastProgId) { lastProgId = pid; renderProgram(data); }
    });
  }

  function pollNow() {
    jsonp(CMS + '/api/program/programs/nowlist?ip=' + encodeURIComponent(selfIp), function (err, data) {
      if (err || !data) return;
      if (typeof data.volume === 'number' && data.volume !== lastVolume) {
        lastVolume = data.volume; applyVolume(data.volume);
      }
      if (data.insert && data.insert.at > lastInsertAt) {
        lastInsertAt = data.insert.at;
        showInsert(data.insert.msg || '', 8);
      }
      if (data.command && data.command.at > lastCmdAt) {
        lastCmdAt = data.command.at;
        if (data.command.type === 'play') { lastProgId = null; plSig = ''; pollList(); }
      }
      // 轮播模式下 nowlist 的单节目字段不再驱动渲染（否则会打断本地轮播节奏）
      if (data.ProjectId && data.ProjectId !== lastProgId && !playlist.length) { lastProgId = data.ProjectId; renderProgram(data); }
    });
  }

  function applyVolume(v) {
    var b = bridge();
    if (b && b.setVolume) { try { b.setVolume(v); setHud('volume', v); } catch (e) {} }
  }

  function descriptorCard(prog) {
    var d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;' +
      'align-items:center;justify-content:center;flex-direction:column;background:#111;color:#fff;text-align:center;';
    var name = (prog && prog.ProjectName) || '等待节目…';
    var scene = (prog && prog.Scene && prog.Scene.ItemName) || '';
    d.innerHTML = '<div style="font-size:40px;font-weight:bold;margin-bottom:16px;">' + esc(name) + '</div>' +
      (scene ? '<div style="font-size:24px;opacity:.8;">场景：' + esc(scene) + '</div>' : '') +
      '<div style="font-size:16px;opacity:.5;margin-top:24px;">56iq 兼容模式 · 等待 CMS 下发内容</div>';
    return d;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 本地轮播（CMS 下传完整 Playlist 时） ---------------- */
  function plSignature(list) {
    var sig = '';
    for (var i = 0; i < list.length; i++) sig += (list[i].ProjectId || '') + '@' + (list[i].durationMs || 0) + '|';
    return sig;
  }

  function applyPlaylist(list) {
    var sig = plSignature(list);
    if (sig === plSig) return;              // 列表没变：不打断当前轮播
    plSig = sig; playlist = list; plIdx = 0;
    if (plTimer) { clearTimeout(plTimer); plTimer = null; }
    log('playlist ' + list.length + ' 项，开始轮播');
    showCurrent();
  }

  function showCurrent() {
    if (!playlist.length) return;
    var item = playlist[plIdx];
    lastProgId = item.ProjectId || null;
    renderProgram(item);
    var dur = Math.max(1000, item.durationMs || 5000);
    plTimer = setTimeout(function () {
      plIdx = (plIdx + 1) % playlist.length;
      showCurrent();
    }, dur);
  }

  function renderProgram(prog) {
    setHud('program', (prog && prog.ProjectName) || '—');
    setHud('scene', (prog && prog.Scene && prog.Scene.ItemName) || '—');
    var stage = $('stage');
    if (!stage) return;
    stage.innerHTML = '';
    var type = (prog && (prog.TaskType || prog.Type)) || '';
    var url = prog && (prog.Url || prog.Media || prog.Image || prog.Video || prog.Url2);
    // 兼容层返回的媒体 URL 可能是相对路径（CMS 与播放页不同源）：按 CMS 基址补全
    if (url && url.charAt(0) === '/') url = CMS.replace(/\/+$/, '') + url;
    if (url && (/\.html?$/i.test(url) || type === '网页' || type === 'web')) {
      var f = document.createElement('iframe');
      f.setAttribute('src', url);
      f.setAttribute('frameborder', '0');
      f.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:#000;';
      stage.appendChild(f);
      setHudVisible(false);
    } else if (url && (/\.(mp4|webm|ogg|m3u8)$/i.test(url) || type === '视频' || type === 'video')) {
      var v = document.createElement('video');
      v.setAttribute('src', url); v.autoplay = true; v.loop = true;
      v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#000;';
      stage.appendChild(v);
      setHudVisible(false);   // 有素材：底层信息让位给内容
    } else if (url && (/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(url) || type === '图片' || type === 'image')) {
      var im = document.createElement('img');
      im.setAttribute('src', url);
      // cover：铺满屏幕（含 9:16 竖屏）不留黑边；横图会裁左右边缘，主体居中不受影响
      im.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#000;';
      stage.appendChild(im);
      setHudVisible(false);
    } else {
      stage.appendChild(descriptorCard(prog));
      setHudVisible(true);    // 无素材：才显示底层诊断信息
    }
    feedback('play', (prog && prog.ProjectId) || '');
  }

  function showInsert(msg, secs) {
    var el = $('insert');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.innerHTML = '<span>' + esc(msg) + '</span>';
    el.style.display = 'flex';
    setHudVisible(false);   // 插播期间同样盖住底层信息
    if (insertTimer) clearTimeout(insertTimer);
    insertTimer = setTimeout(function () { el.style.display = 'none'; el.innerHTML = ''; }, (secs || 8) * 1000);
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    setHud('shell', SHELL_VERSION);
    if (!CMS) { setHud('cms', '未配置'); var st = $('stage'); if (st) st.appendChild(descriptorCard(null)); return; }
    setHud('cms', CMS);
    setHud('name', NAME);
    var b = bridge();
    selfIp = (b && b.getIpAddress) ? (b.getIpAddress() || '') : '';
    setHud('ip', selfIp || '—');
    register(function () {
      pollList();
      pollNow();
      setInterval(pollList, POLL_MS);
      setInterval(pollNow, Math.max(3000, Math.floor(POLL_MS / 2)));
      setInterval(function () { feedback('heartbeat', lastProgId || ''); }, 30000);
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(init, 0); }
  else if (document.addEventListener) { document.addEventListener('DOMContentLoaded', init); }
  else { window.onload = init; }
})();
