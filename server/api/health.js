/**
 * 灵屏 LumaSign · 终端健康度 API（P0-3）
 */
import { json, fail, readJson } from '../lib/http.js';
import { computeHealth } from '../lib/health.js';

export function registerHealthApi(router, ctx) {
  const { store, auth, bus } = ctx;
  const S = n => store.col(n);
  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };

  /** 全局健康概览：平均分、各档位数量、每终端简报 */
  router.get('/api/admin/health/summary', guard('terminal:view', (req, res) =>
    json(res, ctx.health.summary())));

  /** 健康阈值配置（必须注册在 /:id 之前，否则会被 :id 抢匹配） */
  router.get('/api/admin/health/config', guard('system:setting', (req, res) =>
    json(res, { ok: true, config: ctx.health.cfg() })));
  router.post('/api/admin/health/config', guard('system:setting', async (req, res) => {
    const b = await readJson(req);
    const before = (S('settings').byId('settings') || {}).health || {};
    const patch = {};
    for (const k of ['storageWarn', 'storageCrit', 'tempWarn', 'tempCrit', 'cpuWarn', 'cpuCrit',
      'memWarn', 'memCrit', 'latWarn', 'latCrit', 'crashWarn', 'crashCrit']) {
      if (typeof b[k] === 'number' && b[k] >= 0) patch[k] = b[k];
    }
    S('settings').update('settings', { health: { ...before, ...patch } });
    json(res, { ok: true, config: ctx.health.cfg() });
  }));

  /** 单终端健康详情 + 历史采样 */
  router.get('/api/admin/health/:id', guard('terminal:view', (req, res, { id }) => {
    const t = S('terminals').byId(id);
    if (!t) return fail(res, '终端不存在', 404);
    const cfg = ctx.health.cfg();
    const health = computeHealth(t, cfg, Date.now());
    json(res, { ok: true, terminal: { id: t.id, name: t.name }, health, history: ctx.health.historyOf(id), cfg });
  }));

  /** 手动下发清理缓存指令 */
  router.post('/api/admin/health/:id/cleanup', guard('terminal:upgrade', (req, res, { id }) => {
    const t = S('terminals').byId(id);
    if (!t) return fail(res, '终端不存在', 404);
    bus.send(id, 'clear_cache', {}, { ack: false });
    json(res, { ok: true, message: `已向 ${t.name || id} 下发清理缓存指令` });
  }));
}
