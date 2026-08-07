/**
 * 灵屏 LumaSign · ffmpeg 一键安装（服务端）
 *
 * 让运维不必挨个去搜索引擎找 ffmpeg 下载：管理端点一下按钮，
 * 服务端自动从官方静态构建源拉取、解压、校验，落到 data/ffmpeg 目录，
 * 之后 detectFFmpeg() 即可直接认到，转码能力自动激活。
 *
 * 设计原则：
 *   - 零 npm 依赖：只用 Node 内置模块 + 系统自带的解压工具
 *   - 静态构建源：BtbN/FFmpeg-Builds 的 latest release（GPL，含 libx264 / libwebp）
 *   - 流式下载：大文件边下边写，带进度回调
 *   - 校验优先：解压后必须能跑 `ffmpeg -version` 才算成功
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { clearFFmpegCache } from './transcode.js';

const execFileAsync = promisify(execFile);

/**
 * 多源镜像列表 —— 按优先级排列，installFFmpeg() 依次尝试，失败自动 fallback。
 */
const MIRRORS = [
  { name: 'GitHub 官方',    prefix: '' },
  { name: 'GHProxy 镜像',   prefix: 'https://mirror.ghproxy.com' },
  { name: 'gh-proxy 镜像',  prefix: 'https://gh-proxy.com' },
];

/** 根据镜像前缀将原始 GitHub URL 重定向到对应镜像 */
function mirrorUrl(githubUrl, mirror) {
  return mirror.prefix ? mirror.prefix + githubUrl : githubUrl;
}

/**
 * 各平台 ffmpeg 静态构建规格（基于 GitHub 官方 URL 模板）。
 * 实际下载时用 MIRRORS[i].prefix + url 拼出完整地址；
 * 所有镜像分发同一份 BtbN 构建，binInArchive / ext 等元数据跨源不变。
 */
const BUILDS = {
  'win32-x64':    { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',      ext: 'zip', binInArchive: 'bin/ffmpeg.exe', probeInArchive: 'bin/ffprobe.exe', exe: 'ffmpeg.exe' },
  'win32-arm64':  { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-winarm64-gpl.zip',  ext: 'zip', binInArchive: 'bin/ffmpeg.exe', probeInArchive: 'bin/ffprobe.exe', exe: 'ffmpeg.exe' },
  'linux-x64':    { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz', ext: 'txz', binInArchive: 'bin/ffmpeg',     probeInArchive: 'bin/ffprobe',     exe: 'ffmpeg' },
  'linux-arm64':  { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz', ext: 'txz', binInArchive: 'bin/ffmpeg', probeInArchive: 'bin/ffprobe', exe: 'ffmpeg' },
  // macOS 官方构建为通用二进制（x64 + arm64 合一）
  'darwin-x64':   { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.zip',   ext: 'zip', binInArchive: 'bin/ffmpeg',     probeInArchive: 'bin/ffprobe',     exe: 'ffmpeg' },
  'darwin-arm64': { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.zip',   ext: 'zip', binInArchive: 'bin/ffmpeg',     probeInArchive: 'bin/ffprobe',     exe: 'ffmpeg' },
};

export function getPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

export function isPlatformSupported() {
  return !!BUILDS[getPlatformKey()];
}

export function getInstallDir(ctx) {
  return path.join(ctx.paths.data, 'ffmpeg');
}

/** 安装状态机（供前端轮询） */
let _state = {
  stage: 'idle',        // idle | downloading | extracting | verifying | done | error
  percent: 0,
  message: '',
  startedAt: null,
  finishedAt: null,
  version: null,
  path: null,
  error: null,
};

export function getInstallState() { return { ..._state }; }
export function isInstallBusy() { return _state.stage !== 'idle' && _state.stage !== 'done' && _state.stage !== 'error'; }

/** 读取已安装 ffmpeg 的版本号 */
export async function ffmpegVersion(exePath) {
  try {
    const { stdout } = await execFileAsync(exePath, ['-version'], { timeout: 10000 });
    return (stdout.match(/ffmpeg version (\S+)/) || [])[1] || 'unknown';
  } catch { return null; }
}

/**
 * 拉取并安装 ffmpeg 到 data/ffmpeg。
 * 全程更新模块级 _state，前端通过 getInstallState() 轮询进度。
 */
export async function installFFmpeg(ctx) {
  const key = getPlatformKey();
  const build = BUILDS[key];
  if (!build) {
    _state = { ..._state, stage: 'error', error: `暂不支持当前平台（${key}）的自动安装，请手动安装 ffmpeg 后重试` };
    throw new Error(_state.error);
  }

  const installDir = getInstallDir(ctx);
  fs.mkdirSync(installDir, { recursive: true });
  const tmpDir = path.join(installDir, '_download');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const archivePath = path.join(tmpDir, 'ffmpeg.' + (build.ext === 'txz' ? 'tar.xz' : 'zip'));

  _state = { stage: 'downloading', percent: 0, message: '正在下载 ffmpeg 静态构建…', startedAt: Date.now(), finishedAt: null, version: null, path: null, error: null };

  try {
    // 1) 多源下载：依次尝试每个镜像，第一个成功即停止
    let lastError = null;
    for (let mi = 0; mi < MIRRORS.length; mi++) {
      const m = MIRRORS[mi];
      const dlUrl = mirrorUrl(build.url, m);
      _state.message = `正在下载（${m.name}，${mi + 1}/${MIRRORS.length}）…`;
      try {
        await downloadWithProgress(dlUrl, archivePath, (pct) => {
          _state.percent = pct;
          _state.message = `下载中 ${pct}%（${m.name}）`;
        });
        // 下载成功，跳出镜像循环
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        _state.message = `${m.name} 下载失败：${e.message || e}，尝试下一源…`;
        // 删掉可能写了一半的文件，避免影响下一个源
        try { fs.unlinkSync(archivePath); } catch { /* ignore */ }
        continue;
      }
    }
    if (lastError) throw new Error(`所有 ${MIRRORS.length} 个下载源均失败。最后一个错误：${lastError.message || lastError}`);

    // 2) 解压
    _state.stage = 'extracting'; _state.percent = 100; _state.message = '正在解压…';
    const extractRoot = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractRoot, { recursive: true });
    await extract(archivePath, extractRoot, build.ext);

    // 3) 定位二进制
    const foundBin = findFile(extractRoot, build.binInArchive);
    const foundProbe = findFile(extractRoot, build.probeInArchive);
    if (!foundBin) throw new Error('压缩包内未找到 ffmpeg 可执行文件');

    // 4) 落到安装目录
    const destBin = path.join(installDir, build.exe);
    fs.copyFileSync(foundBin, destBin);
    if (foundProbe) {
      const probeName = build.probeInArchive.split('/').pop();
      fs.copyFileSync(foundProbe, path.join(installDir, probeName));
    }
    try { fs.chmodSync(destBin, 0o755); } catch { /* Windows 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // 5) 校验
    _state.stage = 'verifying'; _state.message = '正在校验…';
    const ver = await ffmpegVersion(destBin);
    if (!ver) throw new Error('ffmpeg 校验失败：无法执行');

    // 6) 清掉探测缓存，下一次 detectFFmpeg() 会立刻认到新装的二进制
    clearFFmpegCache();

    _state = { ..._state, stage: 'done', percent: 100, message: `安装完成：ffmpeg ${ver}`, version: ver, path: destBin, finishedAt: Date.now() };
    return { ok: true, version: ver, path: destBin };
  } catch (e) {
    _state = { ..._state, stage: 'error', message: '', error: e.message || String(e), finishedAt: Date.now() };
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw e;
  }
}

/** 流式下载（带进度），支持 HTTP(S)_PROXY 环境变量 */
async function downloadWithProgress(url, dest, onPct) {
  // 企业网/代理环境：跟随 HTTP(S)_PROXY 环境变量（Node fetch 默认不读代理）
  let dispatcher = undefined;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (proxy) {
    try {
      const { ProxyAgent } = await import('undici');
      dispatcher = new ProxyAgent(proxy);
    } catch { /* undici 不可用则直连 */ }
  }

  const res = await fetch(url, { redirect: 'follow', dispatcher });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status} ${res.statusText}`);
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  if (!res.body) throw new Error('下载失败：无响应体');

  const file = fs.createWriteStream(dest);
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (total) onPct(Math.min(99, Math.round((received / total) * 100)));
  });
  await pipeline(body, file);
  if (total && received < total) throw new Error('下载不完整，请重试');
}

/** 解压：zip 用系统工具（Windows→Expand-Archive，其他→unzip），txz→tar */
async function extract(archivePath, dest, ext) {
  if (ext === 'zip') {
    if (process.platform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${dest}"`,
      ], { timeout: 180000, windowsHide: true });
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', dest], { timeout: 180000 });
    }
  } else {
    // .tar.xz：现代 Linux/macOS 自带 tar 支持 xz
    execFileSync('tar', ['-xf', archivePath, '-C', dest], { timeout: 180000 });
  }
}

/** 在解压根目录递归查找目标相对路径（如 bin/ffmpeg）的实际文件 */
function findFile(root, relPath) {
  const name = relPath.split('/').pop();
  let found = null;
  function walk(dir) {
    if (found) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === name) {
        const rel = path.relative(root, p).split(path.sep).join('/');
        if (rel.endsWith(relPath)) { found = p; return; }
      }
    }
  }
  walk(root);
  return found;
}
