/**
 * 灵屏 LumaSign · 管理端 API
 * 覆盖：认证、仪表盘、机构/分组、终端、素材、节目、模板、排期、审批、
 *       用户角色、日志与播放证明、告警、APK 升级包、系统设置。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  json, ok, fail, readJson, parseMultipart, sendFile, sse, mimeOf,
} from '../lib/http.js';
import { uid } from '../lib/store.js';
import {
  hashPassword, verifyPassword, sessionCookie, clearCookie,
  PERMISSIONS, ALL_PERMS,
} from '../lib/auth.js';
import { buildManifest, detectConflicts, MODE_PRIORITY } from '../lib/schedule.js';
import { validityOf } from '../lib/lifecycle.js';
import { lanIPs, primaryIP } from '../lib/discovery.js';
import { builtinTemplates } from '../lib/seed.js';
import { sniffFile, passwordStrength } from '../lib/security.js';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mkv|avi|flv|ts|mov|m4v)$/i;
const AUDIO_EXT = /\.(mp3|aac|wav|m4a|ogg)$/i;
const DOC_EXT = /\.(pdf|ppt|pptx|doc|docx|xls|xlsx)$/i;

const mediaKind = name =>
  IMAGE_EXT.test(name) ? 'image' : VIDEO_EXT.test(name) ? 'video'
  : AUDIO_EXT.test(name) ? 'audio' : DOC_EXT.test(name) ? 'doc' : 'other';

/** 给列表项附上生命周期状态（有效期看板 / 列表徽标用） */
const withLifecycle = (doc) => {
  const v = validityOf(doc);
  return {
    validFrom: doc.validFrom ?? doc.validTo ?? null,
    validUntil: doc.validUntil ?? doc.validTo ?? null,
    lifecycleState: v.state,
    daysLeft: v.daysLeft,
    archived: v.archived,
  };
};

export function registerAdminApi(router, ctx) {
  const { store, auth, bus, logger, paths, moderator } = ctx;
  const S = n => store.col(n);
  const settings = () => S('settings').byId('settings');

  /* ================= 中间件式守卫 ================= */
  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };

  /* ================= 内容合规守卫 =================
   * 三道闸：写入(create/update) → 提审(submit/approve) → 下发(publish)。
   * 之所以每道都查，是因为攻击者可能绕过 UI 直接调 API：先存一份干净草稿，
   * 再用 PUT 改内容、或直接改磁盘 JSON。只有在「下发前」也查一次，才真正挡得住。
   */
  const moderateLayout = (layoutLike, user, scene) => {
    if (!moderator) return { ok: true, level: 'pass', hits: [] };
    const r = moderator.checkLayout(layoutLike);
    moderator.audit(r, { user, scene, targetId: layoutLike?.id, targetName: layoutLike?.name });
    return r;
  };
  /** 命中 BLOCK 时统一的拒绝响应（带命中明细，方便运营自查） */
  const blockedResponse = (res, r, scene) => json(res, {
    ok: false,
    error: `内容合规检查未通过（${scene}）：${r.summary}`,
    moderation: {
      level: r.level,
      hits: r.hits.slice(0, 20).map(h => ({ label: h.label, word: h.word, where: h.where || '' })),
    },
  }, 422);

  /* ================= 认证 ================= */
  router.post('/api/auth/login', async (req, res) => {
    const { username, password } = await readJson(req);
    if (!username || !password) return fail(res, '请输入用户名和密码');
    if (auth.isLocked(username))
      return fail(res, `账号已锁定，请 ${auth.lockRemaining(username)} 秒后重试`, 423);

    const user = S('users').findOne(u => u.username === username);
    if (!user || user.disabled || !verifyPassword(password, user.password)) {
      auth.noteFailure(username);
      logger.audit({ action: 'login_failed', username, ip: req.socket.remoteAddress });
      return fail(res, '用户名或密码错误', 401);
    }
    auth.clearFailure(username);
    const sid = auth.createSession(user.id, req);
    S('users').touch(user.id, { lastLoginAt: Date.now() });
    logger.audit({ action: 'login', userId: user.id, username, ip: req.socket.remoteAddress });

    res.setHeader('Set-Cookie', sessionCookie(sid, ctx.https));
    json(res, {
      ok: true, sid,
      user: publicUser(user, auth),
      mustChangePassword: !!user.mustChangePassword,
    });
  });

  router.post('/api/auth/logout', async (req, res) => {
    const user = auth.userFromReq(req);
    if (user) { auth.destroySession(user._sid); logger.audit({ action: 'logout', userId: user.id, username: user.username }); }
    res.setHeader('Set-Cookie', clearCookie());
    ok(res);
  });

  router.get('/api/auth/me', async (req, res) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录', 401);
    ok(res, { user: publicUser(user, auth), permissions: PERMISSIONS });
  });

  router.post('/api/auth/password', guard(null, async (req, res, p, u, user) => {
    const { oldPassword, newPassword } = await readJson(req);
    if (!verifyPassword(oldPassword || '', user.password)) return fail(res, '原密码不正确');
    const err = checkPasswordStrength(newPassword);
    if (err) return fail(res, err);
    S('users').update(user.id, { password: hashPassword(newPassword), mustChangePassword: false });
    logger.audit({ action: 'change_password', userId: user.id, username: user.username });
    ok(res);
  }));

  /* ================= 管理端事件 SSE ================= */
  router.get('/api/events', guard(null, async (req, res) => {
    const h = sse(res);
    bus.attachAdmin(h);
    const ping = setInterval(() => { if (!h.send('ping', { t: Date.now() })) cleanup(); }, 25000);
    const cleanup = () => { clearInterval(ping); bus.detachAdmin(h); h.close(); };
    req.on('close', cleanup);
    req.on('error', cleanup);
  }));

  /* ================= 仪表盘 ================= */
  router.get('/api/dashboard', guard('dashboard:view', async (req, res, p, u, user) => {
    const terms = scopedTerminals(user);
    const now = Date.now();
    const th = (settings().offlineThreshold || 60) * 1000;
    const online = terms.filter(t => t.lastHeartbeat && now - t.lastHeartbeat < th);
    const pendingApprove = S('layouts').count(l => l.approval?.state === 'pending');
    const waitingTerminals = S('terminals').count(t => !t.approved);
    const alerts = S('alerts').find(a => !a.resolved).slice(-20).reverse();

    // 近 7 天在线率
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const rows = logger.query({ kind: 'task', from: key, to: key, limit: 20000, filter: r => r.kind === 'heartbeat' });
      trend.push({ date: key.slice(5), count: rows.length });
    }

    ok(res, {
      stats: {
        terminalTotal: terms.length,
        terminalOnline: online.length,
        terminalOffline: terms.length - online.length,
        linked: bus.linkedCount(),
        mediaTotal: S('media').count(),
        mediaSize: S('media').all().reduce((a, m) => a + (m.size || 0), 0),
        layoutTotal: S('layouts').count(l => l.type === 'program'),
        scheduleActive: S('schedules').count(s => s.enabled !== false),
        pendingApprove, waitingTerminals,
        alertUnresolved: alerts.length,
      },
      trend,
      alerts,
      recentTerminals: terms.slice()
        .sort((a, b) => (b.lastHeartbeat || 0) - (a.lastHeartbeat || 0)).slice(0, 8)
        .map(t => decorateTerminal(t, th, bus)),
      recentAudit: logger.query({ kind: 'audit', limit: 12 }),
    });
  }));

  /* ================= 机构 / 分组 ================= */
  router.get('/api/orgs', guard('terminal:view', async (req, res) => ok(res, { items: S('orgs').all() })));
  router.post('/api/orgs', guard('system:setting', async (req, res, p, u, user) => {
    const b = await readJson(req);
    if (!b.name) return fail(res, '请填写机构名称');
    const row = S('orgs').insert({ id: uid('org_'), name: b.name, parentId: b.parentId || 'org_root', order: b.order || 0 });
    logger.change(user, 'org_create', row.id, null, row, req);
    ok(res, { item: row });
  }));
  router.put('/api/orgs/:id', guard('system:setting', async (req, res, { id }, u, user) => {
    const b = await readJson(req); const before = { ...S('orgs').byId(id) };
    const row = S('orgs').update(id, { name: b.name, parentId: b.parentId, order: b.order });
    if (!row) return fail(res, '机构不存在', 404);
    logger.change(user, 'org_update', id, before, row, req);
    ok(res, { item: row });
  }));
  router.del('/api/orgs/:id', guard('system:setting', async (req, res, { id }, u, user) => {
    if (id === 'org_root') return fail(res, '根机构不可删除');
    if (S('orgs').count(o => o.parentId === id)) return fail(res, '请先删除下级机构');
    if (S('terminals').count(t => t.orgId === id)) return fail(res, '该机构下仍有终端，无法删除');
    S('orgs').remove(id);
    logger.audit({ action: 'org_delete', userId: user.id, target: id });
    ok(res);
  }));

  router.get('/api/groups', guard('terminal:view', async (req, res) => {
    const items = S('groups').all().map(g => ({ ...g, terminalCount: S('terminals').count(t => (t.groupIds || []).includes(g.id)) }));
    ok(res, { items });
  }));
  router.post('/api/groups', guard('terminal:edit', async (req, res, p, u, user) => {
    const b = await readJson(req);
    if (!b.name) return fail(res, '请填写分组名称');
    const row = S('groups').insert({ id: uid('g_'), name: b.name, orgId: b.orgId || user.orgId || 'org_root', desc: b.desc || '' });
    logger.change(user, 'group_create', row.id, null, row, req);
    ok(res, { item: row });
  }));
  router.put('/api/groups/:id', guard('terminal:edit', async (req, res, { id }, u, user) => {
    const b = await readJson(req); const before = { ...S('groups').byId(id) };
    const row = S('groups').update(id, { name: b.name, desc: b.desc, orgId: b.orgId });
    if (!row) return fail(res, '分组不存在', 404);
    logger.change(user, 'group_update', id, before, row, req);
    ok(res, { item: row });
  }));
  router.del('/api/groups/:id', guard('terminal:edit', async (req, res, { id }, u, user) => {
    S('terminals').all().forEach(t => {
      if ((t.groupIds || []).includes(id)) S('terminals').update(t.id, { groupIds: t.groupIds.filter(g => g !== id) });
    });
    S('groups').remove(id);
    logger.audit({ action: 'group_delete', userId: user.id, target: id });
    ok(res);
  }));

  /* ================= 终端 ================= */
  router.get('/api/terminals', guard('terminal:view', async (req, res, p, url, user) => {
    const th = (settings().offlineThreshold || 60) * 1000;
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const status = url.searchParams.get('status');
    const groupId = url.searchParams.get('groupId');
    let items = scopedTerminals(user).map(t => decorateTerminal(t, th, bus));
    if (q) items = items.filter(t =>
      (t.name || '').toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q) ||
      (t.net?.ip || '').includes(q) || (t.hardware?.mac || '').toLowerCase().includes(q));
    if (status) items = items.filter(t => t.status === status);
    if (groupId) items = items.filter(t => (t.groupIds || []).includes(groupId));
    items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
    ok(res, { items, groups: S('groups').all(), orgs: S('orgs').all() });
  }));

  router.get('/api/terminals/:id', guard('terminal:view', async (req, res, { id }) => {
    const t = S('terminals').byId(id);
    if (!t) return fail(res, '终端不存在', 404);
    const th = (settings().offlineThreshold || 60) * 1000;
    const shots = fs.existsSync(path.join(paths.shots, id))
      ? fs.readdirSync(path.join(paths.shots, id)).sort().reverse().slice(0, 20)
      : [];
    ok(res, {
      item: decorateTerminal(t, th, bus),
      manifest: buildManifest(store, t).schedules.map(s => ({
        scheduleId: s.scheduleId, name: s.name, mode: s.mode,
        layoutName: s.layout.name, timeSlots: s.timeSlots, weekdays: s.weekdays,
      })),
      shots: shots.map(f => ({ file: f, url: `/api/terminals/${id}/shot/${f}`, ts: parseInt(f, 10) || 0 })),
      pendingCommands: bus.pendingFor(id),
    });
  }));

  router.get('/api/terminals/:id/shot/:file', async (req, res, { id, file }, url) => {
    const user = auth.userFromReq(req);
    const key = url.searchParams.get('key') || '';
    if (!user && !(settings().monitorToken && key && key === settings().monitorToken)) return fail(res, '未授权', 401);
    if (!/^[\w.-]+$/.test(file)) return fail(res, '非法文件名', 400);
    sendFile(req, res, path.join(paths.shots, id, file), { cache: 'public, max-age=86400' });
  });

  router.put('/api/terminals/:id', guard('terminal:edit', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const before = { ...S('terminals').byId(id) };
    if (!before.id) return fail(res, '终端不存在', 404);
    const patch = {};
    for (const k of ['name', 'code', 'orgId', 'groupIds', 'note', 'tags', 'floorPlan', 'syncGroupId', 'videoWall'])
      if (b[k] !== undefined) patch[k] = b[k];
    const row = S('terminals').update(id, patch);
    logger.change(user, 'terminal_update', id, before, row, req);
    bus.send(id, 'refresh_manifest', {}, { ack: false });
    ok(res, { item: row });
  }));

  router.post('/api/terminals/:id/approve', guard('terminal:approve', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const row = S('terminals').update(id, { approved: b.approved !== false });
    if (!row) return fail(res, '终端不存在', 404);
    logger.audit({ action: b.approved !== false ? 'terminal_approve' : 'terminal_reject', userId: user.id, username: user.username, target: id });
    bus.send(id, 'refresh_manifest', {}, { ack: false });
    bus.broadcastAdmin('terminal:update', { terminalId: id });
    ok(res, { item: row });
  }));

  router.del('/api/terminals/:id', guard('terminal:delete', async (req, res, { id }, u, user) => {
    const t = S('terminals').byId(id);
    if (!t) return fail(res, '终端不存在', 404);
    S('terminals').remove(id);
    try { fs.rmSync(path.join(paths.shots, id), { recursive: true, force: true }); } catch {}
    logger.audit({ action: 'terminal_delete', userId: user.id, username: user.username, target: id, name: t.name });
    ok(res);
  }));

  /* -------- 远程控制（批量） -------- */
  router.post('/api/terminals/command', guard('terminal:control', async (req, res, p, u, user) => {
    const { terminalIds = [], type, payload = {} } = await readJson(req);
    if (!type) return fail(res, '缺少指令类型');
    if (!terminalIds.length) return fail(res, '请至少选择一台终端');

    const ALLOW = ['reboot', 'restart_app', 'volume', 'screenshot', 'sync_time', 'clear_cache',
      'power_schedule', 'refresh_manifest', 'pull_info', 'screen_on', 'screen_off',
      'set_brightness', 'insert_message', 'stop_insert', 'play_now', 'upgrade_apk'];
    if (!ALLOW.includes(type)) return fail(res, `不支持的指令：${type}`);
    if (type === 'insert_message' && !auth.can(user, 'message:insert')) return fail(res, '没有插播权限', 403);
    if (type === 'upgrade_apk' && !auth.can(user, 'terminal:upgrade')) return fail(res, '没有升级权限', 403);

    // 定时开关机需要落库，终端离线时下次上线也能生效
    if (type === 'power_schedule')
      terminalIds.forEach(id => S('terminals').update(id, { powerSchedule: payload.schedule || [] }));
    if (type === 'volume')
      terminalIds.forEach(id => S('terminals').update(id, { volume: payload.volume }));

    const results = bus.broadcast(terminalIds, type, payload);
    logger.audit({ action: 'terminal_command', userId: user.id, username: user.username, cmdType: type, terminalIds, payload });
    ok(res, { results });
  }));

  /* ================= 监看墙（一块大屏监控所有屏） ================= */
  // 取某终端最新一张截屏
  function latestShot(id) {
    try {
      const dir = path.join(paths.shots, id);
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir).filter(f => /^\d+(\.\w+)?$/.test(f));
      if (!files.length) return null;
      files.sort((a, b) => Number(b.split('.')[0] || 0) - Number(a.split('.')[0] || 0));
      const f = files[0];
      return { file: f, url: `/api/terminals/${id}/shot/${f}`, ts: Number(f.split('.')[0]) || 0 };
    } catch { return null; }
  }

  // 只读监看墙：管理端会话 或 专用 monitorToken 均可访问（供大屏端轮询）
  router.get('/api/monitor/wall', async (req, res, p, url) => {
    const user = auth.userFromReq(req);
    const key = url.searchParams.get('key') || '';
    const byKey = !user && settings().monitorToken && key && key === settings().monitorToken;
    if (!user && !byKey) return fail(res, '未授权', 401);

    const th = (settings().offlineThreshold || 60) * 1000;
    const list = user ? scopedTerminals(user) : S('terminals').all();
    const items = list.map(t => {
      const d = decorateTerminal(t, th, bus);
      const gName = (S('groups').byId((t.groupIds || [])[0]) || {}).name || '';
      return {
        id: t.id, name: t.name, code: t.code,
        status: d.status, online: d.status === 'online', linked: d.linked,
        playing: t.playing || null,
        resolution: t.hardware?.resolution || '', orientation: t.hardware?.orientation || 'landscape',
        ip: t.net?.ip || '', groupName: gName,
        lastShot: latestShot(t.id),
      };
    });
    ok(res, {
      items, serverTime: Date.now(),
      monitorToken: byKey ? undefined : settings().monitorToken,
      monitorUrl: `/player/monitor.html?key=${settings().monitorToken}`,
    });
  });

  // 批量请求截屏（让所有/指定终端立即上报当前画面）
  router.post('/api/monitor/refresh', guard('terminal:control', async (req, res, p, u, user) => {
    const { terminalIds = [], onlineOnly = true } = await readJson(req);
    let ids = terminalIds.length ? terminalIds : scopedTerminals(user).map(t => t.id);
    if (onlineOnly) {
      const th = (settings().offlineThreshold || 60) * 1000;
      ids = ids.filter(id => { const t = S('terminals').byId(id); return t && t.lastHeartbeat && Date.now() - t.lastHeartbeat < th; });
    }
    const results = bus.broadcast(ids, 'screenshot', {});
    logger.audit({ action: 'monitor_refresh', userId: user.id, username: user.username, count: ids.length });
    ok(res, { requested: ids.length, results });
  }));

  // 轮换监看墙只读 token
  router.post('/api/monitor/rotate', guard('system:setting', async (req, res, p, u, user) => {
    const token = crypto.randomBytes(10).toString('hex');
    S('settings').update('settings', { monitorToken: token });
    bus.broadcastAdmin('settings:changed', {});
    logger.audit({ action: 'monitor_token_rotate', userId: user.id, username: user.username });
    ok(res, { monitorToken: token, monitorUrl: `/player/monitor.html?key=${token}` });
  }));

  /* ================= 素材库 ================= */
  router.get('/api/media', guard('media:view', async (req, res, p, url) => {
    const kind = url.searchParams.get('kind');
    const folderId = url.searchParams.get('folderId');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    let items = S('media').all();
    if (kind && kind !== 'all') items = items.filter(m => m.kind === kind);
    if (folderId) items = items.filter(m => m.folderId === folderId);
    if (q) items = items.filter(m => m.name.toLowerCase().includes(q));
    items = items.slice().sort((a, b) => b.createdAt - a.createdAt);
    items = items.map(m => ({ ...m, ...withLifecycle(m) }));
    ok(res, { items, folders: S('mediaFolders').all() });
  }));

  router.post('/api/media/upload', guard('media:upload', async (req, res, p, u, user) => {
    let parsed;
    try { parsed = await parseMultipart(req, paths.tmp); }
    catch (e) { return fail(res, '上传解析失败：' + e.message); }
    const folderId = parsed.fields.folderId || null;
    const out = [];
    for (const f of parsed.files) {
      try {
        /* 安全闸：只信文件头，不信扩展名与 Content-Type。
           典型攻击：把含 <script> 的 HTML 改名为 .jpg 上传，再用「网页组件」引用 → XSS 直达大屏。
           同时挡住 SVG（可内嵌脚本，本系统一律不收为素材）。 */
        const sniff = sniffFile(f.tmpPath, {
          allow: ['jpg', 'png', 'gif', 'bmp', 'webp', 'mp4', 'webm', 'avi', 'flv', 'mkv', 'mp3', 'wav', 'pdf'],
        });
        if (!sniff.ok) {
          try { fs.unlinkSync(f.tmpPath); } catch {}
          logger.audit({
            action: 'upload_rejected', userId: user.id, username: user.username,
            target: f.filename, reason: sniff.reason,
          });
          out.push({ name: f.filename, error: sniff.reason });
          continue;
        }
        // 文件名本身也可能是攻击载体（回显到管理端列表）→ 过合规 + 去掉危险字符
        const safeName = String(f.filename).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120);
        if (moderator) {
          const nameCheck = moderator.check(safeName, { scene: 'name' });
          if (!nameCheck.ok) {
            try { fs.unlinkSync(f.tmpPath); } catch {}
            moderator.audit(nameCheck, { user, scene: '素材文件名', targetName: safeName });
            out.push({ name: safeName, error: `文件名未通过合规检查：${nameCheck.summary}` });
            continue;
          }
        }

        const buf = fs.readFileSync(f.tmpPath);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        const exist = S('media').findOne(m => m.hash === hash);
        if (exist) {                       // SHA-256 去重
          fs.unlinkSync(f.tmpPath);
          out.push({ ...exist, duplicated: true });
          continue;
        }
        // 扩展名以「嗅探结果」为准，而不是用户提供的原始扩展名
        const ext = '.' + sniff.ext;
        const rel = path.join(hash.slice(0, 2), hash + ext);
        const dest = path.join(paths.media, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(f.tmpPath, dest);

        const row = S('media').insert({
          id: uid('m_'), name: safeName, hash, ext,
          rel: rel.split(path.sep).join('/'),
          size: f.size, mime: sniff.mime,
          kind: mediaKind(ext), folderId,
          duration: null, width: null, height: null, pages: null,
          uploadedBy: user.id, refCount: 0,
        });
        out.push(row);
      } catch (e) {
        logger.system({ event: 'upload_error', file: f.filename, message: e.message });
        out.push({ name: f.filename, error: e.message });
      }
    }
    logger.audit({ action: 'media_upload', userId: user.id, username: user.username, count: out.length });
    ok(res, { items: out });
  }));

  router.get('/api/media/:id/raw', guard('media:view', async (req, res, { id }) => {
    const m = S('media').byId(id);
    if (!m) return fail(res, '素材不存在', 404);
    sendFile(req, res, path.join(paths.media, m.rel), { mime: m.mime, cache: 'public, max-age=31536000' });
  }));

  router.put('/api/media/:id', guard('media:upload', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const patch = { name: b.name, folderId: b.folderId ?? null };
    // 有效期：显式传了才改，避免只改个名字把有效期清空
    if ('validFrom' in b) patch.validFrom = b.validFrom || null;
    if ('validUntil' in b) patch.validUntil = b.validUntil || null;
    const row = S('media').update(id, patch);
    if (!row) return fail(res, '素材不存在', 404);
    logger.audit({ action: 'media_update', userId: user.id, target: id });
    ok(res, { item: row });
  }));

  router.del('/api/media/:id', guard('media:delete', async (req, res, { id }, u, user) => {
    const m = S('media').byId(id);
    if (!m) return fail(res, '素材不存在', 404);
    const used = S('layouts').find(l =>
      (l.regions || []).some(r => (r.items || []).some(it => it.mediaId === id)) || l.background?.mediaId === id);
    if (used.length) return fail(res, `该素材被 ${used.length} 个节目引用（如「${used[0].name}」），请先解除引用`);
    S('media').remove(id);
    if (!S('media').count(x => x.hash === m.hash)) {
      try { fs.unlinkSync(path.join(paths.media, m.rel)); } catch {}
    }
    logger.audit({ action: 'media_delete', userId: user.id, username: user.username, target: id, name: m.name });
    ok(res);
  }));

  router.post('/api/media/folders', guard('media:upload', async (req, res) => {
    const b = await readJson(req);
    if (!b.name) return fail(res, '请填写分类名称');
    ok(res, { item: S('mediaFolders').insert({ id: uid('mf_'), name: b.name, parentId: b.parentId || null }) });
  }));
  router.del('/api/media/folders/:id', guard('media:delete', async (req, res, { id }) => {
    S('media').all().forEach(m => { if (m.folderId === id) S('media').update(m.id, { folderId: null }); });
    S('mediaFolders').remove(id);
    ok(res);
  }));

  /* ================= 节目 / 模板 ================= */
  router.get('/api/layouts', guard('layout:view', async (req, res, p, url) => {
    const type = url.searchParams.get('type') || 'program';
    const q = (url.searchParams.get('q') || '').toLowerCase();
    let items = S('layouts').find(l => (l.type || 'program') === type);
    if (q) items = items.filter(l => l.name.toLowerCase().includes(q));
    items = items.map(l => ({
      id: l.id, name: l.name, type: l.type, width: l.width, height: l.height,
      orientation: l.orientation, duration: l.duration, playMode: l.playMode,
      regionCount: (l.regions || []).length,
      itemCount: (l.regions || []).reduce((a, r) => a + (r.items || []).length, 0),
      approval: l.approval, builtin: !!l.builtin,
      createdAt: l.createdAt, updatedAt: l.updatedAt,
      usedBy: S('schedules').count(s => s.layoutId === l.id),
    })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    items = items.map(l => ({ ...l, ...withLifecycle(l) }));
    ok(res, { items });
  }));

  router.get('/api/layouts/:id', guard('layout:view', async (req, res, { id }) => {
    const l = S('layouts').byId(id);
    if (!l) return fail(res, '节目不存在', 404);
    const ids = new Set();
    (l.regions || []).forEach(r => (r.items || []).forEach(it => it.mediaId && ids.add(it.mediaId)));
    if (l.background?.mediaId) ids.add(l.background.mediaId);
    ok(res, { item: l, media: [...ids].map(i => S('media').byId(i)).filter(Boolean) });
  }));

  router.post('/api/layouts', guard('layout:edit', async (req, res, p, u, user) => {
    const b = await readJson(req);
    const lv = settings().approvalLevel || 0;

    // 闸一：写入拦截
    const mod = moderateLayout(b, user, '新建节目');
    if (!mod.ok) return blockedResponse(res, mod, '新建节目');

    const row = S('layouts').insert({
      id: uid('l_'),
      name: b.name || '未命名节目',
      type: b.type || 'program',
      width: b.width || 1920, height: b.height || 1080,
      orientation: (b.width || 1920) >= (b.height || 1080) ? 'landscape' : 'portrait',
      duration: b.duration || 0,
      validFrom: b.validFrom || null, validUntil: b.validUntil ?? b.validTo ?? null,
      playMode: b.playMode || 'default',
      background: b.background || { color: '#000000', mediaId: null },
      regions: b.regions || [{ id: 'r_1', name: '主区', x: 0, y: 0, w: b.width || 1920, h: b.height || 1080, z: 1, loop: true, transition: 'fade', items: [] }],
      approval: { state: lv === 0 ? 'approved' : 'draft', level: lv, records: [] },
      // 命中 review 级 → 即使系统设为"免审批"，该节目也必须人工复核
      moderation: mod.hits.length ? { level: mod.level, summary: mod.summary, at: Date.now() } : null,
      createdBy: user.id,
    });
    logger.change(user, 'layout_create', row.id, null, row, req);
    ok(res, { item: row, moderation: mod.hits.length ? mod : undefined });
  }));

  router.put('/api/layouts/:id', guard('layout:edit', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const before = S('layouts').byId(id);
    if (!before) return fail(res, '节目不存在', 404);
    if (before.builtin) return fail(res, '内置模板不可修改，请先「另存为」');
    const lv = settings().approvalLevel || 0;

    // 闸一：写入拦截（合并后再查，避免只改一个字段时漏检）
    const merged = { ...before, name: b.name ?? before.name, regions: b.regions ?? before.regions };
    const mod = moderateLayout(merged, user, '编辑节目');
    if (!mod.ok) return blockedResponse(res, mod, '编辑节目');

    // 内容变更后需重新审批
    const contentChanged = JSON.stringify(before.regions) !== JSON.stringify(b.regions ?? before.regions);
    const patch = {
      name: b.name ?? before.name,
      width: b.width ?? before.width, height: b.height ?? before.height,
      orientation: (b.width ?? before.width) >= (b.height ?? before.height) ? 'landscape' : 'portrait',
      duration: b.duration ?? before.duration,
      validFrom: b.validFrom ?? before.validFrom,
      validUntil: b.validUntil ?? b.validTo ?? before.validUntil ?? before.validTo ?? null,
      playMode: b.playMode ?? before.playMode,
      background: b.background ?? before.background,
      regions: b.regions ?? before.regions,
    };
    if (contentChanged && lv > 0)
      patch.approval = { state: 'draft', level: lv, records: before.approval?.records || [] };
    patch.moderation = mod.hits.length ? { level: mod.level, summary: mod.summary, at: Date.now() } : null;
    const row = S('layouts').update(id, patch);
    logger.change(user, 'layout_update', id, before, row, req);
    notifyLayoutChanged(id);
    ok(res, { item: row, moderation: mod.hits.length ? mod : undefined });
  }));

  router.post('/api/layouts/:id/duplicate', guard('layout:edit', async (req, res, { id }, u, user) => {
    const src = S('layouts').byId(id);
    if (!src) return fail(res, '节目不存在', 404);
    const b = await readJson(req).catch(() => ({}));
    const copy = structuredClone(src);
    delete copy.createdAt; delete copy.updatedAt;
    copy.id = uid('l_');
    copy.name = b.name || src.name + ' 副本';
    copy.type = b.type || 'program';
    copy.builtin = false;
    copy.createdBy = user.id;
    const lv = settings().approvalLevel || 0;
    copy.approval = { state: lv === 0 ? 'approved' : 'draft', level: lv, records: [] };
    S('layouts').insert(copy);
    logger.audit({ action: 'layout_duplicate', userId: user.id, from: id, to: copy.id });
    ok(res, { item: copy });
  }));

  router.del('/api/layouts/:id', guard('layout:delete', async (req, res, { id }, u, user) => {
    const l = S('layouts').byId(id);
    if (!l) return fail(res, '节目不存在', 404);
    if (l.builtin) return fail(res, '内置模板不可删除');
    const used = S('schedules').count(s => s.layoutId === id);
    if (used) return fail(res, `该节目被 ${used} 条排期使用，请先删除相关排期`);
    S('layouts').remove(id);
    logger.audit({ action: 'layout_delete', userId: user.id, username: user.username, target: id, name: l.name });
    ok(res);
  }));

  /* -------- 审批流 -------- */
  router.post('/api/layouts/:id/submit', guard('layout:submit', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const l = S('layouts').byId(id);
    if (!l) return fail(res, '节目不存在', 404);
    const lv = settings().approvalLevel || 0;
    if (lv === 0) return fail(res, '当前系统设置为「不审批」，节目可直接发布');
    const approval = l.approval || { records: [] };
    if (approval.state === 'pending') return fail(res, '该节目已在待审批状态，请勿重复提交');

    // 闸二：提审前全量复检（防"先存干净草稿、再改内容"绕过）
    const mod = moderateLayout(l, user, '提交审批');
    if (!mod.ok) return blockedResponse(res, mod, '提交审批');

    const prev = approval.state;
    approval.state = 'pending';
    approval.level = lv;
    approval.currentStep = 1;
    approval.urgency = b.urgency || 'normal';     // normal | urgent | critical
    approval.dueDate = b.dueDate || null;
    approval.records = [...(approval.records || []), {
      at: Date.now(), by: user.id, byName: user.name, action: 'submit',
      comment: b.comment || '', urgency: approval.urgency, dueDate: approval.dueDate,
    }];
    S('layouts').update(id, { approval });
    logger.audit({ action: 'layout_submit', userId: user.id, username: user.username, target: id, urgency: approval.urgency });
    bus.broadcastAdmin('approval:new', { layoutId: id, name: l.name });
    ok(res, { approval });
  }));

  router.post('/api/layouts/:id/approve', guard('layout:approve', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const l = S('layouts').byId(id);
    if (!l) return fail(res, '节目不存在', 404);
    const approval = l.approval || { records: [], level: 1, currentStep: 1 };
    if (approval.state !== 'pending') return fail(res, '该节目当前不在待审批状态');
    const pass = b.pass !== false;

    // 闸二：审批通过前再检一次 —— 审批通过就等于放行上屏，这是最后的机器防线
    if (pass) {
      const mod = moderateLayout(l, user, '审批放行');
      if (!mod.ok) return blockedResponse(res, mod, '审批放行');
      if (mod.needReview && !b.confirmModeration) {
        return json(res, {
          ok: false, needConfirm: true,
          error: `内容存在待复核项，请确认后再放行：${mod.summary}`,
          moderation: { level: mod.level, hits: mod.hits.slice(0, 20) },
        }, 409);
      }
    }

    approval.records = [...(approval.records || []), {
      at: Date.now(), by: user.id, byName: user.name,
      action: pass ? 'approve' : 'reject', step: approval.currentStep || 1, comment: b.comment || '',
    }];
    if (!pass) approval.state = 'rejected';
    else if ((approval.currentStep || 1) >= (approval.level || 1)) approval.state = 'approved';
    else approval.currentStep = (approval.currentStep || 1) + 1;
    S('layouts').update(id, { approval });
    logger.audit({ action: pass ? 'layout_approve' : 'layout_reject', userId: user.id, username: user.username, target: id, step: approval.currentStep });
    if (approval.state === 'approved') notifyLayoutChanged(id);
    ok(res, { approval });
  }));

  router.get('/api/approvals', guard('layout:view', async (req, res, p, url) => {
    const state = url.searchParams.get('state') || 'pending';
    const items = S('layouts').find(l => (l.approval?.state || 'draft') === state && l.type === 'program')
      .map(l => ({
        id: l.id, name: l.name, width: l.width, height: l.height,
        approval: l.approval, updatedAt: l.updatedAt,
        createdByName: S('users').byId(l.createdBy)?.name || '—',
      }))
      .sort((a, b) => {
        const rank = { critical: 0, urgent: 1, normal: 2 };
        return (rank[a.approval?.urgency] ?? 2) - (rank[b.approval?.urgency] ?? 2) || (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    ok(res, { items });
  }));

  /* -------- 模板导入导出 (.lsx) -------- */
  router.get('/api/layouts/:id/export', guard('layout:view', async (req, res, { id }) => {
    const l = S('layouts').byId(id);
    if (!l) return fail(res, '节目不存在', 404);
    const ids = new Set();
    (l.regions || []).forEach(r => (r.items || []).forEach(it => it.mediaId && ids.add(it.mediaId)));
    const pack = {
      format: 'lumasign-layout', version: 1, exportedAt: Date.now(),
      layout: l,
      media: [...ids].map(i => { const m = S('media').byId(i); return m && { id: m.id, name: m.name, hash: m.hash, ext: m.ext, mime: m.mime, size: m.size }; }).filter(Boolean),
    };
    const body = JSON.stringify(pack, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(l.name)}.lsx`,
    });
    res.end(body);
  }));

  router.post('/api/layouts/import', guard('layout:edit', async (req, res, p, u, user) => {
    const pack = await readJson(req);
    if (pack.format !== 'lumasign-layout') return fail(res, '不是有效的 .lsx 节目包');
    const l = structuredClone(pack.layout);
    l.id = uid('l_'); l.builtin = false; l.createdBy = user.id;
    delete l.createdAt; delete l.updatedAt;
    l.name = (l.name || '导入节目') + '（导入）';
    // 素材按 hash 重新映射，缺失的置空并标注
    const missing = [];
    const map = new Map();
    for (const m of pack.media || []) {
      const local = S('media').findOne(x => x.hash === m.hash);
      if (local) map.set(m.id, local.id); else missing.push(m.name);
    }
    (l.regions || []).forEach(r => (r.items || []).forEach(it => {
      if (it.mediaId) it.mediaId = map.get(it.mediaId) || null;
    }));
    S('layouts').insert(l);
    logger.audit({ action: 'layout_import', userId: user.id, target: l.id, missing: missing.length });
    ok(res, { item: l, missing });
  }));

  router.post('/api/layouts/reset-templates', guard('system:setting', async (req, res, p, u, user) => {
    S('layouts').removeWhere(l => l.builtin);
    builtinTemplates().forEach(t => S('layouts').insert(t));
    logger.audit({ action: 'templates_reset', userId: user.id });
    ok(res, { count: 12 });
  }));

  /* ================= 排期 ================= */
  router.get('/api/schedules', guard('schedule:view', async (req, res) => {
    const items = S('schedules').all().map(s => ({
      ...s,
      ...withLifecycle(s),
      layoutName: S('layouts').byId(s.layoutId)?.name || '（节目已删除）',
      targetCount: countTargets(s),
    })).sort((a, b) => (MODE_PRIORITY[b.mode] ?? 0) - (MODE_PRIORITY[a.mode] ?? 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    ok(res, { items, conflicts: detectConflicts(S('schedules').all()) });
  }));

  router.post('/api/schedules', guard('schedule:edit', async (req, res, p, u, user) => {
    const b = await readJson(req);
    if (!b.layoutId || !S('layouts').byId(b.layoutId)) return fail(res, '请选择有效的节目');
    const row = S('schedules').insert({
      id: uid('s_'),
      name: b.name || S('layouts').byId(b.layoutId).name,
      layoutId: b.layoutId,
      mode: b.mode || 'default',
      priority: b.priority || 0, order: b.order || 0,
      target: b.target || { all: false, terminalIds: [], groupIds: [], orgIds: [] },
      dateRange: b.dateRange || null,
      weekdays: b.weekdays || [0, 1, 2, 3, 4, 5, 6],
      timeSlots: b.timeSlots || [['00:00', '24:00']],
      expireAt: b.expireAt || null,
      validFrom: b.validFrom || null, validUntil: b.validUntil || null,
      transferMode: b.transferMode || 'now',   // now | at | plan
      transferAt: b.transferAt || null,
      enabled: b.enabled === true,   // 默认 false（草稿），需手动发布
      createdBy: user.id,
    });
    logger.change(user, 'schedule_create', row.id, null, row, req);
    // 不自动推送：排期创建后为草稿状态，需手动"发布"才 pushToTargets
    ok(res, { item: row });
  }));

  router.put('/api/schedules/:id', guard('schedule:edit', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const before = { ...S('schedules').byId(id) };
    if (!before.id) return fail(res, '排期不存在', 404);
    const row = S('schedules').update(id, b);
    logger.change(user, 'schedule_update', id, before, row, req);
    pushToTargets(row); pushToTargets(before);
    ok(res, { item: row });
  }));

  router.del('/api/schedules/:id', guard('schedule:edit', async (req, res, { id }, u, user) => {
    const s = S('schedules').byId(id);
    if (!s) return fail(res, '排期不存在', 404);
    S('schedules').remove(id);
    logger.audit({ action: 'schedule_delete', userId: user.id, username: user.username, target: id, name: s.name });
    pushToTargets(s);
    ok(res);
  }));

  router.post('/api/schedules/:id/publish', guard('schedule:publish', async (req, res, { id }, u, user) => {
    const s = S('schedules').byId(id);
    if (!s) return fail(res, '排期不存在', 404);
    const l = S('layouts').byId(s.layoutId);
    if (l?.approval && l.approval.state !== 'approved')
      return fail(res, '该节目尚未通过审批，无法发布');

    // 闸三：下发前最后复检 —— 哪怕数据被人直接改过磁盘 JSON，也过不去这一关
    if (l) {
      const mod = moderateLayout(l, user, '排期发布');
      if (!mod.ok) return blockedResponse(res, mod, '排期发布');
    }

    S('schedules').update(id, { enabled: true, publishedAt: Date.now(), publishedBy: user.id });
    const n = pushToTargets(s);
    logger.audit({ action: 'schedule_publish', userId: user.id, username: user.username, target: id, terminals: n });
    ok(res, { pushed: n });
  }));

  /* ================= 用户 / 角色 ================= */
  router.get('/api/users', guard('user:view', async (req, res) => {
    ok(res, {
      items: S('users').all().map(u => publicUser(u, auth)),
      roles: S('roles').all(),
      orgs: S('orgs').all(),
      permissions: PERMISSIONS,
    });
  }));

  router.post('/api/users', guard('user:edit', async (req, res, p, u, user) => {
    const b = await readJson(req);
    if (!b.username) return fail(res, '请填写用户名');
    if (S('users').findOne(x => x.username === b.username)) return fail(res, '用户名已存在');
    const err = checkPasswordStrength(b.password);
    if (err) return fail(res, err);
    const row = S('users').insert({
      id: uid('u_'), username: b.username, name: b.name || b.username,
      password: hashPassword(b.password),
      roleIds: b.roleIds || ['role_viewer'], orgId: b.orgId || 'org_root',
      email: b.email || '', phone: b.phone || '', disabled: false, mustChangePassword: true,
    });
    logger.audit({ action: 'user_create', userId: user.id, username: user.username, target: row.id, targetName: b.username });
    ok(res, { item: publicUser(row, auth) });
  }));

  router.put('/api/users/:id', guard('user:edit', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const before = S('users').byId(id);
    if (!before) return fail(res, '用户不存在', 404);
    if (id === 'u_admin' && b.disabled) return fail(res, '不能停用内置超级管理员');
    const patch = {};
    for (const k of ['name', 'roleIds', 'orgId', 'email', 'phone', 'disabled']) if (b[k] !== undefined) patch[k] = b[k];
    if (b.password) {
      const err = checkPasswordStrength(b.password);
      if (err) return fail(res, err);
      patch.password = hashPassword(b.password);
      patch.mustChangePassword = true;
      auth.destroyUserSessions(id);
    }
    const row = S('users').update(id, patch);
    logger.change(user, 'user_update', id, { ...before, password: '***' }, { ...row, password: '***' }, req);
    ok(res, { item: publicUser(row, auth) });
  }));

  router.del('/api/users/:id', guard('user:edit', async (req, res, { id }, u, user) => {
    if (id === 'u_admin') return fail(res, '内置超级管理员不可删除');
    if (id === user.id) return fail(res, '不能删除自己');
    const t = S('users').byId(id);
    S('users').remove(id);
    auth.destroyUserSessions(id);
    logger.audit({ action: 'user_delete', userId: user.id, username: user.username, target: id, targetName: t?.username });
    ok(res);
  }));

  router.get('/api/roles', guard('user:view', async (req, res) =>
    ok(res, { items: S('roles').all(), permissions: PERMISSIONS, all: ALL_PERMS })));

  router.post('/api/roles', guard('role:edit', async (req, res, p, u, user) => {
    const b = await readJson(req);
    if (!b.name) return fail(res, '请填写角色名称');
    const row = S('roles').insert({ id: uid('role_'), name: b.name, desc: b.desc || '', perms: b.perms || [], builtin: false });
    logger.audit({ action: 'role_create', userId: user.id, target: row.id });
    ok(res, { item: row });
  }));
  router.put('/api/roles/:id', guard('role:edit', async (req, res, { id }, u, user) => {
    const b = await readJson(req);
    const before = S('roles').byId(id);
    if (!before) return fail(res, '角色不存在', 404);
    if (before.builtin && id === 'role_super') return fail(res, '超级管理员角色不可修改');
    const row = S('roles').update(id, { name: b.name, desc: b.desc, perms: b.perms });
    logger.change(user, 'role_update', id, before, row, req);
    ok(res, { item: row });
  }));
  router.del('/api/roles/:id', guard('role:edit', async (req, res, { id }, u, user) => {
    const r = S('roles').byId(id);
    if (r?.builtin) return fail(res, '内置角色不可删除');
    if (S('users').count(x => (x.roleIds || []).includes(id))) return fail(res, '仍有用户使用该角色');
    S('roles').remove(id);
    logger.audit({ action: 'role_delete', userId: user.id, target: id });
    ok(res);
  }));

  /* ================= 日志 / 播放证明 ================= */
  router.get('/api/logs', guard('log:view', async (req, res, p, url) => {
    const kind = url.searchParams.get('kind') || 'audit';
    const from = url.searchParams.get('from') || undefined;
    const to = url.searchParams.get('to') || undefined;
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const limit = Math.min(2000, parseInt(url.searchParams.get('limit') || '300', 10));
    const items = logger.query({
      kind, from, to, limit,
      filter: q ? r => JSON.stringify(r).toLowerCase().includes(q) : undefined,
    });
    ok(res, { items, kinds: ['audit', 'task', 'system', 'play'] });
  }));

  router.get('/api/logs/export', guard('log:view', async (req, res, p, url) => {
    const kind = url.searchParams.get('kind') || 'audit';
    const items = logger.query({ kind, from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined, limit: 100000 });
    const cols = [...new Set(items.flatMap(Object.keys))];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [cols.join(','), ...items.map(r => cols.map(c =>
      esc(c === 'ts' ? new Date(r.ts).toLocaleString('zh-CN') : typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])).join(','))].join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lumasign-${kind}-${Date.now()}.csv"`,
    });
    res.end(csv);
  }));

  router.get('/api/proof-of-play', guard('log:view', async (req, res, p, url) => {
    ok(res, {
      items: logger.proofOfPlay({
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        terminalId: url.searchParams.get('terminalId') || undefined,
      }),
    });
  }));

  /* ================= 告警 ================= */
  router.get('/api/alerts', guard('dashboard:view', async (req, res, p, url) => {
    const resolved = url.searchParams.get('resolved') === '1';
    ok(res, { items: S('alerts').find(a => !!a.resolved === resolved).slice(-300).reverse() });
  }));
  router.post('/api/alerts/:id/resolve', guard('terminal:edit', async (req, res, { id }, u, user) => {
    S('alerts').update(id, { resolved: true, resolvedBy: user.id, resolvedAt: Date.now() });
    ok(res);
  }));
  router.post('/api/alerts/resolve-all', guard('terminal:edit', async (req, res, p, u, user) => {
    let n = 0;
    S('alerts').all().forEach(a => { if (!a.resolved) { S('alerts').update(a.id, { resolved: true, resolvedBy: user.id, resolvedAt: Date.now() }); n++; } });
    ok(res, { count: n });
  }));

  /* ================= APK 升级包 ================= */
  router.get('/api/apks', guard('terminal:view', async (req, res) =>
    ok(res, { items: S('apks').all().slice().sort((a, b) => b.createdAt - a.createdAt) })));

  router.post('/api/apks', guard('terminal:upgrade', async (req, res, p, u, user) => {
    const parsed = await parseMultipart(req, paths.tmp);
    const f = parsed.files[0];
    if (!f) return fail(res, '请选择 APK 文件');
    const buf = fs.readFileSync(f.tmpPath);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const dest = path.join(paths.apk, `${md5}.apk`);
    fs.mkdirSync(paths.apk, { recursive: true });
    fs.renameSync(f.tmpPath, dest);
    const row = S('apks').insert({
      id: uid('apk_'), name: f.filename,
      versionName: parsed.fields.versionName || '', versionCode: parseInt(parsed.fields.versionCode || '0', 10),
      note: parsed.fields.note || '', md5, size: f.size,
      url: `/api/t/apk/${md5}.apk`, uploadedBy: user.id,
    });
    logger.audit({ action: 'apk_upload', userId: user.id, target: row.id, version: row.versionName });
    ok(res, { item: row });
  }));

  router.del('/api/apks/:id', guard('terminal:upgrade', async (req, res, { id }) => {
    const a = S('apks').byId(id);
    if (a) { try { fs.unlinkSync(path.join(paths.apk, `${a.md5}.apk`)); } catch {} S('apks').remove(id); }
    ok(res);
  }));

  /* ================= 系统设置 ================= */
  router.get('/api/settings', guard('dashboard:view', async (req, res) => {
    const s = { ...settings() };
    if (s.alert?.email) s.alert.email = { ...s.alert.email, pass: s.alert.email.pass ? '******' : '' };
    ok(res, {
      settings: s,
      lan: { ips: lanIPs(), primary: primaryIP(), port: ctx.port },
      version: '1.0.0',
      node: process.version,
      platform: process.platform,
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().rss / 1048576),
      dataDir: paths.root,
    });
  }));

  router.put('/api/settings', guard('system:setting', async (req, res, p, u, user) => {
    const b = await readJson(req);
    const before = { ...settings() };
    if (b.alert?.email?.pass === '******') b.alert.email.pass = before.alert?.email?.pass || '';
    const row = S('settings').update('settings', b);
    if (b.downloadLimitKBps !== undefined) ctx.limiter.setRate((b.downloadLimitKBps || 0) * 1024);
    logger.change(user, 'settings_update', 'settings', before, row, req);
    ok(res, { settings: row });
  }));

  router.post('/api/system/purge-logs', guard('system:setting', async (req, res, p, u, user) => {
    const n = logger.purge(settings().retentionDays || 180);
    logger.audit({ action: 'logs_purge', userId: user.id, files: n });
    ok(res, { files: n });
  }));

  /* -------- 离线包导出（U 盘脱机发布） -------- */
  router.get('/api/offline-package/:terminalId', guard('schedule:publish', async (req, res, { terminalId }) => {
    const t = S('terminals').byId(terminalId);
    if (!t) return fail(res, '终端不存在', 404);
    const mf = buildManifest(store, t);
    const pack = {
      format: 'lumasign-offline', version: 1, generatedAt: Date.now(),
      terminal: { id: t.id, name: t.name, code: t.code },
      manifest: { version: Date.now(), schedules: mf.schedules },
      assets: mf.assets.map(a => ({ ...a, file: `media/${a.hash}` })),
      instruction: '将本目录整体拷贝到 U 盘根目录并命名为 LUMASIGN_OFFLINE，插入终端即自动导入。',
    };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="LUMASIGN_OFFLINE_${t.code || t.id}.json"`,
    });
    res.end(JSON.stringify(pack, null, 2));
  }));

  /* ================= 内部工具 ================= */
  function scopedTerminals(user) {
    const scope = auth.orgScope(user);
    const all = S('terminals').all();
    return scope === null ? all : all.filter(t => scope.has(t.orgId));
  }
  function countTargets(s) {
    const t = s.target || {};
    if (t.all) return S('terminals').count();
    const set = new Set(t.terminalIds || []);
    S('terminals').all().forEach(term => {
      if ((t.groupIds || []).some(g => (term.groupIds || []).includes(g))) set.add(term.id);
      if ((t.orgIds || []).includes(term.orgId)) set.add(term.id);
    });
    return set.size;
  }
  function targetTerminalIds(s) {
    const t = s.target || {};
    if (t.all) return S('terminals').all().map(x => x.id);
    const set = new Set(t.terminalIds || []);
    S('terminals').all().forEach(term => {
      if ((t.groupIds || []).some(g => (term.groupIds || []).includes(g))) set.add(term.id);
      if ((t.orgIds || []).includes(term.orgId)) set.add(term.id);
    });
    return [...set];
  }
  function pushToTargets(s) {
    const ids = targetTerminalIds(s);
    ids.forEach(id => bus.send(id, 'refresh_manifest', {}, { ack: false }));
    bus.broadcastAdmin('manifest:changed', { scheduleId: s.id, terminals: ids.length });
    return ids.length;
  }
  function notifyLayoutChanged(layoutId) {
    const affected = S('schedules').find(s => s.layoutId === layoutId);
    affected.forEach(pushToTargets);
  }
}

/* ================= 辅助 ================= */
function publicUser(u, auth) {
  const { password, _sid, ...rest } = u;
  return { ...rest, perms: auth.permsOf(u) };
}
/**
 * 密码强度校验：委托给 security.js 的统一实现。
 * 除长度/字符类别外，还挡住 admin123 / lumasign 这类"部署后没改的默认口令"——
 * 实战里绝大多数标牌系统被拿下，都是死在这上面。
 */
function checkPasswordStrength(pw) {
  const r = passwordStrength(pw);
  return r.ok ? null : `密码不符合安全要求：${r.issues.join('；')}`;
}
function decorateTerminal(t, threshold, bus) {
  const now = Date.now();
  const online = !!(t.lastHeartbeat && now - t.lastHeartbeat < threshold);
  // 内联 latestShot 逻辑（原函数定义在 registerAdminApi 闭包内，此处无法引用）
  let shot = null;
  try {
    const dir = path.join(paths.shots, t.id);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => /^\d+(\.\w+)?$/.test(f));
      if (files.length) {
        files.sort((a, b) => Number(b.split('.')[0] || 0) - Number(a.split('.')[0] || 0));
        const f = files[0];
        shot = { file: f, url: `/api/terminals/${t.id}/shot/${f}`, ts: Number(f.split('.')[0]) || 0 };
      }
    }
  } catch { /* ignore */ }
  return {
    ...t,
    status: !t.lastHeartbeat ? 'never' : online ? 'online' : 'offline',
    linked: bus.isLinked(t.id),
    offlineSeconds: t.lastHeartbeat ? Math.floor((now - t.lastHeartbeat) / 1000) : null,
    lastShot: shot,
  };
}
