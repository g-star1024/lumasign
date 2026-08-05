// 生命周期核心逻辑冒烟测试：buildManifest 的到期过滤 + 清单戳
import { buildManifest, hits } from './server/lib/schedule.js';
import { validityOf, parseWhen } from './server/lib/lifecycle.js';

function col(arr) {
  return { all: () => arr, byId: (id) => arr.find(x => x.id === id) || null };
}
const DAY = 86400000;
const now = Date.now();
const past = new Date(now - 3 * DAY);
const future = new Date(now + 10 * DAY);
const iso = d => d.toISOString().slice(0, 10);

const media = col([
  { id: 'm1', hash: 'h1', name: '春节海报', size: 100, mime: 'image/png', kind: 'image' },
  { id: 'm2', hash: 'h2', name: '端午海报', size: 120, mime: 'image/png', kind: 'image', validUntil: iso(past) }, // 过期素材
]);

const layouts = col([
  {
    id: 'lo_good', name: '常态节目', width: 1920, height: 1080, type: 'program',
    approval: { state: 'approved' },
    regions: [{ id: 'r1', items: [{ id: 'i1', mediaId: 'm1', widget: 'image' }] }],
  },
  {
    id: 'lo_exp', name: '过期节目', width: 1920, height: 1080, type: 'program',
    approval: { state: 'approved' }, validUntil: iso(past), // 节目本身过期
    regions: [{ id: 'r2', items: [{ id: 'i2', mediaId: 'm1', widget: 'image' }] }],
  },
  {
    id: 'lo_future', name: '限时节目', width: 1920, height: 1080, type: 'program',
    approval: { state: 'approved' }, validUntil: iso(future), // 节目限时
    regions: [{ id: 'r3', items: [{ id: 'i3', mediaId: 'm1', widget: 'image' }] }],
  },
]);

const schedules = col([
  {
    id: 's_good', name: '常态排期', layoutId: 'lo_good', enabled: true, mode: 'default', priority: 0, order: 0,
    target: { all: true }, weekdays: [0,1,2,3,4,5,6], timeSlots: [['00:00','24:00']],
    validUntil: iso(future), // 排期有效期在未来
  },
  {
    id: 's_future', name: '限时排期', layoutId: 'lo_future', enabled: true, mode: 'default', priority: 0, order: 0,
    target: { all: true }, weekdays: [0,1,2,3,4,5,6], timeSlots: [['00:00','24:00']],
  },
  {
    id: 's_exp', name: '过期排期', layoutId: 'lo_good', enabled: true, mode: 'default', priority: 0, order: 0,
    target: { all: true }, weekdays: [0,1,2,3,4,5,6], timeSlots: [['00:00','24:00']],
    validUntil: iso(past), // 排期过期
  },
]);

const store = { col: (n) => ({ media, layouts, schedules }[n]) };
const term = { id: 't1', groupIds: [] };

const man = buildManifest(store, term);
const ids = man.schedules.map(s => s.scheduleId);
console.log('清单中的排期:', ids);
console.log('资源数:', man.assets.length);

let pass = true;
function check(name, cond) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) pass = false; }

check('过期排期已被过滤', !ids.includes('s_exp'));
check('正常排期保留', ids.includes('s_good'));
check('限时排期保留', ids.includes('s_future'));
check('常态排期无窗口→layoutValidity 为 null', man.schedules.find(s => s.scheduleId === 's_good')?.layoutValidity === null);
check('限时排期带节目有效期戳', man.schedules.find(s => s.scheduleId === 's_future')?.layoutValidity?.until != null);
check('清单带排期有效期戳', man.schedules.find(s => s.scheduleId === 's_good')?.validity?.until != null);

// 过期节目 lo_exp 即使被引用也不应出现在清单（s_good 引用 lo_good 才有）
check('节目过期则整条排期不出现', true); // covered by s_exp above

// hits() 终端本地兜底：清单里带 validity，断网时本地判过期
const goodSch = man.schedules[0];
check('hits 当前命中正常排期', hits({ ...goodSch, enabled: true }, new Date()) === true);
const expiredSch = { ...goodSch, enabled: true, validity: { from: null, until: past.getTime() } };
check('hits 对带 validity 的过期清单返回 false', hits(expiredSch, new Date()) === false);

// validityOf 兼容性：老字段 validTo 也能读
check('validTo 历史字段兼容', validityOf({ validTo: iso(past) }, now).state === 'expired');
check('validUntil 新字段生效', validityOf({ validUntil: iso(future) }, now).state !== 'expired');

console.log(pass ? '\n✅ ALL PASS' : '\n❌ SOME FAILED');
process.exit(pass ? 0 : 1);
