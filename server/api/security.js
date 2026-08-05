/**
 * 灵屏 LumaSign · 安全管理 API
 *
 * 把 server.js 主链路上挂的「安全组件」暴露成可运维的接口，让管理员在界面上：
 *   ① 安全网络隔离（LAN-only / IP 黑白名单）—— 对应 security.js 的 lanOnlyGuard / ipListGuard
 *   ② 实时查看被限速自动封禁的 IP，并支持手动封禁 / 解封 —— 对应 ApiGuard
 *   ③ 审计哈希链校验 —— 对应 AuditChain.verify（内鬼防线，事后改日志会断链）
 *   ④ 内容合规运维（开关 / URL 白名单 / 在线增删敏感词 / 一键试审 / 待复核清单）
 *   ⑤ 安全态势总览 —— 把上面几块汇总成一个 dashboard 卡片数据
 *
 * 权限：配置类需 system:setting；只读（封禁列表、审计校验、合规试审）需 system:setting 或 log:view。
 * 这里统一用 system:setting 兜底，避免低权限账号窥探安全态势；合规试审额外对内容制作岗开放。
 */
import { json, fail, readJson } from '../lib/http.js';
import { normalizeIp } from '../lib/security.js';

export function registerSecurityApi(router, ctx) {
  const { store, auth, logger, apiGuard, auditChain, moderator } = ctx;
  const S = n => store.col(n);
  const settings = () => S('settings').byId('settings');

  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = auth.userFromReq(req);
    if (!user) return fail(res, '未登录或会话已过期', 401);
    if (perm && !auth.can(user, perm)) return fail(res, '没有权限执行此操作', 403);
    return handler(req, res, params, url, user);
  };

  const body = async (req) => { try { return await readJson(req); } catch { return {}; } };
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n,，]/).map(s => s.trim()).filter(Boolean));

  /* ════════════════════════════════════════════════
   * ① 安全网络隔离设置
   * ══════════════════════════════════════════════ */

  router.get('/api/admin/security/settings', guard('system:setting', (req, res) => {
    const s = settings();
    const sec = s.security || {};
    return json(res, {
      ok: true,
      security: {
        lanOnly: !!sec.lanOnly,
        allowIps: sec.allowIps || [],
        denyIps: sec.denyIps || [],
      },
    });
  }));

  router.post('/api/admin/security/settings', guard('system:setting', async (req, res, p, u, user) => {
    const b = await body(req);
    const before = settings().security || {};
    // 只允许写入我们真正消费的几个字段，避免把任意对象塞进 settings.security
    const patch = {};
    if (typeof b.lanOnly === 'boolean') patch.lanOnly = b.lanOnly;
    patch.allowIps = list(b.allowIps).slice(0, 500);
    patch.denyIps = list(b.denyIps).slice(0, 500);

    const after = S('settings').update('settings', { security: { ...before, ...patch } });
    logger.change(user, 'security_settings', '安全网络隔离设置',
      { lanOnly: before.lanOnly, allowIps: before.allowIps, denyIps: before.denyIps },
      { lanOnly: patch.lanOnly, allowIps: patch.allowIps, denyIps: patch.denyIps },
      req);
    return json(res, { ok: true, security: after.security || {} });
  }));

  /* ════════════════════════════════════════════════
   * ② IP 封禁（限速自动封禁 + 手动）
   * ══════════════════════════════════════════════ */

  router.get('/api/admin/security/bans', guard('system:setting', (req, res) => {
    return json(res, { ok: true, bans: apiGuard.bannedList(), banMinutes: Math.round(apiGuard.banMs / 60000) });
  }));

  router.post('/api/admin/security/ban', guard('system:setting', async (req, res, p, u, user) => {
    const b = await body(req);
    const ip = String(b.ip || '').trim();
    if (!ip) return fail(res, '请提供要封禁的 IP');
    const minutes = Math.max(1, Math.min(10080, +b.minutes || 60));
    const n = normalizeIp(ip);
    apiGuard.bans.set(n, Date.now() + minutes * 60000);
    apiGuard.strikes.delete(n);
    logger.audit({
      userId: user.id, username: user.username,
      action: 'security_ip_banned_manual', target: `手动封禁 ${ip} ${minutes} 分钟`, ip,
    });
    return json(res, { ok: true, ip, minutes });
  }));

  router.post('/api/admin/security/unban', guard('system:setting', async (req, res, p, u, user) => {
    const b = await body(req);
    const ip = String(b.ip || '').trim();
    if (!ip) return fail(res, '请提供要解封的 IP');
    apiGuard.unban(ip);
    logger.audit({
      userId: user.id, username: user.username,
      action: 'security_ip_unbanned', target: `解封 ${ip}`, ip,
    });
    return json(res, { ok: true, ip });
  }));

  /* ════════════════════════════════════════════════
   * ③ 审计哈希链校验（内鬼防线）
   * 把所有审计日志读出来，逐条验证 prev/hash 链的连续性。
   * 任何人用编辑器直接增删改日志文件，都会导致链断裂 → ok:false + broken 定位。
   * ══════════════════════════════════════════════ */

  router.post('/api/admin/security/audit/verify', guard('system:setting', (req, res) => {
    const lines = logger.query({ kind: 'audit', limit: 5_000_000 });
    const result = auditChain.verify(lines);
    return json(res, { ok: true, ...result });
  }));

  /* ════════════════════════════════════════════════
   * ④ 内容合规运维
   * ══════════════════════════════════════════════ */

  // 概览（读 + 试审对内容岗开放）
  router.get('/api/admin/security/moderation', guard('layout:view', (req, res) => {
    const st = moderator.stats();
    return json(res, {
      ok: true,
      config: {
        enabled: st.enabled,
        blockOnHit: moderator.config.blockOnHit,
        requireReviewForUnknownUrl: moderator.config.requireReviewForUnknownUrl,
        urlWhitelist: moderator.config.urlWhitelist || [],
        disabledCategories: moderator.config.disabledCategories || [],
      },
      stats: st,
    });
  }));

  // 配置（开关 / URL 白名单 / 类目启用）
  router.post('/api/admin/security/moderation/config', guard('system:setting', async (req, res, p, u, user) => {
    const b = await body(req);
    const patch = {};
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    if (typeof b.blockOnHit === 'boolean') patch.blockOnHit = b.blockOnHit;
    if (typeof b.requireReviewForUnknownUrl === 'boolean') patch.requireReviewForUnknownUrl = b.requireReviewForUnknownUrl;
    if ('urlWhitelist' in b) patch.urlWhitelist = list(b.urlWhitelist).slice(0, 500);
    if ('disabledCategories' in b) patch.disabledCategories = list(b.disabledCategories).slice(0, 64);

    const cfg = moderator.setConfig(patch);
    logger.change(user, 'moderation_config', '内容合规设置', {}, patch, req);
    return json(res, {
      ok: true,
      config: {
        enabled: cfg.enabled, blockOnHit: cfg.blockOnHit,
        requireReviewForUnknownUrl: cfg.requireReviewForUnknownUrl,
        urlWhitelist: cfg.urlWhitelist, disabledCategories: cfg.disabledCategories,
      },
    });
  }));

  // 在线增删敏感词（按类目）
  router.post('/api/admin/security/moderation/words', guard('system:setting', async (req, res, p, u, user) => {
    const b = await body(req);
    const cat = String(b.category || '').trim();
    if (!cat) return fail(res, '缺少 category（类目）');
    if (!['add', 'remove'].includes(b.action)) return fail(res, 'action 必须是 add 或 remove');
    const words = list(b.words);
    if (!words.length) return fail(res, '请提供至少一个词');

    let n = 0;
    if (b.action === 'add') n = moderator.addWords(cat, words);
    else n = moderator.removeWords(cat, words);

    logger.audit({
      userId: user.id, username: user.username,
      action: 'moderation_words',
      target: `${b.action === 'add' ? '新增' : '移除'}「${cat}」类 ${words.length} 个词`,
    });
    return json(res, { ok: true, count: n, category: cat, stats: moderator.stats() });
  }));

  // 一键试审（文本 / URL / 完整节目）
  router.post('/api/admin/security/moderation/test', guard('layout:view', async (req, res) => {
    const b = await body(req);
    const out = {};
    if (b.text != null) out.text = moderator.check(String(b.text), { scene: 'text' });
    if (b.url != null) out.url = moderator.checkUrl(String(b.url));
    if (b.layout != null) out.layout = moderator.checkLayout(b.layout);
    return json(res, { ok: true, ...out });
  }));

  // 待人工复核清单（写入时已标记 needReview 的节目）
  router.get('/api/admin/security/moderation/pending', guard('layout:view', (req, res) => {
    const items = S('layouts').find(l => l.moderation && l.moderation.needReview)
      .map(l => ({
        id: l.id, name: l.name, type: l.type,
        level: l.moderation.level, summary: l.moderation.summary || '',
        hitCount: (l.moderation.hits || []).length,
        approvalState: l.approval?.state || 'none',
      }));
    return json(res, { ok: true, count: items.length, items });
  }));

  /* ════════════════════════════════════════════════
   * ⑤ 安全态势总览（dashboard 卡片）
   * ══════════════════════════════════════════════ */

  router.get('/api/admin/security/overview', guard('system:setting', (req, res) => {
    const sec = settings().security || {};
    const recent = logger.query({
      kind: 'audit', limit: 1000,
      filter: r => r.action && /^security_/.test(r.action),
    });
    return json(res, {
      ok: true,
      posture: {
        lanOnly: !!sec.lanOnly,
        allowlist: (sec.allowIps || []).length,
        denylist: (sec.denyIps || []).length,
        moderationEnabled: moderator.config.enabled,
        urlWhitelistCount: (moderator.config.urlWhitelist || []).length,
        bannedNow: apiGuard.bannedList().length,
        recentSecurityEvents: recent.length,
      },
      bans: apiGuard.bannedList(),
      recentSecurityEvents: recent.slice(0, 20),
    });
  }));
}
