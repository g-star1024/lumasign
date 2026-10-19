/**
 * 灵屏 LumaSign · 触拓(56iq) 兼容控制层 · 管理端 API
 * 路由前缀 /api/admin/siqian/*
 */
import { json, fail, readJson } from '../lib/http.js';

export function registerSiqianApi(router, ctx) {
  const { auth, bus } = ctx;
  const cms = ctx.siqian;            // SiqianCmsServer
  const client = ctx.siqianClient;  // SiqianPlayerClient
  const registry = ctx.siqianRegistry;

  const guard = (perm, handler) => async (req, res, params, url, user) => {
    const u = auth.userFromReq(req);
    if (!u) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(u, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, u);
  };

  /** 已登记的 56iq / 触拓 设备列表 */
  router.get('/api/admin/siqian/devices', guard('terminal:view', (req, res) =>
    json(res, { ok: true, devices: registry.all(), cmsPort: cms?.port, cmsEnabled: cms?.enabled })));

  /** 触发局域网发现广播（让 56iq 播放端自动注册到灵屏） */
  router.post('/api/admin/siqian/discover', guard('terminal:manage', async (req, res) => {
    const b = await readJson(req).catch(() => ({}));
    const r = await import('../lib/siqian.js').then(m => m.broadcastDiscovery(b));
    json(res, { ok: true, ...r });
  }));

  /** 单设备详情 */
  router.get('/api/admin/siqian/:id', guard('terminal:view', (req, res, { id }) => {
    const dev = registry.get(id);
    if (!dev) return fail(res, '设备不存在', 404);
    json(res, { ok: true, device: dev });
  }));

  /** 当前播放（直连播放端 OpenAPI） */
  router.get('/api/admin/siqian/:id/now', guard('terminal:view', async (req, res, { id }) => {
    const dev = registry.get(id);
    if (!dev) return fail(res, '设备不存在', 404);
    try { json(res, { ok: true, ip: id, now: await client.nowPlaying(id) }); }
    catch (e) { fail(res, `连接播放端失败：${e.message}`, 502); }
  }));

  /** 播放指定节目（直连） */
  router.post('/api/admin/siqian/:id/play', guard('schedule:publish', async (req, res, { id }) => {
    const dev = registry.get(id);
    if (!dev) return fail(res, '设备不存在', 404);
    const b = await readJson(req).catch(() => ({}));
    if (!b.programId) return fail(res, '缺少 programId', 400);
    try {
      const r = await client.play(id, b.programId, b.scene);
      json(res, { ok: true, device: id, result: r });
    } catch (e) { fail(res, `下发失败：${e.message}`, 502); }
  }));

  /** 设置音量（直连） */
  router.post('/api/admin/siqian/:id/volume', guard('terminal:upgrade', async (req, res, { id }) => {
    const dev = registry.get(id);
    if (!dev) return fail(res, '设备不存在', 404);
    const b = await readJson(req).catch(() => ({}));
    const v = Number(b.volume ?? b.value ?? b.v);
    if (!Number.isFinite(v) || v < 0 || v > 100) return fail(res, '音量需为 0-100', 400);
    try {
      const r = await client.setVolume(id, v);
      json(res, { ok: true, device: id, result: r });
    } catch (e) { fail(res, `下发失败：${e.message}`, 502); }
  }));

  /** 插播消息（直连） */
  router.post('/api/admin/siqian/:id/message', guard('schedule:publish', async (req, res, { id }) => {
    const dev = registry.get(id);
    if (!dev) return fail(res, '设备不存在', 404);
    const b = await readJson(req).catch(() => ({}));
    if (typeof b.msg !== 'string') return fail(res, '缺少 msg', 400);
    try {
      const r = await client.insertMessage(id, b.msg);
      json(res, { ok: true, device: id, result: r });
    } catch (e) { fail(res, `下发失败：${e.message}`, 502); }
  }));

  /** 手动登记一个已知 IP 的 56iq 播放端 */
  router.post('/api/admin/siqian/register', guard('terminal:manage', async (req, res) => {
    const b = await readJson(req).catch(() => ({}));
    if (!b.ip) return fail(res, '缺少 ip', 400);
    const dev = registry.upsert(b.ip, { name: b.name || b.ip, source: 'manual' });
    json(res, { ok: true, device: dev });
  }));

  /** 删除登记 */
  router.del('/api/admin/siqian/:id', guard('terminal:manage', (req, res, { id }) => {
    registry.remove(id);
    json(res, { ok: true, removed: id });
  }));
}
