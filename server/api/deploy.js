/**
 * 灵屏 LumaSign · 下发版本管理 API（一键回滚 + 灰度下发）
 *
 * 路由（需登录）：
 *   GET  /api/deploy/versions          版本列表（?scheduleId=&layoutId=）
 *   GET  /api/deploy/versions/:id      版本详情
 *   POST /api/deploy/rollback          一键回滚到某版本 { versionId }
 *   POST /api/deploy/promote           灰度试点转全量 { versionId }
 *   POST /api/deploy/retry             对某一版本的目标终端重推 { versionId }
 *
 * 权限：version 查看需 schedule:view；回滚/推广/重试需 schedule:publish。
 */
import { json, fail, readJson } from '../lib/http.js';
import { DEPLOY_MODE } from '../lib/deploy.js';

export function registerDeployApi(router, ctx) {
  const { auth, deploy } = ctx;
  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };
  const body = async (req) => { try { return await readJson(req); } catch { return {}; } };

  router.get('/api/deploy/versions', guard('schedule:view', async (req, res, p, url) => {
    const scheduleId = url.searchParams.get('scheduleId') || undefined;
    const layoutId = url.searchParams.get('layoutId') || undefined;
    const items = deploy.list({ scheduleId, layoutId });
    return json(res, { ok: true, items });
  }));

  router.get('/api/deploy/versions/:id', guard('schedule:view', async (req, res, { id }) => {
    const v = deploy.get(id);
    if (!v) return fail(res, '版本不存在', 404);
    return json(res, { ok: true, item: v });
  }));

  router.post('/api/deploy/rollback', guard('schedule:publish', async (req, res, p, u, user) => {
    const b = await body(req);
    if (!b.versionId) return fail(res, '请提供要回滚到的版本ID');
    const r = deploy.rollback(b.versionId, user.username);
    if (!r.ok) return fail(res, r.error || '回滚失败');
    return json(res, { ok: true, pushed: r.pushed, version: r.version });
  }));

  router.post('/api/deploy/promote', guard('schedule:publish', async (req, res, p, u, user) => {
    const b = await body(req);
    if (!b.versionId) return fail(res, '请提供试点版本ID');
    const r = deploy.promote(b.versionId, user.username);
    if (!r.ok) return fail(res, r.error || '推广失败');
    return json(res, { ok: true, pushed: r.pushed, version: r.version });
  }));

  router.post('/api/deploy/retry', guard('schedule:publish', async (req, res, p, u, user) => {
    const b = await body(req);
    const v = deploy.get(b.versionId);
    if (!v) return fail(res, '版本不存在', 404);
    const ids = deploy.pushTo(v.targets && v.targets.length ? v.targets : [], v.scheduleId);
    return json(res, { ok: true, pushed: ids });
  }));
}
