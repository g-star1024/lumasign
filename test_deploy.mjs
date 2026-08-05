// 下发版本管理（回滚 + 灰度）单元测试：用内存假存储驱动 deploy 模块
import { createDeploy } from './server/lib/deploy.js';

function memCol(seed = []) {
  let rows = seed.map(r => ({ ...r }));
  let seq = 1;
  const byId = id => rows.find(r => r.id === id) || null;
  return {
    all: () => rows,
    byId,
    insert: (r) => { const row = { ...r, _i: seq++ }; rows.push(row); return row; },
    update: (id, patch) => { const i = rows.findIndex(r => r.id === id); if (i < 0) return null; rows[i] = { ...rows[i], ...patch }; return rows[i]; },
    find: (fn) => rows.filter(fn),
  };
}

const schedules = memCol([{ id: 's1', name: '常态排期', layoutId: 'lo1', enabled: false, target: { all: true }, groupIds: [], orgId: 'o1' }]);
const layouts = memCol([{ id: 'lo1', name: '节目A', regions: [{ id: 'r', items: [{ id: 'i', mediaId: 'm1' }] }] }]);
const terminals = memCol([
  { id: 't1', approved: true, groupIds: [], orgId: 'o1' },
  { id: 't2', approved: true, groupIds: [], orgId: 'o1' },
  { id: 't3', approved: true, groupIds: [], orgId: 'o1' },
]);
const versions = memCol();
const store = { col: (n) => ({ schedules, layouts, terminals, deployVersions: versions }[n]) };

let sent = [];
const bus = { send: (id, ev) => { if (ev === 'refresh_manifest') sent.push(id); }, broadcastAdmin: () => {} };
const logger = { audit: () => {} };
const ctx = { store, bus, logger };

const deploy = createDeploy(ctx);
let pass = true;
const check = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) pass = false; };

// 1) 全量发布 → 落 full 版本，推 3 台
const v1 = deploy.record({ schedule: schedules.byId('s1'), layout: layouts.byId('lo1'), targets: ['t1', 't2', 't3'], mode: 'full', by: 'admin', note: '全量' });
check('记录 full 版本', v1 && v1.mode === 'full');
check('full 版本含排期快照', v1.scheduleSnapshot && v1.scheduleSnapshot.id === 's1');

// 2) 灰度试点 → 只推 t1
const v2 = deploy.record({ schedule: schedules.byId('s1'), layout: layouts.byId('lo1'), targets: ['t1'], mode: 'pilot', by: 'admin', note: '试点' });
check('记录 pilot 版本', v2.mode === 'pilot' && v2.targets.length === 1);

// 3) list 过滤
check('list 按 scheduleId 过滤', deploy.list({ scheduleId: 's1' }).length === 2);

// 4) 模拟内容被改坏，回滚到 v1（full）
schedules.update('s1', { name: '被改坏的排期', enabled: false });
layouts.update('lo1', { name: '坏节目', regions: [] });
const rb = deploy.rollback(v1.id, 'admin');
check('回滚成功', rb.ok === true);
check('回滚还原排期名称', schedules.byId('s1').name === '常态排期');
check('回滚还原节目', layouts.byId('lo1').regions.length === 1);
check('回滚生成 rollback 版本', deploy.list({ scheduleId: 's1' }).some(v => v.mode === 'rollback'));

// 5) promote：把 pilot(v2) 推广到全量
sent = [];
const pr = deploy.promote(v2.id, 'admin');
check('promote 成功', pr.ok === true);
check('promote 推送到全量 3 台', pr.pushed === 3);
check('promote 生成 promote 版本', deploy.list({ scheduleId: 's1' }).some(v => v.mode === 'promote'));

console.log(pass ? '\n✅ DEPLOY ALL PASS' : '\n❌ DEPLOY FAILED');
process.exit(pass ? 0 : 1);
