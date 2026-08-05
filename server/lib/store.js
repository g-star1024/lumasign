/**
 * 灵屏 LumaSign · JSON 文档存储
 * 零依赖。内存索引 + 防抖原子写盘（tmp -> rename），进程退出前强制 flush。
 * 数据量级：≤50 终端场景下全量 < 5MB，完全够用。
 * 若未来需要迁移到 SQLite，只需替换本文件的实现，对外 API 保持不变。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FLUSH_DELAY = 300;

export function uid(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

export class Collection {
  constructor(dir, name, seed = []) {
    this.file = path.join(dir, `${name}.json`);
    this.name = name;
    this._timer = null;
    this._dirty = false;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.rows = JSON.parse(raw);
      if (!Array.isArray(this.rows)) this.rows = [];
    } catch {
      this.rows = structuredClone(seed);
      this._writeNow();
    }
    this._index = new Map();
    this._reindex();
  }

  _reindex() {
    this._index.clear();
    for (const r of this.rows) if (r && r.id) this._index.set(r.id, r);
  }

  _writeNow() {
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.rows, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    this._dirty = false;
  }

  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      try { this._writeNow(); } catch (e) { console.error(`[store] 写入 ${this.name} 失败:`, e.message); }
    }, FLUSH_DELAY);
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._dirty) { try { this._writeNow(); } catch {} }
  }

  all() { return this.rows; }
  byId(id) { return this._index.get(id) || null; }
  find(fn) { return this.rows.filter(fn); }
  findOne(fn) { return this.rows.find(fn) || null; }
  count(fn) { return fn ? this.rows.filter(fn).length : this.rows.length; }

  insert(doc) {
    if (!doc.id) doc.id = uid(this.name.slice(0, 1) + '_');
    doc.createdAt = doc.createdAt || Date.now();
    doc.updatedAt = doc.createdAt;
    this.rows.push(doc);
    this._index.set(doc.id, doc);
    this.save();
    return doc;
  }

  update(id, patch) {
    const row = this._index.get(id);
    if (!row) return null;
    Object.assign(row, patch, { id, updatedAt: Date.now() });
    this.save();
    return row;
  }

  /** 不刷新 updatedAt 的轻量写入（心跳等高频场景） */
  touch(id, patch) {
    const row = this._index.get(id);
    if (!row) return null;
    Object.assign(row, patch);
    this.save();
    return row;
  }

  remove(id) {
    const i = this.rows.findIndex(r => r.id === id);
    if (i < 0) return false;
    this.rows.splice(i, 1);
    this._index.delete(id);
    this.save();
    return true;
  }

  removeWhere(fn) {
    const before = this.rows.length;
    this.rows = this.rows.filter(r => !fn(r));
    this._reindex();
    if (this.rows.length !== before) this.save();
    return before - this.rows.length;
  }
}

export class Store {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'db');
    fs.mkdirSync(this.dir, { recursive: true });
    this.cols = new Map();
  }
  col(name, seed) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection(this.dir, name, seed));
    return this.cols.get(name);
  }
  flushAll() { for (const c of this.cols.values()) c.flush(); }
}
