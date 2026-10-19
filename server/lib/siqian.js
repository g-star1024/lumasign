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
import { json, fail, sendFile } from './http.js';
import { buildManifest } from './schedule.js';
import { recordPlayEvent } from './playlog.js';

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

/* ---------------- 节目映射：灵屏排期/layout → 56iq program 描述 ---------------- */
function pickPrimaryMedia(layout, store) {
  const regions = (layout.regions || []).slice().sort((a, b) => (b.w * b.h) - (a.w * a.h));
  for (const r of regions) {
    for (const it of (r.items || [])) {
      if (it.mediaId) {
        const m = store.col('media').byId(it.mediaId);
        if (m) return { hash: m.hash, mime: m.mime, name: m.name };
      }
    }
  }
  if (layout.background && layout.background.mediaId) {
    const m = store.col('media').byId(layout.background.mediaId);
    if (m) return { hash: m.hash, mime: m.mime, name: m.name };
  }
  return null;
}

export class SiqianProgramMapper {
  constructor(ctx) { this.ctx = ctx; }

  _terminalByIp(ip) {
    try {
      return this.ctx.store.col('terminals').all()
        .find(t => t.ip === ip || (t.hardware && t.hardware.ip === ip) || (t.net && t.net.ip === ip)) || null;
    } catch { return null; }
  }

  /** 由设备 IP 解析当前应播 56iq 节目（含可直接渲染的内容 URL，走 CMS 媒体代理）
   *  @param cmsBase 可选，CMS 对外基址（如 http://192.168.2.216:8888）——给了就把媒体
   *  URL 补成绝对地址；播放端页面（:7788/player/siqian.html）与媒体代理（:8888）
   *  不同源，相对路径会被解析到 7788 而 404，真机联调实测黑屏即此因。
   *
   *  v1.3.41：除「当前节目」主字段外，附加 Playlist 数组（全部应播排期 + 各自
   *  durationMs），兼容 Shell 据此本地轮播——多排期不轮播是真机联调暴露的核心
   *  体验缺陷（后台 3 个已发布排期只播第 1 个）。真 56iq CMS 无此字段，Shell
   *  自动回退单节目渲染。 */
  programFor(ip, cmsBase) {
    const store = this.ctx.store;
    const term = this._terminalByIp(ip);
    if (!term) return { ProjectId: 'lumalign-default', ProjectName: '灵屏默认节目', Scene: { ItemName: '默认场景' } };
    let mf;
    try { mf = buildManifest(store, term); } catch { mf = { schedules: [] }; }
    const schedules = mf.schedules || [];
    const sch = schedules[0];
    if (!sch) return { ProjectId: 'no-program', ProjectName: '暂无排期', Scene: { ItemName: '—' }, TerminalName: term.name || null };
    const layout = sch.layout || {};
    const base = {
      ProjectId: sch.scheduleId,
      ProjectName: sch.name || layout.name || '节目',
      Scene: { ItemName: layout.name || '主场景' },
      LayoutId: layout.id || null,
      TerminalName: term.name || null,
    };
    const mediaBase = cmsBase ? String(cmsBase).replace(/\/+$/, '') : '';
    const abs = (p) => (mediaBase ? mediaBase + p : p);
    const primary = pickPrimaryMedia(layout, store);
    if (primary) {
      base.Url = abs(`/api/siqian/media/${primary.hash}?ip=${encodeURIComponent(ip)}`);
      base.TaskType = (primary.mime && primary.mime.startsWith('video')) ? '视频' : '图片';
      base.MediaList = (mf.assets || []).map(a => ({
        hash: a.hash, mime: a.mime, url: abs(`/api/siqian/media/${a.hash}?ip=${encodeURIComponent(ip)}`),
      }));
    }
    // 完整轮播清单：与主字段同一媒体代理体系，Shell 按 durationMs 本地切换
    base.Playlist = schedules.map(s => {
      const lay = s.layout || {};
      const item = {
        ProjectId: s.scheduleId,
        ProjectName: s.name || lay.name || '节目',
        Scene: { ItemName: lay.name || '主场景' },
        LayoutId: lay.id || null,
        durationMs: Math.max(1, s.duration || 15) * 1000,
      };
      const p = pickPrimaryMedia(lay, store);
      if (p) {
        item.Url = abs(`/api/siqian/media/${p.hash}?ip=${encodeURIComponent(ip)}`);
        item.TaskType = (p.mime && p.mime.startsWith('video')) ? '视频' : '图片';
      }
      return item;
    });
    return base;
  }

  /** 供媒体代理：按 hash 找媒体文件（优先转码产物） */
  mediaFile(hash) {
    const bare = hash.replace(/\.[^.]+$/, '');
    const m = this.ctx.store.col('media').findOne(x => x.hash === hash || x.hash === bare || x.id === hash || x.id === bare);
    if (!m) return null;
    let rel = m.rel, mime = m.mime;
    if (m.transcodedRel) {
      try {
        if (fs.existsSync(path.join(this.ctx.paths.media, m.transcodedRel))) { rel = m.transcodedRel; mime = 'video/mp4'; }
      } catch { /* 回退原文件 */ }
    }
    return { filePath: path.join(this.ctx.paths.media, rel), mime };
  }
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

  /** 把灵屏当前应播节目映射成 56iq programs/list 响应（base=本 CMS 对外基址，用于补绝对媒体 URL） */
  _currentProgram(ip, base) {
    try { return this.programResolver(ip, base) || { ProjectId: 'lumalign-default', ProjectName: '灵屏默认节目' }; }
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
      const cmsBase = 'http://' + (req.headers.host || ('localhost:' + this.port));
      if (p === '/api/program/programs/list') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const prog = this._currentProgram(ip, cmsBase);
        const dev = this.registry.get(ip);
        if (dev) { dev.lastProgram = { ProjectId: prog.ProjectId, LayoutId: prog.LayoutId || null, at: Date.now() }; this.registry.upsert(dev.ip, dev); }
        return this._json(res, u, prog);
      }
      if (p === '/api/program/programs/nowlist') {
        const ip = u.searchParams.get('ip') || clientIpFromReq(req);
        const dev = this.registry.get(ip);
        const prog = this._currentProgram(ip, cmsBase);
        // 插播/指令带时效过期：拉模式下 CMS 不知道设备何时消费，若不设 TTL，
        // 设备重载页面（lastInsertAt 归零）会把历史插播重播一遍（真机联调实测）
        const now = Date.now();
        const fresh = (o, ttl) => (o && (now - o.at) < ttl) ? o : null;
        // 把设备待执行指令折进 nowlist，供轮询式播放端（无 XMPP）观测到「推送」
        return this._json(res, u, {
          ...prog,
          volume: (dev && typeof dev.volume === 'number') ? dev.volume : null,
          insert: dev ? fresh(dev.lastInsert, 60_000) : null,
          command: dev ? fresh(dev.lastCommand, 30_000) : null,
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
          this._recordPlaylog(ip, dev);
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
      // 4b) CMS 媒体代理：把灵屏内容以相对 URL 暴露给兼容 Shell（免终端令牌泄露）
      if ((m = /^\/api\/siqian\/media\/([^/?]+)/.exec(p)) && req.method === 'GET') {
        const ip = u.searchParams.get('ip');
        if (ip && !this.registry.get(ip)) return fail(res, '设备未注册', 403);
        const mapper = this.ctx.siqianMapper;
        const mf = mapper ? mapper.mediaFile(decodeURIComponent(m[1])) : null;
        if (!mf) return fail(res, '素材不存在', 404);
        return sendFile(req, res, mf.filePath, { mime: mf.mime, cache: 'public, max-age=300, must-revalidate' });
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

  /** 把 56iq 兼容播放反馈写入灵屏 playlog（按设备 IP 关联终端） */
  _recordPlaylog(ip, dev) {
    try {
      const mapper = this.ctx.siqianMapper;
      const term = mapper ? mapper._terminalByIp(ip) : null;
      if (!term) return;
      recordPlayEvent(this.ctx.store, {
        terminalId: term.id,
        layoutId: (dev && dev.lastProgram && dev.lastProgram.LayoutId) || null,
        itemId: (dev && dev.lastProgram && dev.lastProgram.ProjectId) || null,
        startedAt: Date.now(),
        endedAt: Date.now(),
        customer: '56iq-compat',
      });
    } catch { /* 播放证明失败不影响主流程 */ }
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
