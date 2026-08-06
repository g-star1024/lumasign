/**
 * 灵屏 LumaSign · 极简 HTTP 框架（零依赖）
 * 提供：路由、JSON/表单解析、multipart 流式落盘、静态文件（含 Range）、SSE、限速。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.flv': 'video/x-flv', '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.apk': 'application/vnd.android.package-archive',
  '.txt': 'text/plain; charset=utf-8', '.m3u8': 'application/vnd.apple.mpegurl',
  '.webmanifest': 'application/manifest+json',
};
export const mimeOf = p => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

/* ---------------- 响应助手 ---------------- */
export function json(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
export const ok = (res, data = {}) => json(res, { ok: true, ...data });
export const fail = (res, msg, code = 400) => json(res, { ok: false, error: msg }, code);

/* ---------------- 请求体解析 ---------------- */
export function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw new Error('JSON 格式错误'); }
}

/**
 * 流式 multipart/form-data 解析：文件部分直接落盘，不进内存。
 * 返回 { fields: {}, files: [{ field, filename, mime, tmpPath, size }] }
 */
export function parseMultipart(req, tmpDir) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!m) return reject(new Error('缺少 multipart boundary'));
    const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
    const CRLF = Buffer.from('\r\n');
    fs.mkdirSync(tmpDir, { recursive: true });

    const fields = {}, files = [];
    let buf = Buffer.alloc(0);
    let state = 'boundary';      // boundary -> headers -> body
    let cur = null;              // 当前 part 描述
    let ws = null;               // 当前文件写流

    const finishPart = () => {
      if (!cur) return;
      if (cur.filename) { if (ws) ws.end(); files.push({ ...cur, size: cur.size }); }
      else fields[cur.field] = Buffer.concat(cur.chunks).toString('utf8');
      cur = null; ws = null;
    };

    const pump = () => {
      for (;;) {
        if (state === 'boundary') {
          const i = buf.indexOf(boundary);
          if (i < 0) return;
          const after = i + boundary.length;
          if (buf.length < after + 2) return;
          if (buf[after] === 0x2d && buf[after + 1] === 0x2d) { buf = Buffer.alloc(0); state = 'done'; return; }
          buf = buf.subarray(after + 2);
          state = 'headers';
        }
        if (state === 'headers') {
          const i = buf.indexOf('\r\n\r\n');
          if (i < 0) return;
          const head = buf.subarray(0, i).toString('utf8');
          buf = buf.subarray(i + 4);
          const nameM = /name="([^"]*)"/i.exec(head);
          const fileM = /filename="([^"]*)"/i.exec(head);
          const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
          cur = {
            field: nameM ? nameM[1] : 'unknown',
            filename: fileM ? fileM[1] : null,
            mime: typeM ? typeM[1].trim() : 'application/octet-stream',
            chunks: [], size: 0,
          };
          if (cur.filename) {
            cur.tmpPath = path.join(tmpDir, `up_${Date.now()}_${Math.random().toString(36).slice(2)}`);
            ws = fs.createWriteStream(cur.tmpPath);
          }
          state = 'body';
        }
        if (state === 'body') {
          const i = buf.indexOf(boundary);
          if (i < 0) {
            // 保留可能横跨 boundary 的尾部
            const keep = boundary.length + 4;
            if (buf.length > keep) {
              const out = buf.subarray(0, buf.length - keep);
              buf = buf.subarray(buf.length - keep);
              if (cur.filename) { ws.write(out); cur.size += out.length; }
              else cur.chunks.push(out);
            }
            return;
          }
          let end = i;
          if (end >= 2 && buf.subarray(end - 2, end).equals(CRLF)) end -= 2;
          const out = buf.subarray(0, end);
          if (cur.filename) { ws.write(out); cur.size += out.length; }
          else cur.chunks.push(out);
          buf = buf.subarray(i);
          finishPart();
          state = 'boundary';
        }
        if (state === 'done') return;
      }
    };

    req.on('data', c => { buf = Buffer.concat([buf, c]); try { pump(); } catch (e) { reject(e); req.destroy(); } });
    req.on('end', () => { try { pump(); finishPart(); } catch {} resolve({ fields, files }); });
    req.on('error', reject);
  });
}

/* ---------------- 令牌桶限速 ---------------- */
export class RateLimiter {
  constructor(bytesPerSec = 0) { this.rate = bytesPerSec; this.tokens = bytesPerSec; this.last = Date.now(); }
  setRate(r) { this.rate = r; }
  async take(n) {
    if (!this.rate) return;
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.rate, this.tokens + (now - this.last) / 1000 * this.rate);
      this.last = now;
      if (this.tokens >= n) { this.tokens -= n; return; }
      const wait = Math.max(10, ((n - this.tokens) / this.rate) * 1000);
      await new Promise(r => setTimeout(r, Math.min(wait, 500)));
    }
  }
}
const throttleStream = limiter => new Transform({
  async transform(chunk, _e, cb) { try { await limiter.take(chunk.length); cb(null, chunk); } catch (e) { cb(e); } }
});

/* ---------------- 静态文件（支持 Range / 限速） ---------------- */
export async function sendFile(req, res, filePath, opts = {}) {
  let st;
  try { st = fs.statSync(filePath); } catch { return fail(res, '文件不存在', 404); }
  if (st.isDirectory()) return fail(res, '不是文件', 404);

  const mime = opts.mime || mimeOf(filePath);
  const etag = `W/"${st.size}-${st.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }

  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Cache-Control': opts.cache || 'public, max-age=300',
  };
  if (opts.download) headers['Content-Disposition'] =
    `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`;

  const range = req.headers.range;
  let start = 0, end = st.size - 1, code = 200;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
      if (isNaN(start) || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      end = Math.min(end, st.size - 1);
      code = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(code, headers);
  if (req.method === 'HEAD') return res.end();

  const rs = fs.createReadStream(filePath, { start, end });
  try {
    if (opts.limiter && opts.limiter.rate) await pipeline(rs, throttleStream(opts.limiter), res);
    else await pipeline(rs, res);
  } catch { try { res.destroy(); } catch {} }
}

/* ---------------- SSE ---------------- */
export function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  return {
    send(event, data) {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); return true; }
      catch { return false; }
    },
    close() { try { res.end(); } catch {} },
  };
}

/* ---------------- 路由 ---------------- */
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })
      .replace(/\*$/, '(.*)') + '$');
    this.routes.push({ method, rx, keys, handler, pattern });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  del(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(r.method === 'GET' && method === 'HEAD')) continue;
      const m = r.rx.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }
}

/* ---------------- 工具 ---------------- */
export const safeJoin = (root, rel) => {
  const p = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  return p.startsWith(path.resolve(root)) ? p : null;
};
export const humanSize = b => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)}${u[i]}`;
};
