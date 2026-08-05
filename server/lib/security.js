/**
 * 灵屏 LumaSign · 安全中间层（零依赖）
 *
 * 威胁模型（数字标牌特有）：
 *   T1 外部扫到端口直接打管理端        → 网络面收敛 + 安全响应头 + 限速封禁
 *   T2 XSS 注入到素材/节目，投到大屏上 → CSP + 输出转义 + 上传类型校验
 *   T3 CSRF：诱导管理员点链接改内容     → Origin/Referer 双校验 + SameSite Cookie
 *   T4 内鬼/离职员工拿 token 直调 API   → 令牌绑定+轮换、审计哈希链、敏感操作二次确认
 *   T5 撞库爆破管理员密码              → 登录限速 + 锁定（auth.js 已有）+ 全局 IP 封禁
 *   T6 伪造终端注册，冒领节目           → 注册码 + 终端令牌 + HMAC 清单签名（已有）
 *   T7 路径穿越 / 大文件打满磁盘        → safeJoin（已有）+ 上传体积与类型白名单
 *   T8 有人把不良内容发上屏             → moderation.js 内容合规（本文件之外）
 *
 * 本文件只管「协议与传输层」，内容合规见 moderation.js。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/* ══════════════════════════════════════════════════════════
 * 1) 安全响应头
 * ════════════════════════════════════════════════════════ */

/**
 * CSP 说明：管理端与播放端都是自托管的原生 ESM，无 CDN 依赖。
 * - 允许 'unsafe-inline' 仅限 style（手写 CSS 设计系统用了大量内联样式）
 * - script 严禁 unsafe-inline / unsafe-eval → 这是挡 XSS 打到大屏的关键一刀
 * - media/img 允许 blob: 与 data:（播放引擎要用 canvas 截屏、缩略图）
 * - frame-ancestors 'self' → 防点击劫持（比 X-Frame-Options 更强，覆盖现代浏览器）
 */
const CSP_ADMIN = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

/**
 * 播放端要能内嵌"网页组件"（iframe 外部页面），所以 frame-src 放开，
 * 但由 moderation.js 的 URL 白名单在业务层管住到底能嵌哪些站。
 */
const CSP_PLAYER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src http: https:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

export function applySecurityHeaders(res, { kind = 'admin', https = false } = {}) {
  res.setHeader('Content-Security-Policy', kind === 'player' ? CSP_PLAYER : CSP_ADMIN);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

/* ══════════════════════════════════════════════════════════
 * 2) 网络面收敛：只服务局域网
 * ════════════════════════════════════════════════════════ */

const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./,
  /^::1$/,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i,
];

export function normalizeIp(ip = '') {
  return String(ip).replace(/^::ffff:/i, '').trim();
}

export function isPrivateIp(ip) {
  const s = normalizeIp(ip);
  if (!s) return false;
  return PRIVATE_RANGES.some(r => r.test(s));
}

export function clientIp(req) {
  // 局域网直连场景不信任 XFF（可伪造）；只有显式开启反代模式才读
  return normalizeIp(req.socket?.remoteAddress || '');
}

/**
 * LAN-only 守卫：拒绝来自公网地址的请求。
 * 部署到有公网 IP 的机器上时，这是最后一道物理隔离。
 */
export function lanOnlyGuard(req, cfg = {}) {
  if (!cfg.lanOnly) return { allowed: true };
  const ip = clientIp(req);
  if (isPrivateIp(ip)) return { allowed: true };
  return { allowed: false, reason: `拒绝非局域网来源 ${ip}` };
}

/** IP 黑白名单（白名单优先；支持 192.168.1.* 与 CIDR 前缀写法） */
export function ipListGuard(req, cfg = {}) {
  const ip = clientIp(req);
  const match = (list) => (list || []).some((rule) => {
    const r = String(rule).trim();
    if (!r) return false;
    if (r.endsWith('*')) return ip.startsWith(r.slice(0, -1));
    if (r.includes('/')) {
      const [base, bits] = r.split('/');
      return sameSubnet(ip, base, +bits || 24);
    }
    return ip === r;
  });
  if (cfg.denyIps?.length && match(cfg.denyIps)) return { allowed: false, reason: `IP ${ip} 在黑名单中` };
  if (cfg.allowIps?.length && !match(cfg.allowIps)) return { allowed: false, reason: `IP ${ip} 不在白名单中` };
  return { allowed: true };
}

function sameSubnet(a, b, bits) {
  const toInt = s => s.split('.').reduce((n, o) => (n << 8) + (+o || 0), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+\.\d+$/.test(b)) return false;
  const mask = bits >= 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (toInt(a) & mask) === (toInt(b) & mask);
}

/* ══════════════════════════════════════════════════════════
 * 3) CSRF：Origin / Referer 双校验
 * ════════════════════════════════════════════════════════ */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 会话走 Cookie，所以必须防 CSRF。
 * 策略：写操作必须带 Origin 或 Referer，且其 host 必须等于请求的 Host。
 * 终端设备（带 x-terminal-token）与 SDK 调用不走 Cookie，豁免。
 */
export function csrfGuard(req) {
  if (SAFE_METHODS.has(req.method)) return { allowed: true };
  // 终端/机器调用：用 header 令牌而非 Cookie，天然免疫 CSRF
  if (req.headers['x-terminal-token'] || req.headers['x-api-key'] || req.headers.authorization) {
    return { allowed: true };
  }

  const host = String(req.headers.host || '').toLowerCase();
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };

  if (origin) {
    if (origin === 'null') return { allowed: false, reason: 'Origin 为 null（可能来自沙箱页面）' };
    return hostOf(origin) === host
      ? { allowed: true }
      : { allowed: false, reason: `跨站请求被拒绝（Origin=${origin}）` };
  }
  if (referer) {
    return hostOf(referer) === host
      ? { allowed: true }
      : { allowed: false, reason: `跨站请求被拒绝（Referer=${referer}）` };
  }
  // 既无 Origin 也无 Referer：可能是 curl/脚本。局域网工具允许，但记审计。
  return { allowed: true, suspicious: true };
}

/* ══════════════════════════════════════════════════════════
 * 4) API 限速 + 自动封禁
 * ════════════════════════════════════════════════════════ */

/**
 * 滑动窗口限速器。按 IP 分桶，不同路由类别不同额度：
 *   auth   登录/改密    → 极严（防爆破）
 *   write  写操作       → 中等
 *   scan   局域网扫描   → 严（扫描很吃资源）
 *   read   读操作       → 宽松
 * 超限累计到阈值自动封禁一段时间。
 */
export class ApiGuard {
  constructor(opts = {}) {
    this.rules = {
      auth: { limit: 10, windowMs: 60_000 },
      scan: { limit: 6, windowMs: 60_000 },
      write: { limit: 120, windowMs: 60_000 },
      read: { limit: 600, windowMs: 60_000 },
      ...(opts.rules || {}),
    };
    this.banAfter = opts.banAfter ?? 5;          // 连续超限 N 次后封禁
    this.banMs = opts.banMs ?? 10 * 60_000;      // 封禁时长
    this.buckets = new Map();                    // `${ip}|${class}` -> number[]
    this.strikes = new Map();                    // ip -> count
    this.bans = new Map();                       // ip -> untilTs
    this.onViolation = opts.onViolation || null;

    const t = setInterval(() => this._gc(), 60_000);
    t.unref?.();
  }

  classify(pathname, method) {
    if (/\/api\/(login|auth|password|users?\/.*\/(password|reset))/i.test(pathname)) return 'auth';
    if (/\/api\/admin\/scan\/|\/api\/admin\/fleet\//i.test(pathname)) return 'scan';
    return SAFE_METHODS.has(method) ? 'read' : 'write';
  }

  isBanned(ip) {
    const until = this.bans.get(ip);
    if (!until) return false;
    if (Date.now() > until) { this.bans.delete(ip); this.strikes.delete(ip); return false; }
    return true;
  }

  /** @returns { allowed, reason?, retryAfter?, cls } */
  check(req, pathname) {
    const ip = clientIp(req);
    const cls = this.classify(pathname, req.method);

    if (this.isBanned(ip)) {
      return { allowed: false, cls, banned: true, retryAfter: Math.ceil((this.bans.get(ip) - Date.now()) / 1000),
        reason: `IP ${ip} 已被临时封禁` };
    }

    const rule = this.rules[cls];
    const key = `${ip}|${cls}`;
    const now = Date.now();
    const arr = this.buckets.get(key) || [];
    const kept = arr.filter(t => now - t < rule.windowMs);

    if (kept.length >= rule.limit) {
      this.buckets.set(key, kept);
      const strikes = (this.strikes.get(ip) || 0) + 1;
      this.strikes.set(ip, strikes);
      let banned = false;
      if (strikes >= this.banAfter) {
        this.bans.set(ip, now + this.banMs);
        banned = true;
      }
      this.onViolation?.({ ip, cls, strikes, banned, pathname, method: req.method });
      return {
        allowed: false, cls, banned,
        retryAfter: Math.ceil(rule.windowMs / 1000),
        reason: banned
          ? `请求过于频繁，IP 已封禁 ${Math.round(this.banMs / 60000)} 分钟`
          : `请求过于频繁（${cls} 类限 ${rule.limit} 次/分钟）`,
      };
    }

    kept.push(now);
    this.buckets.set(key, kept);
    return { allowed: true, cls };
  }

  unban(ip) { this.bans.delete(normalizeIp(ip)); this.strikes.delete(normalizeIp(ip)); }
  bannedList() {
    const now = Date.now();
    return [...this.bans.entries()]
      .filter(([, u]) => u > now)
      .map(([ip, until]) => ({ ip, until, remainSec: Math.ceil((until - now) / 1000) }));
  }

  _gc() {
    const now = Date.now();
    for (const [k, arr] of this.buckets) {
      const cls = k.split('|')[1];
      const w = this.rules[cls]?.windowMs || 60_000;
      const kept = arr.filter(t => now - t < w);
      if (kept.length) this.buckets.set(k, kept); else this.buckets.delete(k);
    }
    for (const [ip, until] of this.bans) if (until < now) { this.bans.delete(ip); this.strikes.delete(ip); }
  }
}

/* ══════════════════════════════════════════════════════════
 * 5) 上传文件真实类型校验（magic bytes）
 * ════════════════════════════════════════════════════════ */

/**
 * 只信文件头，不信扩展名与 Content-Type。
 * 攻击场景：把 .html（内含 <script>）改名成 .jpg 上传，再用「网页组件」引用 → XSS 上大屏。
 */
const MAGIC = [
  { ext: 'jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'gif', mime: 'image/gif', test: b => b.subarray(0, 3).toString('ascii') === 'GIF' },
  { ext: 'bmp', mime: 'image/bmp', test: b => b[0] === 0x42 && b[1] === 0x4d },
  { ext: 'webp', mime: 'image/webp', test: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { ext: 'mp4', mime: 'video/mp4', test: b => b.subarray(4, 8).toString('ascii') === 'ftyp' },
  { ext: 'webm', mime: 'video/webm', test: b => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { ext: 'avi', mime: 'video/x-msvideo', test: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 11).toString('ascii') === 'AVI' },
  { ext: 'flv', mime: 'video/x-flv', test: b => b.subarray(0, 3).toString('ascii') === 'FLV' },
  { ext: 'mkv', mime: 'video/x-matroska', test: b => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { ext: 'mp3', mime: 'audio/mpeg', test: b => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { ext: 'wav', mime: 'audio/wav', test: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE' },
  { ext: 'pdf', mime: 'application/pdf', test: b => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  { ext: 'apk', mime: 'application/vnd.android.package-archive', test: b => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) },
];

/** 危险特征：内容里出现 HTML/脚本痕迹却声称是媒体文件 */
const HTML_SNIFF = /<\s*(script|iframe|svg|html|body|object|embed|meta|link)\b/i;

/**
 * 读取文件头做类型判定。
 * @returns { ok, ext, mime, reason }
 */
export function sniffFile(filePath, { allow = [], maxSniff = 4096 } = {}) {
  let fd, buf;
  try {
    fd = fs.openSync(filePath, 'r');
    buf = Buffer.alloc(maxSniff);
    const n = fs.readSync(fd, buf, 0, maxSniff, 0);
    buf = buf.subarray(0, n);
  } catch (e) {
    return { ok: false, reason: `无法读取文件：${e.message}` };
  } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }

  if (buf.length < 4) return { ok: false, reason: '文件过小或为空' };

  const hit = MAGIC.find(m => { try { return m.test(buf); } catch { return false; } });
  if (!hit) {
    // 没命中白名单魔数：进一步看是不是伪装的 HTML
    const head = buf.subarray(0, 1024).toString('utf8');
    if (HTML_SNIFF.test(head)) {
      return { ok: false, reason: '检测到 HTML/脚本内容，禁止作为媒体素材上传（疑似 XSS 投毒）' };
    }
    return { ok: false, reason: '无法识别的文件类型，仅允许上传图片 / 视频 / 音频 / PDF / APK' };
  }
  if (allow.length && !allow.includes(hit.ext)) {
    return { ok: false, ext: hit.ext, mime: hit.mime, reason: `此处不允许上传 ${hit.ext} 类型文件` };
  }
  // SVG 归类为图片但可内嵌脚本 —— 本系统直接不收 SVG 素材（魔数表里就没有）
  return { ok: true, ext: hit.ext, mime: hit.mime };
}

/* ══════════════════════════════════════════════════════════
 * 6) 审计哈希链（防篡改）
 * ════════════════════════════════════════════════════════ */

/**
 * 每条审计记录带上 prevHash，形成链。
 * 有人事后偷改/删除日志文件，校验链时会立刻断裂 —— 这是"内鬼防线"。
 */
export class AuditChain {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'logs', 'audit-chain.json');
    this.state = { head: 'GENESIS', count: 0 };
    try {
      if (fs.existsSync(this.file)) this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch { /* 损坏则从头开始，但会在校验时体现 */ }
    this._dirty = false;
    const t = setInterval(() => this.flush(), 5000); t.unref?.();
  }

  /**
   * 为一条审计记录生成链哈希。
   * @returns { prev, hash } —— 调用方需把两者写进日志记录本身
   */
  seal(rec) {
    const prev = this.state.head;
    const payload = JSON.stringify({
      ts: rec.ts, action: rec.action, userId: rec.userId, target: rec.target, prev,
    });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    this.state = { head: hash, count: this.state.count + 1, updatedAt: Date.now() };
    this._dirty = true;
    return { prev, hash };
  }

  flush() {
    if (!this._dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state), 'utf8');
      this._dirty = false;
    } catch { /* ignore */ }
  }

  /**
   * 校验一段审计日志的链是否连续（传入按时间正序的记录数组）。
   * 任何一条被改写、删除或插入，都会导致后续哈希对不上。
   */
  verify(lines = []) {
    let broken = null;
    let checked = 0;
    for (let i = 0; i < lines.length; i++) {
      const r = lines[i];
      if (!r.hash || !r.chainPrev) continue;          // 链启用前的老记录跳过
      checked++;
      const payload = JSON.stringify({
        ts: r.ts, action: r.action, userId: r.userId, target: r.target, prev: r.chainPrev,
      });
      const h = crypto.createHash('sha256').update(payload).digest('hex');
      if (h !== r.hash) { broken = { index: i, at: r.ts, action: r.action, expected: h, actual: r.hash }; break; }
      // 下一条的 chainPrev 必须等于本条 hash
      const next = lines.slice(i + 1).find(x => x.hash && x.chainPrev);
      if (next && next.chainPrev !== r.hash) {
        broken = { index: i + 1, at: next.ts, action: next.action, expected: r.hash, actual: next.chainPrev, kind: 'gap' };
        break;
      }
    }
    return { ok: !broken, checked, total: lines.length, broken };
  }
}

/* ══════════════════════════════════════════════════════════
 * 7) 令牌工具
 * ════════════════════════════════════════════════════════ */

export const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** 恒定时间比较，防时序侧信道 */
export function safeEqual(a = '', b = '') {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // 长度不同也要走一遍，避免长度泄漏
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/** HTML 转义 —— 任何用户输入回显到管理端/播放端前都要过一遍 */
export function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 弱口令检测：默认口令、纯数字、连续键盘序 */
const WEAK = new Set([
  'admin123', '123456', '12345678', '123456789', 'password', 'admin', 'root',
  'qwerty', 'abc123', '111111', '000000', '888888', '666666', 'a123456',
  'admin888', 'lumasign', 'chuto123',
]);
export function passwordStrength(pw = '') {
  const s = String(pw);
  const issues = [];
  if (s.length < 8) issues.push('长度不足 8 位');
  if (WEAK.has(s.toLowerCase())) issues.push('属于常见弱口令');
  if (/^\d+$/.test(s)) issues.push('不能为纯数字');
  if (/^(.)\1+$/.test(s)) issues.push('不能为重复字符');
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(r => r.test(s)).length;
  if (kinds < 2) issues.push('需包含字母、数字、符号中的至少两类');
  const score = Math.max(0, Math.min(100,
    s.length * 6 + kinds * 12 - (WEAK.has(s.toLowerCase()) ? 60 : 0)));
  return { ok: issues.length === 0, score, issues };
}
