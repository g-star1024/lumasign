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
  var POLL_MS = parseInt(qs.poll || '10000', 10) || 10000;

  var selfIp = '';
  var lastProgId = null;
  var lastInsertAt = 0;
  var lastCmdAt = 0;
  var lastVolume = -1;
  var insertTimer = null;
  var jsonpSeq = 0;

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
        if (data.command.type === 'play') { lastProgId = null; pollList(); }
      }
      if (data.ProjectId && data.ProjectId !== lastProgId) { lastProgId = data.ProjectId; renderProgram(data); }
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

  function renderProgram(prog) {
    setHud('program', (prog && prog.ProjectName) || '—');
    setHud('scene', (prog && prog.Scene && prog.Scene.ItemName) || '—');
    var stage = $('stage');
    if (!stage) return;
    stage.innerHTML = '';
    var type = (prog && (prog.TaskType || prog.Type)) || '';
    var url = prog && (prog.Url || prog.Media || prog.Image || prog.Video || prog.Url2);
    if (url && (/\.html?$/i.test(url) || type === '网页' || type === 'web')) {
      var f = document.createElement('iframe');
      f.setAttribute('src', url);
      f.setAttribute('frameborder', '0');
      f.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:#000;';
      stage.appendChild(f);
    } else if (url && (/\.(mp4|webm|ogg|m3u8)$/i.test(url) || type === '视频' || type === 'video')) {
      var v = document.createElement('video');
      v.setAttribute('src', url); v.autoplay = true; v.loop = true;
      v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#000;';
      stage.appendChild(v);
    } else if (url && (/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(url) || type === '图片' || type === 'image')) {
      var im = document.createElement('img');
      im.setAttribute('src', url);
      im.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#000;';
      stage.appendChild(im);
    } else {
      stage.appendChild(descriptorCard(prog));
    }
    feedback('play', (prog && prog.ProjectId) || '');
  }

  function showInsert(msg, secs) {
    var el = $('insert');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.innerHTML = '<span>' + esc(msg) + '</span>';
    el.style.display = 'flex';
    if (insertTimer) clearTimeout(insertTimer);
    insertTimer = setTimeout(function () { el.style.display = 'none'; el.innerHTML = ''; }, (secs || 8) * 1000);
  }

  /* ---------------- 启动 ---------------- */
  function init() {
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
