/**
 * LumaSign · LRC 歌词解析器（v1.3.32）
 * 支持格式：
 *   [mm:ss.xx] 歌词文本
 *   [mm:ss.00][mm:ss.10] 歌词文本
 *   [mm:ss.xx]<effect>...
 *   元信息头 [ti:] [ar:] [al:] 等
 *
 * 兼容 Chromium 33：ES5 语法（无箭头函数、无 template literal、无对象展开）。
 */
(function (global) {
  'use strict';

  function parseTimestamp(m, s, x) {
    var ms = 0;
    ms += (m | 0) * 60000;
    ms += (s | 0) * 1000;
    ms += (x | 0);
    return ms;
  }

  function parse(text) {
    if (!text || typeof text !== 'string') return { meta: {}, lines: [] };
    var lines = text.split(/\r?\n/);
    var meta = {};
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      // 元信息
      var metaMatch = line.match(/^\[(\w+):\s*(.*?)\s*]$/);
      if (metaMatch && !metaMatch[1].match(/^\d/)) {
        var key = metaMatch[1].toLowerCase();
        if (key === 'ti' || key === 'ar' || key === 'al' || key === 'au' || key === 'by' ||
            key === 'length' || key === 'offset' || key === 're' || key === 've') {
          meta[key] = metaMatch[2];
          continue;
        }
      }
      // 时间戳：一个或多个 [mm:ss.xx]
      var re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
      var m, times = [];
      while ((m = re.exec(line)) !== null) {
        var msPart = m[3] ? parseInt(m[3], 10) : 0;
        // 兼容两位毫秒 (00) 补齐到三位
        if (m[3] && m[3].length === 2) msPart = msPart * 10;
        if (m[3] && m[3].length === 1) msPart = msPart * 100;
        times.push(parseTimestamp(parseInt(m[1], 10), parseInt(m[2], 10), msPart));
      }
      if (!times.length) continue;
      var textPart = line.replace(re, '').trim();
      // 去掉 <...> 标签
      textPart = textPart.replace(/<[^>]*>/g, '').trim();
      if (!textPart) continue;
      for (var k = 0; k < times.length; k++) {
        out.push({ time: times[k], text: textPart, lineIndex: i });
      }
    }
    out.sort(function (a, b) { return a.time - b.time; });
    return { meta: meta, lines: out };
  }

  /**
   * 找到当前毫秒应显示的歌词行索引
   * @param parsed parse() 返回的对象
   * @param ms 当前播放毫秒
   * @returns {number} 索引（-1 表示无）
   */
  function findIndex(parsed, ms) {
    var lines = parsed && parsed.lines;
    if (!lines || !lines.length) return -1;
    // 二分查找：找到最后一个 time <= ms 的行
    var lo = 0, hi = lines.length - 1, idx = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].time <= ms) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return idx;
  }

  global.LRCParser = {
    parse: parse,
    findIndex: findIndex
  };
})(typeof window !== 'undefined' ? window : globalThis);
