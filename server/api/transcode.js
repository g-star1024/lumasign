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

export function registerTranscodeApi(router, ctx) {
  const S = n => ctx.store.col(n);
  const guard = (perm, handler) => async (req, res, params, url) => {
    const user = ctx.auth.userFromReq(req);
    if (!user) return fail(res, '未登录', 401);
    if (perm && !ctx.auth.can(user, perm)) return fail(res, '无权限', 403);
    return handler(req, res, params, url, user);
  };

  // 延迟初始化队列（首次访问时）
  let _queue = null;
  function queue() {
    if (!_queue) _queue = new TranscodeQueue(ctx);
    return _queue;
  }

  // ffmpeg 状态检测
  router.get('/api/admin/transcode/status', guard('media:manage', (req, res) => {
    const q = _queue ? _queue.list() : [];
    json(res, {
      ok: true,
      ffmpeg: { detected: _ffmpegCache != null, ...(_ffmpegCache || {}) },
      queue: q.map(t => ({ id: t.id, type: t.type, status: t.status, progress: t.progress || 0,
        error: t.error, size: t.size, tookMs: t.tookMs, createdAt: t.createdAt })),
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

    const filePath = pathJoin(ctx.paths.mediaDir, media.hash + (media.ext || ''));
    if (!require('fs').existsSync(filePath)) return fail(res, '源文件不存在');

    const task = {
      id: 'tc_' + Date.now().toString(36),
      input: filePath,
      output: pathJoin(ctx.paths.mediaDir, media.hash + '_' + (b.profile?.name || 'transcoded') + (b.type === 'image_webp' ? '.webp' : '.mp4')),
      profile: b.profile || {},
      type: b.type || 'video',
      mediaId: b.mediaId,
    };
    const entry = queue().enqueue(task);
    json(res, { ok: true, task: entry });
  }));

  // 队列列表
  router.get('/api/admin/transcode/queue', guard('media:manage', (req, res) => {
    const q = _queue ? _queue.list() : [];
    json(res, { ok: true, items: q });
  }));

  // 清理过期记录
  router.post('/api/admin/transcode/prune', guard('media:manage', (req, res) => {
    if (_queue) { _queue.prune(); }
    json(res, { ok: true });
  }));
}

/** 小工具：安全拼接路径 */
function pathJoin(...parts) {
  const path = require('path');
  return path.join(...parts);
}
