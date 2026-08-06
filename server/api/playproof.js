/**
 * 灵屏 LumaSign · 播放证明与合规存证包 API（P0-4）
 */
import fs from 'fs';
import path from 'path';
import { json, fail, readJson } from '../lib/http.js';
import { recordPlayEvent, queryPlayLog, aggregatePlayLog, playProofFilters } from '../lib/playlog.js';
import { buildProofPdf, proofHash, jpegSize } from '../lib/pdf.js';
import { ZipWriter } from '../lib/zipjs.js';

export function registerPlayProofApi(router, ctx) {
  const { store, auth, paths, bus } = ctx;
  const S = n => store.col(n);
  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };

  /** 终端鉴权（与 terminal.js 同语义，独立实现避免跨模块耦合） */
  function authTerminal(req, url, body) {
    const id = body?.terminalId || url.searchParams.get('terminalId') || req.headers['x-terminal-id'];
    const token = body?.token || url.searchParams.get('token') || req.headers['x-terminal-token'];
    if (!id || !token) return null;
    const t = S('terminals').byId(id);
    if (!t || t.token !== token) return null;
    return t;
  }

  /* ---------------- 终端上报播放事件 ---------------- */
  router.post('/api/t/playlog', async (req, res) => {
    const b = await readJson(req);
    const t = authTerminal(req, req.url ? new URL(req.url, 'http://x') : new URL('http://x'), b);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    const events = Array.isArray(b.events) ? b.events : (b.event ? [b.event] : []);
    if (!events.length) return fail(res, '缺少播放事件', 400);
    const recorded = [];
    for (const ev of events.slice(0, 200)) {
      recorded.push(recordPlayEvent(store, {
        terminalId: t.id,
        layoutId: ev.layoutId || null,
        itemId: ev.itemId || null,
        mediaId: ev.mediaId || null,
        customer: ev.customer || null,
        startedAt: ev.startedAt,
        endedAt: ev.endedAt,
      }));
    }
    bus.broadcastAdmin('playlog:update', { terminalId: t.id, count: recorded.length });
    json(res, { ok: true, recorded: recorded.length });
  });

  /* ---------------- 管理端查询 ---------------- */
  router.get('/api/admin/playproof/filters', guard('log:view', (req, res) => {
    json(res, { ok: true, ...playProofFilters(store) });
  }));

  router.get('/api/admin/playproof/query', guard('log:view', (req, res, p, url) => {
    const q = Object.fromEntries(url.searchParams.entries());
    const r = queryPlayLog(store, {
      terminalId: q.terminalId || undefined,
      mediaId: q.mediaId || undefined,
      customer: q.customer || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      limit: q.limit ? Number(q.limit) : 500,
    });
    json(res, { ok: true, total: r.total, items: r.items });
  }));

  /* ---------------- 导出存证包（PDF / JSON） ---------------- */
  router.get('/api/admin/playproof/export', guard('log:view', (req, res, p, url) => {
    const q = Object.fromEntries(url.searchParams.entries());
    const fmt = (q.fmt || 'pdf').toLowerCase();
    const rows = queryPlayLog(store, {
      terminalId: q.terminalId || undefined,
      mediaId: q.mediaId || undefined,
      customer: q.customer || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      limit: q.limit ? Number(q.limit) : 5000,
    }).items;

    const filter = { terminalId: q.terminalId || '', mediaId: q.mediaId || '', customer: q.customer || '', from: q.from || '', to: q.to || '' };
    const sum = aggregatePlayLog(rows);
    const generatedAt = Date.now();
    const reportId = `PP-${new Date(generatedAt).toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${String(rows.length).padStart(4, '0')}`;

    // 审计哈希：对规范化记录（去姓名快照，仅留 ID/时间戳）做 SHA-256
    const canonical = {
      reportId, generatedAt, filter,
      records: rows.map(r => ({ terminalId: r.terminalId, mediaId: r.mediaId, itemId: r.itemId, layoutId: r.layoutId, startedAt: r.startedAt, endedAt: r.endedAt })),
    };
    const hash = proofHash(canonical);
    const meta = { reportId, generatedAt, hash, filter };

    if (fmt === 'json') {
      const payload = { ok: true, meta, summary: sum, records: rows };
      const buf = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${reportId}.json"`);
      res.setHeader('Content-Length', buf.length);
      return res.end(buf);
    }

    // ZIP：打包 PDF + JSON 元数据 + 截屏原图
    if (fmt === 'zip') {
      const zip = new ZipWriter();

      // 1. 收集截屏
      const screenshots = [];
      try {
        const termIds = [...new Set(rows.map(r => r.terminalId))].slice(0, 9);
        for (const tid of termIds) {
          const dir = path.join(paths.shots, tid);
          if (!fs.existsSync(dir)) continue;
          const files = fs.readdirSync(dir).filter(f => /\.jpe?g$/i.test(f)).sort((a, b) => b.localeCompare(a));
          if (!files.length) continue;
          const fp = path.join(dir, files[0]);
          const buf = fs.readFileSync(fp);
          const sz = jpegSize(buf);
          if (sz) {
            screenshots.push({ buf, w: sz.w, h: sz.h, label: tid });
            zip.addFile(`screenshots/${tid}_${files[0]}`, buf, 'store'); // JPEG 已压缩
          }
        }
      } catch { /* 无截屏也可出证 */ }

      // 2. PDF 报告
      const pdf = buildProofPdf({ meta, summary: sum, records: rows, screenshots });
      zip.addFile(`${reportId}.pdf`, pdf);

      // 3. 完整 JSON 元数据（含中文客户名/素材名）
      const jsonPayload = { ok: true, meta, summary: sum, records: rows };
      zip.addFile(`${reportId}.json`, JSON.stringify(jsonPayload, null, 2), 'deflate');

      // 4. 导出清单（manifest）
      const manifest = {
        reportId,
        generatedAt: new Date(generatedAt).toISOString(),
        format: 'LumaSign PlayProof v1',
        files: [`${reportId}.pdf`, `${reportId}.json`],
        screenshots: screenshots.length,
        recordCount: rows.length,
        hash,
        filter,
        _note: 'PDF 正文为 ASCII；完整中文元数据见同目录 .json 文件；截图 JPEG 含原始画面作为视觉证据',
      };
      zip.addFile('manifest.json', JSON.stringify(manifest, null, 2), 'deflate');

      const zipBuf = zip.toBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${reportId}.zip"`);
      res.setHeader('Content-Length', zipBuf.length);
      return res.end(zipBuf);
    }

    // PDF：收集最多 9 张最新截屏（每终端取最新一张）
    const screenshots = [];
    try {
      const termIds = [...new Set(rows.map(r => r.terminalId))].slice(0, 9);
      for (const tid of termIds) {
        const dir = path.join(paths.shots, tid);
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(f => /\.jpe?g$/i.test(f)).sort((a, b) => b.localeCompare(a));
        if (!files.length) continue;
        const fp = path.join(dir, files[0]);
        const buf = fs.readFileSync(fp);
        const sz = jpegSize(buf);
        if (sz) screenshots.push({ buf, w: sz.w, h: sz.h, label: tid });
      }
    } catch { /* 无截屏也可出证 */ }

    const pdf = buildProofPdf({ meta, summary: sum, records: rows, screenshots });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportId}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }));
}
