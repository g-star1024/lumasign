/**
 * 灵屏 LumaSign · 零配置发现
 * 终端 UDP 广播 "LUMASIGN_DISCOVER" 到 :7789，服务端应答自身地址。
 * 终端无需手动填 IP，插电即入网。
 */
import dgram from 'node:dgram';
import os from 'node:os';

export function lanIPs() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      out.push({ name, address: i.address, mac: i.mac, netmask: i.netmask });
    }
  }
  // 优先 192.168 / 10. / 172.16-31 段
  const score = a => a.address.startsWith('192.168.') ? 0
    : a.address.startsWith('10.') ? 1
    : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3;
  return out.sort((a, b) => score(a) - score(b));
}
export const primaryIP = () => (lanIPs()[0]?.address) || '127.0.0.1';

export function startDiscovery({ port = 7789, httpPort = 7788, serverName = 'LumaSign' } = {}) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8').trim();
    if (!text.startsWith('LUMASIGN_DISCOVER')) return;
    const reply = Buffer.from(JSON.stringify({
      product: 'LumaSign', version: '1.0.0',
      host: pickReachableIP(rinfo.address), port: httpPort,
      name: serverName, ts: Date.now(),
    }));
    sock.send(reply, rinfo.port, rinfo.address, err => {
      if (err) console.error('[discovery] 应答失败:', err.message);
    });
  });

  sock.on('error', e => { console.error('[discovery] UDP 错误:', e.message); try { sock.close(); } catch {} });
  sock.bind(port, () => {
    try { sock.setBroadcast(true); } catch {}
    console.log(`[discovery] UDP 发现服务已启动 :${port}`);
  });
  sock.unref?.();
  return sock;
}

/** 选择与请求方同网段的本机 IP，多网卡环境下避免回错地址 */
function pickReachableIP(peer) {
  const ips = lanIPs();
  if (!peer) return ips[0]?.address || '127.0.0.1';
  const pp = peer.replace(/^::ffff:/, '').split('.').map(Number);
  for (const i of ips) {
    const ap = i.address.split('.').map(Number);
    const mp = i.netmask.split('.').map(Number);
    if (ap.every((v, k) => (v & mp[k]) === (pp[k] & mp[k]))) return i.address;
  }
  return ips[0]?.address || '127.0.0.1';
}
