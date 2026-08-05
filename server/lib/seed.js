/**
 * 灵屏 LumaSign · 首次运行初始化
 * 建立默认管理员、角色、机构、终端分组、内置节目模板与系统设置。
 */
import crypto from 'node:crypto';
import { hashPassword, DEFAULT_ROLES } from './auth.js';

export const DEFAULT_SETTINGS = {
  id: 'settings',
  serverName: '灵屏标牌管理中心',
  httpPort: 7788,
  heartbeatInterval: 15,
  offlineThreshold: 60,            // 秒，超过则判离线
  autoApproveTerminal: false,      // 新终端是否自动准入
  approvalLevel: 0,                // 0=不审批 1=一级 2=二级
  monitorToken: crypto.randomBytes(10).toString('hex'),  // 监看墙只读 token（大屏端用）
  downloadLimitKBps: 0,            // 全局下发限速，0=不限
  perTerminalLimitKBps: 0,
  transferWindow: null,            // { start:'02:00', end:'06:00' } 计划传输窗口
  retentionDays: 180,
  accent: 'blue',
  theme: 'system',                 // light | dark | system
  alert: {
    offlineEnabled: true,
    offlineMinutes: 5,
    storageLowPercent: 10,
    email: { enabled: false, host: '', port: 465, secure: true, user: '', pass: '', to: '' },
    webhook: { enabled: false, url: '', type: 'wecom' },  // wecom | dingtalk | feishu | custom
  },
  lifecycle: {                     // 内容有效期与自动下线
    enabled: true,
    warnDays: 3,                   // 到期前几天开始提醒
    sweepMinutes: 10,              // 巡检间隔
    autoArchive: true,             // 过期后自动归档（不删除，可恢复）
    archiveGraceDays: 0,
  },
  health: {                        // 终端健康度阈值（P0-3）
    storageWarn: 20, storageCrit: 10,   // 剩余空间 %
    tempWarn: 60, tempCrit: 75,         // CPU 温度 °C
    cpuWarn: 80, cpuCrit: 95,           // 占用 %
    memWarn: 80, memCrit: 95,           // 占用 %
    latWarn: 300, latCrit: 800,         // 心跳 RTT ms
    crashWarn: 1, crashCrit: 5,         // 累计崩溃次数
  },
  weather: { city: '深圳', source: 'manual', manual: { temp: 28, text: '晴', humidity: 60 } },
};

const T = (name, w, h, regions) => ({
  name, type: 'template', width: w, height: h,
  orientation: w >= h ? 'landscape' : 'portrait',
  duration: 0, playMode: 'default',
  background: { color: '#000000', mediaId: null },
  regions, approval: { state: 'approved', level: 0, records: [] },
  builtin: true,
});
const R = (id, name, x, y, w, h, z = 1, items = []) =>
  ({ id, name, x, y, w, h, z, loop: true, transition: 'fade', items });

/** 12 套内置模板：横屏 6 + 竖屏 6 */
export function builtinTemplates() {
  const W = 1920, H = 1080, PW = 1080, PH = 1920;
  return [
    T('横屏 · 全屏单区', W, H, [R('r1', '主区', 0, 0, W, H)]),
    T('横屏 · 主视频 + 底部字幕', W, H, [
      R('r1', '主视频', 0, 0, W, H - 80),
      R('r2', '滚动字幕', 0, H - 80, W, 80, 10, [{
        id: 'i1', widget: 'marquee', text: '欢迎光临 · 请在此编辑滚动内容',
        fontSize: 40, color: '#FFFFFF', bg: 'rgba(0,0,0,0.55)', speed: 60, duration: 0,
      }]),
    ]),
    T('横屏 · 左视频 + 右图文', W, H, [
      R('r1', '视频区', 0, 0, 1360, H),
      R('r2', '图文区', 1360, 0, 560, H, 2),
    ]),
    T('横屏 · 三分栏', W, H, [
      R('r1', '主区', 0, 0, 1340, 810),
      R('r2', '右上', 1340, 0, 580, 810, 2),
      R('r3', '底部条', 0, 810, W, 270, 3),
    ]),
    T('横屏 · 顶栏 + 主区 + 时钟', W, H, [
      R('r1', '顶部标题', 0, 0, W, 120, 5, [{
        id: 'i1', widget: 'text', html: '<b>企业信息发布平台</b>',
        fontSize: 56, color: '#FFFFFF', align: 'center', duration: 0,
      }]),
      R('r2', '主区', 0, 120, 1560, 960),
      R('r3', '时钟', 1560, 120, 360, 960, 4, [{
        id: 'i2', widget: 'clock', format: 'digital', showDate: true, fontSize: 64, duration: 0,
      }]),
    ]),
    T('横屏 · 画中画', W, H, [
      R('r1', '背景大屏', 0, 0, W, H),
      R('r2', '右下小窗', 1420, 740, 460, 260, 9),
    ]),

    T('竖屏 · 全屏单区', PW, PH, [R('r1', '主区', 0, 0, PW, PH)]),
    T('竖屏 · 上视频 + 下图文', PW, PH, [
      R('r1', '视频区', 0, 0, PW, 1200),
      R('r2', '图文区', 0, 1200, PW, PH - 1200, 2),
    ]),
    T('竖屏 · 海报 + 二维码', PW, PH, [
      R('r1', '主海报', 0, 0, PW, 1560),
      R('r2', '二维码区', 0, 1560, PW, 360, 3, [{
        id: 'i1', widget: 'qrcode', content: 'https://example.com',
        size: 280, fgColor: '#000000', bgColor: '#FFFFFF', duration: 0,
      }]),
    ]),
    T('竖屏 · 三段式', PW, PH, [
      R('r1', '顶部', 0, 0, PW, 400),
      R('r2', '中部主区', 0, 400, PW, 1120, 2),
      R('r3', '底部字幕', 0, 1520, PW, 400, 3),
    ]),
    T('竖屏 · 楼层导览', PW, PH, [
      R('r1', '标题', 0, 0, PW, 220, 5, [{
        id: 'i1', widget: 'text', html: '<b>楼层导览</b>', fontSize: 72,
        color: '#FFFFFF', align: 'center', duration: 0,
      }]),
      R('r2', '导览内容', 0, 220, PW, 1480, 2),
      R('r3', '时间', 0, 1700, PW, 220, 3, [{
        id: 'i2', widget: 'clock', format: 'digital', showDate: true, fontSize: 56, duration: 0,
      }]),
    ]),
    T('竖屏 · 会议室门口屏', PW, PH, [
      R('r1', '房间信息', 0, 0, PW, 700, 2, [{
        id: 'i1', widget: 'meeting', roomId: '', showQR: true, duration: 0,
      }]),
      R('r2', '宣传区', 0, 700, PW, 1220),
    ]),
  ];
}

export function seed(store, logger) {
  const users = store.col('users');
  const roles = store.col('roles');
  const orgs = store.col('orgs');
  const groups = store.col('groups');
  const settings = store.col('settings');
  const layouts = store.col('layouts');
  store.col('terminals'); store.col('media'); store.col('schedules');
  store.col('alerts'); store.col('apks'); store.col('mediaFolders'); store.col('floorplans');
  store.col('rooms'); store.col('apikeys');

  let created = false;

  if (!roles.all().length) {
    DEFAULT_ROLES.forEach(r => roles.insert({ ...r }));
    created = true;
  }
  if (!orgs.all().length) {
    orgs.insert({ id: 'org_root', name: '总部', parentId: null, order: 0 });
    created = true;
  }
  if (!groups.all().length) {
    groups.insert({ id: 'g_default', name: '默认分组', orgId: 'org_root', desc: '新终端默认归入' });
    created = true;
  }
  if (!settings.byId('settings')) {
    settings.insert({ ...DEFAULT_SETTINGS });
    created = true;
  }
  if (!users.all().length) {
    users.insert({
      id: 'u_admin', username: 'admin', name: '系统管理员',
      password: hashPassword('admin123'),
      roleIds: ['role_super'], orgId: 'org_root',
      email: '', phone: '', disabled: false, mustChangePassword: true,
      lastLoginAt: null,
    });
    created = true;
    console.log('');
    console.log('  ┌─────────────────────────────────────────┐');
    console.log('  │  已创建默认管理员账号                    │');
    console.log('  │  用户名：admin                          │');
    console.log('  │  密  码：admin123                       │');
    console.log('  │  ⚠ 首次登录后请立即修改密码              │');
    console.log('  └─────────────────────────────────────────┘');
    console.log('');
  }
  if (!layouts.find(l => l.builtin).length) {
    builtinTemplates().forEach(t => layouts.insert(t));
    created = true;
  }

  if (created) logger?.system({ event: 'seed', message: '初始化默认数据完成' });
  return created;
}
