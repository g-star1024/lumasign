/**
 * 灵屏 LumaSign · 转码 API（P1-3.5）
 *
 *   GET  /api/admin/transcode/status     查看 ffmpeg 可用性 + 转码队列
 *   POST /api/admin/transcode/detect      手动检测 ffmpeg
 *   POST /api/admin/transcode/queue       提交转码任务（视频/图片）
 *   GET  /api/admin/transcode/queue       队列列表
 *   POST /api/admin/transcode/:id/cancel 取消排队中的任务
 *   POST /api/admin/transcode/prune       清理过期记录
 */
import { json, fail, readJson } from '../lib/http.js';
import { detectFFmpeg, needsTranscode, TranscodeQueue } from '../lib/transcode.js';
import {
  installFFmpeg, getInstallState, isInstallBusy,
  getInstallDir, isPlatformSupported, getPlatformKey, ffmpegVersion,
} from '../lib/ffmpegInstall.js';

export function registerTranscodeApi(router, ctx) {
  const S = n => ctx.store.col(n);
  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = ctx.auth.userFromReq(req);
    if (!user) return fail(res, '未登录', 401);
    if (perm && !ctx.auth.can(user, perm)) return fail(res, '无权限', 403);
    return handler(req, res, params, url, user);
  };

  // 使用 server.js 注入的共享队列单例（与上传自动转码同一队列）
  const queue = () => ctx.transcodeQueue;

  // ffmpeg 状态检测（实时探测，不再依赖手动 detect 缓存）
  router.get('/api/admin/transcode/status', guard('media:manage', async (req, res) => {
    const det = await detectFFmpeg();
    const q = queue().list();
    json(res, {
      ok: true,
      ffmpeg: { detected: det.ok, ffmpeg: det.ffmpeg, probe: det.probe },
      queue: q.map(t => ({ id: t.id, type: t.type, status: t.status, progress: t.progress || 0,
        error: t.error, size: t.size, tookMs: t.tookMs, createdAt: t.createdAt, mediaId: t.mediaId || null })),
      queueLen: q.length,
    });
  }));

  router.post('/api/admin/transcode/detect', guard('media:manage', async (req, res) => {
    const result = await detectFFmpeg();
    global._ffmpegCache = result; // 缓存供 status 使用
    json(res, { ok: true, ...result });
  }));

  // 提交转码任务
  router.post('/api/admin/transcode/queue', guard('media:manage', async (req, res) => {
    const b = await readJson(req);
    if (!b.mediaId) return fail(res, '缺少 mediaId');
    const media = S('media').byId(b.mediaId);
    if (!media) return fail(res, '素材不存在', 404);

    const filePath = pathJoin(ctx.paths.media, media.hash + (media.ext || ''));
    if (!require('fs').existsSync(filePath)) return fail(res, '源文件不存在');

    const ext = b.type === 'image_webp' ? '.webp' : '.mp4';
    const outRel = media.hash + '_' + (b.profile?.name || 'transcoded') + ext;
    const output = pathJoin(ctx.paths.media, outRel);

    const task = {
      id: 'tc_' + Date.now().toString(36),
      input: filePath,
      output,
      profile: b.profile || {},
      type: b.type || 'video',
      mediaId: b.mediaId,
      // 转码完成自动回填 media 记录的转码产物地址
      onDone: (e) => {
        if (e.status === 'done' && e.outputPath) {
          const trel = path.relative(ctx.paths.media, e.outputPath).split(path.sep).join('/');
          S('media').update(b.mediaId, {
            transcodedRel: trel,
            transcodedAt: Date.now(),
            codec: 'h264',
            browserPlayable: true,
          });
        }
      },
    };
    const entry = queue().enqueue(task);
    json(res, { ok: true, task: entry });
  }));

  // 队列列表
  router.get('/api/admin/transcode/queue', guard('media:manage', (req, res) => {
    const q = queue().list();
    json(res, { ok: true, items: q });
  }));

  // 清理过期记录
  router.post('/api/admin/transcode/prune', guard('media:manage', (req, res) => {
    queue().prune();
    json(res, { ok: true });
  }));

  /* ---------------- ffmpeg 一键安装（服务端） ---------------- */

  // 查看 ffmpeg 状态 + 安装可行性 + 安装进度
  router.get('/api/admin/ffmpeg/status', guard('media:manage', async (req, res) => {
    const det = await detectFFmpeg();
    const key = getPlatformKey();
    const st = getInstallState();
    const version = det.ok && det.ffmpeg ? await ffmpegVersion(det.ffmpeg) : (st.version || null);
    json(res, {
      ok: true,
      detected: det.ok,
      version,
      path: det.ffmpeg || null,
      platform: process.platform,
      arch: process.arch,
      buildKey: key,
      installSupported: isPlatformSupported(),
      installDir: getInstallDir(ctx),
      installBusy: isInstallBusy(),
      installState: st,
    });
  }));

  // 触发安装（异步，立即返回；进度用 status 轮询）
  router.post('/api/admin/ffmpeg/install', guard('media:manage', async (req, res) => {
    if (isInstallBusy()) return fail(res, '正在安装中，请稍候', 409);
    // 后台异步执行，不阻塞请求
    installFFmpeg(ctx).catch(() => { /* 错误已写入 _state，前端轮询可见 */ });
    json(res, { ok: true, started: true });
  }));

  // 安装进度（独立端点，便于轻量轮询）
  router.get('/api/admin/ffmpeg/progress', guard('media:manage', (req, res) => {
    json(res, { ok: true, state: getInstallState(), busy: isInstallBusy() });
  }));
}

/** 小工具：安全拼接路径 */
function pathJoin(...parts) {
  const path = require('path');
  return path.join(...parts);
}
