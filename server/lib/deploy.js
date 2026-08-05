/**
 * 灵屏 LumaSign · 下发版本管理（一键回滚 + 灰度下发）
 *
 * 痛点：下发后内容出问题（播错节目/不良信息/排版崩了），要能一键回到上一个正常版本。
 * 同时大批量下发有风险，先发 1–3 台试点屏确认，再全量。
 *
 * 设计：
 *  - 每次「发布 / 灰度试点 / 全量推广 / 回滚」都落一条不可变版本快照
 *    { scheduleSnapshot, layoutSnapshot, targets, mode, parentVersionId }
 *  - 回滚 = 把快照里的 schedule+layout 还原回存储，并向目标终端重新推送
 *  - 灰度 = 先只推 pilot 子集（mode=pilot），确认无误后 promote 到完整目标集（mode=full）
 *
 * 数据为 JSON 文档存储（零依赖），版本快照不删，便于审计与追溯。
 */
import { uid } from './store.js';

export const DEPLOY_MODE = { FULL: 'full', PILOT: 'pilot', ROLLBACK: 'rollback', PROMOTE: 'promote' };

export function createDeploy(ctx) {
  const { store, bus, logger, paths } = ctx;
  const col = () => store.col('deployVersions');

  /** 落一条版本快照 */
  function record({ schedule, layout, targets, mode, by, note, parentVersionId, pilotVersionId }) {
    const v = {
      id: uid('dv_'),
      scheduleId: schedule?.id || null,
      layoutId: layout?.id || null,
      createdAt: Date.now(),
      createdBy: by || 'system',
      mode: mode || DEPLOY_MODE.FULL,
      note: note || '',
      targets: Array.isArray(targets) ? targets.slice() : [],
      scheduleSnapshot: schedule ? JSON.parse(JSON.stringify(schedule)) : null,
      layoutSnapshot: layout ? JSON.parse(JSON.stringify(layout)) : null,
      parentVersionId: parentVersionId || null,
      pilotVersionId: pilotVersionId || null,
    };
    col().insert(v);
    return v;
  }

  /** 版本列表（可按 scheduleId / layoutId 过滤） */
  function list({ scheduleId, layoutId, limit = 100 } = {}) {
    let items = col().all();
    if (scheduleId) items = items.filter(v => v.scheduleId === scheduleId);
    if (layoutId) items = items.filter(v => v.layoutId === layoutId);
    items.sort((a, b) => b.createdAt - a.createdAt);
    return items.slice(0, limit);
  }

  function get(id) { return col().byId(id); }

  /**
   * 回滚到指定版本：还原 schedule+layout 快照并重新推送到目标终端。
   * @returns {{ok:boolean, pushed:number, version?:object, error?:string}}
   */
  function rollback(versionId, by) {
    const v = get(versionId);
    if (!v) return { ok: false, error: '版本不存在' };
    if (!v.scheduleSnapshot) return { ok: false, error: '该版本不含排期快照，无法回滚' };

    const S = n => store.col(n);
    // 还原排期（含其有效期/启用状态）
    const sch = v.scheduleSnapshot;
    S('schedules').update(sch.id, { ...sch, enabled: true, rolledBackAt: Date.now() });

    // 还原节目（若该版本记录了节目快照）
    if (v.layoutSnapshot) {
      const lo = v.layoutSnapshot;
      S('layouts').update(lo.id, { ...lo, updatedAt: Date.now() });
    }

    // 重新推送到该版本当时的目标终端（或当前排期目标，取并集更稳）
    const targets = v.targets && v.targets.length ? v.targets : targetIdsOf(S('schedules').byId(sch.id));
    const ids = pushTo(targets, sch.id);

    // 记一条回滚版本，方便追溯「从哪个版本回滚来的」
    const newV = record({
      schedule: S('schedules').byId(sch.id),
      layout: v.layoutSnapshot ? S('layouts').byId(v.layoutSnapshot.id) : null,
      targets: ids,
      mode: DEPLOY_MODE.ROLLBACK,
      by: by || 'system',
      note: `回滚自版本 ${versionId}`,
      parentVersionId: versionId,
    });

    logger?.audit?.({ action: 'deploy_rollback', userId: by, versionId, target: sch.id, terminals: ids });
    bus?.broadcastAdmin?.('deploy:changed', { scheduleId: sch.id });
    return { ok: true, pushed: ids, version: newV };
  }

  /**
   * 灰度转全量：把试点版本推广到该排期的完整目标集。
   */
  function promote(versionId, by) {
    const v = get(versionId);
    if (!v) return { ok: false, error: '版本不存在' };
    const sch = store.col('schedules').byId(v.scheduleId);
    if (!sch) return { ok: false, error: '排期不存在' };
    const targets = targetIdsOf(sch);
    const ids = pushTo(targets, sch.id);
    const newV = record({
      schedule: sch,
      layout: store.col('layouts').byId(v.layoutId),
      targets: ids,
      mode: DEPLOY_MODE.PROMOTE,
      by: by || 'system',
      note: `灰度转全量（源自 ${versionId}）`,
      parentVersionId: versionId,
      pilotVersionId: versionId,
    });
    logger?.audit?.({ action: 'deploy_promote', userId: by, versionId, target: sch.id, terminals: ids });
    bus?.broadcastAdmin?.('deploy:changed', { scheduleId: sch.id });
    return { ok: true, pushed: ids, version: newV };
  }

  /** 由排期计算目标终端 id 列表 */
  function targetIdsOf(s) {
    if (!s) return [];
    const S = store.col('terminals');
    const t = s.target || {};
    if (t.all) return S.all().filter(x => x.approved).map(x => x.id);
    const groups = new Set(s.groupIds || []);
    return S.all().filter(x => x.approved && (
      (t.terminalIds || []).includes(x.id) ||
      (t.groupIds || []).some(g => groups.has(g)) ||
      (t.orgIds || []).includes(x.orgId)
    )).map(x => x.id);
  }

  /** 向指定终端 id 列表推送某排期的清单刷新 */
  function pushTo(ids, scheduleId) {
    if (!bus?.send) return 0;
    const set = new Set(ids);
    let n = 0;
    set.forEach(id => { bus.send(id, 'refresh_manifest', {}, { ack: false }); n++; });
    bus.broadcastAdmin?.('manifest:changed', { scheduleId, terminals: n });
    return n;
  }

  return { record, list, get, rollback, promote, targetIdsOf, pushTo };
}
