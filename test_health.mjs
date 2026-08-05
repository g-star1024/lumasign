/**
 * P0-3 终端健康度 · 端到端验证
 * 模拟三类健康度终端（良好/注意/严重），校验：
 *   - 心跳采集并写出 healthScore/healthLevel/healthIssues
 *   - /api/admin/health/summary 平均分 + 分档统计
 *   - /api/admin/health/:id 单终端健康详情 + 异常项
 *   - /api/admin/health/:id/cleanup 清理缓存指令
 *   - /api/admin/health/config 阈值读写
 */
const BASE = 'http://127.0.0.1:7788';
let cookie = '';
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// 1) 登录
const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
console.log('[login]', login.status, login.data?.ok ? 'OK' : 'FAIL');
if (!login.data?.ok) { console.error('登录失败，终止'); process.exit(1); }

// 2) 注册三类终端
async function register(mac, name, storageTotal, storageFree) {
  const r = await api('POST', '/api/t/register', { mac, name, model: 'LumaSign-Box', storageTotal, storageFree });
  return r.data;
}
const T1 = await register('AA:BB:CC:00:00:01', '健康终端A', 32000, 20000);
const T2 = await register('AA:BB:CC:00:00:02', '注意终端B', 32000, 4000);
const T3 = await register('AA:BB:CC:00:00:03', '严重终端C', 32000, 1000);
console.log('[register]', [T1, T2, T3].map(t => t.terminalId).join(', '));

// 3) 心跳上报不同健康档位
async function heartbeat(t, metrics) {
  return api('POST', '/api/t/heartbeat', { terminalId: t.terminalId, token: t.token, ...metrics });
}
await heartbeat(T1, { cpu: 30, mem: 40, latency: 50, cpuTemp: 45, crashCount: 0, uptime: 3600, playing: '广告节目A', storageTotal: 32000, storageFree: 20000 });
await heartbeat(T2, { cpu: 85, mem: 50, latency: 200, cpuTemp: 65, crashCount: 0, uptime: 3600, playing: '广告节目B', storageTotal: 32000, storageFree: 4000 });
await heartbeat(T3, { cpu: 97, mem: 96, latency: 900, cpuTemp: 80, crashCount: 6, uptime: 3600, playing: '广告节目C', storageTotal: 32000, storageFree: 1000 });

// 等待 score 写出（record 同步执行，但保险起见稍候）
await new Promise(r => setTimeout(r, 200));

// 4) 概览
const sum = await api('GET', '/api/admin/health/summary');
console.log('[summary]', sum.status, JSON.stringify(sum.data?.bands), 'avg=', sum.data?.avgScore, 'total=', sum.data?.total);
const byId = Object.fromEntries((sum.data?.terminals || []).map(t => [t.id, t]));
console.log('  T1', byId[T1.terminalId]?.level, byId[T1.terminalId]?.score, '| issues', (byId[T1.terminalId]?.issues||[]).map(i=>i.msg).join(','));
console.log('  T2', byId[T2.terminalId]?.level, byId[T2.terminalId]?.score, '| issues', (byId[T2.terminalId]?.issues||[]).map(i=>i.msg).join(','));
console.log('  T3', byId[T3.terminalId]?.level, byId[T3.terminalId]?.score, '| issues', (byId[T3.terminalId]?.issues||[]).map(i=>i.msg).join(','));

// 5) 单终端详情
const d1 = await api('GET', `/api/admin/health/${T1.terminalId}`);
console.log('[detail T1]', d1.status, 'score=', d1.data?.health?.score, 'level=', d1.data?.health?.level, 'issues=', d1.data?.health?.issues?.length);

// 6) 清理缓存指令
const cl = await api('POST', `/api/admin/health/${T3.terminalId}/cleanup`);
console.log('[cleanup T3]', cl.status, cl.data?.ok ? 'OK' : 'FAIL', cl.data?.message || '');

// 7) 阈值配置读写
const cfgGet = await api('GET', '/api/admin/health/config');
console.log('[config GET]', cfgGet.status, 'storageWarn=', cfgGet.data?.config?.storageWarn, 'offlineMinutes=', cfgGet.data?.config?.offlineMinutes);
const cfgPost = await api('POST', '/api/admin/health/config', { storageWarn: 25, tempCrit: 78 });
console.log('[config POST]', cfgPost.status, 'storageWarn=', cfgPost.data?.config?.storageWarn, 'tempCrit=', cfgPost.data?.config?.tempCrit);

// 断言
const ok1 = sum.status === 200 && sum.data?.total >= 3;
const ok2 = byId[T1.terminalId]?.level === 'good';
const ok3 = ['warn','bad','crit'].includes(byId[T2.terminalId]?.level) && (byId[T2.terminalId]?.issues||[]).some(i=>i.msg.includes('存储'));
const ok4 = byId[T3.terminalId]?.level === 'crit';
const ok5 = d1.status === 200 && d1.data?.health?.score >= 0;
const ok6 = cl.status === 200 && cl.data?.ok;
const ok7 = cfgPost.status === 200 && cfgPost.data?.config?.storageWarn === 25 && cfgPost.data?.config?.tempCrit === 78;
const allOk = ok1 && ok2 && ok3 && ok4 && ok5 && ok6 && ok7;
console.log('\n=== RESULT', allOk ? 'PASS ✅' : 'FAIL ❌', '===');
console.log({ ok1, ok2, ok3, ok4, ok5, ok6, ok7 });
process.exit(allOk ? 0 : 1);
