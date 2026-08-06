/**
 * 灵屏 LumaSign · 远程开通（Fleet Provisioning）
 *
 * 解决核心痛点：电子屏已嵌墙、无法逐台拆机装 APK，但已知全部设备 IP。
 * 本模块负责：
 *   1) 扫描已知 IP，探测存活与开放端口（ADB 5555 / 厂商 Web 配置 / 已装 LumaSign 等）
 *   2) 指纹识别（banner 标题 / 端口特征），判断设备类型与可开通方式
 *   3) 经「ADB-over-TCP」推送并安装我们的播放端 APK（无需物理接触）
 *   4) 预留「厂商 API 推送」钩子（CHUTO 等自带远程安装能力，待抓取具体端点后启用）
 *
 * 设计原则：纯 Node 内置模块，零依赖；所有可能失败的步骤都返回结构化结果，
 *          绝不抛未捕获异常，便于管理端逐台展示开通状态。
 */
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DEFAULT_TIMEOUT = 900;

/* ---------------- 网络探测 ---------------- */

/** TCP 端口探测：能连上即视为开放 */
function tcpProbe(ip, port, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: ip, port, timeout });
    let done = false;
    const finish = (open) => { if (!done) { done = true; try { sock.destroy(); } catch {} resolve(open); } };
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/** 轻量 HTTP banner 抓取：取标题 / Server 头，用于指纹识别 */
function httpBanner(ip, port, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: '/', timeout, headers: { 'User-Agent': 'LumaSign-Fleet/1.0' } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c.toString(); if (buf.length > 4000) req.destroy(); });
      res.on('end', () => resolve({ ok: true, status: res.statusCode, server: res.headers['server'] || '', title: extractTitle(buf) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false }));
  });
}

function extractTitle(html = '') {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim().slice(0, 80);
  const m2 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m2) return m2[1].replace(/\s+/g, ' ').trim().slice(0, 80);
  return '';
}

/* ---------------- 目标展开 ---------------- */

/** 支持：显式 IP 列表、或 CIDR 末段区间（如 192.168.1.1-254） */
export function expandTargets({ targets = [], subnet, start, end } = {}) {
  const out = new Set();
  for (const t of targets) {
    if (typeof t === 'string') out.add(t.trim());
    else if (t && t.ip) out.add(String(t.ip).trim());
  }
  if (subnet) {
    const base = subnet.replace(/\.?0*$/, '').replace(/\.$/, '');
    const s = start ?? 1, e = end ?? 254;
    for (let i = s; i <= e; i++) out.add(`${base}.${i}`);
  }
  return [...out].filter(Boolean);
}

/* ---------------- 指纹识别 ---------------- */

function fingerprint(openPorts, bannerByPort = {}) {
  const tags = [];
  const has = (p) => openPorts.includes(p);
  if (has(5555)) tags.push('adb');
  if (has(7788)) tags.push('luma-http');
  if (has(80) || has(8080) || has(8000)) {
    const b = bannerByPort['80'] || bannerByPort['8080'] || bannerByPort['8000'] || {};
    const title = (b.title || '').toLowerCase();
    const server = (b.server || '').toLowerCase();
    if (title.includes('lumasign') || server.includes('lumasign')) tags.push('luma-web');
    else if (title.includes('液晶互动') || title.includes('chuto') || title.includes('触拓') || server.includes('chuto')) tags.push('chuto-player');
    else if (title || server) tags.push('web-config');
    else tags.push('web-open');
  }
  return tags;
}

/* ---------------- 扫描 ---------------- */

/**
 * 扫描一组目标。
 * @param spec { targets?: string[], subnet?, start?, end? }
 * @returns Promise<Array<{ip, alive, openPorts, banner, fingerprint, registered}>>
 */
export async function scanTargets(spec = {}, { ports = [5555, 80, 8088, 8080, 8000, 7788, 22, 5000, 8888, 19211], timeout = DEFAULT_TIMEOUT, store } = {}) {
  const ips = expandTargets(spec);
  const results = [];
  for (const ip of ips) {
    const probePort = (p) => tcpProbe(ip, p, timeout);
    const openPorts = (await Promise.all(ports.map(async (p) => (await probePort(p)) ? p : null)))
      .filter(Boolean);
    const alive = openPorts.length > 0;
    const bannerByPort = {};
    for (const p of [80, 8080, 8000, 7788]) {
      if (openPorts.includes(p)) {
        const b = await httpBanner(ip, p, timeout);
        if (b.ok) bannerByPort[String(p)] = b;
      }
    }
    const fp = fingerprint(openPorts, bannerByPort);
    let registered = false;
    if (store) {
      registered = !!(store.col('terminals').all().find(t => t.lastIp === ip && (t.online || t.status === 'online')));
    }
    results.push({
      ip, alive, openPorts,
      banner: bannerByPort['80'] || bannerByPort['8080'] || bannerByPort['8000'] || bannerByPort['7788'] || null,
      fingerprint: fp,
      registered,
      method: pickMethod(fp, registered),
    });
  }
  return results;
}

/** 根据指纹推断可开通方式 */
function pickMethod(fp, registered) {
  if (registered) return 'already';
  if (fp.includes('adb')) return 'adb';
  if (fp.includes('chuto-player') || fp.includes('web-config')) return 'vendor';
  if (fp.includes('web-open')) return 'vendor';
  return 'manual';
}

/* ---------------- ADB 开通 ---------------- */

function runAdb(adbPath, args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    let out = '', finished = false;
    let child;
    try {
      child = spawn(adbPath, args, { windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, code: -1, output: `无法启动 adb（${adbPath}）：${e.message}` });
    }
    const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(false, 'adb 执行超时'); }, timeout);
    const finish = (ok, extra = '') => {
      if (finished) return; finished = true; clearTimeout(kill);
      resolve({ ok, code: child.exitCode ?? (ok ? 0 : 1), output: (out + extra).trim() });
    };
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => finish(false, `adb 错误：${e.message}`));
    child.on('close', (code) => finish(code === 0, code === 0 ? '' : `\n(exit ${code})`));
  });
}

/** 先 connect，再 install -rg（自动授予权限，利于 kiosk 自启） */
export async function adbInstall(adbPath, ip, apkPath) {
  const device = `${ip}:5555`;
  const conn = await runAdb(adbPath, ['connect', device], { timeout: 12000 });
  if (!conn.ok && !/connected|already/.test(conn.output)) {
    return { ok: false, stage: 'connect', output: conn.output || `无法连接 ${device}（设备可能未开启网络 ADB）` };
  }
  // 校验 APK 存在
  let size = 0;
  try { size = readFileSync(apkPath).length; } catch { return { ok: false, stage: 'apk', output: `APK 文件不存在：${apkPath}` }; }
  const inst = await runAdb(adbPath, ['-s', device, 'install', '-r', '-g', apkPath], { timeout: 120000 });
  return {
    ok: inst.ok,
    stage: inst.ok ? 'done' : 'install',
    output: `connect: ${conn.output}\ninstall(${(size / 1048576).toFixed(1)}MB): ${inst.output}`,
  };
}

export async function adbUninstall(adbPath, ip, pkg) {
  const device = `${ip}:5555`;
  await runAdb(adbPath, ['connect', device], { timeout: 12000 });
  return runAdb(adbPath, ['-s', device, 'uninstall', pkg], { timeout: 60000 });
}

export async function adbVersion(adbPath) {
  const r = await runAdb(adbPath, ['version'], { timeout: 8000 });
  return { available: r.ok, output: r.output };
}

/* ---------------- 厂商 API 推送（钩子，待具体端点确认后完善） ---------------- */

/**
 * 预留：CHUTO「液晶互动」播放端自带远程安装/升级能力（厂商文档明确支持）。
 * 当前为探测性实现——尝试若干常见端点并记录响应，便于后续确认正式协议。
 * 不臆造协议字段，避免误写导致设备异常。
 */
export async function vendorPush(ip, apkPath, { ports = [80, 8080, 8000] } = {}) {
  const attempts = [];
  for (const p of ports) {
    const r = await httpBanner(ip, p, 4000);
    attempts.push({ port: p, reachable: r.ok, title: r.title || '', server: r.server || '' });
  }
  return {
    ok: false,
    method: 'vendor',
    output: '厂商 API 端点尚未确认。请在设备上打开「设置→关于/网络」确认其远程升级端口，' +
      '或将设备 Web 配置页地址告知我们以适配。当前可用的最稳路径为 ADB（端口 5555）。',
    probe: attempts,
  };
}

export const FLEET_CONST = { DEFAULT_TIMEOUT };

/* ---------------- ADB 一键安装（服务端下载官方 platform-tools） ---------------- */

/**
 * 优先返回已下载到 desktop/adb/platform-tools 的 adb；否则回退到启动时的 adbPath。
 */
export function resolveAdbPath(ctx) {
  const root = ctx?.paths?.root || process.cwd();
  const cand = process.platform === 'win32'
    ? path.join(root, 'desktop', 'adb', 'platform-tools', 'adb.exe')
    : path.join(root, 'desktop', 'adb', 'platform-tools', 'adb');
  if (fs.existsSync(cand)) return cand;
  return ctx?.adbPath || 'adb';
}

function downloadFile(url, dest, onLog) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'LumaSign-Fleet/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, dest, onLog).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('下载失败 HTTP ' + res.statusCode)); }
      const total = +res.headers['content-length'] || 0;
      let got = 0;
      res.on('data', (c) => { got += c.length; if (onLog && total) onLog(`下载中 ${Math.round(got / total * 100)}%`); });
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve()));
      f.on('error', (e) => { fs.rmSync(dest, { force: true }); reject(e); });
    });
    req.on('error', (e) => reject(e));
  });
}

function extractZip(zipPath, destDir, log) {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`], { stdio: 'ignore' });
  } else {
    try { execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'ignore' }); }
    catch {
      try { execFileSync('python3', ['-c', `import zipfile;zipfile.ZipFile(r"${zipPath}").extractall(r"${destDir}")`], { stdio: 'ignore' }); }
      catch { execFileSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'ignore' }); }
    }
  }
}

/**
 * 下载官方 Android platform-tools 并解压到 desktop/adb/platform-tools，使其可被直接调用。
 * 注意：此操作在用户本机执行，依赖外网可达 dl.google.com（与 agent 运行环境无关）。
 * @returns {Promise<{ok:boolean, adbPath:string, output:string, log:string[]}>}
 */
export async function installAdb(ctx, onLog) {
  const log = [];
  const push = (m) => { log.push(m); if (onLog) onLog(m); };
  const map = {
    win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
    darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
    linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
  };
  const url = map[process.platform] || map.linux;
  const root = ctx?.paths?.root || process.cwd();
  const destDir = path.join(root, 'desktop', 'adb');
  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, 'platform-tools.zip');

  try {
    push('开始下载 platform-tools…');
    push('源：' + url);
    await downloadFile(url, zipPath, push);
    push('下载完成，解压中…');
    extractZip(zipPath, destDir, push);
    fs.rmSync(zipPath, { force: true });
    const adbPath = resolveAdbPath(ctx);
    const v = await adbVersion(adbPath);
    if (!v.available) return { ok: false, adbPath, output: v.output, log };
    push('✓ adb 安装完成：' + adbPath);
    return { ok: true, adbPath, output: v.output, log };
  } catch (e) {
    fs.rmSync(zipPath, { force: true });
    push('✗ 安装失败：' + e.message);
    return { ok: false, adbPath: '', output: e.message, log };
  }
}
