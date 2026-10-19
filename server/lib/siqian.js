/**
 * 灵屏 LumaSign · 触拓(56iq) 兼容控制层核心模块
 *
 * 目标：让灵屏服务端能够「控 56iq / 触拓 设备」。
 *
 * 两条控制路径：
 *  1) SiqianPlayerClient —— 直连已知 IP 的 56iq 播放端，直接调其 OpenAPI（无需先注册）。
 *  2) SiqianCmsServer    —— 灵屏服务端兼当 56iq CMS，在 8888 端口实现 56iq OpenAPI，
 *                          56iq 播放端把 serverHost 指过来即自动注册并接受驱控。
 *  3) discover()         —— 向组播 239.255.255.255:51008 广播 registerServerInfo，触发批量注册。
 *
 * 协议细节见 docs/触拓兼容控制层.md 与 Downloads/触拓_协议深挖笔记.md。
 */
import dgram from 'node:dgram';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { json, fail } from './http.js';

const GROUP_IP = '239.255.255.255';
const DISCOVER_PORT = 51008;

/* ---------------- 设备台账（内存 + JSON 落盘） ---------------- */
export class SiqianRegistry {
  constructor(dataDir) {
    this.file = path.join(dataDir || '.', 'siqian-devices.json');
    /** @type {Map<string, any>} key = deviceIp */
    this.map = new Map();
    this._load();
  }
  _load() {
    try {
      const arr = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const d of arr) this.map.set(d.ip, d);
    } catch { /* 首次运行无文件 */ }
  }
  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify([...this.map.values()], null, 2));
    } catch { /* 忽略持久化失败 */ }
  }
  upsert(ip, patch) {
    const cur = this.map.get(ip) || { ip, name: ip, registeredAt: Date.now() };
    Object.assign(cur, patch, { ip, lastSeen: Date.now() });
    this.map.set(ip, cur);
    this._save();
    return cur;
  }
  get(ip) { return this.map.get(ip); }
  all() { return [...this.map.values()]; }
  remove(ip) { this.map.delete(ip); this._save(); }
}

/* ---------------- 直连 56iq 播放端客户端 ---------------- */
export class SiqianPlayerClient {
  constructor({ port = 8888, timeout = 5000 } = {}) { this.port = port; this.timeout = timeout; }

  async _get(ip, p) {
    const url = `http://${ip}:${this.port}${p}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeout);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      const txt = await r.text();
      // 56iq 返回可能是裸 JSON（或 jsonp 包裹）；尽力解析
      try { return { ok: r.ok, status: r.status, data: JSON.parse(txt) }; }
      catch { return { ok: r.ok, status: r.status, data: txt }; }
    } finally { clearTimeout(t); }
  }
  listPrograms(ip) { return this._get(ip, '/api/program/programs/list'); }
  nowPlaying(ip) { return this._get(ip, '/api/program/programs/nowlist'); }
  play(ip, programId, scene) {
    const s = scene ? `/${encodeURIComponent(scene)}` : '';
    return this._get(ip, `/api/action/play/${encodeURIComponent(String(programId))}${s}`);
  }
  setVolume(ip, v) { return this._get(ip, `/api/action/volume/${Math.max(0, Math.min(100, v | 0))}`); }
  insertMessage(ip, msg) { return this._get(ip, `/api/action/InsertMessage?msg=${encodeURIComponent(msg)}`); }
}

/* ---------------- 灵屏兼当 56iq CMS（端口 8888） ---------------- */
export class SiqianCmsServer {
  /**
   * @param {object} ctx 灵屏 server ctx
   * @param {object} opts { port, enabled, programResolver }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.registry = ctx.siqianRegistry;
    this.port = opts.port || 8888;
    this.enabled = opts.enabled !== false;
    // programResolver(deviceIp) -> { ProjectId, ProjectName, Scene:{ItemName} }
    this.programResolver = opts.programResolver || (() => ({ ProjectId: 'lumalign-default', ProjectName: '灵屏默认节目', Scene: { ItemName: '默认场景' } }));
    this.server = null;
  }

  /** 把灵屏当前应播节目映射成 56iq programs/list 响应 */
  _currentProgram(ip) {
    try { return this.programResolver(ip) || { ProjectId: 'lumalign-default', ProjectName: '灵屏默认节目' }; }
    catch { return { ProjectId: 'lumalign-default', ProjectName: '灵屏默认节目' }; }
  }

  async start() {
    if (!this.enabled) { this.ctx.logger?.info?.('[siqian] CMS 兼容层已禁用'); return; }
    this.server = http.createServer((req, res) => this._handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, () => { this.server.removeListener('error', reject); resolve(); });
    }).then(() => this.ctx.logger?.info?.(`[siqian] 56iq CMS 兼容层已监听 :${this.port}`))
      .catch(e => this.ctx.logger?.warn?.(`[siqian] 8888 端口占用，CMS 兼容层未启动：${e.message}`));
  }
  stop() { try { this.server?.close(); } catch {} }

  /** JSONP 感知响应：带 callback 参数时包裹成 JS（Chromium 33 / 跨端口 4.4 WebView 必需） */
  _json(res, u, data, code = 200) {
    const cb = u.searchParams.get('callback');
    if (cb) {
      const body = `${cb}(${JSON.stringify(data)});`;
      res.writeHead(code, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    }
    return json(res, data, code);
  }

  async _handle(req, res) {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = u.pathname;
    try {
      // 1) 播放端注册上报
      if (p === '/api/server' && req.method === 'GET') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const name = u.searchParams.get('name') || ip;
        const dev = this.registry.upsert(ip, { name, source: 'cms-register' });
        this.ctx.bus?.emit?.('siqian:register', dev);
        return this._json(res, u, { ok: true, ip, name });
      }
      // 2) 节目清单 / 当前播放
      if (p === '/api/program/programs/list') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        return this._json(res, u, this._currentProgram(ip));
      }
      if (p === '/api/program/programs/nowlist') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const dev = this.registry.get(ip);
        const prog = this._currentProgram(ip);
        // 把设备待执行指令折进 nowlist，供轮询式播放端（无 XMPP）观测到「推送」
        return this._json(res, u, {
          ...prog,
          volume: (dev && typeof dev.volume === 'number') ? dev.volume : null,
          insert: dev && dev.lastInsert ? { msg: dev.lastInsert.msg, at: dev.lastInsert.at } : null,
          command: dev ? dev.lastCommand || null : null,
        });
      }
      // 3) 播放 / 音量 / 插播（CMS 对外 OpenAPI）
      let m;
      if ((m = /^\/api\/action\/play\/([^/]+)(?:\/(.+))?$/.exec(p)) && req.method === 'GET') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const scene = m[2] ? decodeURIComponent(m[2]) : null;
        const dev = this.registry.get(ip);
        if (dev) { dev.lastCommand = { type: 'play', programId: decodeURIComponent(m[1]), scene, at: Date.now() }; this.registry.upsert(dev.ip, dev); }
        return this._json(res, u, { ok: true, action: 'play', programId: decodeURIComponent(m[1]), scene });
      }
      if ((m = /^\/api\/action\/volume\/(\d+)$/.exec(p)) && req.method === 'GET') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const dev = this.registry.get(ip);
        if (dev) { dev.volume = Number(m[1]); this.registry.upsert(dev.ip, dev); }
        return this._json(res, u, { ok: true, action: 'volume', value: Number(m[1]) });
      }
      if (p === '/api/action/InsertMessage' && req.method === 'GET') {
        const msg = u.searchParams.get('msg') || '';
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const dev = this.registry.get(ip);
        if (dev) { dev.lastInsert = { msg, at: Date.now() }; this.registry.upsert(dev.ip, dev); }
        return this._json(res, u, { ok: true, action: 'InsertMessage', msg });
      }
      // 3b) 播放反馈信标（GET，兼容 4.4 WebView 无法跨域 POST）
      if (p === '/api/feedback' && req.method === 'GET') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const dev = this.registry.get(ip);
        if (dev) {
          dev.lastFeedback = {
            event: u.searchParams.get('event') || 'play',
            item: u.searchParams.get('item') || '',
            at: Date.now(),
          };
          this.registry.upsert(dev.ip, dev);
        }
        return this._json(res, u, { ok: true });
      }
      // 4) 播放反馈（播放端 → CMS，POST 表单；也接受 GET 信标）
      if (p === '/TransferFeedback.aspx') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const dev = this.registry.get(ip);
        const record = (body) => {
          if (dev) { dev.lastFeedback = (body || JSON.stringify({ event: u.searchParams.get('feedbackType') || 'play' })).slice(0, 4000); this.registry.upsert(dev.ip, dev); }
          this._json(res, u, { ok: true });
        };
        if (req.method === 'POST') {
          const chunks = []; req.on('data', c => chunks.push(c));
          req.on('end', () => record(Buffer.concat(chunks).toString('utf8')));
          return;
        }
        return record('');
      }
      // 5) OTA 升级清单
      if (p === '/UpdatePlayer/EAutoUpdate.xml' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(this._eAutoUpdateXml());
      }
      // 6) OpenAPI 文档（方便现场验证）
      if (p === '/api.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(SIQIAN_API_DOC);
      }
      this._json(res, u, { ok: false, error: 'not found' }, 404);
    } catch (e) {
      this._json(res, u, { ok: false, error: e.message }, 500);
    }
  }

  _eAutoUpdateXml() {
    const v = this.ctx.pkgVersion || '1.0.0';
    return `<?xml version="1.0" encoding="utf-8"?>
<Update>
  <Version>${v}</Version>
  <VersionName>${v}</VersionName>
  <Force>0</Force>
  <UpdateUrl></UpdateUrl>
  <Remark>灵屏兼 56iq CMS；暂无强制 OTA 包</Remark>
</Update>`;
  }
}

/* ---------------- 局域网发现广播 ---------------- */
export function discoverMyLanIp() {
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

/**
 * 向组播组广播 registerServerInfo，触发 56iq 播放端自动注册到灵屏 CMS。
 * 注：56iq 原生广播包格式未公开（DEX 仅见标签名），此处用 JSON 行广播，
 *     并支持 serverInfo 透传；若现场不生效，改由播放端手动填 serverHost 指向灵屏 IP。
 */
export function broadcastDiscovery({ webHost, xmppHost, xmppPort = 5222 } = {}) {
  const host = webHost || discoverMyLanIp();
  const payload = JSON.stringify({
    tag: 'registerServerInfo',
    serverInfo: { webHost: host, xmppHost: xmppHost || host, xmppPort },
  });
  const sock = dgram.createSocket('udp4');
  return new Promise((resolve) => {
    sock.on('error', () => { try { sock.close(); } catch {} resolve({ sent: false }); });
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch {}
      const buf = Buffer.from(payload);
      sock.send(buf, 0, buf.length, DISCOVER_PORT, GROUP_IP, (err) => {
        try { sock.close(); } catch {}
        resolve({ sent: !err, host, payload });
      });
    });
  });
}

function clientIpFromReq(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress?.replace('::ffff:', '') || '0.0.0.0';
}

const SIQIAN_API_DOC = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>灵屏·56iq 兼容 OpenAPI</title></head>
<body><h1>灵屏 LumaSign · 56iq/触拓 兼容 OpenAPI</h1>
<ul>
<li>GET /api/server?ip=&amp;name= —— 播放端注册</li>
<li>GET /api/program/programs/list —— 节目清单</li>
<li>GET /api/program/programs/nowlist —— 当前播放</li>
<li>GET /api/action/play/&lt;id&gt;/&lt;scene&gt; —— 播放</li>
<li>GET /api/action/volume/&lt;0-100&gt; —— 音量</li>
<li>GET /api/action/InsertMessage?msg= —— 插播</li>
<li>POST /TransferFeedback.aspx —— 播放反馈</li>
<li>GET /UpdatePlayer/EAutoUpdate.xml —— OTA 清单</li>
</ul></body></html>`;
