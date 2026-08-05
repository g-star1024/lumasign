/**
 * 灵屏 LumaSign · 排期引擎
 * 与 E 版语义对齐的四种播放方式，优先级：exclusive > insert > cycle > default
 *  - default   默认播放：无其他节目时兜底轮播
 *  - cycle     周期播放：按日期范围 + 星期 + 时段轮播
 *  - insert    实时插播：临时高优先级插入，播完回落
 *  - exclusive 独占播放：命中时段内独占屏幕，屏蔽其他所有节目
 */
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
    const layout = layouts.byId(s.layoutId);
    if (!layout) continue;
    // 只下发审批通过的节目
    if (layout.approval && layout.approval.state !== 'approved') continue;
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
      order: s.order || 0,
      layout,
    });
  }
  out.sort((a, b) => b.priority - a.priority || a.order - b.order);
  return { schedules: out, assets: [...assetMap.values()] };
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
