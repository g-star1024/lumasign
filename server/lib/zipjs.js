/**
 * 灵屏 LumaSign · 零依赖极简 ZIP 打包器（审计报表导出）
 *
 * 纯 Node 内置 zlib + 手写 ZIP 格式：
 *   - 支持 DEFLATE 压缩（zlib.deflateSync）和 STORE 不压缩
 *   - 自动计算 CRC32、偏移量
 *   - 输出 Buffer，可直接 res.send() 或 fs.writeFileSync()
 *
 * 用法：
 *   import { ZipWriter } from './zipjs.js';
 *   const zip = new ZipWriter();
 *   zip.addFile('report.pdf', pdfBuffer);
 *   zip.addFile('data.json', JSON.stringify(data), 'text');
 *   const buf = zip.toBuffer();  // 完整 ZIP 文件 Buffer
 */

import zlib from 'zlib';
import crc32 from 'zlib';

/** 计算 CRC32（返回有符号整数，ZIP 需要无符号 >>> 0） */
function calcCrc32(buf) {
  // Node 的 crc32 模块返回的是 Buffer，需要解析为 uint32
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

const LOCSIG = 0x04034b50;
const CENSIG = 0x02014b50;
const ENDSIG = 0x06054b50;

class ZipWriter {
  constructor() {
    this.entries = [];       // { name, data, method, crc32, mtime }
    this.buffers = [];
  }

  /**
   * 添加文件到 ZIP
   * @param {string} name  文件名（路径分隔符用 /）
   * @param {Buffer|string} data  文件内容
   * @param {'store'|'deflate'} [method='deflate']  压缩方式
   */
  addFile(name, data, method = 'deflate') {
    if (typeof data === 'string') data = Buffer.from(data, 'utf-8');
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = calcCrc32(buf);
    let compressed;
    let actualMethod;

    if (method === 'deflate') {
      compressed = zlib.deflateSync(buf);
      // 如果压缩后更大，改用 store
      if (compressed.length >= buf.length) {
        compressed = buf;
        actualMethod = 0; // store
      } else {
        actualMethod = 8; // deflate
      }
    } else {
      compressed = buf;
      actualMethod = 0; // store
    }

    this.entries.push({
      name,
      data: buf,
      compressed,
      method: actualMethod,
      crc,
      size: buf.length,
      compressedSize: compressed.length,
    });
  }

  /** 生成完整 ZIP 文件 Buffer */
  toBuffer() {
    const parts = [];
    const centralDirRecords = [];
    let offset = 0;

    // 1. 写每个文件的 local file header + data
    for (const entry of this.entries) {
      const hdr = this._localHeader(entry);
      parts.push(hdr);
      parts.push(entry.compressed);
      centralDirRecords.push({ ...entry, offset });
      offset += hdr.length + entry.compressedSize;
    }

    // 2. 中央目录
    const centralDirOffset = offset;
    const centralDirParts = [];
    for (const rec of centralDirRecords) {
      centralDirParts.push(this._centralHeader(rec, centralDirOffset));
    }
    const centralDirBuf = Buffer.concat(centralDirParts);
    parts.push(centralDirBuf);

    // 3. EOCD（End of Central Directory）
    const eocd = this._eocd(centralDirOffset, centralDirBuf.length, this.entries.length);
    parts.push(eocd);

    return Buffer.concat(parts);
  }

  _localHeader(entry) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    // Local file header: 30 bytes fixed + variable name
    const buf = Buffer.alloc(30 + nameBuf.length);
    let o = 0;
    buf.writeUInt32LE(LOCSIG, o); o += 4;           // signature
    buf.writeUInt16LE(20, o); o += 2;                // version needed (2.0)
    buf.writeUInt16LE(0, o); o += 2;                // general purpose bit flag
    buf.writeUInt16LE(entry.method, o); o += 2;     // compression method
    buf.writeUInt16LE(0, o); o += 2;                // last mod time (dummy)
    buf.writeUInt16LE(0, o); o += 2;                // last mod date (dummy)
    buf.writeUInt32LE(entry.crc, o); o += 4;        // crc-32
    buf.writeUInt32LE(entry.compressedSize, o); o += 4; // compressed size
    buf.writeUInt32LE(entry.size, o); o += 4;       // uncompressed size
    buf.writeUInt16LE(nameBuf.length, o); o += 2;   // filename length
    buf.writeUInt16LE(0, o); o += 2;               // extra field length
    nameBuf.copy(buf, o);                           // filename
    return buf;
  }

  _centralHeader(rec, centralDirStart) {
    const nameBuf = Buffer.from(rec.name, 'utf-8');
    // Central dir header: 46 bytes fixed + variable name
    const buf = Buffer.alloc(46 + nameBuf.length);
    let o = 0;
    buf.writeUInt32LE(CENSIG, o); o += 4;           // signature
    buf.writeUInt16LE(20, o); o += 2;               // version made by
    buf.writeUInt16LE(20, o); o += 2;               // version needed
    buf.writeUInt16LE(0, o); o += 2;                // general purpose bit flag
    buf.writeUInt16LE(rec.method, o); o += 2;      // compression method
    buf.writeUInt16LE(0, o); o += 2;               // last mod time
    buf.writeUInt16LE(0, o); o += 2;               // last mod date
    buf.writeUInt32LE(rec.crc, o); o += 4;         // crc-32
    buf.writeUInt32LE(rec.compressedSize, o); o += 4; // compressed size
    buf.writeUInt32LE(rec.size, o); o += 4;        // uncompressed size
    buf.writeUInt16LE(nameBuf.length, o); o += 2;  // filename length
    buf.writeUInt16LE(0, o); o += 2;              // extra field length
    buf.writeUInt16LE(0, o); o += 2;              // comment length
    buf.writeUInt16LE(0, o); o += 2;              // disk number start
    buf.writeUInt16LE(0, o); o += 2;              // internal attributes
    buf.writeUInt32LE(0, o); o += 4;             // external attributes
    buf.writeUInt32LE(rec.offset, o); o += 4;     // relative offset of local header
    nameBuf.copy(buf, o);
    return buf;
  }

  _eocd(centralDirOffset, centralDirSize, count) {
    // EOCD: 22 bytes fixed (+ optional comment)
    const buf = Buffer.alloc(22);
    let o = 0;
    buf.writeUInt32LE(ENDSIG, o); o += 4;          // signature
    buf.writeUInt16LE(0, o); o += 2;               // disk number
    buf.writeUInt16LE(0, o); o += 2;               // disk with central dir
    buf.writeUInt16LE(count, o); o += 2;           // entries on this disk
    buf.writeUInt16LE(count, o); o += 2;           // total entries
    buf.writeUInt32LE(centralDirSize, o); o += 4;  // central dir size
    buf.writeUInt32LE(centralDirOffset, o); o += 4; // central dir offset
    buf.writeUInt16LE(0, o); o += 2;               // comment length
    return buf;
  }
}

export { ZipWriter };
