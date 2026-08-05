/**
 * 灵屏 LumaSign · 零依赖极简 PDF 生成器（P0-4 合规存证包）
 *
 * 仅用 Node 内置模块，手写最小可用 PDF：
 *   - 标准 14 字体 Helvetica（ASCII），中文文本走 JSON 侧车
 *   - 支持嵌入 JPEG 截屏（DCTDecode），自动解析宽高
 *   - 多页 + 文本页 + 截屏九宫格页 + 审计哈希页
 *
 * 设计取舍：标准字体不含 CJK，故 PDF 正文用 ASCII（ID/时间戳/哈希/统计），
 * 真实中文素材名/客户名由随包的 JSON 提供，而截屏 JPEG 本身已含中文画面，
 * 作为"播放证明"的视觉证据。
 */
import crypto from 'crypto';

const PAGE_W = 595.28, PAGE_H = 841.89; // A4 @72dpi

/** 转义 PDF 文本串中的特殊字符，并剔除非 ASCII（中文→?） */
function esc(s) {
  return String(s ?? '')
    .replace(/[^\x20-\x7E]/g, '?')   // 非 ASCII 用 ? 占位
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/** 解析 JPEG 宽高（SOF0/SOF2/SOF1） */
export function jpegSize(buf) {
  let off = 2;
  while (off < buf.length) {
    if (buf[off] !== 0xFF) { off++; continue; }
    const marker = buf[off + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      const h = buf.readUInt16BE(off + 5);
      const w = buf.readUInt16BE(off + 7);
      return { w, h };
    }
    const len = buf.readUInt16BE(off + 2);
    off += 2 + len;
  }
  return null;
}

/** 组装 PDF：objects 为对象体字符串数组（不含 "n 0 obj"） */
function assemble(objects) {
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(off => { pdf += `${String(off).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** 文本页 content stream：lines = [{text, x, y, size, bold}] */
function textContent(lines) {
  let s = '';
  for (const l of lines) {
    const font = l.bold ? 'F2' : 'F1';
    const size = l.size || 10;
    const x = l.x ?? 50, y = l.y ?? 800;
    s += `BT /${font} ${size} Tf ${x} ${y} Td (${esc(l.text)}) Tj ET\n`;
  }
  return s;
}

/** 截屏网格页 content stream：每张图按 3x3 布局 */
function gridContent(imgs) {
  const cols = 3, rows = 3;
  const margin = 40;
  const cellW = (PAGE_W - margin * 2) / cols;
  const cellH = (PAGE_H - margin * 2) / rows;
  const maxIW = cellW - 16, maxIH = cellH - 36;
  let s = '';
  imgs.forEach((im, i) => {
    const cx = margin + (i % cols) * cellW;
    const cyTop = PAGE_H - margin - ((Math.floor(i / cols) + 1) * cellH);
    const ar = im.w / im.h;
    let dw = maxIW, dh = dw / ar;
    if (dh > maxIH) { dh = maxIH; dw = dh * ar; }
    const dx = cx + (cellW - dw) / 2;
    const dy = cyTop + (cellH - dh) / 2 + 8;
    s += `q ${dw.toFixed(2)} ${dh.toFixed(2)} 0 0 ${dx.toFixed(2)} ${dy.toFixed(2)} cm /Im${i + 1} Do Q\n`;
  });
  return s;
}

/**
 * 构建播放证明存证 PDF
 * @param {object} opt
 *   meta: { reportId, generatedAt, hash, filter }
 *   summary: { total, terminals, materials, spanFrom, spanTo }
 *   records: [{terminalId, mediaId, startedAt, endedAt, duration, terminalName, mediaName}]
 *   screenshots: [{ buf, w, h, label }]   // 最多 9 张
 */
export function buildProofPdf({ meta, summary, records, screenshots = [] }) {
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');           // 1 Catalog
  // Pages tree built later; reserve index 2
  const pageObjIds = [];
  const contentObjIds = [];
  const imgXobjIds = [];

  // ---- 文本页（封面 + 摘要 + 记录表，可分页）----
  const textLines = [];
  const addLine = (text, y, opts = {}) => textLines.push({ text, x: opts.x ?? 50, y, size: opts.size, bold: opts.bold });
  let y = PAGE_H - 60;
  addLine('LumaSign Playback Proof Report', y, { size: 18, bold: true }); y -= 16;
  addLine(`Report ID : ${meta.reportId}`, y, { size: 10 }); y -= 14;
  addLine(`Generated : ${new Date(meta.generatedAt).toISOString()}`, y, { size: 10 }); y -= 14;
  addLine(`SHA-256   : ${meta.hash}`, y, { size: 9 }); y -= 18;
  addLine('Filter', y, { size: 12, bold: true }); y -= 14;
  for (const [k, v] of Object.entries(meta.filter || {})) {
    if (v == null || v === '') continue;
    addLine(`  ${k}: ${v}`, y, { size: 10 }); y -= 13;
  }
  y -= 8;
  addLine('Summary', y, { size: 12, bold: true }); y -= 14;
  addLine(`  Total plays : ${summary.total}`, y, { size: 10 }); y -= 13;
  addLine(`  Terminals   : ${summary.terminals}`, y, { size: 10 }); y -= 13;
  addLine(`  Materials   : ${summary.materials}`, y, { size: 10 }); y -= 13;
  addLine(`  Span        : ${summary.spanFrom || '-'} .. ${summary.spanTo || '-'}`, y, { size: 10 }); y -= 20;

  addLine('Playback Records (ASCII; full CJK metadata in companion .json)', y, { size: 11, bold: true }); y -= 6;
  // 表头
  addLine('TERMINAL_ID            MEDIA_ID               START                END                  DUR(s)', y, { size: 8, bold: true }); y -= 12;
  addLine('------------------------------------------------------------------------------------------------', y, { size: 8 }); y -= 11;

  const pad = (s, n) => { s = String(s ?? ''); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
  const fmt = ts => ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : '-';
  for (const r of records) {
    const line = `${pad(r.terminalId, 22)} ${pad(r.mediaId, 22)} ${pad(fmt(r.startedAt), 19)} ${pad(fmt(r.endedAt), 19)} ${pad(r.duration, 6)}`;
    addLine(line, y, { size: 8 });
    y -= 11;
    if (y < 60) { // 新页
      contentObjIds.push(objs.length + 1);
      objs.push(`<< /Length ${Buffer.byteLength(textContent(textLines), 'latin1')} >>\nstream\n${textContent(textLines)}\nendstream`);
      pageObjIds.push(objs.length + 1);
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjIds[contentObjIds.length - 1]} 0 R >>`);
      textLines.length = 0; y = PAGE_H - 60;
      addLine('Playback Records (continued)', y, { size: 11, bold: true }); y -= 24;
    }
  }
  contentObjIds.push(objs.length + 1);
  objs.push(`<< /Length ${Buffer.byteLength(textContent(textLines), 'latin1')} >>\nstream\n${textContent(textLines)}\nendstream`);
  pageObjIds.push(objs.length + 1);
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjIds[contentObjIds.length - 1]} 0 R >>`);

  // ---- 截屏九宫格页 ----
  const shots = screenshots.slice(0, 9);
  if (shots.length) {
    shots.forEach((im, i) => {
      imgXobjIds.push(objs.length + 1);
      objs.push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length} >>\nstream\n${im.buf.toString('latin1')}\nendstream`);
    });
    contentObjIds.push(objs.length + 1);
    objs.push(`<< /Length ${Buffer.byteLength(gridContent(shots), 'latin1')} >>\nstream\n${gridContent(shots)}\nendstream`);
    const res = `<< /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${shots.map((_, i) => `/Im${i + 1} ${imgXobjIds[i]} 0 R`).join(' ')} >> >>`;
    pageObjIds.push(objs.length + 1);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${res} /Contents ${contentObjIds[contentObjIds.length - 1]} 0 R >>`);
  }

  // ---- 字体 ----
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');   // 3 F1
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'); // 4 F2

  // ---- Pages tree (index 2) ----
  objs[1] = `<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;

  return assemble(objs);
}

/** 计算存证包审计哈希（对规范化记录 + 元信息做 SHA-256） */
export function proofHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
