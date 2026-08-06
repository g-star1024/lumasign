/**
 * 灵屏 LumaSign · 动态内容数据源（P1 数据驱动）
 *
 * 支持两类数据源：
 *   - http-json：定时拉取 HTTP/JSON API，可选 JSONPath 提取子对象/数组
 *   - csv：定时拉取 CSV（远程 URL），解析为对象数组
 *
 * 设计原则：纯 Node 内置（全局 fetch / 零第三方），零依赖；
 *          拉取结果缓存到集合文档，播放端经终端鉴权端点读取缓存（不直连外网、不暴露 token）。
 */
const DEFAULT_REFRESH = 60;

function getCol(ctx) { return ctx.store.col('datasources'); }

/* ---------------- CSV 解析（支持引号转义、逗号/换行） ---------------- */
export function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(r => {
    const o = {};
    header.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
    return o;
  });
}

function pickPath(obj, path) {
  if (!path || !obj) return obj;
  return String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export async function fetchDataSource(ctx, ds) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), (ds.timeoutSec || 15) * 1000);
    const headers = { 'User-Agent': 'LumaSign-DS/1.0', ...(ds.headers || {}) };
    if (ds.auth === 'basic' && ds.basicUser) headers.Authorization = 'Basic ' + Buffer.from(ds.basicUser + ':' + (ds.basicPass || '')).toString('base64');
    const res = await fetch(ds.url, { method: ds.method || 'GET', headers, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let data;
    if (ds.type === 'csv') data = parseCsv(text, ds.delimiter || ',');
    else {
      const json = JSON.parse(text);
      data = pickPath(json, ds.path);
    }
    const took = Date.now() - started;
    return { ok: true, data, fetchedAt: Date.now(), tookMs: took };
  } catch (e) {
    return { ok: false, error: e.message || String(e), fetchedAt: Date.now() };
  }
}

export class DataSourceManager {
  constructor(ctx) { this.ctx = ctx; this.timer = null; }
  get col() { return getCol(this.ctx); }

  async refresh(ds) {
    const r = await fetchDataSource(this.ctx, ds);
    const patch = { lastFetch: r.fetchedAt, status: r.ok ? 'ok' : 'error', lastError: r.ok ? '' : r.error };
    if (r.ok) { patch.data = r.data; patch.lastOk = r.fetchedAt; patch.tookMs = r.tookMs; }
    this.col.update(ds.id, patch);
    return r;
  }

  async refreshAll() {
    const list = this.col.all();
    for (const ds of list) { if (ds.enabled !== false) await this.refresh(ds).catch(() => {}); }
  }

  start() {
    this.stop();
    this.refreshAll().catch(() => {});
    this.timer = setInterval(() => this.refreshAll().catch(() => {}), 30000);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

export function listDataSources(ctx) {
  return getCol(ctx).all().map(d => ({
    id: d.id, name: d.name, type: d.type, url: d.url, refreshSec: d.refreshSec || DEFAULT_REFRESH,
    enabled: d.enabled !== false, status: d.status || 'idle', lastFetch: d.lastFetch || null,
    lastError: d.lastError || '', lastOk: d.lastOk || null, tookMs: d.tookMs || null,
  }));
}

export async function previewDataSource(ctx, ds) {
  const r = await fetchDataSource(ctx, ds);
  let sample = r.data;
  let sampleStr = '';
  try { sampleStr = JSON.stringify(r.data, null, 2); } catch { sampleStr = String(r.data); }
  return { ok: r.ok, error: r.error || null, tookMs: r.tookMs, sample, sampleStr: sampleStr.slice(0, 4000) };
}
