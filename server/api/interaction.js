/**
 * 灵屏 LumaSign · 交互埋点 API（P1 交互式节目）
 *
 * 播放端上报（局域网内，基础字段校验 + 全局 ApiGuard 限速）：
 *   POST /api/interaction             上报一次交互事件 { layoutId, itemId, type, terminalId }
 *
 * 管理端：
 *   GET  /api/admin/interactions                聚合列表（?layoutId=&type=）
 *   POST /api/admin/interactions/reset          清空（?layoutId=&itemId=&type=）
 */
import { json, fail, readJson } from '../lib/http.js';
import { record, report, reset } from '../lib/interaction.js';

export function registerInteractionApi(router, ctx) {
  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = ctx.auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !ctx.auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };

  // 播放端上报：无需管理员会话（终端在局域网内），但仍受全局限速 + 字段校验约束
  router.post('/api/interaction', async (req, res) => {
    let body; try { body = await readJson(req); } catch { return fail(res, '无效请求体', 400); }
    if (!body || !body.layoutId || !body.type) return fail(res, '缺少 layoutId 或 type', 400);
    const ok = record(ctx, {
      layoutId: String(body.layoutId),
      itemId: body.itemId ? String(body.itemId) : '',
      type: String(body.type).slice(0, 32),
      terminalId: body.terminalId ? String(body.terminalId)
        : (req.headers['x-terminal-id'] ? String(req.headers['x-terminal-id']) : ''),
    });
    return json(res, { ok: !!ok });
  });

  router.get('/api/admin/interactions', guard('layout:view', (req, res, params, url) =>
    json(res, {
      ok: true,
      items: report(ctx, {
        layoutId: url.searchParams.get('layoutId') || undefined,
        type: url.searchParams.get('type') || undefined,
      }),
    })));

  router.post('/api/admin/interactions/reset', guard('layout:manage', async (req, res) => {
    let body = {}; try { body = await readJson(req); } catch {}
    reset(ctx, { layoutId: body.layoutId, itemId: body.itemId, type: body.type });
    return json(res, { ok: true });
  }));
}
