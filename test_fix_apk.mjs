const BASE = 'http://localhost:7788';
const fs = await import('node:fs');

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Referer: `${BASE}/` },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
});
const session = login.headers.get('set-cookie');
const ck = { headers: { Cookie: session, Origin: BASE, Referer: `${BASE}/` } };

// 造一个最小“APK”文件（PK 头即可，后端 apks 上传不校验 magic）
fs.writeFileSync('/tmp/_dummy.apk', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));

const fd = new FormData();
const buf = fs.readFileSync('/tmp/_dummy.apk');
fd.append('file', new Blob([buf], { type: 'application/vnd.android.package-archive' }), 'test.apk');
fd.append('versionName', '9.9.9');
fd.append('versionCode', '999');
fd.append('note', 'smoke-test');

const up = await fetch(`${BASE}/api/apks`, { method: 'POST', headers: { Cookie: session, Origin: BASE, Referer: `${BASE}/` }, body: fd });
const upj = await up.json();
console.log('upload status', up.status, upj.ok ? 'ok' : 'FAIL', upj.item?.id);

const list = await (await fetch(`${BASE}/api/apks`, ck)).json();
console.log('apks count', list.items.length, '(期望 >=1)');

const del = await fetch(`${BASE}/api/apks/${upj.item.id}`, { method: 'DELETE', headers: { Cookie: session, Origin: BASE, Referer: `${BASE}/` } });
console.log('delete status', del.status);

const list2 = await (await fetch(`${BASE}/api/apks`, ck)).json();
console.log('apks count after delete', list2.items.length, '(期望回到原值)');

const pass = up.status === 200 && list.items.length >= 1 && del.status === 200;
console.log(pass ? '\n✅ APK 上传/列表/删除 全链路可用' : '\n❌ APK 链路异常');
fs.unlinkSync('/tmp/_dummy.apk');
