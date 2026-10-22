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
  var SHELL_VERSION = '1.3.43-r3';   // r3：视频互切改等首帧（loadeddata/canplay）就绪再淡入
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
    var code = qs.code || '';
    var regUrl = CMS + '/api/server?ip=' + encodeURIComponent(selfIp) + '&name=' + encodeURIComponent(NAME) +
      (code ? '&code=' + encodeURIComponent(code) : '');
    jsonp(regUrl, function (err, data) {
      setHud('registered', (!err && data && data.ok) ? '是' : '否');
      setHud('bound', (data && data.terminalId) ? data.terminalId : '否');
      log('register ' + (err ? err.message : 'ok') + (data && data.terminalId ? ' bound=' + data.terminalId : ''));
      if (cb) cb(err, data);
    });
  }

  function feedback(event, item) {
    if (!selfIp) return;
    jsonp(CMS + '/api/feedback?ip=' + encodeURIComponent(selfIp) +
      '&event=' + encodeURIComponent(event) + '&item=' + encodeURIComponent(item || '') +
      '&av=' + encodeURIComponent(SHELL_VERSION), function () {});
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
  var FADE_MS = 500;     // 交叉淡入时长：杜绝素材切换黑屏（Chromium 33 支持 CSS transition）
  var plGen = 0;         // 轮播世代号：列表变化作废在途渲染回调，防计时器竞争

  function plSignature(list) {
    var sig = '';
    for (var i = 0; i < list.length; i++) sig += (list[i].ProjectId || '') + '@' + (list[i].durationMs || 0) + '|';
    return sig;
  }

  function applyPlaylist(list) {
    var sig = plSignature(list);
    if (sig === plSig) return;              // 列表没变：不打断当前轮播
    plSig = sig; playlist = list; plIdx = 0;
    plGen++;                                // 作废在途渲染/计时
    if (plTimer) { clearTimeout(plTimer); plTimer = null; }
    log('playlist ' + list.length + ' 项，开始轮播');
    showCurrent();
  }

  function showCurrent() {
    if (!playlist.length) return;
    var myGen = ++plGen;
    var item = playlist[plIdx];
    lastProgId = item.ProjectId || null;
    var hold = Math.max(1000, item.durationMs || 15000);
    var armed = false;
    // 媒体 5s 未就绪：按服务端时长兜底推进，避免旧层永驻、轮播卡死
    var safety = setTimeout(function () {
      if (armed || myGen !== plGen) return;
      armed = true;
      plTimer = setTimeout(nextItem, hold);
    }, 5000);
    renderProgram(item, function (actualMs) {
      if (armed || myGen !== plGen) return;
      armed = true; clearTimeout(safety);
      // 视频按 loadedmetadata 实际时长（服务端 media.duration 的实时校正）；
      // 图片/就绪异常按服务端时长（排期 duration 或默认 15s）
      var t = (typeof actualMs === 'number' && actualMs > 300) ? actualMs : hold;
      plTimer = setTimeout(nextItem, t);
      // 世代校验：慢加载素材（>5s 兜底已推进轮播）迟到就绪时不再淡入，
      // 防止旧世代的视频/图片盖住当前内容（rk312x 弱网下的轮播错乱）
    }, function () { return myGen === plGen; });
  }

  function nextItem() {
    if (!playlist.length) return;
    plIdx = (plIdx + 1) % playlist.length;
    showCurrent();
  }

  /* ---------------- 渲染：双层交叉淡入 ---------------- */
  // 淡入即旧层退场时刻：新媒体开始可见的同一瞬间旧层才开始淡出，
  // 两层交叉过渡，任何时刻屏幕上都有内容（v1.3.43 除黑闪核心）。
  // 淡入时机按媒体类型取「真正可画」事件：图片=load（已解码）、视频=loadeddata/canplay
  // （首帧就绪）。r3 修复：loadedmetadata 只代表元数据就绪，rk312x 硬解首帧常滞后
  // 数百 ms，彼时淡入黑底视频层正是视频互切黑闪的根因。
  function fadeInLayer(layer) {
    if (layer._retired) return;
    layer._retired = true;
    setTimeout(function () { layer.style.opacity = '1'; }, 30);
    if (layer._retire) layer._retire();
  }

  /** 把 prog 的媒体（或描述卡）装进 layer；媒体就绪后回调 onReady(actualMs)。
   *  isValid 可缺省：轮播世代校验，返回 false 表示本层已过期（迟到就绪也不再淡入） */
  function buildMediaInto(layer, prog, onReady, isValid) {
    function stillValid() { return !isValid || isValid(); }
    var type = (prog && (prog.TaskType || prog.Type)) || '';
    var url = prog && (prog.Url || prog.Media || prog.Image || prog.Video || prog.Url2);
    // 兼容层返回的媒体 URL 可能是相对路径（CMS 与播放页不同源）：按 CMS 基址补全
    if (url && url.charAt(0) === '/') url = CMS.replace(/\/+$/, '') + url;
    var fired = false;
    function ready(actualMs) {
      if (fired) return; fired = true;
      if (onReady) onReady(actualMs);
    }
    // 就绪/超时保护：5s 未就绪只推进轮播计时，不强行淡入未加载的媒体层。
    // rk312x 上媒体经 HTTP 代理加载常 >5s（缓存过期重拉更慢）：强行淡入
    // 黑底空层会盖掉旧内容 → 整屏黑闪（真机 15:46 视频槽抓到纯黑帧实锤）。
    // 正确做法：旧层一直顶住，媒体真正就绪才淡入；网络中断时保留最后
    // 一张图也远好于黑屏，且轮播计时继续推进不会卡死。
    var guard = setTimeout(function () { ready(); }, 5000);
    function settle(actualMs) { clearTimeout(guard); ready(actualMs); }

    if (url && (/\.html?$/i.test(url) || type === '网页' || type === 'web')) {
      var f = document.createElement('iframe');
      f.setAttribute('frameborder', '0');
      f.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:#000;';
      if (f.addEventListener) f.addEventListener('load', function () { if (!stillValid()) return; fadeInLayer(layer); settle(); });
      else if (stillValid()) { fadeInLayer(layer); settle(); }
      f.setAttribute('src', url);
      layer.appendChild(f);
    } else if (url && (/\.(mp4|webm|ogg|m3u8)$/i.test(url) || type === '视频' || type === 'video')) {
      var v = document.createElement('video');
      v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#000;';
      v.setAttribute('playsinline', 'true');
      v.setAttribute('preload', 'auto');    // 确保首帧数据被拉取（loadeddata 才会来）
      v.autoplay = true;
      v.loop = false;                       // 不循环：播完按实际时长切下一条
      var vDur = 0;                         // loadedmetadata 拿到的真实时长（ms）
      var vFrame = false;                   // 首帧是否已就绪
      if (v.addEventListener) {
        v.addEventListener('loadedmetadata', function () {
          try { vDur = (v.duration || 0) * 1000; } catch (e) {}
          // 元数据就绪 ≠ 首帧可画：rk312x 硬解出首帧常滞后数百 ms，
          // 彼时淡入会让黑底视频层盖住旧内容 → 视频互切黑闪（联调实拍实锤）。
          // 因此 loadedmetadata 只记录时长，淡入统一交给 onFirstFrame。
          if (vFrame) fadeInLayer(layer);   // 极端情况首帧先行到位：补淡入
        });
        // 首帧可画（loadeddata）或足以起播（canplay）才淡入：旧层顶到最后一刻，
        // 黑屏间隙为零；时长回传 loadedmetadata 实时值，<=300ms 视为无效。
        // 必须用函数表达式：Chromium 33 严格模式下块级 function 声明是 SyntaxError，
        // 整个脚本静默死亡（CDP 不报异常、HUD 全留 '…'）——r3 首个版本的坑。
        var onFirstFrame = function () {
          if (vFrame) return;
          vFrame = true;
          fadeInLayer(layer);
          try { v.play(); } catch (e) {}    // 与 autoplay 双保险：声音与画面同步进场
          settle(vDur > 300 ? vDur : null);
        };
        v.addEventListener('loadeddata', onFirstFrame);
        v.addEventListener('canplay', onFirstFrame);
        // 加载失败不淡入空层：保留旧内容顶住，等下一轮/网络恢复
        v.addEventListener('error', function () { settle(); });
      } else { fadeInLayer(layer); settle(); }
      v.setAttribute('src', url);
      layer.appendChild(v);
    } else if (url && (/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(url) || type === '图片' || type === 'image')) {
      var im = document.createElement('img');
      im.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#000;';
      if (im.addEventListener) {
        // 先挂监听再设 src：大图在 rk312x 上解码慢，就绪后才淡入，旧层顶住不闪黑
        im.addEventListener('load', function () { if (!stillValid()) return; fadeInLayer(layer); settle(); });
        // 加载失败不淡入空层：保留旧内容顶住，等下一轮/网络恢复
        im.addEventListener('error', function () { if (!stillValid()) return; settle(); });
      } else { fadeInLayer(layer); settle(); }
      im.setAttribute('src', url);
      layer.appendChild(im);
    } else {
      if (stillValid()) { layer.appendChild(descriptorCard(prog)); fadeInLayer(layer); }
      settle();
    }
  }

  function renderProgram(prog, onReady, isValid) {
    setHud('program', (prog && prog.ProjectName) || '—');
    setHud('scene', (prog && prog.Scene && prog.Scene.ItemName) || '—');
    var stage = $('stage');
    if (!stage) { if (onReady) onReady(); return; }
    // 可见层留给交叉淡入；不可见层（之前未就绪的残留）立即清理，防 DOM 累积
    var stale = [];
    var kids = stage.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      var op = 1;
      try { op = parseFloat(window.getComputedStyle(k).opacity); if (isNaN(op)) op = 1; } catch (e) { op = 1; }
      if (op > 0.02) stale.push(k);
      else if (k.parentNode) k.parentNode.removeChild(k);
    }
    var layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;' +
      'transition:opacity ' + FADE_MS + 'ms ease;background:#000;';
    // 旧层退场绑定在本层淡入时刻（fadeInLayer 触发），与新媒体同步交叉过渡
    layer._retire = function () {
      for (var j = 0; j < stale.length; j++) {
        (function (elm) {
          // 交叉淡入期间停掉旧层视频：双视频同播会声音重叠，并争抢 rk312x 紧缺的解码器
          try {
            if (elm.getElementsByTagName) {
              var ov = elm.getElementsByTagName('video');
              for (var q = 0; q < ov.length; q++) { try { ov[q].pause(); } catch (e2) {} }
            }
          } catch (e) {}
          if (elm.style) elm.style.opacity = '0';
          setTimeout(function () { if (elm.parentNode) elm.parentNode.removeChild(elm); }, FADE_MS + 150);
        })(stale[j]);
      }
    };
    stage.appendChild(layer);
    buildMediaInto(layer, prog, function (actualMs) {
      // 有素材 → HUD 让位给内容（隐藏）；无素材（描述卡）→ HUD 可见
      setHudVisible(!(prog && (prog.Url || prog.Media || prog.Image || prog.Video)));
      if (onReady) onReady(actualMs);
    }, isValid);
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
