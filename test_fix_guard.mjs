const BASE = 'http://localhost:7788';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Referer: `${BASE}/` },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
});
const session = login.headers.get('set-cookie');
const ck = { headers: { Cookie: session, Origin: BASE, Referer: `${BASE}/` } };
console.log('login', login.status);

// 1) 封禁列表应为空（之前 127.0.0.1 被 ban 的已随重启清除，且不再产生）
const bans = await (await fetch(`${BASE}/api/admin/security/bans`, ck)).json();
console.log('bans now:', bans.bans.length, '(期望 0)');

// 2) 安全概览应秒回、不 403
const t0 = Date.now();
const ov = await (await fetch(`${BASE}/api/admin/security/overview`, ck)).json();
console.log('overview status', ov.ok ? 'ok' : 'FAIL', '耗时', Date.now() - t0, 'ms; bannedNow=', ov.posture?.bannedNow);

// 3) 高频打 scan 类端点（之前会触发 ban），确认 loopback 豁免后不再封禁
let rateLimited = 0, banned = 0, okCount = 0;
for (let i = 0; i < 12; i++) {
  const r = await fetch(`${BASE}/api/admin/fleet/adb`, ck);
  const j = await r.json().catch(() => ({}));
  if (r.status === 429 || j.reason?.includes('封禁') || j.reason?.includes('频繁')) {
    if (j.reason?.includes('封禁')) banned++; else rateLimited++;
  } else okCount++;
}
console.log(`scan 类高频 12 次: ok=${okCount} rateLimited=${rateLimited} banned=${banned} (期望 ok=12, 其余 0)`);

// 4) 再次查看封禁列表，确认仍未新增 ban
const bans2 = await (await fetch(`${BASE}/api/admin/security/bans`, ck)).json();
console.log('bans after hammer:', bans2.bans.length, '(期望 0)');

const pass = bans.bans.length === 0 && ov.ok && banned === 0 && bans2.bans.length === 0;
console.log(pass ? '\n✅ 限流器回环豁免生效，本机不再自锁' : '\n❌ 仍有封禁问题');
