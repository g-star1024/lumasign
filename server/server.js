/**
 * 灵屏 LumaSign · 服务端主入口（零依赖）
 * 整合 store / logger / auth / bus / schedule / discovery / seed / fleet 与各 API 层，
 * 启动：HTTP + 静态服务（admin & player） + SSE + UDP 零配置发现。
 *
 * 设计要点：
 *  - init(opts) 返回 { server, ctx, shutdown, ready }，便于 Electron 主进程「同进程托管」服务端，
 *    无需单独打包 node 二进制、无需子进程管理；同时 standalone `node server/server.js` 依旧可用。
 *  - 远程开通（fleet）模块：扫描局域网已知 IP、指纹识别、经 ADB / 厂商 API 推送 APK。
 *
 * 运行方式：
 *   node server/server.js
 * 可选环境变量 / opts：
 *   LUMASIGN_DATA   数据目录（默认 ./data，Electron 下指向 userData）
 *   LUMASIGN_PORT   HTTP 端口（默认 7788）
 *   LUMASIGN_ADB    adb 可执行文件路径（默认 'adb'，Electron 下指向打包资源）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Store } from './lib/store.js';
import { Logger } from './lib/logger.js';
import { Auth } from './lib/auth.js';
import { Bus } from './lib/bus.js';
import { RateLimiter, Router, safeJoin, sendFile, fail, json } from './lib/http.js';
import { startDiscovery, primaryIP, lanIPs } from './lib/discovery.js';
import { seed } from './lib/seed.js';
import { Inventory } from './lib/inventory.js';
import { Moderator } from './lib/moderation.js';
import { Lifecycle } from './lib/lifecycle.js';
import {
  applySecurityHeaders, ApiGuard, AuditChain, csrfGuard, lanOnlyGuard, ipListGuard, clientIp,
} from './lib/security.js';
import { registerAdminApi } from './api/admin.js';
import { registerTerminalApi } from './api/terminal.js';
import { registerFleetApi } from './api/fleet.js';
import { registerNetscanApi } from './api/netscan.js';
import { registerSecurityApi } from './api/security.js';
import { registerLifecycleApi } from './api/lifecycle.js';
import { createDeploy } from './lib/deploy.js';
import { registerDeployApi } from './api/deploy.js';
import { registerHealthApi } from './api/health.js';
import { HealthMonitor } from './lib/health.js';
import { registerPlayProofApi } from './api/playproof.js';
import { DataSourceManager } from './lib/datasource.js';
import { registerDataSourceApi } from './api/datasource.js';
import { registerInteractionApi } from './api/interaction.js';
import { registerTranscodeApi } from './api/transcode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.dirname(__dirname);                       // .../lumasign

async function init(opts = {}) {
  const DATA = opts.dataDir || process.env.LUMASIGN_DATA || path.join(__dirname, 'data');
  const PORT = opts.port || parseInt(process.env.LUMASIGN_PORT || '7788', 10);
  const HOST = opts.host || '0.0.0.0';
  const ADB = opts.adbPath || process.env.LUMASIGN_ADB || 'adb';

  const ADMIN_DIR = path.join(ROOT, 'admin');
  const PLAYER_DIR = path.join(ROOT, 'player');
  const MEDIA = path.join(DATA, 'media');
  const THUMBS = path.join(DATA, 'thumbs');
  const SHOTS = path.join(DATA, 'shots');
  const APK = path.join(DATA, 'apk');
  const TMP = path.join(DATA, 'tmp');

  /* ---------------- 目录准备 ---------------- */
  for (const d of [DATA, MEDIA, THUMBS, SHOTS, APK, TMP]) {
    fs.mkdirSync(d, { recursive: true });
  }

  /* ---------------- 核心实例 ---------------- */
  const store = new Store(DATA);
  const logger = new Logger(DATA);
  const auth = new Auth(store);
  const bus = new Bus(store, logger);
  const limiter = new RateLimiter(0);                       // 全局下发限速（0=不限）

  /* ---------------- 安全组件 ---------------- */
  // 审计哈希链：每条审计记录带 prev/hash，事后被改会立刻断链（内鬼防线）
  const auditChain = new AuditChain(DATA);
  const rawAudit = logger.audit.bind(logger);
  logger.audit = (o) => {
    const rec = { ts: Date.now(), ...o };
    const { prev, hash } = auditChain.seal(rec);
    return rawAudit({ ...o, chainPrev: prev, hash });
  };
  logger.verifyChain = (lines) => auditChain.verify(lines);

  // API 限速 + 自动封禁
  const apiGuard = new ApiGuard({
    onViolation: ({ ip, cls, strikes, banned, pathname }) => {
      logger.audit({
        userId: 'system', username: 'system',
        action: banned ? 'security_ip_banned' : 'security_rate_limited',
        target: `${ip} 触发 ${cls} 类限速（第 ${strikes} 次）${pathname}`,
        ip, cls, strikes,
      });
    },
  });

  // 内容合规审核
  const moderator = new Moderator({ dataDir: DATA, logger });

  const ctx = {
    store, auth, bus, logger,
    paths: { root: ROOT, data: DATA, media: MEDIA, thumbs: THUMBS, shots: SHOTS, apk: APK, tmp: TMP },
    port: PORT, https: false, adbPath: ADB,
    scanPorts: [5555, 80, 8080, 8000, 7788, 22, 5000, 8888, 19211],
    limiter,
    secret: crypto.randomBytes(32).toString('hex'),
    apiGuard, auditChain, moderator,
  };

  /* 首次运行初始化默认数据 */
  seed(store, logger);

  /* 设备台账与自动巡检（需在 seed 之后，依赖 settings 集合） */
  const inventory = new Inventory(ctx);
  ctx.inventory = inventory;
  inventory.start();

  /* 内容生命周期：有效期到点自动下线 + 归档 + 提醒 */
  const lifecycle = new Lifecycle(ctx);
  ctx.lifecycle = lifecycle;
  lifecycle.start();

  /* 下发版本管理：一键回滚 + 灰度下发 */
  const deploy = createDeploy(ctx);
  ctx.deploy = deploy;

  /* 终端健康度：评分 + 异常预警 + 失联侦测 + 存储不足自动清理 */
  const health = new HealthMonitor(ctx);
  ctx.health = health;
  health.start();

  /* P1 动态内容数据源：定时拉取 HTTP/JSON、CSV，缓存供播放端读取 */
  const dataManager = new DataSourceManager(ctx);
  ctx.dataManager = dataManager;
  dataManager.start();

  /* ---------------- 路由注册 ---------------- */
  const router = new Router();
  registerAdminApi(router, ctx);
  registerTerminalApi(router, ctx);
  registerFleetApi(router, ctx);
  registerNetscanApi(router, ctx);
  registerSecurityApi(router, ctx);
  registerLifecycleApi(router, ctx);
  registerDeployApi(router, ctx);
  registerHealthApi(router, ctx);
  registerPlayProofApi(router, ctx);
  registerDataSourceApi(router, ctx);
  registerInteractionApi(router, ctx);
  registerTranscodeApi(router, ctx);

  /* ---------------- 全局限速随设置刷新 ---------------- */
  const refreshTimer = setInterval(() => {
    const s = store.col('settings').byId('settings');
    if (s) limiter.setRate((s.downloadLimitKBps || 0) * 1024);
  }, 5000);
  refreshTimer.unref?.();

  /* ---------------- 静态服务 ---------------- */
  async function serveStatic(req, res, baseDir, rp) {
    if (!rp || rp === '/') rp = '/index.html';
    let fp = safeJoin(baseDir, rp);
    if (!fp) return fail(res, '非法路径', 400);

    let st = null;
    try { st = fs.statSync(fp); } catch { st = null; }

    if (st && st.isDirectory()) {
      const idx = safeJoin(baseDir, rp + '/index.html');
      if (idx && fs.existsSync(idx)) return sendFile(req, res, idx, { cache: 'no-cache' });
      return fail(res, '目录无索引页', 404);
    }
    if (st) return sendFile(req, res, fp, { cache: 'no-cache' });

    // SPA 兜底：未知路径回退到 index.html
    const idx = path.join(baseDir, 'index.html');
    if (fs.existsSync(idx)) return sendFile(req, res, idx, { cache: 'no-cache' });
    return fail(res, 'Not Found', 404);
  }

  /* ---------------- CORS ----------------
   * 原来是 Access-Control-Allow-Origin: * ——任何网站的 JS 都能读我们的接口响应。
   * 现在收紧为「回显同源 + 允许凭证」：只有从本服务自身页面发起的请求才拿得到数据。
   * 桌面端（Electron）走 file:// 时 Origin 为 null，用 x-terminal-token / 无 Origin 通道，不受影响。
   */
  function setCors(req, res) {
    const origin = req.headers.origin;
    const host = String(req.headers.host || '').toLowerCase();
    let allow = '';
    if (origin) {
      try { if (new URL(origin).host.toLowerCase() === host) allow = origin; } catch { /* ignore */ }
    }
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', allow);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
      'Content-Type, x-session, x-terminal-id, x-terminal-token, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  const secCfg = () => {
    const s = store.col('settings').byId('settings') || {};
    return s.security || {};
  };

  /* ---------------- 主请求处理 ---------------- */
  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(url.pathname);
      const isPlayer = pathname.startsWith('/player');

      setCors(req, res);
      applySecurityHeaders(res, { kind: isPlayer ? 'player' : 'admin', https: ctx.https });
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

      /* ── 安全闸门（顺序：网络面 → 黑白名单 → 限速 → CSRF） ── */
      const cfg = secCfg();

      const lan = lanOnlyGuard(req, cfg);
      if (!lan.allowed) {
        logger.audit({ userId: 'system', username: 'system', action: 'security_blocked_wan', target: lan.reason });
        return fail(res, '禁止访问', 403);
      }

      // 白名单仅约束「管理后台面」（/api/admin、/、/admin）。
      // 终端拉取/上报、SSE、播放端 /player、监看墙 等内网通信豁免，
      // 否则 allowIps 非空时会误伤全部电子屏，导致屏拉不到节目。
      const isAdminSurface = pathname.startsWith('/api/admin') || pathname === '/' || pathname.startsWith('/admin');
      if (isAdminSurface) {
        const ipl = ipListGuard(req, cfg);
        if (!ipl.allowed) {
          logger.audit({ userId: 'system', username: 'system', action: 'security_blocked_ip', target: ipl.reason });
          return fail(res, '禁止访问', 403);
        }
      }

      // 1) API
      if (pathname.startsWith('/api/')) {
        // SSE 长连接不计入限速（否则每次重连都吃额度）
        const isStream = pathname === '/api/events' || /\/(events|stream)$/.test(pathname);
        if (!isStream) {
          const rl = apiGuard.check(req, pathname);
          if (!rl.allowed) {
            res.setHeader('Retry-After', String(rl.retryAfter || 60));
            return fail(res, rl.reason, 429);
          }
        }

        const csrf = csrfGuard(req);
        if (!csrf.allowed) {
          logger.audit({
            userId: 'system', username: 'system', action: 'security_csrf_blocked',
            target: `${req.method} ${pathname} — ${csrf.reason}`, ip: clientIp(req),
          });
          return fail(res, '跨站请求被拒绝', 403);
        }
        if (csrf.suspicious && req.method !== 'GET') {
          logger.audit({
            userId: 'system', username: 'system', action: 'security_headless_write',
            target: `${req.method} ${pathname}（无 Origin/Referer，疑似脚本调用）`, ip: clientIp(req),
          });
        }

        const m = router.match(req.method, pathname);
        if (m) { await m.handler(req, res, m.params, url); return; }
        return fail(res, '接口不存在', 404);
      }

      // 2) 健康检查（桌面端探活 / 监控 / 设备探测）
      if (pathname === '/health') {
        return json(res, { ok: true, product: 'LumaSign', port: PORT, uptime: process.uptime() | 0 });
      }

      // 3) 静态资源
      if (pathname === '/') return serveStatic(req, res, ADMIN_DIR, '/index.html');
      if (pathname.startsWith('/admin')) {
        const rp = pathname.slice('/admin'.length) || '/';
        return serveStatic(req, res, ADMIN_DIR, rp);
      }
      if (pathname.startsWith('/player')) {
        const rp = pathname.slice('/player'.length) || '/';
        return serveStatic(req, res, PLAYER_DIR, rp);
      }

      // 4) 其余未知路径回退到管理端
      return serveStatic(req, res, ADMIN_DIR, pathname);
    } catch (e) {
      logger.system({ event: 'request_error', message: e.message, stack: String(e.stack || '') });
      if (!res.headersSent) fail(res, '服务器内部错误', 500);
      else try { res.end(); } catch { /* ignore */ }
    } finally {
      const dt = Date.now() - t0;
      if (dt > 1000) logger.system({ event: 'slow_request', ms: dt, url: req.url });
    }
  });

  /* ---------------- UDP 零配置发现 ---------------- */
  const serverName = store.col('settings').byId('settings')?.serverName || 'LumaSign';
  const disc = startDiscovery({ port: 7789, httpPort: PORT, serverName });

  /* ---------------- 启动 ---------------- */
  const ready = new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      const ips = lanIPs();
      const lines = [
        '',
        '  ┌─────────────────────────────────────────────────────┐',
        '  │           灵屏 LumaSign 数字标牌管理系统            │',
        '  └─────────────────────────────────────────────────────┘',
        '',
        `  管理端：  http://localhost:${PORT}/`,
        ...ips.map(i => `           http://${i.address}:${PORT}/`),
        '',
        `  终端发现：UDP :7789   本机主地址：${primaryIP()}`,
        `  数据目录：${DATA}`,
        `  adb 路径：${ADB}`,
        '',
        '  默认管理员：admin / admin123  （首次登录请修改密码）',
        '',
        '  终端注册：发 UDP「LUMASIGN_DISCOVER」到 :7789 即可自动入网',
        '  远程开通：管理端「设备开通」页可扫描已知 IP 并批量推送 APK',
        '',
      ];
      lines.forEach(l => console.log(l));
      logger.system({ event: 'startup', port: PORT, ips: ips.map(i => i.address) });
      resolve();
    });
  });

  /* ---------------- 优雅退出 ---------------- */
  function shutdown() {
    try { server.close(() => {}); } catch { /* ignore */ }
    try { disc.close(); } catch { /* ignore */ }
    try { clearInterval(refreshTimer); } catch { /* ignore */ }
    try { inventory.stop(); } catch { /* ignore */ }
    try { lifecycle.stop(); } catch { /* ignore */ }
    try { health.stop(); } catch { /* ignore */ }
    try { dataManager.stop(); } catch { /* ignore */ }
    store.flushAll();
    logger.flush();
    try { auditChain.flush(); } catch { /* ignore */ }
  }

  return { server, ctx, shutdown, ready, paths: ctx.paths };
}

/* ---------------- standalone 自启动 ---------------- */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { shutdown } = await init();
  const stop = (sig) => {
    console.log(`\n收到 ${sig}，正在优雅退出...`);
    try { shutdown(); } catch {}
    setTimeout(() => process.exit(0), 200);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('uncaughtException', e => {
    console.error('[致命] 未捕获异常:', e);
  });
  process.on('unhandledRejection', e => {
    console.error('[警告] 未处理的 Promise 拒绝:', e);
  });
}

export { init };
