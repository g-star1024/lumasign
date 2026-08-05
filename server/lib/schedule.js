/**
 * 灵屏 LumaSign · 排期引擎
 * 与 E 版语义对齐的四种播放方式，优先级：exclusive > insert > cycle > default
 *  - default   默认播放：无其他节目时兜底轮播
 *  - cycle     周期播放：按日期范围 + 星期 + 时段轮播
 *  - insert    实时插播：临时高优先级插入，播完回落
 *  - exclusive 独占播放：命中时段内独占屏幕，屏蔽其他所有节目
 */
import { isPlayable, windowForManifest } from './lifecycle.js';

export const MODE_PRIORITY = { default: 0, cycle: 10, insert: 20, exclusive: 30 };

const pad = n => String(n).padStart(2, '0');
const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 判断某排期在给定时刻是否命中 */
export function hits(sch, when = new Date()) {
  if (sch.enabled === false) return false;

  const dk = dateKey(when);
  if (sch.dateRange && sch.dateRange.length === 2) {
    const [from, to] = sch.dateRange;
    if (from && dk < from) return false;
    if (to && dk > to) return false;
  }
  if (Array.isArray(sch.weekdays) && sch.weekdays.length) {
    if (!sch.weekdays.includes(when.getDay())) return false;
  }
  const slots = sch.timeSlots;
  if (Array.isArray(slots) && slots.length) {
    const cur = when.getHours() * 60 + when.getMinutes();
    const inSlot = slots.some(([a, b]) => {
      const s = toMin(a), e = toMin(b);
      return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e); // 跨零点
    });
    if (!inSlot) return false;
  }
  // 实时插播的有效期
  if (sch.mode === 'insert' && sch.expireAt && Date.now() > sch.expireAt) return false;
  // 内容有效期：兼容排期文档（validFrom/validUntil）与下发清单（validity）两种形态
  const now = when instanceof Date ? when.getTime() : Date.now();
  if (sch.validity) {
    if (sch.validity.from != null && now < sch.validity.from) return false;
    if (sch.validity.until != null && now > sch.validity.until) return false;
  } else if (!isPlayable(sch, now)) return false;
  if (sch.layoutValidity) {
    if (sch.layoutValidity.from != null && now < sch.layoutValidity.from) return false;
    if (sch.layoutValidity.until != null && now > sch.layoutValidity.until) return false;
  }
  return true;
}

/** 解析某终端的目标排期集合 */
export function schedulesForTerminal(store, terminal) {
  const all = store.col('schedules').all();
  const groups = new Set(terminal.groupIds || []);
  return all.filter(s => {
    if (s.enabled === false) return false;
    const t = s.target || {};
    if (t.terminalIds?.includes(terminal.id)) return true;
    if (t.groupIds?.some(g => groups.has(g))) return true;
    if (t.orgIds?.includes(terminal.orgId)) return true;
    if (t.all) return true;
    return false;
  });
}

/**
 * 生成下发清单：服务端算好排期，终端只需按 timeSlots 本地判定（断网也能正确切换）
 */
export function buildManifest(store, terminal) {
  const layouts = store.col('layouts');
  const media = store.col('media');
  const list = schedulesForTerminal(store, terminal);

  const now = Date.now();
  const out = [], assetMap = new Map();
  const collectAssets = layout => {
    for (const r of layout.regions || []) {
      for (const it of r.items || []) {
        if (!it.mediaId) continue;
        const m = media.byId(it.mediaId);
        if (!m || assetMap.has(m.hash)) continue;
        assetMap.set(m.hash, {
          hash: m.hash, size: m.size, mime: m.mime, name: m.name,
          url: `/api/t/media/${m.hash}`,
          pages: m.pages || null,   // Office/PDF 转出的图片序列
        });
      }
    }
    if (layout.background?.mediaId) {
      const m = media.byId(layout.background.mediaId);
      if (m && !assetMap.has(m.hash)) assetMap.set(m.hash, {
        hash: m.hash, size: m.size, mime: m.mime, name: m.name, url: `/api/t/media/${m.hash}`,
      });
    }
  };

  for (const s of list) {
    // 闸一：排期本身的有效期
    if (!isPlayable(s, now)) continue;

    const raw = layouts.byId(s.layoutId);
    if (!raw) continue;
    // 只下发审批通过的节目
    if (raw.approval && raw.approval.state !== 'approved') continue;
    // 闸二：节目的有效期
    if (!isPlayable(raw, now)) continue;

    // 闸三：剔除已过期的素材项（节目还有效，但里面某张促销海报过期了）
    const layout = stripExpiredItems(raw, media, now);
    if (isLayoutEmpty(layout)) continue;

    collectAssets(layout);
    out.push({
      scheduleId: s.id,
      name: s.name,
      mode: s.mode || 'default',
      priority: (MODE_PRIORITY[s.mode] ?? 0) + (s.priority || 0),
      dateRange: s.dateRange || null,
      weekdays: s.weekdays || null,
      timeSlots: s.timeSlots || null,
      expireAt: s.expireAt || null,
      // 绝对时间戳有效期：终端断网时靠这个自行下线，不依赖服务端推送
      validity: windowForManifest(s),
      layoutValidity: windowForManifest(raw),
      order: s.order || 0,
      layout,
    });
  }
  out.sort((a, b) => b.priority - a.priority || a.order - b.order);
  return { schedules: out, assets: [...assetMap.values()] };
}

/**
 * 剔除节目里已过期的素材项，并给保留项打上有效期戳（终端本地兜底用）。
 * 不修改原对象——store 里存的是引用，改了就把数据写脏了。
 */
function stripExpiredItems(layout, media, now) {
  let touched = false;
  const regions = (layout.regions || []).map(r => {
    const items = (r.items || []).filter(it => {
      if (!it.mediaId) return true;                       // 纯组件项（文字/时钟/天气）不受素材有效期约束
      const m = media.byId(it.mediaId);
      if (!m) return true;                                // 素材缺失走原有兜底逻辑，不在这里砍
      if (!isPlayable(m, now)) { touched = true; return false; }
      return true;
    }).map(it => {
      const w = it.mediaId ? windowForManifest(media.byId(it.mediaId)) : null;
      const own = windowForManifest(it);
      const merged = mergeWindow(w, own);
      if (!merged) return it;
      touched = true;
      return { ...it, validity: merged };
    });
    if (items.length === (r.items || []).length && !touched) return r;
    return { ...r, items };
  });
  // 背景素材过期则回落纯色，不能让屏上出现破图
  let background = layout.background;
  if (background?.mediaId) {
    const bm = media.byId(background.mediaId);
    if (bm && !isPlayable(bm, now)) { background = { ...background, mediaId: null }; touched = true; }
  }
  if (!touched) return layout;
  return { ...layout, regions, background };
}

/** 取两个时间窗的交集：素材有效期 ∩ 项自身有效期 */
function mergeWindow(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const from = (a.from == null) ? b.from : (b.from == null ? a.from : Math.max(a.from, b.from));
  const until = (a.until == null) ? b.until : (b.until == null ? a.until : Math.min(a.until, b.until));
  return { from, until };
}

function isLayoutEmpty(layout) {
  return !(layout.regions || []).some(r => (r.items || []).length > 0);
}

/** 排期冲突检测：同优先级同时段的独占冲突 */
export function detectConflicts(schedules) {
  const conflicts = [];
  const ex = schedules.filter(s => s.mode === 'exclusive' && s.enabled !== false);
  for (let i = 0; i < ex.length; i++) {
    for (let j = i + 1; j < ex.length; j++) {
      const a = ex[i], b = ex[j];
      if (!shareTargets(a, b)) continue;
      if (!shareDays(a, b)) continue;
      const ov = overlapSlots(a.timeSlots, b.timeSlots);
      if (ov) conflicts.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, slot: ov });
    }
  }
  return conflicts;
}
function shareTargets(a, b) {
  const ta = a.target || {}, tb = b.target || {};
  if (ta.all || tb.all) return true;
  const inter = (x = [], y = []) => x.some(v => y.includes(v));
  return inter(ta.terminalIds, tb.terminalIds) || inter(ta.groupIds, tb.groupIds) || inter(ta.orgIds, tb.orgIds);
}
function shareDays(a, b) {
  if (!a.weekdays?.length || !b.weekdays?.length) return true;
  return a.weekdays.some(d => b.weekdays.includes(d));
}
function overlapSlots(A, B) {
  if (!A?.length || !B?.length) return ['00:00', '24:00'];
  for (const [a1, a2] of A) for (const [b1, b2] of B) {
    const s = Math.max(toMin(a1), toMin(b1)), e = Math.min(toMin(a2), toMin(b2));
    if (s < e) return [`${pad(Math.floor(s / 60))}:${pad(s % 60)}`, `${pad(Math.floor(e / 60))}:${pad(e % 60)}`];
  }
  return null;
}

/** 判断终端此刻是否应处于开机状态（定时开关机） */
export function shouldBeOn(terminal, when = new Date()) {
  const ps = terminal.powerSchedule;
  if (!Array.isArray(ps) || !ps.length) return true;
  const day = when.getDay(), cur = when.getHours() * 60 + when.getMinutes();
  const todays = ps.filter(p => !p.weekdays?.length || p.weekdays.includes(day));
  if (!todays.length) return true;
  return todays.some(p => {
    const s = toMin(p.on), e = toMin(p.off);
    return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
  });
}
