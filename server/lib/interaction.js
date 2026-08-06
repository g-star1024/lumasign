/**
 * 灵屏 LumaSign · 交互埋点聚合（P1 交互式节目）
 *
 * 记录播放端上报的交互事件（目前主要为热区点击 hotspot_click），
 * 按 (layoutId, itemId, type) 聚合计数，供管理端「交互统计」查看。
 * 纯 Node 内置 + JSON 文档存储，零依赖。
 */
function getCol(ctx) { return ctx.store.col('interactions'); }

function mergeTerminals(arr, id) {
  const s = new Set(arr || []);
  if (id) s.add(id);
  return [...s].slice(-50);
}

export function record(ctx, ev) {
  const { layoutId, itemId, type, terminalId } = ev || {};
  if (!layoutId || !type) return null;
  const col = getCol(ctx);
  const key = `${layoutId}::${itemId || ''}::${type}`;
  const now = Date.now();
  const existing = col.all().find(x => x.key === key);
  if (existing) {
    col.update(existing.id, {
      count: (existing.count || 0) + 1,
      lastAt: now,
      terminals: mergeTerminals(existing.terminals, terminalId),
    });
    return existing.id;
  }
  col.insert({
    key, layoutId, itemId: itemId || '', type,
    count: 1, lastAt: now, terminals: terminalId ? [terminalId] : [],
  });
  return true;
}

export function report(ctx, { layoutId, type } = {}) {
  let list = getCol(ctx).all();
  if (layoutId) list = list.filter(x => x.layoutId === layoutId);
  if (type) list = list.filter(x => x.type === type);
  return list
    .map(x => ({
      key: x.key, layoutId: x.layoutId, itemId: x.itemId, type: x.type,
      count: x.count || 0, lastAt: x.lastAt || null,
      terminals: (x.terminals || []).length,
    }))
    .sort((a, b) => b.count - a.count);
}

export function reset(ctx, { layoutId, itemId, type } = {}) {
  const col = getCol(ctx);
  let list = col.all();
  if (layoutId) list = list.filter(x => x.layoutId === layoutId);
  if (itemId) list = list.filter(x => x.itemId === itemId);
  if (type) list = list.filter(x => x.type === type);
  for (const x of list) col.remove(x.id);
}
