// 生命周期 API 冒烟测试（针对已启动的 http://localhost:7788）
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

  const sum = await call('GET', '/api/admin/lifecycle/summary');
  check('summary 接口可用', sum.status === 200 && sum.data?.buckets);

  const cfg = await call('GET', '/api/admin/lifecycle/config');
  check('config 接口可用', cfg.status === 200 && cfg.data?.config?.warnDays != null);

  const items = await call('GET', '/api/admin/lifecycle/items?state=expired');
  check('items 接口可用', items.status === 200 && Array.isArray(items.data?.items));

  // 找一个真实素材来测 set/archive/restore
  const media = await call('GET', '/api/media');
  const m = (media.data?.items || [])[0];
  if (m) {
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const setR = await call('POST', '/api/admin/lifecycle/set', { type: 'media', id: m.id, validUntil: past });
    check('set 有效期(过去)→过期', setR.status === 200);
    const expItems = await call('GET', '/api/admin/lifecycle/items?type=media&state=expired');
    check('过期素材出现在 expired 列表', (expItems.data?.items || []).some(x => x.id === m.id));

    const fut = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const rest = await call('POST', '/api/admin/lifecycle/restore', { type: 'media', id: m.id, validUntil: fut });
    check('restore 顺延到未来→重新可播', rest.status === 200 && rest.data?.state !== 'expired');
  } else {
    console.log('（无素材，跳过 set/restore 明细测试）');
  }

  const sweep = await call('POST', '/api/admin/lifecycle/sweep');
  check('sweep 接口可用', sweep.status === 200 && sweep.data?.scanned != null);

  console.log(pass ? '\n✅ API ALL PASS' : '\n❌ API FAILED');
  process.exit(pass ? 0 : 1);
})();
