/**
 * 灵屏 LumaSign · 局域网设备发现引擎
 *
 * 目标：在不装任何客户端的前提下，把一个局域网里"有哪些屏、哪些安卓设备"摸清楚。
 *
 * 能力：
 *   1) 本机网段自动枚举（多网卡环境按 RFC1918 优先级排序）
 *   2) 高并发扫描池（默认 64 并发，254 台 /24 网段约 6~10 秒扫完）
 *   3) 两阶段探测：先快筛存活（3 个高频端口 + 短超时），存活的才做全端口深扫
 *   4) ARP 表读取 → MAC 地址 → OUI 厂商识别（Windows/Linux/macOS 三平台）
 *   5) **ADB 原生握手**：直接用 socket 说 ADB 协议，无需 adb 二进制即可拿到
 *      设备型号 / 产品名 / 序列号 / 授权状态 —— 这是判定"是不是安卓屏"最硬的证据
 *   6) HTTP banner 抓取（标题 / Server 头 / 特征路径）
 *   7) 设备类型分类引擎（安卓屏 / 灵屏终端 / 触拓播放端 / 路由器 / PC / 摄像头 / 打印机 / 未知）
 *   8) 进度回调，供 SSE 实时推送到管理端
 *
 * 设计原则：纯 Node 内置模块、零依赖；任何探测失败都降级而非抛错。
 */
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import { exec } from 'node:child_process';

/* ══════════════ 常量 ══════════════ */

const FAST_TIMEOUT = 400;      // 快筛超时
const DEEP_TIMEOUT = 1200;     // 深扫超时
const DEFAULT_CONCURRENCY = 64;

/** 快筛端口：命中任意一个即认为存活，覆盖 90% 的安卓屏与网络设备 */
export const FAST_PORTS = [5555, 80, 8080];

/** 深扫端口：分类用。按"信息量/成本"排序 */
export const DEEP_PORTS = [
  5555,   // ADB over TCP —— 安卓设备铁证
  5037,   // adb server
  7788,   // 灵屏 HTTP
  80, 8080, 8000, 8088, 8888,  // Web 配置页
  443,    // HTTPS
  22,     // SSH
  23,     // Telnet（老式盒子/交换机）
  445, 135, 3389,   // Windows PC
  9100, 631,        // 打印机
  554, 8554,        // RTSP 摄像头
  1935,             // RTMP 推流
  19211,            // 部分标牌厂商私有端口
  5000,             // UPnP / 部分安卓盒子
];

/**
 * OUI 厂商识别表（MAC 前 3 字节）
 * 精选覆盖：安卓 SoC 方案商、常见电子屏/盒子代工、主流网络设备、虚拟机。
 * 完整 OUI 库有 3 万+ 条，此处只收对本场景有判别价值的部分，未命中显示"未知厂商"。
 */
const OUI = {
  // —— 安卓 SoC / 板卡方案（电子屏、广告机的主力芯片）——
  '0c:8c:24': 'Rockchip 瑞芯微', '2a:e2:0a': 'Rockchip 瑞芯微',
  '00:1a:11': 'Google/Android', 'd8:5d:4c': 'Amlogic 晶晨',
  '4c:49:6c': 'Allwinner 全志', '96:e8:40': 'Allwinner 全志',
  'aa:bb:cc': '通用安卓板卡',
  // —— 电子屏 / 广告机整机厂 ——
  '00:e0:4c': 'Realtek(常见广告机网卡)', '00:1e:06': 'WIBRAIN/工控屏',
  '8c:1a:bf': '触拓/同类标牌', '00:23:a7': 'Redpine/嵌入式屏',
  // —— 手机 / 平板（可能被当播放端）——
  '64:09:80': '小米', 'f8:59:71': '小米', '50:8f:4c': '小米',
  '00:e0:fc': '华为', '28:6e:d4': '华为', '48:46:fb': '华为',
  'ac:37:43': 'HTC', '00:26:e8': 'Murata/三星系',
  '94:65:2d': 'OPPO', 'd0:c5:d3': 'vivo',
  // —— 网络设备（识别出来好排除）——
  '00:0f:e2': 'H3C 华三', '00:23:89': 'H3C 华三',
  '00:25:9e': '华为交换机', 'ec:26:ca': 'TP-LINK',
  '00:1d:0f': 'TP-LINK', '14:cc:20': 'TP-LINK',
  '00:0c:43': 'Ralink/小厂路由', 'b0:95:8e': '腾达 Tenda',
  '00:1f:33': 'Netgear', '00:24:01': 'D-Link',
  // —— PC / 虚拟机 ——
  '00:0c:29': 'VMware', '00:50:56': 'VMware', '08:00:27': 'VirtualBox',
  '00:15:5d': 'Hyper-V', '52:54:00': 'QEMU/KVM',
  'b8:27:eb': '树莓派', 'dc:a6:32': '树莓派', 'e4:5f:01': '树莓派',
  // —— 摄像头 ——
  '00:12:12': '海康威视', 'bc:ad:28': '海康威视', '4c:bd:8f': '大华',
};

/* ══════════════ 并发池 ══════════════ */

/** 极简并发限流器：把一批任务按 limit 并发跑完，保序返回 */
async function pool(items, limit, worker, onEach) {
  const results = new Array(items.length);
  let cursor = 0, done = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await worker(items[i], i); }
      catch (e) { results[i] = { error: e.message }; }
      done++;
      if (onEach) { try { onEach(results[i], done, items.length); } catch {} }
    }
  });
  await Promise.all(runners);
  return results;
}

/* ══════════════ 网段计算 ══════════════ */

const ipToInt = ip => ip.split('.').reduce((a, o) => (a << 8 >>> 0) + (+o), 0) >>> 0;
const intToIp = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const maskBits = mask => ipToInt(mask).toString(2).split('1').length - 1;

/** 枚举本机所有可用 IPv4 网段，按 RFC1918 优先级排序 */
export function localNetworks() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const bits = maskBits(i.netmask);
      const netInt = (ipToInt(i.address) & ipToInt(i.netmask)) >>> 0;
      const hostCount = bits >= 30 ? 0 : Math.pow(2, 32 - bits) - 2;
      out.push({
        iface: name,
        address: i.address,
        mac: i.mac,
        netmask: i.netmask,
        cidr: `${intToIp(netInt)}/${bits}`,
        network: intToIp(netInt),
        bits,
        hostCount,
        // 大于 /22（>1022 台）不建议全扫，前端给提示
        scannable: bits >= 22,
        subnet: i.address.split('.').slice(0, 3).join('.'),
      });
    }
  }
  const score = a => a.address.startsWith('192.168.') ? 0
    : a.address.startsWith('10.') ? 1
      : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3;
  return out.sort((a, b) => score(a) - score(b) || a.bits - b.bits);
}

/** 展开扫描目标：显式 IP / 子网前缀+区间 / CIDR */
export function expandTargets({ targets = [], subnet, start, end, cidr } = {}) {
  const out = new Set();
  for (const t of targets) {
    const ip = typeof t === 'string' ? t.trim() : (t && t.ip ? String(t.ip).trim() : '');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) out.add(ip);
  }
  if (cidr && /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)) {
    const [base, bitsRaw] = cidr.split('/');
    const bits = Math.max(16, Math.min(32, parseInt(bitsRaw, 10)));  // 下限 /16 防炸
    const netInt = (ipToInt(base) & (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0)) >>> 0;
    const total = Math.pow(2, 32 - bits);
    const cap = Math.min(total, 4096);   // 单次最多 4096 个目标，防滥用
    for (let i = 1; i < cap - 1; i++) out.add(intToIp((netInt + i) >>> 0));
  }
  if (subnet) {
    const base = String(subnet).trim().replace(/\.+$/, '').split('.').slice(0, 3).join('.');
    if (/^\d{1,3}(\.\d{1,3}){2}$/.test(base)) {
      const s = Math.max(1, Math.min(254, start ?? 1));
      const e = Math.max(s, Math.min(254, end ?? 254));
      for (let i = s; i <= e; i++) out.add(`${base}.${i}`);
    }
  }
  return [...out];
}

/* ══════════════ ARP 表 ══════════════ */

const execP = (cmd, timeout = 5000) => new Promise((resolve) => {
  exec(cmd, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    (err, stdout) => resolve(err && !stdout ? '' : String(stdout || '')));
});

/**
 * 读取系统 ARP 表 → { ip: mac }
 * 只在扫描后调用一次（扫描过程本身会填充 ARP 缓存），成本极低但信息量很大。
 */
export async function readArpTable() {
  const map = {};
  const plat = process.platform;
  const raw = plat === 'win32' ? await execP('arp -a')
    : plat === 'darwin' ? await execP('arp -an')
      : (await execP('ip neigh show')) || (await execP('arp -an'));
  if (!raw) return map;

  for (const line of raw.split(/\r?\n/)) {
    // 兼容三平台格式：
    //   win :  192.168.1.5      b8-27-eb-01-02-03     动态
    //   mac :  ? (192.168.1.5) at b8:27:eb:1:2:3 on en0
    //   linux: 192.168.1.5 dev eth0 lladdr b8:27:eb:01:02:03 REACHABLE
    const ipM = line.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    const macM = line.match(/([0-9a-fA-F]{1,2}(?:[:-][0-9a-fA-F]{1,2}){5})/);
    if (!ipM || !macM) continue;
    const mac = macM[1].replace(/-/g, ':').split(':')
      .map(x => x.padStart(2, '0')).join(':').toLowerCase();
    if (mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff') continue;
    map[ipM[1]] = mac;
  }
  return map;
}

export function vendorOfMac(mac) {
  if (!mac) return '';
  const pre = mac.toLowerCase().split(':').slice(0, 3).join(':');
  if (OUI[pre]) return OUI[pre];
  // 本地管理位（第二个 16 进制位为 2/6/a/e）→ 多为虚拟网卡或随机化 MAC
  const second = parseInt(mac[1], 16);
  if (!isNaN(second) && (second & 0x2)) return '随机/虚拟 MAC';
  return '';
}

/* ══════════════ 端口探测 ══════════════ */

function tcpProbe(ip, port, timeout) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: ip, port, timeout });
    let settled = false;
    const done = (open) => {
      if (settled) return; settled = true;
      try { sock.destroy(); } catch {}
      resolve(open);
    };
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/* ══════════════ ADB 原生握手 ══════════════ */
/*
 * ADB 传输层协议（无需 adb 二进制，直接说协议）：
 *   消息头 24 字节，小端：
 *     u32 command | u32 arg0 | u32 arg1 | u32 data_len | u32 data_crc | u32 magic(=command ^ 0xffffffff)
 *   我们发 A_CNXN 自我介绍，设备会回：
 *     A_CNXN → 已授权，payload 形如
 *              "device::ro.product.name=rk3288;ro.product.model=PD1001;ro.product.device=rk3288;features=..."
 *     A_AUTH → 未授权（需在设备上点"允许 USB 调试"），但这已证明它是安卓设备
 */
const A_CNXN = 0x4e584e43;
const A_AUTH = 0x48545541;

function adbPacket(command, arg0, arg1, payload = Buffer.alloc(0)) {
  const head = Buffer.alloc(24);
  let crc = 0;
  for (const b of payload) crc = (crc + b) >>> 0;
  head.writeUInt32LE(command >>> 0, 0);
  head.writeUInt32LE(arg0 >>> 0, 4);
  head.writeUInt32LE(arg1 >>> 0, 8);
  head.writeUInt32LE(payload.length, 12);
  head.writeUInt32LE(crc, 16);
  head.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([head, payload]);
}

/**
 * 与 ip:5555 做一次 ADB 握手。
 * @returns {Promise<null | {authorized, model, product, device, serial, raw}>}
 *          null = 不是 ADB 设备（或端口不通）
 */
export function adbHandshake(ip, port = 5555, timeout = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; try { sock.destroy(); } catch {} resolve(v); } };

    const sock = net.createConnection({ host: ip, port, timeout });
    let buf = Buffer.alloc(0);

    sock.once('connect', () => {
      // "host::features=..."，尾部必须带 \0
      const banner = Buffer.from('host::features=cmd,shell_v2,stat_v2\0', 'utf8');
      try { sock.write(adbPacket(A_CNXN, 0x01000001, 256 * 1024, banner)); } catch { finish(null); }
    });

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 24) return;
      const command = buf.readUInt32LE(0);
      const dataLen = buf.readUInt32LE(12);
      const magic = buf.readUInt32LE(20);
      // magic 校验：不匹配说明不是 ADB 协议（可能是别的服务占了 5555）
      if (((command ^ 0xffffffff) >>> 0) !== magic) return finish(null);

      if (command === A_AUTH) {
        return finish({ authorized: false, model: '', product: '', device: '', serial: '', raw: '' });
      }
      if (command === A_CNXN) {
        if (buf.length < 24 + dataLen) return;   // 等 payload 收全
        const raw = buf.subarray(24, 24 + dataLen).toString('utf8').replace(/\0+$/, '');
        const pick = (k) => {
          const m = raw.match(new RegExp(k.replace(/\./g, '\\.') + '=([^;]*)'));
          return m ? m[1].trim() : '';
        };
        return finish({
          authorized: true,
          model: pick('ro\\.product\\.model'),
          product: pick('ro\\.product\\.name'),
          device: pick('ro\\.product\\.device'),
          serial: pick('ro\\.serialno') || pick('ro\\.boot\\.serialno'),
          raw: raw.slice(0, 300),
        });
      }
      finish(null);
    });

    sock.once('timeout', () => finish(null));
    sock.once('error', () => finish(null));
    setTimeout(() => finish(null), timeout + 500).unref?.();
  });
}

/* ══════════════ HTTP banner ══════════════ */

function httpBanner(ip, port, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({
      host: ip, port, path: '/', timeout,
      headers: { 'User-Agent': 'LumaSign-Discovery/1.1', Accept: 'text/html,*/*' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c.toString('utf8');
        if (body.length > 8192) { try { req.destroy(); } catch {} }
      });
      res.on('end', () => resolve({
        ok: true,
        status: res.statusCode,
        server: String(res.headers['server'] || ''),
        powered: String(res.headers['x-powered-by'] || ''),
        realm: String(res.headers['www-authenticate'] || ''),
        title: extractTitle(body),
        snippet: body.replace(/\s+/g, ' ').slice(0, 200),
      }));
    });
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false }));
  });
}

function extractTitle(html = '') {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim().slice(0, 100);
  const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h) return h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return '';
}

/* ══════════════ 设备分类引擎 ══════════════ */

/** 设备类型元数据：给前端统一的图标 / 配色 / 文案 */
export const DEVICE_KINDS = {
  server:   { label: '本机服务端', icon: '⌂', tone: 'ok',     desc: '灵屏管理服务所在主机' },
  luma:     { label: '灵屏终端',   icon: '◉', tone: 'ok',     desc: '已注册到本系统的播放终端' },
  android:  { label: '安卓设备',   icon: '▣', tone: 'primary', desc: 'ADB 握手成功，可远程安装播放端' },
  screen:   { label: '电子屏/广告机', icon: '▤', tone: 'primary', desc: '疑似标牌播放设备' },
  chuto:    { label: '触拓播放端', icon: '▥', tone: 'warn',   desc: '检测到 e 版播放端，可迁移替换' },
  router:   { label: '路由/交换机', icon: '⇄', tone: '',       desc: '网络设备，非播放终端' },
  pc:       { label: '电脑主机',   icon: '▢', tone: '',       desc: 'Windows/Linux 主机' },
  camera:   { label: '摄像头',     icon: '◎', tone: '',       desc: 'RTSP 视频源设备' },
  printer:  { label: '打印机',     icon: '⎙', tone: '',       desc: '网络打印设备' },
  unknown:  { label: '未知设备',   icon: '?', tone: '',       desc: '存活但无法判定类型' },
};

/* 特征词典：集中维护，便于按现场情况扩充 */
const SIG = {
  luma:   /lumasign|灵屏/i,
  chuto:  /液晶互动|chuto|触拓|ebplayer|数字标牌\s*e\s*版|信息发布系统/i,
  // 路由器：涵盖国内主流品牌型号前缀与管理域名
  router: /router|openwrt|dd-wrt|padavan|路由器|无线路由|tp-?link|tl-(wdr|wr|xdr|ap)|tenda|腾达|mercury|水星|mw\d{3}|fast|迅捷|fw\d{3}|h3c|华三|huawei\s*(ws|ax)|荣耀路由|xiaomi\s*router|小米路由|netgear|d-?link|asus\s*rt|melogin|falogin|tplogin|miwifi|gateway|光猫|网关/i,
  camera: /hikvision|海康|dahua|大华|uniview|宇视|ipcam|ip\s*camera|网络摄像机|nvr|dvr|webcam|surveillance/i,
  printer:/printer|打印|hp\s*laserjet|epson|canon|brother|ricoh|kyocera/i,
  nas:    /synology|群晖|qnap|威联通|nas|openmediavault/i,
  // 安卓标牌方案：SoC 型号 + 屏类关键词
  screen: /rk3(0|1|2|3|5|6|9)|rockchip|amlogic|s9\d{2}|allwinner|a64|h6|mstar|novatek|box|stb|tv\s*box|signage|digital\s*sign|广告机|一体机|多媒体终端|播放盒|信发/i,
};

/**
 * 根据全部探测证据判定设备类型。
 * 判定优先级：本机 > 已注册 > 灵屏服务 > 触拓 > ADB 握手 > 服务端口特征 > banner 特征 > 未知
 */
function classify({ openPorts, banners, adb, vendor, registered, isSelf }) {
  const has = p => openPorts.includes(p);
  const bannerList = Object.values(banners);
  const allText = bannerList.map(b => `${b.title} ${b.server} ${b.realm} ${b.snippet}`).join(' ');
  const vend = (vendor || '').toLowerCase();
  const reasons = [];

  /* 本机：跑着灵屏服务端的这台机器，不是可开通目标 */
  if (isSelf) {
    reasons.push('本机（灵屏服务端所在主机）');
    return { kind: 'server', confidence: 100, reasons };
  }

  if (registered) { reasons.push('已在终端列表中注册'); return { kind: 'luma', confidence: 100, reasons }; }

  /* 灵屏终端：必须是 7788 端口本身返回灵屏标识，不能用全局文本（避免同机其它服务串味） */
  if (has(7788) && SIG.luma.test(`${banners['7788']?.title || ''} ${banners['7788']?.server || ''}`)) {
    reasons.push('7788 端口返回灵屏服务标识');
    return { kind: 'luma', confidence: 95, reasons };
  }

  if (SIG.chuto.test(allText)) {
    reasons.push('Web 页面标识为触拓「液晶互动」播放端');
    return { kind: 'chuto', confidence: 90, reasons };
  }

  /* ADB 握手是判定安卓最硬的证据 */
  if (adb) {
    reasons.push(adb.authorized
      ? `ADB 握手成功${adb.model ? `，型号 ${adb.model}` : ''}`
      : 'ADB 端口应答（设备存在但未授权调试，需在屏上点「允许」一次）');
    const modelText = `${adb.model} ${adb.product} ${adb.device}`;
    if (SIG.screen.test(modelText)) {
      reasons.push('型号特征匹配标牌 / 安卓盒子方案');
      return { kind: 'screen', confidence: adb.authorized ? 92 : 75, reasons };
    }
    return { kind: 'android', confidence: adb.authorized ? 95 : 78, reasons };
  }

  /* 端口只开 5555 但握手失败：仍高度疑似安卓（可能是防火墙拦了握手） */
  if (has(5555)) {
    reasons.push('开放 5555（ADB over TCP）端口，握手未完成');
    return { kind: 'android', confidence: 60, reasons };
  }

  if (SIG.screen.test(`${allText} ${vend}`)) {
    reasons.push('MAC 厂商或页面特征指向安卓标牌方案');
    return { kind: 'screen', confidence: 70, reasons };
  }

  /* 服务端口特征（比 banner 更可靠，优先判） */
  if (has(554) || has(8554)) {
    reasons.push('开放 RTSP(554) 视频流端口');
    return { kind: 'camera', confidence: has(8000) ? 88 : 80, reasons };
  }
  if (has(9100) || has(631)) { reasons.push('开放打印服务端口(9100/631)'); return { kind: 'printer', confidence: 85, reasons }; }
  if (has(3389) || has(445)) { reasons.push('开放 RDP/SMB 端口'); return { kind: 'pc', confidence: 82, reasons }; }

  /* banner 关键词兜底 */
  if (SIG.camera.test(`${allText} ${vend}`)) { reasons.push('页面/厂商标识为摄像设备'); return { kind: 'camera', confidence: 75, reasons }; }
  if (SIG.printer.test(allText)) { reasons.push('页面标识为打印设备'); return { kind: 'printer', confidence: 75, reasons }; }
  if (SIG.router.test(`${allText} ${vend}`)) { reasons.push('页面/厂商标识为路由或网关设备'); return { kind: 'router', confidence: 80, reasons }; }
  if (SIG.nas.test(allText)) { reasons.push('页面标识为 NAS 存储'); return { kind: 'pc', confidence: 75, reasons }; }

  if (has(23) && !has(80)) { reasons.push('仅开放 Telnet，多为交换机/老式设备'); return { kind: 'router', confidence: 55, reasons }; }

  /* 只开 80 且需鉴权 → 多为嵌入式设备的配置页 */
  if (has(80) && bannerList.some(b => b.status === 401 || b.realm)) {
    reasons.push('Web 端口要求 HTTP Basic 鉴权，疑似嵌入式设备配置页');
    return { kind: 'unknown', confidence: 45, reasons };
  }

  if (openPorts.length) reasons.push(`存活，开放端口 ${openPorts.join('/')}，特征不足以判定类型`);
  return { kind: 'unknown', confidence: 30, reasons };
}

/** 判定可用的开通方式 */
function pickMethod(kind, openPorts, adb) {
  if (kind === 'server') return 'self';
  if (kind === 'luma') return 'already';
  if (adb && openPorts.includes(5555)) return adb.authorized ? 'adb' : 'adb-unauthorized';
  if (openPorts.includes(5555)) return 'adb';
  if (kind === 'chuto' || kind === 'screen') return 'vendor';
  if (kind === 'android') return 'vendor';
  return 'manual';
}

/* ══════════════ 主扫描流程 ══════════════ */

/**
 * 扫描一批目标。
 * @param spec    { targets?, subnet?, start?, end?, cidr? }
 * @param options { ports?, concurrency?, deep?, store?, onProgress?, signal? }
 * @returns { items, stats }
 */
export async function scanNetwork(spec = {}, options = {}) {
  const {
    ports = DEEP_PORTS,
    concurrency = DEFAULT_CONCURRENCY,
    deep = true,
    store,
    onProgress,
    signal,          // { aborted: boolean } 供外部取消
  } = options;

  const ips = expandTargets(spec);
  const t0 = Date.now();
  const emit = (phase, payload) => { if (onProgress) { try { onProgress({ phase, ...payload }); } catch {} } };

  if (!ips.length) return { items: [], stats: { total: 0, alive: 0, ms: 0 } };
  emit('start', { total: ips.length });

  /* ── 阶段一：快筛存活 ── */
  const aliveList = [];
  await pool(ips, concurrency, async (ip) => {
    if (signal?.aborted) return null;
    for (const p of FAST_PORTS) {
      if (await tcpProbe(ip, p, FAST_TIMEOUT)) { aliveList.push(ip); return ip; }
    }
    return null;
  }, (_r, done, total) => {
    if (done % 8 === 0 || done === total) {
      emit('probing', { done, total, alive: aliveList.length, percent: Math.round(done / total * 60) });
    }
  });

  emit('alive', { alive: aliveList.length, total: ips.length, percent: 60 });

  if (!deep || !aliveList.length) {
    return {
      items: aliveList.map(ip => ({ ip, alive: true, openPorts: [], kind: 'unknown', method: 'manual' })),
      stats: { total: ips.length, alive: aliveList.length, ms: Date.now() - t0 },
    };
  }

  /* ── 阶段二：深扫存活设备 ── */
  aliveList.sort((a, b) => ipToInt(a) - ipToInt(b));
  const registeredIps = new Set();
  if (store) {
    try {
      for (const t of store.col('terminals').all()) if (t.lastIp) registeredIps.add(t.lastIp);
    } catch {}
  }

  const items = await pool(aliveList, Math.min(concurrency, 24), async (ip) => {
    if (signal?.aborted) return { ip, alive: true, openPorts: [], kind: 'unknown', method: 'manual' };

    const openPorts = (await Promise.all(
      ports.map(async p => (await tcpProbe(ip, p, DEEP_TIMEOUT)) ? p : null)
    )).filter(Boolean).sort((a, b) => a - b);

    // ADB 握手（拿型号）
    let adb = null;
    if (openPorts.includes(5555)) adb = await adbHandshake(ip, 5555);

    // HTTP banner（最多探 3 个 Web 端口，控制耗时）
    const banners = {};
    const webPorts = [80, 8080, 8000, 8088, 7788, 8888].filter(p => openPorts.includes(p)).slice(0, 3);
    for (const p of webPorts) {
      const b = await httpBanner(ip, p, 1500);
      if (b.ok) banners[String(p)] = b;
    }

    return { ip, openPorts, adb, banners, registered: registeredIps.has(ip) };
  }, (_r, done, total) => {
    emit('deep', { done, total, percent: 60 + Math.round(done / total * 35) });
  });

  /* ── 阶段三：ARP 补 MAC + 分类 ── */
  const arp = await readArpTable();
  emit('arp', { entries: Object.keys(arp).length, percent: 97 });

  const selfIps = new Set(localNetworks().map(n => n.address));

  const finalItems = items.map((raw) => {
    const mac = arp[raw.ip] || '';
    const vendor = vendorOfMac(mac);
    const { kind, confidence, reasons } = classify({
      openPorts: raw.openPorts || [],
      banners: raw.banners || {},
      adb: raw.adb,
      vendor,
      registered: raw.registered,
      isSelf: selfIps.has(raw.ip),
    });
    const meta = DEVICE_KINDS[kind];
    const primaryBanner = Object.values(raw.banners || {})[0] || null;
    return {
      ip: raw.ip,
      alive: true,
      mac,
      vendor,
      openPorts: raw.openPorts || [],
      kind,
      kindLabel: meta.label,
      kindIcon: meta.icon,
      kindTone: meta.tone,
      confidence,
      reasons,
      // 设备标识：ADB 型号优先，其次网页标题
      name: raw.adb?.model || raw.adb?.product || primaryBanner?.title || '',
      adb: raw.adb ? {
        authorized: raw.adb.authorized,
        model: raw.adb.model, product: raw.adb.product,
        device: raw.adb.device, serial: raw.adb.serial,
      } : null,
      banner: primaryBanner ? {
        title: primaryBanner.title, server: primaryBanner.server, status: primaryBanner.status,
      } : null,
      registered: !!raw.registered,
      method: pickMethod(kind, raw.openPorts || [], raw.adb),
      seenAt: Date.now(),
    };
  });

  // 排序：可开通的排前面，再按 IP
  const kindWeight = { screen: 0, android: 1, chuto: 2, luma: 3, unknown: 4, pc: 5, router: 6, camera: 7, printer: 8 };
  finalItems.sort((a, b) =>
    (kindWeight[a.kind] ?? 9) - (kindWeight[b.kind] ?? 9) || ipToInt(a.ip) - ipToInt(b.ip));

  const stats = {
    total: ips.length,
    alive: finalItems.length,
    ms: Date.now() - t0,
    byKind: finalItems.reduce((m, i) => { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {}),
    provisionable: finalItems.filter(i => i.method === 'adb' || i.method === 'vendor').length,
  };
  emit('done', { percent: 100, stats });
  return { items: finalItems, stats };
}

export const NETSCAN_CONST = { FAST_TIMEOUT, DEEP_TIMEOUT, DEFAULT_CONCURRENCY };
