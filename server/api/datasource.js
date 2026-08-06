/**
 * 灵屏 LumaSign · 动态内容数据源 API（P1 数据驱动）
 *
 * 管理端（需 datasource:view / datasource:manage）：
 *   GET    /api/admin/datasources           列表
 *   POST   /api/admin/datasources           创建
 *   PUT    /api/admin/datasources/:id        更新
 *   DELETE /api/admin/datasources/:id        删除
 *   POST   /api/admin/datasources/:id/refresh 预览 + 立即刷新
 *   GET    /api/admin/datasources/:id/data    读取缓存数据（编辑器预览）
 *
 * 播放端（终端鉴权，不暴露外网 token）：
 *   GET    /api/t/datasource/:id             拉取缓存数据
 */
import { json, fail, readJson } from '../lib/http.js';
import { uid } from '../lib/store.js';
import { listDataSources, previewDataSource } from '../lib/datasource.js';

const DEFAULT_REFRESH = 60;

export function registerDataSourceApi(router, ctx) {
  const S = n => ctx.store.col(n);
  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = ctx.auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !ctx.auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };
  const authTerminal = (req, url, body) => {
    const id = body?.terminalId || url.searchParams.get('terminalId') || req.headers['x-terminal-id'];
    const token = body?.token || url.searchParams.get('token') || req.headers['x-terminal-token'];
    if (!id || !token) return null;
    const t = S('terminals').byId(id);
    if (!t || t.token !== token) return null;
    return t;
  };

  router.get('/api/admin/datasources', guard('datasource:view', (req, res) =>
    json(res, { ok: true, items: listDataSources(ctx) })));

  router.post('/api/admin/datasources', guard('datasource:manage', async (req, res) => {
    const b = await readJson(req);
    const ds = {
      id: uid('ds'), name: b.name || '未命名数据源', type: b.type || 'http-json',
      url: b.url || '', method: b.method || 'GET', headers: b.headers || {}, path: b.path || '',
      delimiter: b.delimiter || ',', auth: b.auth || '', basicUser: b.basicUser || '', basicPass: b.basicPass || '',
      refreshSec: Math.max(5, b.refreshSec || DEFAULT_REFRESH), timeoutSec: b.timeoutSec || 15,
      enabled: b.enabled !== false, status: 'idle', lastFetch: null, lastOk: null, lastError: '', createdAt: Date.now(),
    };
    S('datasources').insert(ds);
    json(res, { ok: true, item: ds });
  }));

  router.put('/api/admin/datasources/:id', guard('datasource:manage', async (req, res, { id }) => {
    const b = await readJson(req);
    const ds = S('datasources').byId(id);
    if (!ds) return fail(res, '数据源不存在', 404);
    const patch = {};
    for (const k of ['name', 'type', 'url', 'method', 'headers', 'path', 'delimiter', 'auth', 'basicUser', 'basicPass', 'refreshSec', 'timeoutSec', 'enabled']) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    if (patch.refreshSec != null) patch.refreshSec = Math.max(5, patch.refreshSec);
    S('datasources').update(id, patch);
    json(res, { ok: true, item: S('datasources').byId(id) });
  }));

  router.del('/api/admin/datasources/:id', guard('datasource:manage', (req, res, { id }) => {
    S('datasources').remove(id);
    json(res, { ok: true });
  }));

  router.post('/api/admin/datasources/:id/refresh', guard('datasource:manage', async (req, res, { id }) => {
    const ds = S('datasources').byId(id);
    if (!ds) return fail(res, '数据源不存在', 404);
    await ctx.dataManager.refresh(ds);
    const pv = await previewDataSource(ctx, ds);
    json(res, {
      ok: pv.ok, error: pv.error, tookMs: pv.tookMs, sampleStr: pv.sampleStr, sample: pv.sample,
      item: listDataSources(ctx).find(x => x.id === id),
    });
  }));

  router.get('/api/admin/datasources/:id/data', guard('datasource:view', (req, res, { id }) => {
    const ds = S('datasources').byId(id);
    if (!ds) return fail(res, '数据源不存在', 404);
    json(res, { ok: true, id, data: ds.data ?? null, fetchedAt: ds.lastFetch || null, status: ds.status || 'idle' });
  }));

  router.get('/api/t/datasource/:id', (req, res, params, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端鉴权失败', 401);
    const ds = S('datasources').byId(params.id);
    if (!ds) return fail(res, '数据源不存在', 404);
    json(res, { ok: true, id: ds.id, data: ds.data ?? null, fetchedAt: ds.lastFetch || null, status: ds.status || 'idle' });
  });
}
