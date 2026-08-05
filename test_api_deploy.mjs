// 下发版本管理 API 冒烟测试（针对 http://localhost:7788）
const BASE = 'http://localhost:7788';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/auth/me'); if (r.status !== 0) return true; } catch {}
    await sleep(200);
  }
  return false;
}
let cookie = '';
async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
let pass = true;
const check = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) pass = false; };

(async () => {
  if (!(await waitUp())) { console.log('server not up'); process.exit(1); }
  const lg = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  check('登录成功', lg.status === 200 && cookie);

  // 建一个节目 + 排期（无审批则直接可发）
  const lo = await call('POST', '/api/layouts', { name: 'API测试节目', width: 1920, height: 1080 });
  check('创建节目', lo.status === 200 && lo.data?.item?.id);
  const layoutId = lo.data.item.id;

  const sch = await call('POST', '/api/schedules', { name: 'API测试排期', layoutId, mode: 'default', target: { all: true }, enabled: false });
  check('创建排期', sch.status === 200 && sch.data?.item?.id);
  const scheduleId = sch.data.item.id;

  // 全量发布 → 应记录 full 版本
  const pub = await call('POST', `/api/schedules/${scheduleId}/publish`, {});
  check('全量发布成功', pub.status === 200 && pub.data?.versionId);
  const versionId = pub.data.versionId;

  const versions = await call('GET', `/api/deploy/versions?scheduleId=${scheduleId}`);
  check('版本列表含 full 版本', versions.status === 200 && versions.data.items.some(v => v.id === versionId && v.mode === 'full'));

  // 回滚到该版本
  const rb = await call('POST', '/api/deploy/rollback', { versionId });
  check('回滚成功', rb.status === 200 && rb.data?.ok === true);
  const versions2 = await call('GET', `/api/deploy/versions?scheduleId=${scheduleId}`);
  check('回滚后新增 rollback 版本', versions2.data.items.some(v => v.mode === 'rollback'));

  // 详情接口
  const det = await call('GET', `/api/deploy/versions/${versionId}`);
  check('版本详情接口', det.status === 200 && det.data?.item?.id === versionId);

  // 重试接口
  const retry = await call('POST', '/api/deploy/retry', { versionId });
  check('重试接口可用', retry.status === 200 && retry.data?.ok === true);

  console.log(pass ? '\n✅ DEPLOY API ALL PASS' : '\n❌ DEPLOY API FAILED');
  process.exit(pass ? 0 : 1);
})();
