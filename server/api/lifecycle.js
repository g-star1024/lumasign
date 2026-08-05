/**
 * 灵屏 LumaSign · 内容生命周期 API（有效期与自动下线）
 *
 * 路由一览（全部需登录）：
 *   GET  /api/admin/lifecycle/summary        概览（分桶计数 + 待处理清单 + 配置）
 *   GET  /api/admin/lifecycle/items          明细列表（?type=&state=&q=）
 *   POST /api/admin/lifecycle/set            设置有效期 { type, id, validFrom, validUntil }
 *   POST /api/admin/lifecycle/bulk           批量设置 { type, ids:[], validFrom, validUntil }
 *   POST /api/admin/lifecycle/archive        归档 { type, id }
 *   POST /api/admin/lifecycle/restore        恢复（可同时顺延有效期）{ type, id, validUntil }
 *   POST /api/admin/lifecycle/sweep          立即巡检一次
 *   GET  /api/admin/lifecycle/config         读配置
 *   POST /api/admin/lifecycle/config         写配置
 *
 * 权限：查看需 media:view；写入需 media:upload（节目/排期同样归入内容运营范畴）。
 */
import { json, fail, readJson } from '../lib/http.js';
import { LC_TYPES, LC_STATE, LC_DEFAULTS, parseWhen, validityOf, lcTypeLabel } from '../lib/lifecycle.js';

export function registerLifecycleApi(router, ctx) {
  const { auth, store, logger, lifecycle, bus } = ctx;
  const S = n => store.col(n);

  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };
  const body = async (req) => { try { return await readJson(req); } catch { return {}; } };

  /** 定位目标文档，顺带做类型白名单校验 —— 不能让人拿这个接口去改任意集合 */
  function locate(type, id) {
    if (!LC_TYPES.includes(type)) return { err: `不支持的类型：${type}` };
    const col = S(type);
    const doc = col.byId(id);
    if (!doc) return { err: `${lcTypeLabel(type)}不存在` };
    return { col, doc };
  }

  /** 校验并归一化有效期入参 */
  function normalize(b) {
    const hasFrom = Object.prototype.hasOwnProperty.call(b, 'validFrom');
    const hasUntil = Object.prototype.hasOwnProperty.call(b, 'validUntil');
    const patch = {};
    if (hasFrom) patch.validFrom = b.validFrom || null;
    if (hasUntil) patch.validUntil = b.validUntil || null;

    const f = parseWhen(patch.validFrom, false);
    const u = parseWhen(patch.validUntil, true);
    if (hasFrom && patch.validFrom && f == null) return { err: '生效时间格式无法识别（建议 YYYY-MM-DD）' };
    if (hasUntil && patch.validUntil && u == null) return { err: '失效时间格式无法识别（建议 YYYY-MM-DD）' };
    if (f != null && u != null && u < f) return { err: '失效时间不能早于生效时间' };
    return { patch, from: f, until: u };
  }

  /** 有效期一改，清单就变了，得让终端重新拉 */
  function resync(reason) {
    try {
      const ids = S('terminals').all().filter(t => t.approved).map(t => t.id);
      if (ids.length) bus.broadcast(ids, 'sync_manifest', { reason }, { ack: false });
      bus.broadcastAdmin('lifecycle:changed', { reason });
      return ids.length;
    } catch { return 0; }
  }

  /* ══════════ 概览与列表 ══════════ */

  router.get('/api/admin/lifecycle/summary', guard('media:view', async (req, res) => {
    return json(res, { ok: true, ...lifecycle.summary() });
  }));

  router.get('/api/admin/lifecycle/items', guard('media:view', async (req, res, p, url) => {
    const type = url.searchParams.get('type') || '';
    const state = url.searchParams.get('state') || '';
    const q = url.searchParams.get('q') || '';
    const items = lifecycle.list({ type, state, q });
    return json(res, { ok: true, items, total: items.length, states: Object.values(LC_STATE) });
  }));

  /* ══════════ 设置有效期 ══════════ */

  router.post('/api/admin/lifecycle/set', guard('media:upload', async (req, res, p, u, user) => {
    const b = await body(req);
    const loc = locate(b.type, b.id);
    if (loc.err) return fail(res, loc.err, 404);
    const n = normalize(b);
    if (n.err) return fail(res, n.err);

    const before = { validFrom: loc.doc.validFrom || null, validUntil: loc.doc.validUntil || null };
    // 改了有效期就把旧的过期/归档标记清掉，否则改完还是不播，运营会疯
    const lc = { ...(loc.doc.lifecycle || {}) };
    delete lc.expiredAt; delete lc.archived; delete lc.archivedAt; delete lc.archivedBy;
    const row = loc.col.update(b.id, { ...n.patch, lifecycle: lc });

    logger.change(user, 'lifecycle_set', b.id, before, { type: b.type, ...n.patch }, req);
    const pushed = resync('lifecycle_set');
    return json(res, { ok: true, item: brief(b.type, row), pushed });
  }));

  router.post('/api/admin/lifecycle/bulk', guard('media:upload', async (req, res, p, u, user) => {
    const b = await body(req);
    const ids = Array.isArray(b.ids) ? b.ids.slice(0, 500) : [];
    if (!ids.length) return fail(res, '未选择任何对象');
    if (!LC_TYPES.includes(b.type)) return fail(res, `不支持的类型：${b.type}`);
    const n = normalize(b);
    if (n.err) return fail(res, n.err);

    const col = S(b.type);
    let done = 0;
    for (const id of ids) {
      const doc = col.byId(id);
      if (!doc) continue;
      const lc = { ...(doc.lifecycle || {}) };
      delete lc.expiredAt; delete lc.archived; delete lc.archivedAt; delete lc.archivedBy;
      col.update(id, { ...n.patch, lifecycle: lc });
      done++;
    }
    logger.audit({
      action: 'lifecycle_bulk', userId: user.id, username: user.username,
      type: b.type, count: done, validFrom: n.patch.validFrom, validUntil: n.patch.validUntil,
    });
    const pushed = resync('lifecycle_bulk');
    return json(res, { ok: true, updated: done, pushed });
  }));

  /* ══════════ 归档 / 恢复 ══════════ */

  router.post('/api/admin/lifecycle/archive', guard('media:upload', async (req, res, p, u, user) => {
    const b = await body(req);
    const loc = locate(b.type, b.id);
    if (loc.err) return fail(res, loc.err, 404);
    const patch = {
      lifecycle: { ...(loc.doc.lifecycle || {}), archived: true, archivedAt: Date.now(), archivedBy: user.username },
    };
    if (b.type === 'schedules') patch.enabled = false;
    loc.col.update(b.id, patch);
    logger.audit({ action: 'lifecycle_archive', userId: user.id, username: user.username, target: b.id, type: b.type, name: loc.doc.name });
    const pushed = resync('lifecycle_archive');
    return json(res, { ok: true, pushed });
  }));

  router.post('/api/admin/lifecycle/restore', guard('media:upload', async (req, res, p, u, user) => {
    const b = await body(req);
    const loc = locate(b.type, b.id);
    if (loc.err) return fail(res, loc.err, 404);

    const patch = { lifecycle: { ...(loc.doc.lifecycle || {}) } };
    delete patch.lifecycle.archived; delete patch.lifecycle.archivedAt;
    delete patch.lifecycle.archivedBy; delete patch.lifecycle.expiredAt;

    // 恢复时通常要顺延有效期，否则恢复完还是过期状态
    if (b.validUntil !== undefined) {
      const n = normalize({ validUntil: b.validUntil, validFrom: b.validFrom });
      if (n.err) return fail(res, n.err);
      Object.assign(patch, n.patch);
    }
    const row = loc.col.update(b.id, patch);
    const v = validityOf(row);
    logger.audit({ action: 'lifecycle_restore', userId: user.id, username: user.username, target: b.id, type: b.type, name: loc.doc.name, state: v.state });
    const pushed = resync('lifecycle_restore');
    return json(res, {
      ok: true, item: brief(b.type, row), state: v.state, pushed,
      warn: v.state === LC_STATE.EXPIRED ? '已恢复归档，但有效期仍是过去时间，内容不会播出——请顺延失效日期' : null,
    });
  }));

  /* ══════════ 巡检与配置 ══════════ */

  router.post('/api/admin/lifecycle/sweep', guard('media:upload', async (req, res, p, u, user) => {
    const r = lifecycle.sweep();
    logger.audit({ action: 'lifecycle_sweep', userId: user.id, username: user.username, scanned: r.scanned, expired: r.expired.length });
    return json(res, { ok: true, ...r });
  }));

  router.get('/api/admin/lifecycle/config', guard('media:view', async (req, res) => {
    return json(res, { ok: true, config: lifecycle.cfg(), defaults: LC_DEFAULTS });
  }));

  router.post('/api/admin/lifecycle/config', guard('system:setting', async (req, res, p, u, user) => {
    const b = await body(req);
    const cur = lifecycle.cfg();
    const next = {
      enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled,
      warnDays: clamp(int(b.warnDays, cur.warnDays), 0, 90),
      sweepMinutes: clamp(int(b.sweepMinutes, cur.sweepMinutes), 1, 1440),
      autoArchive: b.autoArchive !== undefined ? !!b.autoArchive : cur.autoArchive,
      archiveGraceDays: clamp(int(b.archiveGraceDays, cur.archiveGraceDays), 0, 365),
    };
    S('settings').update('settings', { lifecycle: next });
    lifecycle.start();   // 间隔变了要重挂定时器
    logger.change(user, 'lifecycle_config', 'settings', cur, next, req);
    return json(res, { ok: true, config: next });
  }));

  /* ══════════ 工具 ══════════ */
  function brief(type, row) {
    const v = validityOf(row);
    return {
      type, id: row.id, name: row.name || row.id,
      validFrom: row.validFrom || null, validUntil: row.validUntil || null,
      state: v.state, from: v.from, until: v.until, daysLeft: v.daysLeft,
    };
  }
}

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
