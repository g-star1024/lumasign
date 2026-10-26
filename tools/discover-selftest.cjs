/* 零配置发现自测：本机广播 LUMASIGN_DISCOVER，验证服务端应答与 IP */
const dgram = require('dgram');
const sock = dgram.createSocket({ type: 'udp4' });
sock.on('message', (msg, rinfo) => {
  console.log('REPLY from', rinfo.address + ':' + rinfo.port, '->', msg.toString('utf8'));
  sock.close();
  process.exit(0);
});
sock.bind(() => {
  try { sock.setBroadcast(true); } catch {}
  const data = Buffer.from('LUMASIGN_DISCOVER');
  sock.send(data, 7789, '255.255.255.255', err => {
    if (err) { console.error('SEND_FAIL:', err.message); process.exit(1); }
    console.log('broadcast sent to 255.255.255.255:7789, waiting 3s...');
  });
  setTimeout(() => { console.log('TIMEOUT: no reply'); process.exit(2); }, 3000);
});
