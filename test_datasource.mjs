/**
 * 数据源端到端测试：本地起一个返回 JSON/CSV 的 HTTP 服务，
 * 登录 lumasign 后创建 http-json / csv 两类数据源，刷新并读取缓存。
 */
import http from 'node:http';

const LMS = 'http://127.0.0.1:7788';

// 1) 本地数据源（模拟用户自己的业务 API）
const localJson = {
  ok: true,
  data: { list: [
    { name: '门店A', visitors: 120, temp: 24.5 },
    { name: '门店B', visitors: 88, temp: 23.1 },
    { name: '门店C', visitors: 210, temp: 25.0 },
  ] },
};
const localCsv = 'city,sales,orders\nSH,1500,42\nBJ,980,31\nGZ,1230,38\n';

const local = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.url.startsWith('/json')) return res.end(JSON.stringify(localJson));
  if (req.url.startsWith('/csv')) { res.setHeader('Content-Type', 'text/csv'); return res.end(localCsv); }
  res.statusCode = 404; res.end('nope');
});
await new Promise(r => local.listen(8799, '127.0.0.1', r));
console.log('本地数据源服务已启动 :8799');

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
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')); }

// 2) 登录
let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
check('登录成功', r.status === 200 && r.json?.ok, 'status=' + r.status);
if (!cookie) { console.log('无 cookie，终止'); process.exit(1); }

// 3) 创建 http-json 数据源（JSONPath = data.list）
r = await call('POST', '/api/admin/datasources', {
  name: '测试-JSON', type: 'http-json', url: 'http://127.0.0.1:8799/json',
  method: 'GET', path: 'data.list', refreshSec: 60, timeoutSec: 15,
});
check('创建 http-json 数据源', r.status === 200 && r.json?.ok, 'status=' + r.status);
const jsonId = r.json?.item?.id;
check('返回 id', !!jsonId, jsonId);

// 4) 刷新并预览 http-json
r = await call('POST', `/api/admin/datasources/${jsonId}/refresh`);
check('刷新 http-json 成功', r.json?.ok, 'error=' + (r.json?.error || ''));
check('预览含 3 条记录', Array.isArray(r.json?.sample) && r.json.sample.length === 3, 'len=' + (r.json?.sample?.length));
check('预览 JSON 字符串非空', !!r.json?.sampleStr, 'tookMs=' + r.json?.tookMs);

// 5) 读取缓存
r = await call('GET', `/api/admin/datasources/${jsonId}/data`);
check('读取缓存数据', r.json?.ok && Array.isArray(r.json?.data) && r.json.data.length === 3, 'len=' + (r.json?.data?.length));

// 6) 列表包含该数据源
r = await call('GET', '/api/admin/datasources');
check('列表含数据源', Array.isArray(r.json?.items) && r.json.items.some(x => x.id === jsonId), 'count=' + (r.json?.items?.length));

// 7) CSV 数据源
r = await call('POST', '/api/admin/datasources', {
  name: '测试-CSV', type: 'csv', url: 'http://127.0.0.1:8799/csv',
  delimiter: ',', refreshSec: 60, timeoutSec: 15,
});
const csvId = r.json?.item?.id;
r = await call('POST', `/api/admin/datasources/${csvId}/refresh`);
check('刷新 CSV 成功', r.json?.ok, 'error=' + (r.json?.error || ''));
check('CSV 解析出 3 行', Array.isArray(r.json?.sample) && r.json.sample.length === 3, 'len=' + (r.json?.sample?.length));
check('CSV 字段 city/sales', r.json?.sample?.[0]?.city === 'SH' && r.json?.sample?.[0]?.sales === '1500', JSON.stringify(r.json?.sample?.[0]));

// 8) 删除 CSV 数据源
r = await call('DELETE', `/api/admin/datasources/${csvId}`);
check('删除 CSV 成功', r.json?.ok, 'status=' + r.status);

// 9) 终端鉴权端点（取一个真实终端 token；无终端则跳过）
r = await call('GET', '/api/admin/terminals');
const term = r.json?.items?.[0];
if (term && term.id && term.token) {
  r = await fetch(`${LMS}/api/t/datasource/${jsonId}?terminalId=${term.id}&token=${term.token}`).then(x => x.json());
  check('终端拉取缓存数据', r.ok && Array.isArray(r.data) && r.data.length === 3, 'len=' + (r.data?.length));
  r = await fetch(`${LMS}/api/t/datasource/${jsonId}?terminalId=${term.id}&token=wrong`).then(x => x.json());
  check('终端错误 token 被拒', r.ok !== true, 'ok=' + r.ok);
} else {
  console.log('SKIP 终端鉴权端点（无终端数据）');
}

// 清理
await call('DELETE', `/api/admin/datasources/${jsonId}`);
local.close();

const failed = results.filter(x => !x.ok);
console.log(`\n==== 共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length} ====`);
process.exit(failed.length ? 1 : 0);
