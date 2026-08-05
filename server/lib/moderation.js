/**
 * 灵屏 LumaSign · 内容合规审核（零依赖）
 *
 * 为什么必须有：数字标牌是「公共屏幕」。一旦有人（外部攻击者，或拿到账号的内部人员）
 * 把违法违规内容投上去，责任在场所方，不在软件。所以合规不能只靠"人工审批"这一道，
 * 必须在写入链路上做机器拦截。
 *
 * 三道闸：
 *   ① 写入拦截    创建/编辑文本类节目项时实时检测，命中高危直接拒绝入库
 *   ② 发布拦截    提交审批 / 下发排期前全量复检（防止先存草稿再改内容绕过）
 *   ③ 下发前复检  bus 推送清单前最后一次校验（防止直接调 API 篡改数据后下发）
 *
 * 检测能力：
 *   - 多模式敏感词（Trie/DFA，O(n) 单遍扫描，几百词零性能压力）
 *   - 反绕过归一化：全角→半角、繁→简常见字、去零宽字符、去分隔符、拼音数字混淆还原
 *   - 联系方式引流识别（手机号 / 微信号 / QQ / 邮箱 / 短链）
 *   - 外链域名白名单（网页组件只能嵌可信站点）
 *   - 二维码素材强制人工复核（机器识别不了内容，只能标记）
 *
 * 词库可运维：data/moderation-words.json 热加载，管理端可在线增删，不改代码。
 */
import fs from 'node:fs';
import path from 'node:path';

/* ══════════════════════════════════════════════════════════
 * 处置级别
 * ════════════════════════════════════════════════════════ */
export const LEVEL = {
  BLOCK: 'block',    // 直接拒绝，不入库
  REVIEW: 'review',  // 入库但强制人工复核，未复核不可下发
  WARN: 'warn',      // 提示，不阻断
  PASS: 'pass',
};

const LEVEL_RANK = { pass: 0, warn: 1, review: 2, block: 3 };

/* ══════════════════════════════════════════════════════════
 * 内置基础词库
 * ── 说明 ────────────────────────────────────────────────
 * 这里只放"任何场所都不该出现"的通用违规类目。
 * 涉政类词库因地区法规差异极大且需持续更新，本系统不内置固定清单，
 * 改为：① 提供 politics 类目空槽，由运营方按属地要求导入；
 *      ② 对未登记来源的文本一律走人工复核。
 * ════════════════════════════════════════════════════════ */
const BUILTIN = {
  gambling: {
    label: '赌博博彩', level: LEVEL.BLOCK,
    words: ['博彩', '赌场', '百家乐', '轮盘', '老虎机', '六合彩', '时时彩', '私彩', '外围投注',
      '包赔包赢', '稳赚不赔', '下注', '开户送彩金', '娱乐城', '真人荷官', '澳门赌', '网投'],
  },
  porn: {
    label: '色情低俗', level: LEVEL.BLOCK,
    words: ['裸聊', '约炮', '一夜情', '成人影片', '情色', 'av女优', '楼凤', '包夜', '特殊服务',
      '上门服务', '找小姐', '援交', '性用品', '催情', '媚药', '迷奸', '涩涩', '黄片'],
  },
  fraud: {
    label: '诈骗引流', level: LEVEL.BLOCK,
    words: ['刷单返利', '兼职刷单', '无抵押贷款', '黑户贷款', '代开发票', '增值税发票',
      '办理证件', '代办证件', '毕业证办理', '身份证办理', '银行卡出租', '跑分', '洗钱',
      '资金盘', '原始股', '内幕消息', '稳赚', '日入过万', '躺赚', '解冻资金', '杀猪盘'],
  },
  contraband: {
    label: '违禁物品', level: LEVEL.BLOCK,
    words: ['枪支', '弹药', '仿真枪', '管制刀具', '雷管', '炸药', '毒品', '冰毒', '大麻',
      '摇头丸', '麻古', '迷魂药', '窃听器', '定位追踪器', '身份证复印件出售', '公民信息出售',
      '器官买卖', '代孕'],
  },
  hate: {
    label: '仇恨辱骂', level: LEVEL.REVIEW,
    words: ['傻逼', '智障', '滚蛋', '去死', '狗东西', '贱人', '废物东西', '砍死你', '弄死你'],
  },
  medical: {
    label: '医疗广告违规', level: LEVEL.REVIEW,
    words: ['包治百病', '根治', '药到病除', '祖传秘方', '无效退款', '治愈率100', '国家级新药',
      '最高技术', '最新科技', '最先进', '最佳疗效'],
  },
  superlative: {
    label: '广告法极限词', level: LEVEL.WARN,
    words: ['国家级', '世界级', '最高级', '第一品牌', '独一无二', '绝无仅有', '万能', '史无前例',
      '空前绝后', '永久', '免检', '首选', '唯一'],
  },
  politics: {
    label: '涉政敏感（由运营方按属地要求导入）', level: LEVEL.BLOCK,
    words: [],
  },
};

/* ══════════════════════════════════════════════════════════
 * 反绕过归一化
 * ════════════════════════════════════════════════════════ */

/* 注意：以下两个正则用于「逐字符」判定，绝不能带 g 标志（g + test 有 lastIndex 状态，
   会导致隔一个字符漏判——这是反绕过逻辑最容易踩的坑）。 */
/** 零宽 / 控制 / 变体选择符 —— 常被用来在词中间"插隐形字符"绕过 */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u00ad]/;
/** 常见分隔干扰：空格、点、星号、下划线、竖线、中划线 */
const SEPARATOR = /[\s.·•・*＊_—\-~﹏|/\\，,、。!！?？:：;；'"'"()（）[\]【】]/;

/** 全角 → 半角 */
function toHalfWidth(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 0x3000) out += ' ';
    else if (c > 0xff00 && c < 0xff5f) out += String.fromCharCode(c - 0xfee0);
    else out += ch;
  }
  return out;
}

/** 数字/符号替字母的火星文还原：0→o 1→i 3→e 4→a 5→s 7→t @→a $→s */
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '¥': 'y' };

/** 常见繁体 → 简体（只收违规词里会用到的高频字，避免引入巨表） */
const T2S = {
  賭: '赌', 場: '场', 彩: '彩', 錢: '钱', 贏: '赢', 賠: '赔', 開: '开', 戶: '户',
  發: '发', 票: '票', 證: '证', 辦: '办', 藥: '药', 槍: '枪', 彈: '弹', 毒: '毒',
  聊: '聊', 約: '约', 貸: '贷', 單: '单', 返: '返',
  務: '务', 網: '网', 樂: '乐', 廳: '厅', 龍: '龙', 鳳: '凤', 買: '买',
  賣: '卖', 貨: '货', 幣: '币', 銀: '银', 產: '产', 業: '业', 團: '团', 會: '会',
};

/**
 * 归一化文本供匹配用，同时保留「原始下标映射」以便定位命中位置。
 *
 * 重要：leet 还原（1→i、3→e、0→o）会把手机号这类纯数字内容毁掉，
 * 所以拆成两条通道，长度严格一致、共用同一份 map：
 *   norm  —— 半角化 + 小写 + 繁转简 + 去隐形字符 + 去分隔符（数字原样保留）
 *   leet  —— 在 norm 基础上再做火星文还原，只喂给敏感词 Trie
 * 正则规则（手机号/QQ 等）只跑 raw 与 norm，绝不跑 leet。
 *
 * @returns { norm, leet, map } map[i] = 归一化串第 i 个字符在原串中的下标
 */
export function normalize(raw = '') {
  const src = String(raw);
  let norm = '', leet = '';
  const map = [];
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (INVISIBLE.test(ch)) continue;
    ch = toHalfWidth(ch);
    if (T2S[ch]) ch = T2S[ch];
    ch = ch.toLowerCase();
    if (SEPARATOR.test(ch)) continue;
    norm += ch;
    leet += (LEET[ch] || ch);
    map.push(i);
  }
  return { norm, leet, map };
}

/* ══════════════════════════════════════════════════════════
 * Trie 多模式匹配（Aho-Corasick 简化版：Trie + 逐位起点扫描）
 * 词库量级几百到几千，单条文本几百字，实测微秒级，够用且代码可审计。
 * ════════════════════════════════════════════════════════ */
class WordTrie {
  constructor() { this.root = new Map(); this.size = 0; }

  add(word, meta) {
    const { norm } = normalize(word);
    if (!norm) return;
    let node = this.root;
    for (const ch of norm) {
      if (!node.has(ch)) node.set(ch, new Map());
      node = node.get(ch);
    }
    node.set('$', { word, ...meta });
    this.size++;
  }

  /** 返回所有命中（同一起点取最长匹配，避免"赌场"同时报"赌"） */
  scan(norm) {
    const hits = [];
    for (let i = 0; i < norm.length; i++) {
      let node = this.root, j = i, best = null, bestEnd = i;
      while (j < norm.length) {
        const next = node.get(norm[j]);
        if (!next) break;
        node = next; j++;
        const hit = node.get('$');
        if (hit) { best = hit; bestEnd = j; }
      }
      if (best) { hits.push({ ...best, start: i, end: bestEnd }); i = bestEnd - 1; }
    }
    return hits;
  }
}

/* ══════════════════════════════════════════════════════════
 * 正则规则：联系方式引流 / 外链 / 二维码线索
 * ════════════════════════════════════════════════════════ */
const PATTERNS = [
  {
    id: 'phone', label: '手机号', level: LEVEL.REVIEW,
    // 归一化后分隔符已去掉，所以 138-0000-0000 也会连成 11 位
    re: /1[3-9]\d{9}/g,
  },
  { id: 'wechat', label: '微信引流', level: LEVEL.REVIEW, re: /(加|扫)?(微信|weixin|wx|vx|v信|威信)[号:]?[a-z0-9_-]{5,20}/gi },
  { id: 'qq', label: 'QQ 引流', level: LEVEL.REVIEW, re: /(qq|扣扣|企鹅)[号:]?\d{5,12}/gi },
  { id: 'email', label: '邮箱', level: LEVEL.WARN, re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { id: 'shorturl', label: '短链（可跳转任意站点）', level: LEVEL.REVIEW, re: /(t\.cn|dwz\.cn|suo\.im|bit\.ly|tinyurl\.com|url\.cn|5\.tf)\/[a-z0-9]+/gi },
  { id: 'ipurl', label: '裸 IP 链接', level: LEVEL.REVIEW, re: /https?:\/\/\d{1,3}(\.\d{1,3}){3}/gi },
  { id: 'script', label: '脚本注入特征', level: LEVEL.BLOCK, re: /<\s*script|javascript:|onerror\s*=|onload\s*=|<\s*iframe|document\.cookie|eval\s*\(/gi },
];

/* ══════════════════════════════════════════════════════════
 * Moderator 主类
 * ════════════════════════════════════════════════════════ */
export class Moderator {
  /**
   * @param ctx { dataDir, store?, logger? }
   */
  constructor(ctx = {}) {
    this.dataDir = ctx.dataDir || '.';
    this.logger = ctx.logger || null;
    this.file = path.join(this.dataDir, 'moderation-words.json');
    this.config = {
      enabled: true,
      blockOnHit: true,           // 命中 BLOCK 级是否硬拒绝
      requireReviewForUnknownUrl: true,
      urlWhitelist: [],           // 网页组件允许的域名（空 = 只允许本机）
      customWords: {},            // { category: { label, level, words[] } }
      disabledCategories: [],
    };
    this.trie = new WordTrie();
    this.load();
  }

  /* ── 词库加载 / 持久化 ── */

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.config = { ...this.config, ...raw };
      }
    } catch (e) {
      this.logger?.system({ event: 'moderation_load_error', message: e.message });
    }
    this.rebuild();
  }

  save() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);      // 原子写，与 store.js 同一约定
    } catch (e) {
      this.logger?.system({ event: 'moderation_save_error', message: e.message });
    }
  }

  rebuild() {
    this.trie = new WordTrie();
    for (const [cat, def] of Object.entries(this.categories())) {
      if (this.config.disabledCategories?.includes(cat)) continue;
      for (const w of def.words || []) this.trie.add(w, { category: cat, label: def.label, level: def.level });
    }
  }

  /** 内置 + 自定义合并后的完整类目 */
  categories() {
    const out = {};
    for (const [k, v] of Object.entries(BUILTIN)) out[k] = { ...v, words: [...v.words], builtin: true };
    for (const [k, v] of Object.entries(this.config.customWords || {})) {
      if (out[k]) out[k] = { ...out[k], words: [...new Set([...out[k].words, ...(v.words || [])])], level: v.level || out[k].level };
      else out[k] = { label: v.label || k, level: v.level || LEVEL.REVIEW, words: v.words || [], builtin: false };
    }
    return out;
  }

  setConfig(patch = {}) {
    this.config = { ...this.config, ...patch };
    this.rebuild();
    this.save();
    return this.config;
  }

  /** 向某类目追加词（运营在线维护） */
  addWords(category, words = []) {
    const cw = this.config.customWords || (this.config.customWords = {});
    const cat = cw[category] || (cw[category] = { label: BUILTIN[category]?.label || category, level: BUILTIN[category]?.level || LEVEL.REVIEW, words: [] });
    const before = new Set(cat.words);
    for (const w of words) { const s = String(w).trim(); if (s && !before.has(s)) cat.words.push(s); }
    this.rebuild(); this.save();
    return cat.words.length;
  }

  removeWords(category, words = []) {
    const cat = this.config.customWords?.[category];
    if (!cat) return 0;
    const del = new Set(words.map(String));
    const n = cat.words.length;
    cat.words = cat.words.filter(w => !del.has(w));
    this.rebuild(); this.save();
    return n - cat.words.length;
  }

  /* ── 核心检测 ── */

  /**
   * 检测一段文本。
   * @param text  待检测文本
   * @param opts  { scene: 'text'|'url'|'name', strict: boolean }
   * @returns { level, ok, hits[], masked, summary }
   */
  check(text, opts = {}) {
    const raw = String(text ?? '');
    if (!this.config.enabled || !raw.trim()) {
      return { level: LEVEL.PASS, ok: true, hits: [], masked: raw, summary: '' };
    }

    const { norm, leet, map } = normalize(raw);
    const hits = [];

    // ① 敏感词：常规通道 + 火星文还原通道，按原文位置去重
    const wordSeen = new Set();
    for (const src of [norm, leet]) {
      for (const h of this.trie.scan(src)) {
        const at = map[h.start] ?? h.start;
        const key = `${h.word}@${at}`;
        if (wordSeen.has(key)) continue;
        wordSeen.add(key);
        hits.push({
          type: 'word', word: h.word, category: h.category, label: h.label, level: h.level, at,
          excerpt: raw.slice(Math.max(0, at - 8), (map[h.end - 1] ?? h.end) + 9),
        });
      }
    }

    // ② 正则规则（在原文与归一化文本上各跑一遍，取并集）
    for (const p of PATTERNS) {
      for (const src of [raw, norm]) {
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(src)) !== null) {
          if (hits.some(h => h.type === p.id && h.word === m[0])) continue;
          hits.push({ type: p.id, word: m[0], label: p.label, level: p.level, at: m.index, excerpt: m[0] });
          if (p.re.lastIndex === m.index) p.re.lastIndex++;   // 防零宽匹配死循环
        }
      }
    }

    // ③ 合并级别 —— 取最高
    let level = LEVEL.PASS;
    for (const h of hits) if (LEVEL_RANK[h.level] > LEVEL_RANK[level]) level = h.level;
    if (level === LEVEL.BLOCK && !this.config.blockOnHit) level = LEVEL.REVIEW;
    if (opts.strict && level === LEVEL.WARN) level = LEVEL.REVIEW;

    return {
      level,
      ok: level !== LEVEL.BLOCK,
      needReview: level === LEVEL.REVIEW,
      hits,
      masked: this.mask(raw, hits),
      summary: hits.length
        ? `命中 ${hits.length} 项：${[...new Set(hits.map(h => h.label))].slice(0, 5).join('、')}`
        : '',
    };
  }

  /** 打码，用于日志与提示，避免把违规原文再复制一遍 */
  mask(raw, hits) {
    if (!hits.length) return raw;
    let out = raw;
    for (const h of hits) {
      if (h.type !== 'word') continue;
      out = out.split(h.word).join('*'.repeat(Math.min(6, h.word.length)));
    }
    return out;
  }

  /* ── URL 白名单（网页组件） ── */

  checkUrl(url) {
    const s = String(url || '').trim();
    if (!s) return { ok: true, level: LEVEL.PASS, hits: [] };

    // 协议层：只允许 http/https，杜绝 javascript: data: file:
    if (!/^https?:\/\//i.test(s)) {
      return { ok: false, level: LEVEL.BLOCK, hits: [{ type: 'scheme', label: '非法协议', word: s.slice(0, 40) }],
        summary: '网页组件仅支持 http/https 链接' };
    }

    let host = '';
    try { host = new URL(s).hostname.toLowerCase(); } catch {
      return { ok: false, level: LEVEL.BLOCK, hits: [], summary: 'URL 格式非法' };
    }

    const wl = this.config.urlWhitelist || [];
    if (wl.length) {
      const allowed = wl.some((d) => {
        const rule = String(d).trim().toLowerCase().replace(/^\*\./, '');
        return host === rule || host.endsWith('.' + rule);
      });
      if (!allowed) {
        return { ok: false, level: LEVEL.BLOCK, hits: [{ type: 'domain', label: '域名不在白名单', word: host }],
          summary: `域名 ${host} 未列入白名单，禁止投放到大屏` };
      }
    } else if (this.config.requireReviewForUnknownUrl) {
      // 未配白名单：不硬拦，但强制人工复核
      return { ok: true, level: LEVEL.REVIEW, needReview: true,
        hits: [{ type: 'domain', label: '外部域名待复核', word: host }],
        summary: `外链 ${host} 需人工复核后方可下发` };
    }

    // 文本层再过一遍（防 URL 里塞违规关键词做引流）
    return this.check(s, { scene: 'url' });
  }

  /* ── 节目/清单批量审核 ── */

  /**
   * 审核一个完整的节目布局（Layout → Region → Item）。
   * 这是「下发前复检」的入口：不管数据怎么进来的（UI/API/直改 JSON），下发前都过这一关。
   */
  checkLayout(layout) {
    const hits = [];
    let level = LEVEL.PASS;
    const bump = (r, where) => {
      if (LEVEL_RANK[r.level] > LEVEL_RANK[level]) level = r.level;
      for (const h of r.hits || []) hits.push({ ...h, where });
    };

    bump(this.check(layout?.name || '', { scene: 'name' }), '节目名称');

    for (const region of layout?.regions || []) {
      for (const item of region.items || []) {
        const where = `${region.name || '区域'} / ${item.name || item.type || '素材'}`;
        if (item.type === 'text' || item.type === 'marquee' || item.type === 'clock') {
          bump(this.check(item.content || item.text || '', { scene: 'text' }), where);
        }
        if (item.type === 'web' || item.url) {
          bump(this.checkUrl(item.url || item.content || ''), where);
        }
        if (item.name) bump(this.check(item.name, { scene: 'name' }), where);
        // 图片/视频无法机器识别内容 → 依赖上传者留痕 + 审批流 + 播放证明
        if (item.type === 'image' && /qr|二维码|收款码/i.test(`${item.name || ''}`)) {
          level = LEVEL_RANK[level] > LEVEL_RANK[LEVEL.REVIEW] ? level : LEVEL.REVIEW;
          hits.push({ type: 'qrcode', label: '疑似二维码素材，需人工确认指向', word: item.name, where });
        }
      }
    }

    return {
      level, ok: level !== LEVEL.BLOCK, needReview: level === LEVEL.REVIEW,
      hits,
      summary: hits.length ? `共 ${hits.length} 处待处理：${[...new Set(hits.map(h => h.label))].slice(0, 5).join('、')}` : '内容合规检查通过',
    };
  }

  /** 记审计（命中时才写，避免噪声） */
  audit(result, { user, scene, targetId, targetName } = {}) {
    if (!this.logger || !result.hits?.length) return;
    this.logger.audit({
      userId: user?.id || 'system', username: user?.username || 'system',
      action: result.level === LEVEL.BLOCK ? 'content_blocked' : 'content_flagged',
      target: `${scene || '内容'}「${targetName || targetId || '-'}」${result.summary}`,
      level: result.level,
      hits: result.hits.slice(0, 20).map(h => ({ type: h.type, label: h.label, word: h.word, where: h.where })),
    });
  }

  stats() {
    const cats = this.categories();
    return {
      enabled: this.config.enabled,
      totalWords: Object.values(cats).reduce((n, c) => n + (c.words?.length || 0), 0),
      categories: Object.entries(cats).map(([k, v]) => ({
        key: k, label: v.label, level: v.level, count: v.words?.length || 0,
        builtin: !!v.builtin, disabled: this.config.disabledCategories?.includes(k) || false,
      })),
      urlWhitelist: this.config.urlWhitelist || [],
      patterns: PATTERNS.map(p => ({ id: p.id, label: p.label, level: p.level })),
    };
  }
}
