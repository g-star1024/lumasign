/**
 * 灵屏 LumaSign · 触拓(56iq) 兼容控制层 · 管理端 API
 * 路由前缀 /api/admin/siqian/*
 *
 * 注意：具名路由（/settings、/deeplink、/discover、/register）必须注册在 /:id 之前，
 *       否则会被 /:id 抢匹配（参考 health.js 的同类坑）。
 */
import { json, fail, readJson } from '../lib/http.js';
import { execFile } from 'node:child_process';

export function registerSiqianApi(router, ctx) {
  const { auth } = ctx;
  const cms = ctx.siqian;            // SiqianCmsServer
  const client = ctx.siqianClient;  // SiqianPlayerClient
  const registry = ctx.siqianRegistry;
  const mapper = ctx.siqianMapper;  // SiqianProgramMapper
  const S = n => ctx.store.col(n);

  const guard = (perm, handler) => async (req, res, params, url, user) => {
    const u = auth.userFromReq(req);
    if (!u) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(u, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, u);
  };

  /** 构兼容模式深链：lumasync://config?server=<luma>&mode=siqian&cms=<cms>&code=&name= */
  const buildDeeplink = (req, term, mode) => {
    const host = String(req.headers.host || 'localhost');
    const hostOnly = host.split(':')[0];
    const s = S('settings').byId('settings') || {};
    const lumaBase = 'http://' + host;
    const cmsBase = s.siqianCms || ('http://' + hostOnly + ':' + (s.siqianPort || 8888));
    let link = 'lumasync://config?server=' + encodeURIComponent(lumaBase) + '&mode=' + encodeURIComponent(mode || 'siqian');
    if ((mode || 'siqian') === 'siqian') link += '&cms=' + encodeURIComponent(cmsBase);
    if (term?.code) link += '&code=' + encodeURIComponent(term.code);
    if (term?.name) link += '&name=' + encodeURIComponent(term.name);
    return { link, cmsBase, lumaBase };
  };

  /* ---------------- 兼容层设置（先于 /:id） ---------------- */
  router.get('/api/admin/siqian/settings', guard('system:setting', (req, res) => {
    const s = S('settings').byId('settings') || {};
    json(res, { ok: true, settings: {
      siqianEnabled: s.siqianEnabled !== false,
      siqianPort: s.siqianPort || 8888,
      siqianCms: s.siqianCms || '',
    }, cmsPort: cms?.port, cmsRunning: !!cms?.server });
  }));
  router.post('/api/admin/siqian/settings', guard('system:setting', async (req, res) => {
    const b = await readJson(req).catch(() => ({}));
    const cur = (S('settings').byId('settings') || {});
    const patch = {};
    if (typeof b.siqianEnabled === 'boolean') patch.siqianEnabled = b.siqianEnabled;
    if (b.siqianPort != null && Number.isFinite(Number(b.siqianPort)) && Number(b.siqianPort) > 0) patch.siqianPort = Number(b.siqianPort);
    if (typeof b.siqianCms === 'string') patch.siqianCms = b.siqianCms.trim();
    S('settings').update('settings', patch);
    json(res, { ok: true, settings: { ...cur, ...patch }, note: '端口/开关改动需重启服务端后生效' });
  }));

  /* ---------------- 生成兼容模式深链（先于 /:id） ---------------- */
  router.get('/api/admin/siqian/deeplink', guard('terminal:view', (req, res, p, url) => {
    const tid = url.searchParams.get('terminalId');
    const mode = url.searchParams.get('mode') || 'siqian';
    const term = tid ? S('terminals').byId(tid) : null;
    const { link, cmsBase, lumaBase } = buildDeeplink(req, term, mode);
    json(res, { ok: true, deeplink: link, cms: cmsBase, server: lumaBase, terminalId: tid || null });
  }));

  /* ---------------- 设备列表 / 发现 ---------------- */
  router.get('/api/admin/siqian/devices', guard('terminal:view', (req, res) =>
    json(res, { ok: true, devices: registry.all(), cmsPort: cms?.port, cmsEnabled: cms?.enabled })));

  router.post('/api/admin/siqian/discover', guard('terminal:manage', async (req, res) => {
    const b = await readJson(req).catch(() => ({}));
    const r = await import('../lib/siqian.js').then(m => m.broadcastDiscovery(b));
    json(res, { ok: true, ...r });
  }));

  /* ---------------- 单设备 ---------------- */
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

  /** 推送「56iq 兼容模式」到设备：经 adb 触发 lumasync 深链，设备即切模式 */
  router.post('/api/admin/siqian/:id/push-mode', guard('terminal:manage', async (req, res, { id }) => {
    const dev = registry.get(id);
    if (!dev) return fail(res, '设备不存在', 404);
    const b = await readJson(req).catch(() => ({}));
    const mode = b.mode || 'siqian';
    const term = mapper ? mapper._terminalByIp(id) : null;
    const { link } = buildDeeplink(req, term || { name: dev.name }, mode);
    const adb = ctx.adbPath || 'adb';
    const addr = id.indexOf(':') >= 0 ? id : (id + ':5555');
    const manual = `${adb} -s ${addr} shell am start -a android.intent.action.VIEW -d '${link}'`;
    execFile(adb, ['-s', addr, 'shell', `am start -a android.intent.action.VIEW -d '${link}'`], { timeout: 8000 },
      (err, stdout, stderr) => {
        if (err) return json(res, { ok: false, error: String(stderr || err.message).slice(0, 300), deeplink: link, manual });
        json(res, { ok: true, deeplink: link, output: String(stdout).slice(0, 400), manual });
      });
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
