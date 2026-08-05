/**
 * P0-4 播放证明与合规存证包 · 端到端验证
 *  - 终端上报播放事件（POST /api/t/playlog）
 *  - 管理端查询（GET /api/admin/playproof/query）
 *  - 导出 JSON（含 SHA-256 审计哈希）
 *  - 导出 PDF（最小可用 PDF：%PDF 头 + %%EOF 尾）
 */
const BASE = 'http://127.0.0.1:7788';
let cookie = '';
async function api(method, path, body, raw = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), ct: res.headers.get('content-type') };
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// 1) 登录
const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
console.log('[login]', login.status, login.data?.ok ? 'OK' : 'FAIL');
if (!login.data?.ok) process.exit(1);

// 2) 注册终端
const reg = await api('POST', '/api/t/register', { mac: 'BB:CC:DD:11:22:33', name: '门店A屏', model: 'LumaSign-Box', storageTotal: 32000, storageFree: 20000 });
const T = reg.data;
console.log('[register]', T.terminalId);

// 3) 上报播放事件
const now = Date.now();
const rep = await api('POST', '/api/t/playlog', {
  terminalId: T.terminalId, token: T.token,
  events: [
    { layoutId: 'lay_1', itemId: 'it_1', mediaId: 'med_1', customer: '星巴克', startedAt: now - 60000, endedAt: now - 30000 },
    { layoutId: 'lay_1', itemId: 'it_2', mediaId: 'med_2', customer: '星巴克', startedAt: now - 30000, endedAt: now },
  ],
});
console.log('[playlog report]', rep.status, 'recorded=', rep.data?.recorded);

// 4) 查询
const q = await api('GET', '/api/admin/playproof/query?customer=星巴克');
console.log('[query]', q.status, 'total=', q.data?.total, 'items=', (q.data?.items || []).length);
const qEmpty = await api('GET', '/api/admin/playproof/query?customer=不存在客户');
console.log('[query empty]', qEmpty.status, 'total=', qEmpty.data?.total);

// 5) 导出 JSON
const js = await api('GET', '/api/admin/playproof/export?fmt=json&customer=星巴克', null, true);
let jsonOk = false, hashOk = false;
try {
  const txt = js.buf.toString('utf8');
  const obj = JSON.parse(txt);
  jsonOk = obj.ok && Array.isArray(obj.records) && obj.records.length === 2;
  hashOk = typeof obj.meta?.hash === 'string' && obj.meta.hash.length === 64;
  console.log('[export json]', js.status, 'records=', obj.records?.length, 'hash=', obj.meta?.hash?.slice(0, 12) + '...');
} catch (e) { console.log('[export json] parse FAIL', e.message); }

// 6) 导出 PDF
const pdf = await api('GET', '/api/admin/playproof/export?fmt=pdf&customer=星巴克', null, true);
const head = pdf.buf.subarray(0, 5).toString('latin1');
const tail = pdf.buf.subarray(Math.max(0, pdf.buf.length - 6)).toString('latin1');
const pdfOk = head === '%PDF-' && tail.includes('%%EOF');
console.log('[export pdf]', pdf.status, 'ct=', pdf.ct, 'bytes=', pdf.buf.length, 'head=', head, 'eof=', tail.includes('%%EOF'));

// 断言
const ok1 = login.status === 200 && login.data?.ok;
const ok2 = reg.status === 200 && !!T.terminalId;
const ok3 = rep.status === 200 && rep.data?.recorded === 2;
const ok4 = q.status === 200 && q.data?.total === 2;
const ok5 = qEmpty.status === 200 && qEmpty.data?.total === 0;
const ok6 = js.status === 200 && jsonOk && hashOk;
const ok7 = pdf.status === 200 && pdfOk;
const allOk = ok1 && ok2 && ok3 && ok4 && ok5 && ok6 && ok7;
console.log('\n=== RESULT', allOk ? 'PASS ✅' : 'FAIL ❌', '===');
console.log({ ok1, ok2, ok3, ok4, ok5, ok6, ok7 });
process.exit(allOk ? 0 : 1);
