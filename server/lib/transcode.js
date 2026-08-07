/**
 * 灵屏 LumaSign · 素材智能转码（P1-3.5，ffmpeg 可选外挂）
 *
 * 设计原则：
 *   - 零 npm 依赖：ffmpeg 是系统级外部工具，检测到就用，没有就降级
 *   - 不阻塞上传：转码入队后台异步执行
 *   - 多档位：按终端能力下发匹配版本
 *   - 存储自洁：超期转码产物自动清理
 *
 * 支持的转码：
 *   - 视频 → H.264（多码率：1080p/720p/480p）
 *   - 图片 → WebP（有损可调）
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

/** 全局单例：ffmpeg 可用性缓存 */
let _ffmpegPath = null; // null = 未检测, '' = 不可用, string = 路径
let _probePath = null;
let _ffmpegInstallDir = null; // 本系统「一键安装」落盘目录（由 server.js 注入）

/** 设置一键安装目录（server.js 在 ctx 初始化后调用） */
export function setFFmpegInstallDir(dir) { _ffmpegInstallDir = dir; }

/** 清除探测缓存，强制下次重新探测（安装完成后调用，让 detectFFmpeg 立刻认到新装的二进制） */
export function clearFFmpegCache() { _ffmpegPath = null; _probePath = null; }

/** 检测系统是否安装了 ffmpeg / ffprobe */
export async function detectFFmpeg() {
  if (_ffmpegPath !== null) return { ok: !!_ffmpegPath, ffmpeg: _ffmpegPath || null, probe: _probePath || null };
  const platform = process.platform;
  const exeName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [];
  // 本系统一键安装的落盘目录（最高优先级，装完立即认到）
  if (_ffmpegInstallDir) candidates.push(path.join(_ffmpegInstallDir, exeName));
  if (platform === 'win32') {
    candidates.push(
      'ffmpeg.exe',
      'C:\\ffmpeg\\bin\\ffmpeg.exe',                       // gyan.dev 官方构建默认解压位置
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',        // 常见手动安装位置
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Data\\chocolatey\\bin\\ffmpeg.exe',     // chocolatey
    );
  } else {
    candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/opt/ffmpeg/bin/ffmpeg');
  }
  for (const c of candidates) {
    try {
      await execFileAsync(c, ['-version'], { timeout: 5000 });
      _ffmpegPath = c;
      // ffprobe 通常与 ffmpeg 同目录
      const probeCandidate = c.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
      try { await execFileAsync(probeCandidate, ['-version'], { timeout: 3000 }); _probePath = probeCandidate; } catch { /* probe 可选 */ }
      return { ok: true, ffmpeg: _ffmpegPath, probe: _probePath };
    } catch { /* 继续试下一个 */ }
  }
  _ffmpegPath = '';
  _probePath = '';
  return { ok: false, ffmpeg: null, probe: null };
}

/** 用 ffprobe 探测视频信息（分辨率、编码、时长、码率） */
export async function probeMedia(filePath) {
  const { ok, probe } = await detectFFmpeg();
  if (!ok || !probe) throw new Error('ffprobe 不可用');
  try {
    const { stdout } = await execFileAsync(probe, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams',
      filePath,
    ], { timeout: 15000 });
    return JSON.parse(stdout);
  } catch (e) { throw new Error('媒体探测失败: ' + e.message); }
}

/**
 * 判断视频是否需要转码（非 H.264 或分辨率超过目标）
 * 返回 { needed, reason, suggestedProfiles }
 */
export async function needsTranscode(filePath, targetCodec = 'h264') {
  const info = await probeMedia(filePath);
  const videoStream = info.streams?.find(s => s.codec_type === 'video');
  if (!videoStream) return { needed: false, reason: '无视频流' };

  const codec = videoStream.codec_name?.toLowerCase();
  const width = parseInt(videoStream.width) || 0;
  const height = parseInt(videoStream.height) || 0;
  const isH264 = codec === 'h264' || codec === 'avc';

  const reasons = [];
  const profiles = [];

  if (!isH264) {
    reasons.push(`编码 ${codec} ≠ ${targetCodec}`);
    profiles.push({ name: 'h264_main', codec: 'h264', preset: 'medium', crf: 23, maxWidth: width, maxHeight: height });
  }

  // 始终生成 720p 档位（适合大多数电子屏）
  if (width > 1280 || height > 720) {
    reasons.push(`分辨率 ${width}x${height} > 1280x720`);
    profiles.push(
      { name: '720p', codec: 'h264', preset: 'medium', crf: 24, maxWidth: 1280, maxHeight: 720 },
      { name: '480p', codec: 'h264', preset: 'medium', crf: 28, maxWidth: 854, maxHeight: 480 },
    );
  }

  if (width > 1920) {
    profiles.unshift({ name: '1080p', codec: 'h264', preset: 'medium', crf: 23, maxWidth: 1920, maxHeight: 1080 });
  }

  if (!profiles.length && !isH264) {
    profiles.push({ name: 'same_res', codec: 'h264', preset: 'medium', crf: 23, maxWidth: width, maxHeight: height });
  }

  return {
    needed: reasons.length > 0,
    reason: reasons.join('; ') || '无需转码',
    profiles: profiles.length ? profiles : null,
    original: { codec, width, height, duration: parseFloat(info.format?.duration) || 0 },
  };
}

/**
 * 执行单个转码任务
 * @param {{ input: string, output: string, profile: object, onProgress?: (pct)=>void }} opts
 * @returns {{ ok, outputPath, size, tookMs }}
 */
export async function transcode(opts) {
  const { ok, ffmpeg } = await detectFFmpeg();
  if (!ok || !ffmpeg) throw new Error('ffmpeg 不可用，无法转码');

  const { input, output, profile, onProgress } = opts;
  const hasAudio = profile.hasAudio !== false; // 默认保留音频（电子屏可静音播放，有配音需求也能用）
  const args = [
    '-y',                                    // 覆盖输出
    '-i', input,
    '-c:v', profile.codec === 'h264' ? 'libx264' : 'copy',
    '-preset', profile.preset || 'medium',
    '-crf', String(profile.crf || 23),
    '-vf', `scale=min(${profile.maxWidth || 'iw'},iw):-2`,  // 保持宽高比
    '-movflags', '+faststart',              // MP4 快速开始（流式播放）
  ];
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k'); // 源有音频则转 AAC
  else args.push('-an');                                     // 源无音频则禁用音频流

  // 确保输出目录存在
  const outDir = path.dirname(output);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const started = Date.now();
  const proc = execFileAsync(ffmpeg, args, { timeout: 300000 }); // 5 分钟超时

  // 进度回调（从 stderr 解析 ffmpeg 输出）
  if (onProgress && proc.child && proc.child.stderr) {
    let buf = '';
    proc.child.stderr.on('data', chunk => {
      buf += chunk.toString();
      const m = buf.match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (m) {
        const sec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
        // 我们不知道总时长，用已用时间做粗略进度（假设 60s 内完成短视频）
        onProgress(Math.min(95, Math.round((sec / 90) * 100)));
      }
    });
  }

  try {
    await proc;
  } catch (e) {
    // 清理失败的输出文件
    try { fs.unlinkSync(output); } catch {}
    throw new Error(`转码失败: ${e.message}`);
  }

  const stat = fs.statSync(output);
  return { ok: true, outputPath: output, size: stat.size, tookMs: Date.now() - started };
}

/**
 * 图片 → WebP 转换
 */
export async function convertToWebP(inputPath, outputPath, quality = 80) {
  const { ok, ffmpeg } = await detectFFmpeg();
  if (!ok || !ffmpeg) throw new Error('ffmpeg 不可用');

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  try {
    await execFileAsync(ffmpeg, [
      '-y', '-i', inputPath,
      '-c:v', 'libwebp', '-quality', String(quality),
      '-lossless', '0',
      outputPath,
    ], { timeout: 30000 });
    return { ok: true, outputPath, size: fs.statSync(outputPath).size };
  } catch (e) {
    try { fs.unlinkSync(outputPath); } catch {}
    throw new Error(`WebP 转换失败: ${e.message}`);
  }
}

/**
 * TranscodeQueue: 后台转码队列管理器
 * 单线程串行执行，避免 CPU/IO 过载
 */
export class TranscodeQueue {
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = [];       // { id, input, output, profile, type, status, createdAt, ... }
    this.processing = false;
    this.timer = null;
  }

  /** 入队一个转码任务。task.onDone(entry) 在任务完成/失败时回调，用于回写业务记录。 */
  enqueue(task) {
    const id = task.id || ('tc_' + Date.now().toString(36));
    const entry = {
      id, input: task.input, output: task.output, profile: task.profile || {},
      type: task.type || 'video', status: 'queued',
      mediaId: task.mediaId || null, onDone: task.onDone || null,
      createdAt: Date.now(), startedAt: null, finishedAt: null,
      error: null, size: null, tookMs: null,
    };
    this.queue.push(entry);
    this._tick();
    return entry;
  }

  /** 获取所有任务状态 */
  list() { return [...this.queue]; }

  /** 清理已完成/失败超过 N 小时的记录 */
  prune(maxAgeMs = 3600000 * 24) {
    const now = Date.now();
    this.queue = this.queue.filter(t => {
      if (t.status !== 'done' && t.status !== 'error') return true;
      if (!t.finishedAt) return true;
      return now - t.finishedAt < maxAgeMs;
    });
  }

  async _tick() {
    if (this.processing) return;
    const next = this.queue.find(t => t.status === 'queued');
    if (!next) return;
    this.processing = true;
    next.status = 'processing'; next.startedAt = Date.now();

    try {
      let result;
      if (next.type === 'image_webp') {
        result = await convertToWebP(next.input, next.output, next.profile.quality || 80);
      } else {
        result = await transcode({
          input: next.input, output: next.output, profile: next.profile,
          onProgress: pct => { next.progress = pct; },
        });
      }
      next.status = 'done'; next.finishedAt = Date.now();
      next.size = result.size; next.tookMs = result.tookMs;
      next.outputPath = result.outputPath;
    } catch (e) {
      next.status = 'error'; next.finishedAt = Date.now();
      next.error = e.message || String(e);
    }
    // 回调业务层（如回写 media.transcodedRel），失败不影响队列继续
    if (next.onDone) {
      try { next.onDone(next); } catch (cbErr) { /* 业务回写失败仅记录 */ console.error('[transcode] onDone error:', cbErr); }
    }
    this.processing = false;
    // 处理下一个
    setTimeout(() => this._tick(), 500);
  }
}
