/* CDP 诊断：连设备 WebView，抓页面状态/引擎版本/视频元素/blob 缓存/console 错误 */
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || 9333;
const EVAL = process.env.EVAL_JS; // 要执行的表达式（可选）

async function main() {
  const list = await fetch(`http://localhost:${PORT}/json`).then(r => r.json());
  const page = list.find(t => t.type === 'page');
  if (!page) { console.error('no page target'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const consoleErrors = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    }
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await send('Runtime.enable');
  await send('Page.enable');

  const expr = EVAL || `(function(){
    var out = {};
    out.url = location.href;
    out.engineVer = (window.__lumaPlayer && window.__lumaPlayer.version) || null;
    out.hasPlayer = !!window.__lumaPlayer;
    out.heartbeatAt = window.__lumaHeartbeatAt || null;
    var v = document.querySelector('video');
    if (v) {
      out.video = {
        src: (v.currentSrc || v.src || '').slice(0, 120),
        readyState: v.readyState, networkState: v.networkState,
        error: v.error ? (v.error.code + ':' + v.error.message) : null,
        paused: v.paused, currentTime: v.currentTime, duration: v.duration,
        videoWidth: v.videoWidth, videoHeight: v.videoHeight
      };
    } else out.video = null;
    var imgs = document.querySelectorAll('img');
    out.imgCount = imgs.length;
    out.imgLoaded = 0; out.imgBroken = 0;
    for (var i = 0; i < imgs.length; i++) { if (imgs[i].complete && imgs[i].naturalWidth > 0) out.imgLoaded++; else out.imgBroken++; }
    out.regions = document.querySelectorAll('.region, [class*=region]').length;
    out.bodyChildren = document.body ? document.body.children.length : -1;
    out.stageHTML = (function(){ var s = document.querySelector('.stage, #stage, .stage-root'); return s ? s.innerHTML.slice(0, 400) : null; })();
    out.mediaBlobKeys = (typeof _mediaBlobs !== 'undefined') ? Object.keys(_mediaBlobs) : 'n/a';
    return out;
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result.value, null, 1));
  if (consoleErrors.length) { console.log('--- console errors ---'); consoleErrors.slice(-10).forEach(e => console.log(e)); }
  ws.close();
  process.exit(0);
}
main().catch(e => { console.error('CDP_FAIL:', e.message); process.exit(1); });
