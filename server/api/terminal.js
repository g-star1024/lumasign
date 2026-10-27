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
    // kind: 终端类型。device=真实硬件（安卓屏），web=浏览器预览。
    // 旧版引擎不传此字段，按 model 回退推断（Browser 视为 web，其余视为 device）。
    const kind = b.kind || (b.model === 'Browser' ? 'web' : 'device');

    if (t) {
      const patch = { hardware, net, kind, appVersion: b.appVersion || t.appVersion, lastHeartbeat: Date.now() };
      // autoApproveTerminal 开启时，已存在但未批准的终端也应在重注册时自动准入。
      // 否则「自动准入」只对新终端生效：历史遗留的未批准终端（如本次现场救援的
      // t_13238c1fad57c675）会被 mac/serial 幂等键永久命中、approved 恒为 false，
      // 清单门禁返回空 schedules → 设备连上也永远黑屏（2026-10-08 现场事故）。
      if (settings().autoApproveTerminal && !t.approved) patch.approved = true;
      S('terminals').update(t.id, patch);
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
        approved: !!auto, hardware, net, kind,
        appVersion: b.appVersion || '', lastHeartbeat: Date.now(),
        onlineSeconds: 0, volume: 60, powerSchedule: [],
        syncGroupId: null, videoWall: null, floorPlan: null,
        note: '', tags: [], hideFromWall: false,
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
    // ★ v1.3.31：存储热插拔设备列表（Android DeviceChangeListener 上报挂载的 SD/USB 路径）
    if (Array.isArray(b.devices)) patch.devices = b.devices;
    // ★ v1.3.31：计划关机时间戳（管理端下发，客户端渲染 PowerOffRem 组件）
    if (b.poweroffAt != null) patch.poweroffAt = b.poweroffAt;
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
      // ★ v1.3.31：客户端 PowerOffRem widget 消费 poweroffAt；同步 devices 回包便于诊断
      poweroffAt: t.poweroffAt ?? null,
      devices: t.devices ?? [],
    });
  });

  /* ---------------- 引擎存活打点（v1.3.46） ----------------
   * 播放引擎用 `new Image().src='/api/t/ping?stage=...'` 打点（加载/退出等关键阶段），
   * 此前无此路由 → 单日 4000+ 个 404 噪音日志。Image 请求带不了鉴权头，故不做终端校验，
   * 只回 204（No Content）不写日志；stage 仅供抓包诊断。 */
  router.get('/api/t/ping', (req, res) => {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
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
    // ★ v1.3.52：keep-alive 心跳由 25s 降到 8s——实测设备端 SSE 每 15.1s 断开重连一次
    //   （2395 次连接、间隔 15071/15100/15091…ms 高度规律），而 curl 保持同一连接 40s 不掉：
    //   说明是**客户端侧对空闲流的超时**（Chromium 33 的 EventSource 流加载器），
    //   服务端首个 ping 在 25s > 空闲阈值 → 每次都是「还没等到 ping 就被掐」→ 15s 周期性重连。
    //   提前到 8s 心跳即可让流保持活跃，根除周期性重连（也顺带消除管理端 toast 抖动源）。
    const ping = setInterval(() => { if (!h.send('ping', { t: Date.now() })) cleanup(); }, 8000);
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
  // 兼容三种取法：内容 hash（清单 assets.url）/ hash + 扩展名 / mediaId（播放端 resolver 用 m_xxx 拉图，
  // 旧实现只按 hash 查导致终端渲染图片时全部 404 → 屏幕提示「图片缺失」）
  router.get('/api/t/media/:hash', async (req, res, { hash }, url) => {
    const t = authTerminal(req, url);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    // ★ v1.3.53 应急闸：LUMASIGN_MEDIA_OFF=1 时拒绝一切素材下发。
    //   背景：v1.3.51 起终端改从本机回环源取素材，随后设备进入重启循环（adbd 起来又掉，
    //   疑似 ROM 媒体栈读回环源时驱动崩溃）。先用服务端闸门把「媒体栈」从链路上摘掉，
    //   让设备先活下来；装上带原生侧熔断的 APK 后再放开。
    if (process.env.LUMASIGN_MEDIA_OFF === '1') return fail(res, '素材下发已临时关闭', 503);
    const bare = hash.replace(/\.[^.]+$/, '');
    const m = S('media').findOne(x => x.hash === hash || x.hash === bare || x.id === hash || x.id === bare);
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
    // 优先下发转码产物（HEVC 等不可直播编码 → H.264 转码版）：RK312x 等老安卓设备硬解只认 H.264，
    // 原样下发会导致视频在播放端永远停在首帧不出画面（v1.3.23）
    let serveRel = m.rel, serveMime = m.mime;
    if (m.transcodedRel) {
      const tpath = path.join(paths.media, m.transcodedRel);
      try { if (fs.existsSync(tpath)) { serveRel = m.transcodedRel; serveMime = 'video/mp4'; } } catch (_e) { /* 回退原文件 */ }
    }
    // ⚠️ 缓存策略（v1.3.33）：原为 immutable + max-age=1年，旧端 WebView（Chromium 33 / Android 4.4）
    //    会把早期一次瞬时错误响应按该 URL 缓存一年 → 之后一直命中缓存错误 → 图片恒显「图片缺失」
    //    （视频同接口却正常，因各自 URL 不同）。改为短 max-age + must-revalidate：正常播放仍命中
    //    缓存，一旦发生错误最多 5 分钟自愈，不再永久污染。配合 renderImage 的重试 cache-bust 双保险。
    sendFile(req, res, path.join(paths.media, serveRel), {
      mime: serveMime, cache: 'public, max-age=300, must-revalidate',
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

  /* ---------------- 崩溃日志（安卓端主动上报） ---------------- */
  router.post('/api/t/crash', async (req, res) => {
    const b = await readJson(req);
    // 免鉴权：闪退设备可能无法完成正常认证流程，允许按 code 匹配
    const code = b.code || '';
    const t = code ? S('terminals').findOne(x => x.code === code) : null;
    const entry = {
      terminalId: t?.id || '',
      terminalName: t?.name || '未知终端',
      model: b.model || '',
      androidVersion: b.androidVersion || '',
      crashCount: b.crashCount || 0,
      log: b.log || '',
      at: Date.now(),
    };
    try {
      const logs = S('crashLogs') || store.col('crashLogs');
      logs.insert(entry);
    } catch (_e) { /* 存储失败不阻塞上报 */ }
    ok(res, { received: true });
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

  /* 管理端读取崩溃日志列表（按时间倒序） */
  router.get('/api/admin/crash-logs', async (req, res) => {
    const user = ctx.auth.userFromReq(req);
    if (!user) return fail(res, '未登录', 401);
    if (!ctx.auth.can(user, 'terminal:view')) return fail(res, '无权限', 403);
    try {
      const logs = (S('crashLogs') || store.col('crashLogs')).all();
      const sorted = logs.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
      json(res, { ok: true, items: sorted.slice(0, 200), total: sorted.length });
    } catch (_e) {
      json(res, { ok: true, items: [], total: 0 });
    }
  });

  /* 管理端删除单条崩溃日志 */
  router.post('/api/admin/crash-logs/:id/delete', async (req, res, p) => {
    const user = ctx.auth.userFromReq(req);
    if (!user) return fail(res, '未登录', 401);
    if (!ctx.auth.can(user, 'terminal:edit')) return fail(res, '无权限', 403);
    try {
      (S('crashLogs') || store.col('crashLogs')).delete(p.id);
      ok(res);
    } catch (_e) { fail(res, '删除失败', 500); }
  });

  // ★ v1.3.31: 断点续播 + 关机计划下发（对齐竞品 BreakPointDBAdapter / PowerOffRem）
  // v1.3.45 修复：authTerminal 是本函数内部定义的，必须显式传入——否则断点两个端点
  // 一律 ReferenceError → 500（真机日志 system-2026-10-22 共 266 次 request_error）。
  registerBreakpointRoutes(router, store, ctx, authTerminal);
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

// ============ v1.3.31: 断点续播（对齐竞品 BreakPointDBAdapter） ============
// collection: breakpoints  [{ id, terminalId, key, position, duration, updatedAt }]
// key 由客户端生成：itemId|mediaId，用于定位到具体素材
export function registerBreakpointRoutes(router, store, ctx, authTerminal) {
  const S = n => store.col(n);

  // 客户端上报播放进度（节流：只在关键时点调用）
  router.post('/api/t/breakpoint', async (req, res, p, url) => {
    const b = await readJson(req);
    const t = authTerminal(req, url, b);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    if (!b.key || typeof b.position !== 'number' || b.position <= 0) {
      return fail(res, '参数错误', 400);
    }
    const col = S('breakpoints');
    let row = col.find(r => r.terminalId === t.id && r.key === b.key)[0];
    if (row) {
      col.update(row.id, { position: b.position, duration: b.duration || 0, updatedAt: Date.now() });
    } else {
      col.insert({
        id: uid('bp_'), terminalId: t.id, key: b.key,
        position: b.position, duration: b.duration || 0,
      });
    }
    // 每终端最多保留 200 条断点（LRU）
    const all = col.find(r => r.terminalId === t.id);
    if (all.length > 200) {
      all.sort((a, b2) => (a.updatedAt || 0) - (b2.updatedAt || 0));
      for (const r of all.slice(200)) col.remove(r.id);
    }
    // 每天清理一次全库过期（>7d）
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    col.removeWhere(r => (r.updatedAt || 0) < weekAgo);
    ok(res, { ok: true });
  });

  // 客户端拉取该终端所有断点（新节目加载时）
  router.get('/api/t/breakpoints', async (req, res, p, url) => {
    const t = authTerminal(req, url, p);
    if (!t) return fail(res, '终端未注册或令牌无效', 401);
    const list = S('breakpoints').find(r => r.terminalId === t.id).map(r => ({
      key: r.key, position: r.position, duration: r.duration || 0, updatedAt: r.updatedAt,
    }));
    ok(res, { ok: true, breakpoints: list });
  });

  // 管理端下发关机计划（对齐竞品 PowerOffRem 的调度源）
  router.post('/api/admin/terminals/:id/poweroff', async (req, res, p, url) => {
    const user = ctx.user || ctx.auth?.user;
    if (!ctx.auth?.can(user, 'terminal:update')) return fail(res, '无权限', 403);
    const b = await readJson(req);
    const t = S('terminals').byId(p.id);
    if (!t) return fail(res, '终端不存在', 404);
    const patch = { poweroffAt: b.poweroffAt ?? null, updatedAt: Date.now() };
    S('terminals').update(t.id, patch);
    bus.broadcastTerminal(t.id, { type: 'poweroff', payload: { poweroffAt: b.poweroffAt ?? null } });
    ok(res, { ok: true, poweroffAt: patch.poweroffAt });
  });
}
