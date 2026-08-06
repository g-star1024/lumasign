/**
 * 灵屏 LumaSign · 远程开通（Fleet）API
 * 管理端「设备开通」页调用的后端：扫描已知 IP、探测设备、批量推送 APK。
 *
 * 权限：扫描需 terminal:view；开通/卸载/厂商探测需 terminal:upgrade。
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { json, fail, readJson } from '../lib/http.js';
import {
  scanTargets, adbInstall, adbUninstall, adbVersion, vendorPush, installAdb, resolveAdbPath,
} from '../lib/fleet.js';

export function registerFleetApi(router, ctx) {
  const { store, auth, paths, adbPath } = ctx;
  const S = n => store.col(n);

  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };

  /* 解析已上传的播放端 APK 物理路径 */
  const resolveApk = (apkId) => {
    const a = S('apks').byId(apkId);
    if (!a) return null;
    const fp = path.join(paths.apk, `${a.md5}.apk`);
    return existsSync(fp) ? fp : null;
  };

  /* adb 可用性（桌面端打包了 adb；纯 Node 运行则依赖 PATH 中的 adb；本机安装后优先用 desktop/adb） */
  router.get('/api/admin/fleet/adb', guard('terminal:upgrade', async (req, res) => {
    const real = resolveAdbPath(ctx);
    const v = await adbVersion(real);
    return json(res, { ok: true, available: v.available, path: real, output: v.output });
  }));

  /* 一键安装 ADB（服务端下载官方 platform-tools 到 desktop/adb） */
  router.post('/api/admin/fleet/install-adb', guard('terminal:upgrade', async (req, res) => {
    const r = await installAdb(ctx);
    return json(res, { ok: r.ok, available: r.ok, adbPath: r.adbPath, output: r.output, log: r.log });
  }));

  /* 扫描：支持显式 IP 列表 或 子网末段区间 */
  router.post('/api/admin/fleet/scan', guard('terminal:view', async (req, res) => {
    let body = {};
    try { body = await readJson(req); } catch { body = {}; }
    const { targets = [], subnet, start, end, ports } = body;
    const result = await scanTargets({ targets, subnet, start, end }, { ports, store });
    return json(res, { ok: true, count: result.length, items: result });
  }));

  /* 开通：把指定 APK 推送到某台设备 */
  router.post('/api/admin/fleet/provision', guard('terminal:upgrade', async (req, res) => {
    let body = {};
    try { body = await readJson(req); } catch { body = {}; }
    const { ip, method = 'adb', apkId } = body;
    if (!ip) return fail(res, '请提供设备 IP');
    const apk = resolveApk(apkId);
    if (!apk) return fail(res, '请先上传播放端 APK（管理端 → 终端 → APK 升级包）', 400);

    if (method === 'adb') {
      const r = await adbInstall(adbPath, ip, apk);
      return json(res, { ok: r.ok, stage: r.stage, output: r.output, ip, method });
    }
    if (method === 'vendor') {
      const r = await vendorPush(ip, apk);
      return json(res, { ok: r.ok, output: r.output, probe: r.probe, ip, method });
    }
    return fail(res, '未知的开通方式', 400);
  }));

  /* 仅探测厂商 Web 升级端点（不安装），用于确认协议 */
  router.post('/api/admin/fleet/vendor-probe', guard('terminal:upgrade', async (req, res) => {
    let body = {};
    try { body = await readJson(req); } catch { body = {}; }
    const { ip } = body;
    if (!ip) return fail(res, '请提供设备 IP');
    const r = await vendorPush(ip, null);
    return json(res, { ok: true, probe: r.probe, output: r.output, ip });
  }));

  /* 卸载旧播放端（谨慎使用） */
  router.post('/api/admin/fleet/uninstall', guard('terminal:upgrade', async (req, res) => {
    let body = {};
    try { body = await readJson(req); } catch { body = {}; }
    const { ip, pkg } = body;
    if (!ip || !pkg) return fail(res, '请提供 ip 与包名');
    const r = await adbUninstall(adbPath, ip, pkg);
    return json(res, { ok: r.ok, output: r.output, ip, pkg });
  }));
}
