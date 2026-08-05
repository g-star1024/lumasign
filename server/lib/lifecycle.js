/**
 * 灵屏 LumaSign · 内容生命周期（有效期与自动下线）
 *
 * 解决数字标牌最高频的运营事故：促销过期了，海报还挂在屏上。
 *
 * 设计要点：
 *  1. 三类对象都可设有效期：media（素材）/ layouts（节目）/ schedules（排期）
 *  2. 日期语义符合人的直觉：validUntil='2026-08-10' 表示「到 8月10日 23:59:59 为止仍有效」
 *  3. 服务端定时巡检 → 到期自动移出下发清单 + 归档 + 告警
 *  4. 清单里携带 validFrom/validUntil 绝对时间戳 → 终端断网时本地也能自行下线（关键兜底）
 *  5. 到期只归档不删除，可一键恢复（运营改个日期就能复用去年的春节海报）
 */

export const LC_STATE = {
  PENDING: 'pending',    // 未生效（还没到 validFrom）
  ACTIVE: 'active',      // 生效中
  EXPIRING: 'expiring',  // 生效中但即将到期（warnDays 内）
  EXPIRED: 'expired',    // 已过期
  ARCHIVED: 'archived',  // 已归档（人工或自动）
};

export const LC_TYPES = ['media', 'layouts', 'schedules'];

const DAY = 86400000;

/**
 * 解析有效期端点。
 * @param {*} v      number(ms) | 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:mm' | ISO 串 | null
 * @param {boolean} endOfDay  纯日期时是否取当日 23:59:59.999（validUntil 用）
 * @returns {number|null} 毫秒时间戳
 */
export function parseWhen(v, endOfDay = false) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;

  // 纯日期 YYYY-MM-DD → 本地时间的当日起点/终点
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return d.getTime();
  }
  // YYYY-MM-DDTHH:mm（本地时间，不带时区后缀）
  const m2 = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3], +m2[4], +m2[5], +(m2[6] || 0)).getTime();

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** 归一化文档上的有效期字段（容忍历史数据里各种写法） */
export function windowOf(doc) {
  if (!doc) return { from: null, until: null };
  return {
    from: parseWhen(doc.validFrom, false),
    // validTo 是历史字段名，老数据还在用，读的时候一并兼容
    until: parseWhen(doc.validUntil != null && doc.validUntil !== '' ? doc.validUntil : doc.validTo, true),
  };
}

/**
 * 计算某文档的生命周期状态。
 * @returns {{state:string, from:number|null, until:number|null, msLeft:number|null, daysLeft:number|null, archived:boolean}}
 */
export function validityOf(doc, now = Date.now(), warnDays = 3) {
  const { from, until } = windowOf(doc);
  const archived = !!(doc?.lifecycle?.archived);
  const base = { from, until, msLeft: null, daysLeft: null, archived };

  if (archived) return { ...base, state: LC_STATE.ARCHIVED };
  if (from != null && now < from) return { ...base, state: LC_STATE.PENDING };
  if (until != null && now > until) return { ...base, state: LC_STATE.EXPIRED };

  if (until != null) {
    const msLeft = until - now;
    const daysLeft = Math.floor(msLeft / DAY);
    const state = msLeft <= warnDays * DAY ? LC_STATE.EXPIRING : LC_STATE.ACTIVE;
    return { ...base, state, msLeft, daysLeft };
  }
  return { ...base, state: LC_STATE.ACTIVE };
}

/** 是否可播：未归档、已生效、未过期。无有效期 = 永久可播 */
export function isPlayable(doc, now = Date.now()) {
  const st = validityOf(doc, now, 0).state;
  return st === LC_STATE.ACTIVE || st === LC_STATE.EXPIRING;
}

/** 供下发清单携带的紧凑有效期（绝对毫秒时间戳，终端断网也能判） */
export function windowForManifest(doc) {
  const { from, until } = windowOf(doc);
  return (from == null && until == null) ? null : { from, until };
}

export const LC_DEFAULTS = {
  enabled: true,
  warnDays: 3,          // 到期前几天开始提醒
  sweepMinutes: 10,     // 巡检间隔
  autoArchive: true,    // 过期后自动归档（不删除）
  archiveGraceDays: 0,  // 过期后再等几天才归档，0=立即
};

/* ============================================================
 *  巡检调度器
 * ============================================================ */
export class Lifecycle {
  constructor(ctx) {
    this.ctx = ctx;
    this._timer = null;
    this._lastSweep = 0;
    this._warned = new Map();   // `${type}:${id}` -> 上次提醒时间，避免刷屏
  }

  cfg() {
    const s = this.ctx.store.col('settings').byId('settings') || {};
    return { ...LC_DEFAULTS, ...(s.lifecycle || {}) };
  }

  start() {
    this.stop();
    const c = this.cfg();
    if (!c.enabled) return;
    // 启动 20 秒后先扫一次，避开启动风暴
    setTimeout(() => { try { this.sweep(); } catch { /* ignore */ } }, 20000);
    this._timer = setInterval(() => {
      try { this.sweep(); } catch (e) { this.ctx.logger?.system?.({ event: 'lifecycle_sweep_error', error: e.message }); }
    }, Math.max(1, c.sweepMinutes) * 60000);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  /**
   * 一轮巡检：标记过期、归档、告警、推送清单。
   * @returns {{scanned:number, expired:Array, expiring:Array, archived:number, pushed:number}}
   */
  sweep(now = Date.now()) {
    const c = this.cfg();
    const { store, logger, bus } = this.ctx;
    const out = { scanned: 0, expired: [], expiring: [], archived: 0, pushed: 0, at: now };
    if (!c.enabled) return out;

    let dirty = false;

    for (const type of LC_TYPES) {
      const col = store.col(type);
      for (const doc of col.all()) {
        out.scanned++;
        const v = validityOf(doc, now, c.warnDays);

        if (v.state === LC_STATE.EXPIRED) {
          const already = doc.lifecycle?.expiredAt;
          if (!already) {
            const patch = { lifecycle: { ...(doc.lifecycle || {}), expiredAt: now } };
            // 过期即下线：排期直接停用，避免任何残留下发
            if (type === 'schedules' && doc.enabled !== false) patch.enabled = false;
            col.touch(doc.id, patch);
            dirty = true;
            out.expired.push({ type, id: doc.id, name: doc.name || doc.id, until: v.until });
            logger?.audit?.({
              action: 'lifecycle_expired', userId: 'system', username: 'system',
              target: doc.id, type, name: doc.name || doc.id, validUntil: v.until,
            });
            this._alert('warn', 'content_expired', `内容已到期自动下线`,
              `${typeLabel(type)}「${doc.name || doc.id}」有效期至 ${fmt(v.until)}，已自动停止播放`);
          }
          // 归档（可设宽限期）
          if (c.autoArchive && !doc.lifecycle?.archived) {
            const expiredAt = doc.lifecycle?.expiredAt || now;
            if (now - expiredAt >= (c.archiveGraceDays || 0) * DAY) {
              col.touch(doc.id, { lifecycle: { ...(doc.lifecycle || {}), expiredAt, archived: true, archivedAt: now, archivedBy: 'system' } });
              out.archived++;
              dirty = true;
            }
          }
        } else if (v.state === LC_STATE.EXPIRING) {
          out.expiring.push({ type, id: doc.id, name: doc.name || doc.id, until: v.until, daysLeft: v.daysLeft });
          const key = `${type}:${doc.id}`;
          const last = this._warned.get(key) || 0;
          if (now - last > 12 * 3600000) {         // 同一对象 12 小时最多提醒一次
            this._warned.set(key, now);
            this._alert('info', 'content_expiring', '内容即将到期',
              `${typeLabel(type)}「${doc.name || doc.id}」将于 ${fmt(v.until)} 到期（剩余 ${Math.max(0, v.daysLeft)} 天）`);
          }
        } else if (doc.lifecycle?.expiredAt && v.state !== LC_STATE.ARCHIVED) {
          // 有效期被人往后改了 → 清掉过期标记，重新上线
          const lc = { ...doc.lifecycle };
          delete lc.expiredAt;
          col.touch(doc.id, { lifecycle: lc });
          dirty = true;
        }
      }
    }

    this._lastSweep = now;
    if (dirty && bus) {
      try {
        bus.broadcastAdmin('lifecycle:changed', { expired: out.expired.length, expiring: out.expiring.length });
        out.pushed = this._pushAll();
      } catch { /* ignore */ }
    }
    return out;
  }

  /** 内容下线后要让所有终端重新拉清单 */
  _pushAll() {
    const { store, bus } = this.ctx;
    if (!bus?.broadcast) return 0;
    const ids = store.col('terminals').all().filter(t => t.approved).map(t => t.id);
    if (!ids.length) return 0;
    bus.broadcast(ids, 'sync_manifest', { reason: 'lifecycle' }, { ack: false });
    return ids.length;
  }

  _alert(level, type, title, message) {
    const { store, bus } = this.ctx;
    try {
      const row = store.col('alerts').insert({
        id: 'al_' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16),
        level, type, title, message, resolved: false, createdAt: Date.now(),
      });
      bus?.broadcastAdmin?.('alert:new', row);
    } catch { /* ignore */ }
  }

  /** 概览：给仪表盘和有效期看板用 */
  summary(now = Date.now()) {
    const c = this.cfg();
    const buckets = { pending: 0, active: 0, expiring: 0, expired: 0, archived: 0, none: 0 };
    const items = [];
    for (const type of LC_TYPES) {
      for (const doc of this.ctx.store.col(type).all()) {
        const v = validityOf(doc, now, c.warnDays);
        const hasWindow = v.from != null || v.until != null;
        if (!hasWindow && !v.archived) { buckets.none++; continue; }
        buckets[v.state] = (buckets[v.state] || 0) + 1;
        if (v.state === LC_STATE.EXPIRING || v.state === LC_STATE.EXPIRED || v.state === LC_STATE.PENDING) {
          items.push({
            type, id: doc.id, name: doc.name || doc.id,
            state: v.state, from: v.from, until: v.until, daysLeft: v.daysLeft,
            archived: v.archived,
          });
        }
      }
    }
    items.sort((a, b) => (a.until || Infinity) - (b.until || Infinity));
    return { buckets, items: items.slice(0, 200), config: c, lastSweep: this._lastSweep, now };
  }

  /** 列表查询 */
  list({ type, state, q } = {}, now = Date.now()) {
    const c = this.cfg();
    const types = type && LC_TYPES.includes(type) ? [type] : LC_TYPES;
    const out = [];
    for (const tp of types) {
      for (const doc of this.ctx.store.col(tp).all()) {
        const v = validityOf(doc, now, c.warnDays);
        if (state && v.state !== state) continue;
        if (q && !String(doc.name || '').toLowerCase().includes(String(q).toLowerCase())) continue;
        out.push({
          type: tp, id: doc.id, name: doc.name || doc.id,
          state: v.state, from: v.from, until: v.until, daysLeft: v.daysLeft,
          archived: v.archived, enabled: doc.enabled !== false,
          updatedAt: doc.updatedAt || doc.createdAt || 0,
        });
      }
    }
    out.sort((a, b) => (a.until || Infinity) - (b.until || Infinity));
    return out;
  }
}

/* ================= 工具 ================= */
function typeLabel(t) {
  return t === 'media' ? '素材' : t === 'layouts' ? '节目' : t === 'schedules' ? '排期' : t;
}
function fmt(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export { typeLabel as lcTypeLabel, fmt as lcFormat };
