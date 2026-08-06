/**
 * 交互热区端到端测试：
 *  - 节目创建/更新/读取时 hotspots 数组被正确持久化
 *  - 终端鉴权端点 /api/t/layout/:id 对热区节目可用且需鉴权
 */
import http from 'node:http';

const LMS = 'http://127.0.0.1:7788';
let cookie = '';
async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(LMS + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let json; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}
const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')); }

const sampleHotspots = [
  { id: 'hs_1', x: 100, y: 100, w: 300, h: 200, shape: 'rect', action: { type: 'popup', mediaId: '', text: '欢迎', label: '菜单', duration: 8 } },
  { id: 'hs_2', x: 500, y: 100, w: 300, h: 200, shape: 'rect', action: { type: 'url', target: 'https://example.com', label: '官网' } },
];

// 登录
let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
check('登录成功', r.status === 200 && r.json?.ok);

// 创建节目（含热区）
r = await call('POST', '/api/layouts', { name: '热区测试节目', type: 'program', width: 1920, height: 1080, hotspots: sampleHotspots });
check('创建节目含热区', r.status === 200 && r.json?.ok, 'status=' + r.status);
const layoutId = r.json?.item?.id;
check('创建响应回带 hotspots', Array.isArray(r.json?.item?.hotspots) && r.json.item.hotspots.length === 2, 'len=' + (r.json?.item?.hotspots?.length));

// 读取节目 → hotspots 持久化
r = await call('GET', `/api/layouts/${layoutId}`);
check('GET 回带 hotspots', Array.isArray(r.json?.item?.hotspots) && r.json.item.hotspots.length === 2, 'len=' + (r.json?.item?.hotspots?.length));
check('hotspots 坐标正确', r.json?.item?.hotspots?.[0]?.x === 100 && r.json.item.hotspots[0].action?.type === 'popup');

// 更新节目 → hotspots 被保留/更新
const updated = JSON.parse(JSON.stringify(r.json.item));
updated.hotspots[0].action.target = 'https://a.com';
updated.hotspots.push({ id: 'hs_3', x: 10, y: 10, w: 100, h: 100, shape: 'rect', action: { type: 'layout', target: 'OTHER', label: '跳转' } });
r = await call('PUT', `/api/layouts/${layoutId}`, updated);
check('PUT 成功', r.status === 200 && r.json?.ok);
r = await call('GET', `/api/layouts/${layoutId}`);
check('PUT 后 hotspots 持久化(3个)', r.json?.item?.hotspots?.length === 3, 'len=' + (r.json?.item?.hotspots?.length));
check('PUT 后字段更新生效', r.json?.item?.hotspots?.[0]?.action?.target === 'https://a.com');

// 注册一个终端拿 token
let t = await call('POST', '/api/t/register', { serial: 'test-hotspot-' + Date.now(), name: '测试终端', model: 'Browser', resolution: '1920x1080' });
const termId = t.json?.terminalId, termToken = t.json?.token;
check('终端注册成功', !!termId && !!termToken, 'id=' + termId);

// 终端端点：无 token → 401
r = await call('GET', `/api/t/layout/${layoutId}`);
check('终端端点无 token 被拒(401)', r.status === 401, 'status=' + r.status);

// 终端端点：错误 token → 401
r = await call('GET', `/api/t/layout/${layoutId}?terminalId=${termId}&token=wrong`);
check('终端端点错误 token 被拒(401)', r.status === 401, 'status=' + r.status);

// 终端端点：正确 token → 200 且包含 hotspots
r = await call('GET', `/api/t/layout/${layoutId}?terminalId=${termId}&token=${termToken}`);
check('终端端点正确 token 返回节目', r.status === 200 && r.json?.ok, 'status=' + r.status);
check('终端端点回带 hotspots', Array.isArray(r.json?.item?.hotspots) && r.json.item.hotspots.length === 3, 'len=' + (r.json?.item?.hotspots?.length));

// 清理
await call('DELETE', `/api/layouts/${layoutId}`);

const failed = results.filter(x => !x.ok);
console.log(`\n==== 共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length} ====`);
process.exit(failed.length ? 1 : 0);
