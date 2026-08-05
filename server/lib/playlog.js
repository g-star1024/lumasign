/**
 * 灵屏 LumaSign · 播放证明数据层（P0-4）
 *
 * 采集维度（终端每播放一个 item 上报一次）：
 *   terminalId / layoutId / itemId / mediaId / customer / startedAt / endedAt
 * 服务端落库 playlog 集合，并提供按终端/客户/素材/时间段查询与聚合。
 */
import { uid } from './store.js';

export const PLAYLOG_COL = 'playlog';

/** 单条上报落库（捕获播放时刻的终端/节目/素材名快照，便于事后出证） */
export function recordPlayEvent(store, ev) {
  const t = store.col('terminals').byId(ev.terminalId);
  const layout = (ev.layoutId && store.col('layouts').byId(ev.layoutId)) || null;
  let mediaName = null;
  if (ev.mediaId) {
    const m = store.col('media').byId(ev.mediaId);
    if (m) mediaName = m.name;
  }
  const startedAt = Number(ev.startedAt) || Date.now();
  const endedAt = Number(ev.endedAt) || startedAt;
  const rec = {
    id: uid('pp_'),
    terminalId: ev.terminalId,
    terminalName: t?.name || null,
    layoutId: ev.layoutId || null,
    layoutName: layout?.name || null,
    itemId: ev.itemId || null,
    mediaId: ev.mediaId || null,
    mediaName,
    customer: ev.customer || layout?.customer || null,
    startedAt,
    endedAt,
    duration: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
  };
  store.col(PLAYLOG_COL).insert(rec);
  return rec;
}

/** 查询 + 聚合 */
export function queryPlayLog(store, q = {}) {
  const { terminalId, mediaId, customer, from, to, limit = 500 } = q;
  let rows = store.col(PLAYLOG_COL).all();
  if (terminalId) rows = rows.filter(r => r.terminalId === terminalId);
  if (mediaId) rows = rows.filter(r => r.mediaId === mediaId);
  if (customer) rows = rows.filter(r => (r.customer || '') === customer);
  if (from) rows = rows.filter(r => r.startedAt >= Number(from));
  if (to) rows = rows.filter(r => r.startedAt <= Number(to));
  rows.sort((a, b) => b.startedAt - a.startedAt);
  const total = rows.length;
  if (limit && limit > 0) rows = rows.slice(0, limit);
  return { total, items: rows };
}

/** 供导出聚合：各终端播放次数、各素材次数、时间跨度 */
export function aggregatePlayLog(rows) {
  const byTerminal = new Map();
  const byMedia = new Map();
  let minT = Infinity, maxT = -Infinity;
  for (const r of rows) {
    byTerminal.set(r.terminalId, (byTerminal.get(r.terminalId) || 0) + 1);
    if (r.mediaId) byMedia.set(r.mediaId, (byMedia.get(r.mediaId) || 0) + 1);
    if (r.startedAt < minT) minT = r.startedAt;
    if (r.endedAt > maxT) maxT = r.endedAt;
  }
  return {
    terminals: byTerminal.size,
    materials: byMedia.size,
    spanFrom: minT === Infinity ? null : minT,
    spanTo: maxT === -Infinity ? null : maxT,
  };
}

/** 导出可用的筛选维度（供管理端下拉） */
export function playProofFilters(store) {
  const rows = store.col(PLAYLOG_COL).all();
  const terminals = [...new Set(rows.map(r => r.terminalId))];
  const customers = [...new Set(rows.map(r => r.customer).filter(Boolean))];
  const materials = [...new Set(rows.map(r => r.mediaId).filter(Boolean))];
  return { terminals, customers, materials };
}
