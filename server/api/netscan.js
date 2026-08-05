/**
 * 灵屏 LumaSign · 局域网扫描 / 设备台账 API
 *
 * 与旧 fleet API 的区别：
 *   fleet  = 「给我一串 IP，我逐个探一下」——一次性、无状态、无进度
 *   netscan = 「这个网络里到底有什么」——自动巡检 + 持久台账 + 进度回传 + 差异告警
 *
 * 路由一览（全部需登录）：
 *   GET  /api/admin/scan/networks    本机可扫网段（前端自动填充，不用手输）
 *   POST /api/admin/scan/run         触发一次扫描（异步返回，进度经 SSE / 轮询）
 *   GET  /api/admin/scan/progress    进度轮询（SSE 不可用时降级）
 *   POST /api/admin/scan/cancel      取消当前扫描
 *   GET  /api/admin/scan/summary     台账汇总（分类计数 + 未确认数 + 配置）
 *   GET  /api/admin/scan/devices     台账列表（可按类型/状态/关键词过滤）
 *   POST /api/admin/scan/ack         确认设备（消除新设备告警）
 *   POST /api/admin/scan/annotate    人工标注类型/名称/备注
 *   POST /api/admin/scan/forget      删除台账记录
 *   POST /api/admin/scan/prune       清理长期失联记录
 *   GET  /api/admin/scan/config      读取自动巡检配置
 *   POST /api/admin/scan/config      保存自动巡检配置
 *   POST /api/admin/scan/probe       单机深度探测（不落台账，用于确认某台设备）
 *
 * 权限：查看类需 terminal:view；写入/配置类需 terminal:upgrade。
 */
import { json, fail, readJson } from '../lib/http.js';
import {
  localNetworks, scanNetwork, adbHandshake, vendorOfMac, readArpTable, DEVICE_KINDS,
} from '../lib/netscan.js';

export function registerNetscanApi(router, ctx) {
  const { auth, inventory, logger } = ctx;

  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };

  const body = async (req) => { try { return await readJson(req); } catch { return {}; } };

  /* ══════════ 网段发现 ══════════ */

  router.get('/api/admin/scan/networks', guard('terminal:view', async (req, res) => {
    const nets = localNetworks();
    return json(res, {
      ok: true,
      networks: nets,
      // 推荐默认：第一个可扫描网段
      recommended: nets.find(n => n.scannable)?.subnet || '',
      kinds: DEVICE_KINDS,
    });
  }));

  /* ══════════ 扫描执行 ══════════ */

  router.post('/api/admin/scan/run', guard('terminal:view', async (req, res, p, u, user) => {
    if (inventory.running) return fail(res, '已有扫描任务正在进行，请稍候', 409);
    const b = await body(req);

    let spec = null;
    if (b.targets?.length || b.subnet || b.cidr) {
      spec = {
        targets: Array.isArray(b.targets) ? b.targets.slice(0, 1024) : [],
        subnet: b.subnet || '',
        cidr: b.cidr || '',
        start: Math.max(1, Math.min(254, +b.start || 1)),
        end: Math.max(1, Math.min(254, +b.end || 254)),
      };
    }

    // 立即返回，扫描在后台跑；前端用 SSE(scan_progress) 或轮询 /progress 追踪
    inventory.runScan({ reason: 'manual', spec, user })
      .catch(e => logger.system({ event: 'scan_error', message: e.message }));

    return json(res, { ok: true, started: true, spec: spec || '（自动：本机主网段）' });
  }));

  router.get('/api/admin/scan/progress', guard('terminal:view', async (req, res) => {
    return json(res, { ok: true, ...inventory.progress() });
  }));

  router.post('/api/admin/scan/cancel', guard('terminal:view', async (req, res) => {
    const done = inventory.cancel();
    return json(res, { ok: true, cancelled: done });
  }));

  /* ══════════ 台账 ══════════ */

  router.get('/api/admin/scan/summary', guard('terminal:view', async (req, res) => {
    return json(res, { ok: true, ...inventory.summary() });
  }));

  router.get('/api/admin/scan/devices', guard('terminal:view', async (req, res, p, url) => {
    const q = url.searchParams;
    const items = inventory.list({
      kind: q.get('kind') || '',
      status: q.get('status') || '',
      unacknowledged: q.get('unack') === '1',
      q: q.get('q') || '',
    });
    return json(res, { ok: true, count: items.length, items, kinds: DEVICE_KINDS });
  }));

  router.post('/api/admin/scan/ack', guard('terminal:upgrade', async (req, res, p, u, user) => {
    const b = await body(req);
    const n = b.all ? inventory.acknowledgeAll() : inventory.acknowledge(b.ids || []);
    logger.audit({ userId: user.id, username: user.username, action: 'net_device_ack', target: `确认 ${n} 台设备` });
    return json(res, { ok: true, count: n });
  }));

  router.post('/api/admin/scan/annotate', guard('terminal:upgrade', async (req, res, p, u, user) => {
    const b = await body(req);
    if (!b.id) return fail(res, '缺少设备 id');
    const row = inventory.annotate(b.id, { tag: b.tag, note: b.note, name: b.name });
    if (!row) return fail(res, '设备记录不存在', 404);
    logger.audit({
      userId: user.id, username: user.username, action: 'net_device_annotate',
      target: `标注 ${row.ip}：类型=${row.tag || '(自动)'} 名称=${row.name || '-'}`,
    });
    return json(res, { ok: true, item: row });
  }));

  router.post('/api/admin/scan/forget', guard('terminal:upgrade', async (req, res, p, u, user) => {
    const b = await body(req);
    const ids = b.ids || (b.id ? [b.id] : []);
    let n = 0;
    for (const id of ids) if (inventory.forget(id)) n++;
    logger.audit({ userId: user.id, username: user.username, action: 'net_device_forget', target: `移除 ${n} 条台账记录` });
    return json(res, { ok: true, count: n });
  }));

  router.post('/api/admin/scan/prune', guard('terminal:upgrade', async (req, res, p, u, user) => {
    const b = await body(req);
    const n = inventory.prune(Math.max(1, +b.days || 30));
    logger.audit({ userId: user.id, username: user.username, action: 'net_device_prune', target: `清理 ${n} 条失联记录` });
    return json(res, { ok: true, count: n });
  }));

  /* ══════════ 自动巡检配置 ══════════ */

  router.get('/api/admin/scan/config', guard('terminal:view', async (req, res) => {
    return json(res, { ok: true, config: inventory.getConfig(), networks: localNetworks() });
  }));

  router.post('/api/admin/scan/config', guard('terminal:upgrade', async (req, res, p, u, user) => {
    const b = await body(req);
    const before = inventory.getConfig();
    const after = inventory.setConfig({
      enabled: !!b.enabled,
      intervalMin: b.intervalMin,
      subnet: b.subnet || '',
      start: b.start, end: b.end,
      alertOnNew: b.alertOnNew !== false,
      missThreshold: b.missThreshold,
      quietHours: b.quietHours || '',
    });
    logger.change(user, 'net_scan_config', '自动巡检配置', before, after, req);
    return json(res, { ok: true, config: after });
  }));

  /* ══════════ 单机深度探测 ══════════ */

  router.post('/api/admin/scan/probe', guard('terminal:view', async (req, res) => {
    const b = await body(req);
    const ip = String(b.ip || '').trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return fail(res, '请提供合法 IP');

    const { items } = await scanNetwork({ targets: [ip] }, { store: ctx.store, deep: true });
    const item = items[0] || null;
    if (!item) return json(res, { ok: true, alive: false, ip });

    // 补一次 ADB 握手细节（型号/序列号），这是判定「是不是安卓屏」最硬的证据
    const adb = item.adb || await adbHandshake(ip).catch(() => null);
    const arp = await readArpTable().catch(() => ({}));
    const mac = item.mac || arp[ip] || '';

    return json(res, {
      ok: true, alive: true,
      item: { ...item, adb, mac, vendor: item.vendor || vendorOfMac(mac) },
    });
  }));
}
