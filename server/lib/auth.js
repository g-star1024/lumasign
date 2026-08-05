/**
 * 灵屏 LumaSign · 认证与 RBAC
 * PBKDF2-SHA512 10 万轮加盐；内存会话（重启失效，符合安全预期）；
 * 权限双维度：功能维度（permission）+ 数据维度（机构树 orgScope）。
 */
import crypto from 'node:crypto';

const ITER = 100000, KEYLEN = 64, DIGEST = 'sha512';
const SESSION_TTL = 8 * 3600 * 1000;
const LOCK_THRESHOLD = 5, LOCK_MS = 10 * 60 * 1000;

export function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.pbkdf2Sync(pw, salt, ITER, KEYLEN, DIGEST).toString('hex');
  return `pbkdf2$${ITER}$${salt}$${h}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [, iter, salt, h] = stored.split('$');
    const calc = crypto.pbkdf2Sync(pw, salt, parseInt(iter, 10), KEYLEN, DIGEST).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(h, 'hex'));
  } catch { return false; }
}

/* ---------------- 权限点定义 ---------------- */
export const PERMISSIONS = {
  'dashboard:view': '查看仪表盘',
  'terminal:view': '查看终端', 'terminal:edit': '编辑终端', 'terminal:delete': '删除终端',
  'terminal:approve': '审批终端接入', 'terminal:control': '远程控制终端', 'terminal:upgrade': '终端升级',
  'media:view': '查看素材', 'media:upload': '上传素材', 'media:delete': '删除素材',
  'layout:view': '查看节目', 'layout:edit': '编辑节目', 'layout:delete': '删除节目',
  'layout:submit': '提交审批', 'layout:approve': '审批节目',
  'schedule:view': '查看排期', 'schedule:edit': '编辑排期', 'schedule:publish': '发布下发',
  'message:insert': '插播消息',
  'user:view': '查看用户', 'user:edit': '管理用户', 'role:edit': '管理角色',
  'log:view': '查看日志', 'system:setting': '系统设置',
};
export const ALL_PERMS = Object.keys(PERMISSIONS);

export const DEFAULT_ROLES = [
  { id: 'role_super', name: '超级管理员', builtin: true, perms: ['*'],
    desc: '拥有全部权限，可管理用户、角色与系统设置' },
  { id: 'role_maker', name: '制作管理员', builtin: true,
    perms: ['dashboard:view','terminal:view','media:view','media:upload','media:delete',
            'layout:view','layout:edit','layout:delete','layout:submit',
            'schedule:view','schedule:edit','log:view'],
    desc: '负责素材与节目制作，提交审批但不能直接发布' },
  { id: 'role_approver', name: '审批管理员', builtin: true,
    perms: ['dashboard:view','terminal:view','media:view','layout:view','layout:approve',
            'schedule:view','schedule:publish','log:view'],
    desc: '负责节目内容审批与发布放行' },
  { id: 'role_area', name: '辖区管理员', builtin: true,
    perms: ['dashboard:view','terminal:view','terminal:edit','terminal:control',
            'media:view','layout:view','schedule:view','schedule:edit','schedule:publish',
            'message:insert','log:view'],
    desc: '仅可管理本机构及下级机构的终端与发布' },
  { id: 'role_viewer', name: '只读观察员', builtin: true,
    perms: ['dashboard:view','terminal:view','media:view','layout:view','schedule:view','log:view'],
    desc: '只能查看，不能做任何修改' },
];

export class Auth {
  constructor(store) {
    this.store = store;
    this.sessions = new Map();   // sid -> { userId, exp, ip, ua }
    this.failures = new Map();   // username -> { count, until }
    setInterval(() => this.gc(), 60000).unref?.();
  }
  gc() {
    const now = Date.now();
    for (const [k, v] of this.sessions) if (v.exp < now) this.sessions.delete(k);
    for (const [k, v] of this.failures) if (v.until && v.until < now) this.failures.delete(k);
  }

  isLocked(username) {
    const f = this.failures.get(username);
    return !!(f && f.until && f.until > Date.now());
  }
  lockRemaining(username) {
    const f = this.failures.get(username);
    return f && f.until ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  }
  noteFailure(username) {
    const f = this.failures.get(username) || { count: 0, until: 0 };
    f.count++;
    if (f.count >= LOCK_THRESHOLD) { f.until = Date.now() + LOCK_MS; f.count = 0; }
    this.failures.set(username, f);
  }
  clearFailure(username) { this.failures.delete(username); }

  createSession(userId, req) {
    const sid = crypto.randomBytes(32).toString('hex');
    this.sessions.set(sid, {
      userId, exp: Date.now() + SESSION_TTL,
      ip: req.socket.remoteAddress, ua: req.headers['user-agent'] || '',
    });
    return sid;
  }
  destroySession(sid) { this.sessions.delete(sid); }
  destroyUserSessions(userId) {
    for (const [k, v] of this.sessions) if (v.userId === userId) this.sessions.delete(k);
  }

  /** 从请求中还原当前用户；同时滑动续期 */
  userFromReq(req) {
    const cookie = req.headers.cookie || '';
    const m = /lumasign_sid=([a-f0-9]+)/.exec(cookie);
    const sid = m ? m[1] : (req.headers['x-session'] || '');
    if (!sid) return null;
    const s = this.sessions.get(sid);
    if (!s || s.exp < Date.now()) { if (s) this.sessions.delete(sid); return null; }
    s.exp = Date.now() + SESSION_TTL;
    const user = this.store.col('users').byId(s.userId);
    if (!user || user.disabled) return null;
    return { ...user, _sid: sid };
  }

  permsOf(user) {
    if (!user) return [];
    const roles = this.store.col('roles').all();
    const set = new Set();
    for (const rid of user.roleIds || []) {
      const r = roles.find(x => x.id === rid);
      if (!r) continue;
      if (r.perms.includes('*')) return ['*'];
      r.perms.forEach(p => set.add(p));
    }
    return [...set];
  }
  can(user, perm) {
    const p = this.permsOf(user);
    return p.includes('*') || p.includes(perm);
  }

  /** 数据维度：该用户可见的机构 id 集合（null = 全部） */
  orgScope(user) {
    if (!user) return new Set();
    if (this.permsOf(user).includes('*')) return null;
    if (!user.orgId || user.orgId === 'org_root') return null;
    const orgs = this.store.col('orgs').all();
    const result = new Set([user.orgId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const o of orgs) if (o.parentId && result.has(o.parentId) && !result.has(o.id)) { result.add(o.id); changed = true; }
    }
    return result;
  }
  inScope(user, orgId) {
    const s = this.orgScope(user);
    return s === null || s.has(orgId);
  }
}

export function sessionCookie(sid, secure = false) {
  return `lumasign_sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure ? '; Secure' : ''}`;
}
export const clearCookie = () => 'lumasign_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
