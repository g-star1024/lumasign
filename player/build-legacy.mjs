import fs from 'node:fs';
import path from 'node:path';

const WS = 'C:/Users/DMax/.workbuddy/binaries/node/workspace';
const PLAYER = 'C:/Users/DMax/WorkBuddy/2026-08-03-18-09-29/lumasign/player';
const TMP = path.join(PLAYER, 'engine.es2020.tmp.js');

// ── Step 1: esbuild bundle (engine.js + widgets.js → single IIFE, keep async/await intact) ──
const esbuild = await import('file:///' + WS + '/node_modules/esbuild/lib/main.js');
await esbuild.build({
  entryPoints: [path.join(PLAYER, 'engine.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  outfile: TMP,
  logLevel: 'warning',
});
const bundled = fs.readFileSync(TMP, 'utf8');
console.log('esbuild bundle bytes=', bundled.length);

// ── Step 2: swc transform ES2020 → ES5 (regenerator handles async/await) ──
const swcPath = WS + '/node_modules/@swc/core/index.js';
const swc = await import('file:///' + swcPath);
const out = await swc.transform(bundled, {
  jsc: {
    target: 'es5',
    parser: { syntax: 'ecmascript' },
    transform: {},
  },
  module: { type: 'es6' },
  minify: false,
  isModule: false,
  filename: 'engine.js',
});
const es5 = out.code;
console.log('swc es5 bytes=', es5.length);

// ── Step 2.5: 修复 SWC _ts_values 在无 Symbol 引擎（Android 4.4 / Chromium 33）上的致命缺陷 ──
// yield* 委托（如 runRegion 的 tick 循环）会走 _ts_values：
//   Symbol 路径在 4.4 不可用（typeof Symbol === "undefined"），而生成器对象没有 .length
//   → 抛 "Symbol.iterator is not defined."。该错误发生在 Promise 链内，
//   4.4 无 unhandledrejection 事件 → 被静默吞掉 → 所有 region 永不渲染 →
//   黑屏 + 无 playlog（内容监控失效）+ 截屏全黑（v1.3.19 现场事故根因，2026-10-13 定位）。
// 修复：带 next 函数的对象（生成器/迭代器）直接作为迭代器返回，语义与规范一致。
const TS_VALUES_ANCHOR = 'if (o && typeof o.length === "number") {';
const TS_VALUES_PATCH = 'if (o && typeof o.next === "function") { return o; }\n    ' + TS_VALUES_ANCHOR;
if (!es5.includes(TS_VALUES_ANCHOR)) throw new Error('_ts_values anchor not found; swc output changed');
const es5Fixed = es5.replace(TS_VALUES_ANCHOR, TS_VALUES_PATCH);
console.log('patched _ts_values for no-Symbol engines (Android 4.4)');

// ── Step 3: polyfill header (fetch via whatwg-fetch UMD + mini URLSearchParams, zero backslash) ──
// ⚠️ 历史事故（2026-10-16 定位）：此前从 Temp 读 fetch.umd.js，该文件被误写成了
//    engine.legacy.js 的陈旧截断副本（194KB，含未闭合的 __LUMA_PLAYER__ 对象），
//    导致最终产物 = 假 polyfill + 真引擎 = 双份代码且整体语法错误 → 4.4 设备全黑。
//    v1.3.30/31/32 的 engine.legacy.js 均被此污染（v1.3.27 及之前健康）。
// 修复：polyfill 固化进仓库 player/fetch.umd.js，并加断言防再次被污染。
const fetchPfPath = path.join(PLAYER, 'fetch.umd.js');
const fetchPf = fs.readFileSync(fetchPfPath, 'utf8');
// 断言 1：必须是 whatwg-fetch UMD，而不是引擎产物
if (!fetchPf.includes('WHATWGFetch') || !fetchPf.includes('exports.fetch = fetch')) {
  throw new Error('fetch polyfill sanity check failed: ' + fetchPfPath + ' is not whatwg-fetch UMD');
}
// 断言 2：不得含引擎特征（被污染的典型信号）
if (fetchPf.includes('__LUMA_PLAYER__') || fetchPf.includes('bootstrap();')) {
  throw new Error('fetch polyfill sanity check failed: ' + fetchPfPath + ' looks like a stale engine build');
}
// 断言 3：体积合理（whatwg-fetch UMD 约 20KB；被污染时通常 >100KB）
if (fetchPf.length > 60000) {
  throw new Error('fetch polyfill sanity check failed: ' + fetchPfPath + ' too large (' + fetchPf.length + ' bytes)');
}
const uspLines = [
  '/* mini URLSearchParams polyfill (ES5) for Chromium<49 */',
  '(function () {',
  '  if (typeof window.URLSearchParams === "function") return;',
  '  function USP(search) {',
  '    this._p = {};',
  '    var s = String(search || "");',
  '    if (s.charAt(0) === "?") s = s.slice(1);',
  '    if (s.charAt(0) === "&") s = s.slice(1);',
  '    var pairs = s ? s.split("&") : [];',
  '    for (var i = 0; i < pairs.length; i++) {',
  '      var kv = pairs[i].split("=");',
  '      var k = decodeURIComponent(kv[0].split("+").join(" "));',
  '      var v = kv.length > 1 ? decodeURIComponent(kv[1].split("+").join(" ")) : "";',
  '      if (k) this.append(k, v);',
  '    }',
  '  }',
  '  USP.prototype.append = function (k, v) { (this._p[k] = this._p[k] || []).push(String(v)); };',
  '  USP.prototype.get = function (k) { return this.has(k) ? this._p[k][0] : null; };',
  '  USP.prototype.getAll = function (k) { return this.has(k) ? this._p[k].slice() : []; };',
  '  USP.prototype.has = function (k) { return Object.prototype.hasOwnProperty.call(this._p, k); };',
  '  USP.prototype.set = function (k, v) { this._p[k] = [String(v)]; };',
  '  USP.prototype.delete = function (k) { delete this._p[k]; };',
  '  USP.prototype.forEach = function (cb, thisArg) {',
  '    var p = this._p;',
  '    Object.keys(p).forEach(function (k) { p[k].forEach(function (v) { cb.call(thisArg, v, k, this); }); });',
  '  };',
  '  USP.prototype.toString = function () {',
  '    var out = [];',
  '    this.forEach(function (v, k) { out.push(encodeURIComponent(k) + "=" + encodeURIComponent(v)); });',
  '    return out.join("&");',
  '  };',
  '  window.URLSearchParams = USP;',
  '})();',
  '',
].join('\n');

const header = '/* LumaSign legacy engine: esbuild(bundle,es2020) + swc(es5) + polyfills. DO NOT EDIT BY HAND. */\n'
  + '/* Regenerate with: node player/build-legacy.mjs */\n'
  + uspLines + '\n' + fetchPf + '\n';

const final = header + '\n' + es5Fixed;
fs.writeFileSync(path.join(PLAYER, 'engine.legacy.js'), final);
fs.unlinkSync(TMP);
console.log('BUILT player/engine.legacy.js bytes=', final.length);

// ── Step 4: 产物自检（防止再次出现「双份代码 / 未闭合」静默事故） ──
const outPath = path.join(PLAYER, 'engine.legacy.js');
const built = fs.readFileSync(outPath, 'utf8');
const countOf = (s) => built.split(s).length - 1;
const checks = [
  ['bootstrap(); 恰好一次', countOf('bootstrap();') === 1],
  ['__LUMA_PLAYER__ 恰好一次', countOf('__LUMA_PLAYER__ = {') === 1],
  ['_ts_values 补丁已注入', built.includes('if (o && typeof o.next === "function") { return o; }')],
  ['IIFE 正常闭合', /\};\s*\n\s*\}\)\(\);\s*$/.test(built.trimEnd())],
  ['体积合理(<300KB)', built.length < 300000],
];
let bad = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name);
  if (!ok) bad++;
}
if (bad > 0) throw new Error('engine.legacy.js self-check failed (' + bad + ' issue(s))');
console.log('SELF-CHECK PASSED');
