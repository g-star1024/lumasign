/**
 * 灵屏 LumaSign · 终端侧 API（/api/t/*）
 * 设计原则：终端主动发起、纯 HTTP、幂等、可断点续传、离线可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { json, ok, fail, readJson, readBody, sendFile, sse, RateLimiter } from '../lib/http.js';
import { uid } from '../lib/store.js';
import { buildManifest, shouldBeOn } from '../lib/schedule.js';

export function registerTerminalApi(router, ctx) {
  const { store, bus, logger, paths } = ctx;
  const S = n => store.col(n);
  const settings = () => S('settings').byId('settings');
  const perTerm = new Map();   // terminalId -> RateLimiter

  /** 校验终端身份 */
  function authTerminal(req, url, body) {
    const id = body?.terminalId || url.searchParams.get('terminalId') || req.headers['x-terminal-id'];
    const token = body?.token || url.searchParams.get('token') || req.headers['x-terminal-token'];
    if (!id || !token) return null;
    const t = S('terminals').byId(id);
    if (!t || t.token !== token) return null;
    return t;
  }

  function limiterFor(id) {
    const kb = settings().perTerminalLimitKBps || 0;
    if (!kb) return ctx.limiter;
    if (!perTerm.has(id)) perTerm.set(id, new RateLimiter(kb * 1024));
    else perTerm.get(id).setRate(kb * 1024);
    return perTerm.get(id);
  }

  /* ---------------- 注册 ---------------- */
  router.post('/api/t/register', async (req, res) => {
    const b = await readJson(req);
    const mac = (b.mac || '').toUpperCase();
    if (!mac && !b.serial) return fail(res, '缺少设备唯一标识（mac 或 serial）');

    // 以 mac/serial 作为幂等键：重装 APK 不会产生重复终端
    let t = S('terminals').findOne(x =>
      (mac && (x.hardware?.mac || '').toUpperCase() === mac) ||
      (b.serial && x.hardware?.serial === b.serial));

    const hardware = {
      mac, serial: b.serial || '', model: b.model || '未知型号',
      androidVersion: b.androidVersion || '', firmware: b.firmware || '',
      resolution: b.resolution || '1920x1080',
      orientation: b.orientation || 'landscape',
      storageTotal: b.storageTotal || 0, storageFree: b.storageFree || 0,
    };
    const net = { ip: realIP(req), wifi: b.wifi || '', rssi: b.rssi ?? null };

    if (t) {
      S('terminals').update(t.id, { hardware, net, appVersion: b.appVersion || t.appVersion, lastHeartbeat: Date.now() });
    } else {
      // 终端授权上限拦截：0=无限制；>0 时达上限即拒绝新设备（已存在终端重连不受影响）
      const maxTerminals = settings().maxTerminals || 0;
      if (maxTerminals > 0 && S('terminals').count() >= maxTerminals) {
        return fail(res, `终端授权数量已达上限（${maxTerminals} 台），无法接入新设备`, 403);
      }
      const auto = settings().autoApproveTerminal;
      const seq = S('terminals').count() + 1;
      t = S('terminals').insert({
        id: uid('t_'),
        name: b.name || `新终端 ${String(seq).padStart(3, '0')}`,
        code: `LS-${String(seq).padStart(4, '0')}`,
        token: crypto.randomBytes(32).toString('hex'),
        orgId: 'org_root', groupIds: ['g_default'],
        approved: !!auto, hardware, net,
        appVersion: b.appVersion || '', lastHeartbeat: Date.now(),
        onlineSeconds: 0, volume: 60, powerSchedule: [],
        syncGroupId: null, videoWall: null, floorPlan: null,
        note: '', tags: [],
      });
      logger.audit({ action: 'terminal_register', target: t.id, mac, model: hardware.model, ip: net.ip });
      raiseAlert(store, bus, {
        level: 'info', type: 'terminal_new', terminalId: t.id,
        title: '发现新终端接入',
        message: `${t.name}（${hardware.model} · ${net.ip}）${auto ? '已自动准入' : '等待管理员批准'}`,
      });
    }
    bus.broadcastAdmin('terminal:update', { terminalId: t.id });
    ok(res, {
      terminalId: t.id, token: t.token, approved: !!t.approved,
      name: t.name, code: t.code,
      serverTime: Date.now(),
      heartbeatInterval: settings().heartbeatInterval || 15,
    });
  });

  /* ---------------- 心跳 ---------------- */
  router.post('/api/t/heartbeat', async (req, res, p, url) => {
    const b = await readJson(req);
    const t = authTerminal(req, url, b);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);

    const now = Date.now();
    const gap = t.lastHeartbeat ? Math.min(300, Math.floor((now - t.lastHeartbeat) / 1000)) : 0;
    const h = { ...(t.health || {}) };
    if (b.cpu != null) h.cpu = b.cpu;
    if (b.mem != null) h.mem = b.mem;
    if (b.latency != null) h.latency = b.latency;
    if (b.crashCount != null) h.crashCount = b.crashCount;
    if (b.uptime != null) h.uptime = b.uptime;

    const patch = {
      lastHeartbeat: now,
      onlineSeconds: (t.onlineSeconds || 0) + gap,
      net: { ...t.net, ip: realIP(req), wifi: b.wifi ?? t.net?.wifi, rssi: b.rssi ?? t.net?.rssi },
      playing: b.playing || null,
      appVersion: b.appVersion || t.appVersion,
      cpuTemp: b.cpuTemp ?? null,
      health: h,
    };
    if (b.storageFree != null) patch.hardware = { ...t.hardware, storageFree: b.storageFree, storageTotal: b.storageTotal ?? t.hardware?.storageTotal };
    if (b.volume != null) patch.volume = b.volume;
    S('terminals').touch(t.id, patch);

    logger.task({ kind: 'heartbeat', terminalId: t.id });
    if (Array.isArray(b.errors) && b.errors.length) {
      logger.system({ event: 'terminal_error', terminalId: t.id, name: t.name, errors: b.errors });
    }

    // 健康度评分 + 异常告警（失联/温度/CPU/内存/存储/崩溃/延迟），存储严重不足自动下发清理
    try { ctx.health?.record(S('terminals').byId(t.id), now); } catch { /* ignore */ }

    json(res, {
      ok: true,
      serverTime: Date.now(),
      manifestVersion: manifestVersion(store, t),
      approved: !!t.approved,
      hasCommands: bus.pendingFor(t.id).length > 0,
      heartbeatInterval: settings().heartbeatInterval || 15,
      shouldBeOn: shouldBeOn(t),
      volume: t.volume,
      powerSchedule: t.powerSchedule || [],
      syncGroupId: t.syncGroupId || null,
      videoWall: t.videoWall || null,
      name: t.name, code: t.code,
    });
  });

  /* ---------------- 清单 ---------------- */
  router.get('/api/t/manifest', async (req, res, p, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    if (!t.approved) return json(res, { ok: true, approved: false, schedules: [], assets: [], version: 0 });

    const mf = buildManifest(store, t);
    const body = {
      ok: true, approved: true,
      version: manifestVersion(store, t),
      serverTime: Date.now(),
      terminal: {
        id: t.id, name: t.name, code: t.code,
        resolution: t.hardware?.resolution, orientation: t.hardware?.orientation,
        volume: t.volume, powerSchedule: t.powerSchedule || [],
        syncGroupId: t.syncGroupId, videoWall: t.videoWall,
      },
      schedules: mf.schedules,
      assets: mf.assets,
      weather: settings().weather || null,
    };
    body.signature = sign(body, ctx.secret);
    logger.task({ kind: 'manifest_pull', terminalId: t.id, version: body.version, assets: mf.assets.length });
    json(res, body);
  });

  /* 终端按 id 拉取单个节目（交互热区「跳转节目」用，终端鉴权，不暴露管理端） */
  router.get('/api/t/layout/:id', (req, res, { id }, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    const l = store.col('layouts').byId(id);
    if (!l) return fail(res, '节目不存在', 404);
    json(res, { ok: true, item: l, media: [] });
  });

  /* ---------------- SSE 指令通道 ---------------- */
  router.get('/api/t/events', async (req, res, p, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    const h = sse(res);
    bus.attachTerminal(t.id, h);
    h.send('hello', { serverTime: Date.now(), terminalId: t.id, name: t.name });
    const ping = setInterval(() => { if (!h.send('ping', { t: Date.now() })) cleanup(); }, 25000);
    const cleanup = () => { clearInterval(ping); bus.detachTerminal(t.id, h); h.close(); };
    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  /* ---------------- 长轮询降级（老 WebView 无 SSE 时） ---------------- */
  router.get('/api/t/poll', async (req, res, p, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    const wait = Math.min(30000, parseInt(url.searchParams.get('wait') || '25000', 10));
    const started = Date.now();
    const check = () => {
      const cmds = bus.pendingFor(t.id);
      if (cmds.length) { json(res, { ok: true, commands: cmds, serverTime: Date.now() }); return true; }
      return false;
    };
    if (check()) return;
    const timer = setInterval(() => {
      if (res.writableEnded) { clearInterval(timer); return; }
      if (check() || Date.now() - started > wait) {
        clearInterval(timer);
        if (!res.writableEnded) json(res, { ok: true, commands: [], serverTime: Date.now() });
      }
    }, 1000);
    req.on('close', () => clearInterval(timer));
  });

  /* ---------------- 指令回执 ---------------- */
  router.post('/api/t/ack', async (req, res, p, url) => {
    const b = await readJson(req);
    const t = authTerminal(req, url, b);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    bus.ack(b.cmdId, b.ok !== false, b.message || '');
    ok(res);
  });

  /* ---------------- 素材下载（Range + 限速 + 校验） ---------------- */
  router.get('/api/t/media/:hash', async (req, res, { hash }, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    const m = S('media').findOne(x => x.hash === hash || x.hash === hash.replace(/\.[^.]+$/, ''));
    if (!m) return fail(res, '素材不存在', 404);

    // 计划传输窗口限制
    const win = settings().transferWindow;
    if (win?.start && win?.end && !req.headers.range) {
      const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
      const s = hm(win.start), e = hm(win.end);
      const inWin = s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
      if (!inWin) return json(res, { ok: false, error: '当前不在允许传输的时间窗口', retryAfter: 600 }, 503);
    }
    logger.task({ kind: 'media_download', terminalId: t.id, hash: m.hash, name: m.name, size: m.size });
    sendFile(req, res, path.join(paths.media, m.rel), {
      mime: m.mime, cache: 'public, max-age=31536000, immutable',
      limiter: limiterFor(t.id),
    });
  });

  /* ---------------- 截屏上传 ---------------- */
  router.post('/api/t/shot', async (req, res, p, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    const buf = await readBody(req, 12 * 1024 * 1024);
    if (!buf.length) return fail(res, '截屏内容为空');
    const dir = path.join(paths.shots, t.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = `${Date.now()}.jpg`;
    fs.writeFileSync(path.join(dir, file), buf);
    // 只保留最近 20 张
    const files = fs.readdirSync(dir).sort();
    while (files.length > 20) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch { break; } }
    S('terminals').touch(t.id, { lastShotAt: Date.now() });
    bus.broadcastAdmin('terminal:shot', { terminalId: t.id, url: `/api/terminals/${t.id}/shot/${file}`, ts: Date.now() });
    const cmdId = url.searchParams.get('cmdId');
    if (cmdId) bus.ack(cmdId, true, '截屏已上传');
    ok(res, { file });
  });

  /* ---------------- 播放日志（Proof of Play） ---------------- */
  router.post('/api/t/log', async (req, res, p, url) => {
    const b = await readJson(req);
    const t = authTerminal(req, url, b);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    for (const e of (b.events || []).slice(0, 500)) {
      logger.play({
        terminalId: t.id, terminalName: t.name,
        layoutId: e.layoutId, layoutName: e.layoutName,
        itemId: e.itemId, mediaId: e.mediaId, mediaName: e.mediaName,
        widget: e.widget, duration: e.duration || 0, at: e.at || Date.now(),
      });
    }
    ok(res, { received: (b.events || []).length });
  });

  /* ---------------- APK 升级 ---------------- */
  router.get('/api/t/apk/check', async (req, res, p, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    const list = S('apks').all().slice().sort((a, b) => (b.versionCode || 0) - (a.versionCode || 0));
    const latest = list[0];
    if (!latest) return ok(res, { hasUpdate: false });
    const cur = parseInt(url.searchParams.get('versionCode') || '0', 10);
    ok(res, {
      hasUpdate: (latest.versionCode || 0) > cur,
      versionName: latest.versionName, versionCode: latest.versionCode,
      md5: latest.md5, size: latest.size, url: latest.url, note: latest.note,
    });
  });

  router.get('/api/t/apk/:file', async (req, res, { file }) => {
    if (!/^[a-f0-9]{32}\.apk$/.test(file)) return fail(res, '非法文件名', 400);
    sendFile(req, res, path.join(paths.apk, file), {
      mime: 'application/vnd.android.package-archive', cache: 'public, max-age=86400',
    });
  });

  /* ---------------- 开放 API（对接 HIS / OA / PIS 等） ---------------- */
  router.post('/api/ext/message', async (req, res) => {
    const key = req.headers['x-api-key'];
    const rec = S('apikeys').findOne(k => k.key === key && !k.disabled);
    if (!rec) return fail(res, 'API Key 无效', 401);
    const b = await readJson(req);
    const ids = resolveTargets(store, b);
    if (!ids.length) return fail(res, '未匹配到任何终端');
    bus.broadcast(ids, 'insert_message', {
      text: b.text || '', color: b.color || '#FFFFFF', fontSize: b.fontSize || 40,
      speed: b.speed || 60, position: b.position || 'bottom', duration: b.duration || 60,
    });
    S('apikeys').touch(rec.id, { lastUsedAt: Date.now(), callCount: (rec.callCount || 0) + 1 });
    logger.audit({ action: 'ext_message', apiKey: rec.name, terminals: ids.length, text: b.text });
    ok(res, { terminals: ids.length });
  });

  router.get('/api/ext/terminals', async (req, res) => {
    const key = req.headers['x-api-key'];
    const rec = S('apikeys').findOne(k => k.key === key && !k.disabled);
    if (!rec) return fail(res, 'API Key 无效', 401);
    const th = (settings().offlineThreshold || 60) * 1000, now = Date.now();
    ok(res, {
      items: S('terminals').all().map(t => ({
        id: t.id, name: t.name, code: t.code,
        online: !!(t.lastHeartbeat && now - t.lastHeartbeat < th),
        ip: t.net?.ip, model: t.hardware?.model, playing: t.playing || null,
      })),
    });
  });

  /* ---------------- 外部数据接入（受众 / 传感器，预留） ---------------- */
  router.post('/api/ext/audience', async (req, res) => {
    const key = req.headers['x-api-key'];
    if (!S('apikeys').findOne(k => k.key === key && !k.disabled)) return fail(res, 'API Key 无效', 401);
    const b = await readJson(req);
    if (b.terminalId) bus.send(b.terminalId, 'audience', { gender: b.gender, age: b.age, count: b.count }, { ack: false });
    ok(res);
  });

  /* ---------------- P1-3.4 交互式表单反馈（终端提交） ---------------- */
  router.post('/api/t/form-feedback', async (req, res) => {
    const t = authTerminal(req, new URL(req.url, 'http://localhost'), null);
    if (!t) return fail(res, '终端鉴权失败', 401);
    const b = await readJson(req);
    const fb = S('form_feedbacks').insert({
      id: uid('fb'),
      terminalId: t.id,
      terminalName: t.name || t.serial || '未知',
      formType: b.formType || 'satisfaction',
      layoutId: b.layoutId || null,
      itemId: b.itemId || null,
      payload: { rating: b.rating, message: (b.message || '').slice(0, 2000), name: (b.name || '').slice(100), phone: (b.phone || '').slice(20) },
      createdAt: Date.now(),
    });
    logger.info(`表单反馈[${b.formType}] 终端=${t.id} item=${b.itemId}`);
    bus.broadcastAdmin('form-feedback:new', fb);
    json(res, { ok: true, id: fb.id });
  });

  /* 管理端读取表单反馈列表 */
  router.get('/api/admin/form-feedbacks', async (req, res) => {
    const user = ctx.auth.userFromReq(req);
    if (!user) return fail(res, '未登录', 401);
    if (!ctx.auth.can(user, 'feedback:view')) return fail(res, '无权限', 403);
    const list = S('form_feedbacks').all().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    json(res, { ok: true, items: list.slice(0, 500), total: list.length });
  });
}

/* ================= 工具 ================= */
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const realIP = req => (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '')
  .replace(/^::ffff:/, '').trim();

function sign(body, secret) {
  const { signature, ...rest } = body;
  return 'hmac-sha256:' + crypto.createHmac('sha256', secret).update(JSON.stringify(rest)).digest('hex');
}

/** 清单版本号 = 影响该终端的所有排期+节目的最后更新时间之和的哈希 */
function manifestVersion(store, t) {
  const { schedules } = buildManifest(store, t);
  let v = t.approved ? 1 : 0;
  for (const s of schedules) v = (v * 31 + (s.layout.updatedAt || 0) % 1000000007 + (s.order || 0)) % 2147483647;
  return v;
}

function resolveTargets(store, b) {
  const terms = store.col('terminals').all();
  if (b.all) return terms.map(t => t.id);
  const set = new Set(b.terminalIds || []);
  if (b.codes?.length) terms.forEach(t => { if (b.codes.includes(t.code)) set.add(t.id); });
  if (b.groupIds?.length) terms.forEach(t => { if (b.groupIds.some(g => (t.groupIds || []).includes(g))) set.add(t.id); });
  return [...set];
}

const alertThrottle = new Map();
export function raiseAlert(store, bus, a) {
  const row = store.col('alerts').insert({ id: uid('al_'), resolved: false, ...a });
  bus.broadcastAdmin('alert:new', row);
  return row;
}
export function raiseAlertThrottled(store, bus, key, a, ms = 3600000) {
  const last = alertThrottle.get(key) || 0;
  if (Date.now() - last < ms) return null;
  alertThrottle.set(key, Date.now());
  return raiseAlert(store, bus, a);
}
