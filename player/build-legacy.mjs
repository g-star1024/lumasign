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

// ── Step 3: polyfill header (fetch via whatwg-fetch UMD + mini URLSearchParams, zero backslash) ──
const fetchPf = fs.readFileSync('C:/Users/DMax/AppData/Local/Temp/fetch.umd.js', 'utf8');
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

const final = header + '\n' + es5;
fs.writeFileSync(path.join(PLAYER, 'engine.legacy.js'), final);
fs.unlinkSync(TMP);
console.log('BUILT player/engine.legacy.js bytes=', final.length);
