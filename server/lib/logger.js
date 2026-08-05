/**
 * 灵屏 LumaSign · 日志
 * 三类分离，按天 JSONL 分片：
 *   audit  审计（谁 在何时 对什么 做了什么，含变更 diff）
 *   task   任务链路（下发 → 接收 → 播放）
 *   system 系统异常
 * 另含 Proof of Play 播放证明统计（E 版没有的增量能力）。
 */
import fs from 'node:fs';
import path from 'node:path';

const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export class Logger {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'logs');
    fs.mkdirSync(this.dir, { recursive: true });
    this.streams = new Map();
    this.buffer = [];
    setInterval(() => this.flush(), 1000).unref?.();
  }

  _write(kind, obj) {
    const rec = { ts: Date.now(), kind, ...obj };
    this.buffer.push(rec);
    if (this.buffer.length > 500) this.flush();
    return rec;
  }

  flush() {
    if (!this.buffer.length) return;
    const byFile = new Map();
    for (const r of this.buffer) {
      const f = path.join(this.dir, `${r.kind}-${dayKey(new Date(r.ts))}.jsonl`);
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(JSON.stringify(r));
    }
    this.buffer = [];
    for (const [f, lines] of byFile) {
      try { fs.appendFileSync(f, lines.join('\n') + '\n', 'utf8'); }
      catch (e) { console.error('[logger] 写日志失败:', e.message); }
    }
  }

  audit(o) { return this._write('audit', o); }
  task(o) { return this._write('task', o); }
  system(o) { return this._write('system', o); }
  play(o) { return this._write('play', o); }

  /** 记录带 diff 的变更审计 */
  change(user, action, target, before, after, req) {
    const diff = {};
    if (before && after) {
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (k === 'updatedAt') continue;
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) diff[k] = { from: before[k], to: after[k] };
      }
    }
    return this.audit({
      userId: user?.id, username: user?.username, action, target,
      diff: Object.keys(diff).length ? diff : undefined,
      ip: req?.socket?.remoteAddress,
    });
  }

  /** 读取指定类型 + 日期范围的日志（倒序） */
  query({ kind = 'audit', from, to, limit = 500, filter } = {}) {
    const files = fs.readdirSync(this.dir)
      .filter(f => f.startsWith(kind + '-') && f.endsWith('.jsonl'))
      .sort().reverse();
    const out = [];
    for (const f of files) {
      const day = f.slice(kind.length + 1, -6);
      if (from && day < from) continue;
      if (to && day > to) continue;
      let lines;
      try { lines = fs.readFileSync(path.join(this.dir, f), 'utf8').split('\n'); }
      catch { continue; }
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        if (!l) continue;
        let r; try { r = JSON.parse(l); } catch { continue; }
        if (filter && !filter(r)) continue;
        out.push(r);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** 播放证明报表：素材 × 终端 的播放次数与总时长 */
  proofOfPlay({ from, to, terminalId, mediaId } = {}) {
    const rows = this.query({
      kind: 'play', from, to, limit: 100000,
      filter: r => (!terminalId || r.terminalId === terminalId) && (!mediaId || r.mediaId === mediaId),
    });
    const agg = new Map();
    for (const r of rows) {
      const key = `${r.terminalId}|${r.mediaId || r.itemId}`;
      const a = agg.get(key) || {
        terminalId: r.terminalId, terminalName: r.terminalName,
        mediaId: r.mediaId, mediaName: r.mediaName,
        layoutName: r.layoutName, count: 0, seconds: 0, firstAt: r.ts, lastAt: r.ts,
      };
      a.count++; a.seconds += r.duration || 0;
      a.firstAt = Math.min(a.firstAt, r.ts); a.lastAt = Math.max(a.lastAt, r.ts);
      agg.set(key, a);
    }
    return [...agg.values()].sort((x, y) => y.seconds - x.seconds);
  }

  /** 清理 N 天前的日志 */
  purge(days = 180) {
    const cutoff = new Date(Date.now() - days * 86400000);
    const ck = dayKey(cutoff);
    let n = 0;
    for (const f of fs.readdirSync(this.dir)) {
      const m = /-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < ck) { try { fs.unlinkSync(path.join(this.dir, f)); n++; } catch {} }
    }
    return n;
  }
}
