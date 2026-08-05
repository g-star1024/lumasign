/**
 * 灵屏 LumaSign · 设备台账与自动巡检
 *
 * 解决的问题：扫描是"一次性快照"，但运维需要的是"这个网络里到底有什么、什么时候多了一台"。
 *
 * 能力：
 *   1) 台账持久化（discovered 集合）：设备首见/末见时间、出现次数、类型变更历史
 *   2) 自动巡检：按配置间隔自动扫描本机主网段，无需人工点按钮
 *   3) 差异检测：新设备上线 / 设备失联 / 类型变化 / IP 漂移（同 MAC 换 IP）
 *   4) 新设备告警：未确认的新设备会在管理端顶栏提示，防止有人偷偷接屏进网
 *   5) 人工标注：运维可覆盖自动判定的设备类型（人比算法更懂自己的现场）
 *
 * 安全价值：局域网里突然出现一台没见过的安卓设备，可能就是攻击面。
 *          自动巡检 + 未确认告警，让"接入即可见"。
 */
import { scanNetwork, localNetworks, DEVICE_KINDS } from './netscan.js';

const DEFAULT_CONFIG = {
  enabled: false,          // 默认关闭，用户在设置页显式开启
  intervalMin: 30,         // 巡检间隔（分钟）
  subnet: '',              // 空 = 自动使用本机主网段
  start: 1,
  end: 254,
  alertOnNew: true,        // 发现新设备是否告警
  missThreshold: 3,        // 连续 N 次未见判定为失联
  quietHours: '',          // 静默时段，如 "22:00-07:00"（该时段不巡检，避免夜间扰动）
};

/** 设备指纹键：MAC 优先（能跨 IP 漂移追踪），无 MAC 退化为 IP */
const keyOf = (d) => (d.mac ? `mac:${d.mac}` : `ip:${d.ip}`);

export class Inventory {
  /**
   * @param ctx { store, logger, bus }
   */
  constructor(ctx) {
    this.store = ctx.store;
    this.logger = ctx.logger;
    this.bus = ctx.bus;
    this.running = false;      // 是否有扫描正在进行（防重入）
    this.lastRun = null;
    this.lastResult = null;
    this._timer = null;
    this._progress = null;     // 当前进度快照，供 SSE / 轮询读取
    this._signal = null;       // { aborted } 供外部取消长扫描
  }

  /** 取消当前扫描（大网段误扫时的止损开关） */
  cancel() {
    if (!this.running || !this._signal) return false;
    this._signal.aborted = true;
    this._progress = { ...(this._progress || {}), phase: 'cancelling', message: '正在取消…' };
    return true;
  }

  col() { return this.store.col('discovered'); }

  /* ══════════ 配置 ══════════ */

  getConfig() {
    const s = this.store.col('settings').all()[0] || {};
    return { ...DEFAULT_CONFIG, ...(s.autoScan || {}) };
  }

  setConfig(patch) {
    const col = this.store.col('settings');
    const s = col.all()[0];
    const next = { ...this.getConfig(), ...patch };
    // 防呆：间隔下限 5 分钟，避免把网络扫爆
    next.intervalMin = Math.max(5, Math.min(1440, +next.intervalMin || 30));
    next.missThreshold = Math.max(1, Math.min(20, +next.missThreshold || 3));
    if (s) col.update(s.id, { autoScan: next });
    else col.insert({ autoScan: next });
    this.reschedule();
    return next;
  }

  /* ══════════ 调度 ══════════ */

  start() {
    // 每分钟检查一次是否该跑，比长 setInterval 更能容忍系统休眠/时钟跳变
    if (this._timer) return;
    this._timer = setInterval(() => this._tick().catch(() => {}), 60 * 1000);
    this._timer.unref?.();
    console.log('[inventory] 自动巡检调度已启动（每分钟检查一次到期）');
  }

  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
  reschedule() { /* 配置变更后下一分钟自然生效，无需重建定时器 */ }

  _inQuietHours(cfg) {
    if (!cfg.quietHours) return false;
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(cfg.quietHours.trim());
    if (!m) return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    return a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b);   // 跨夜区间
  }

  async _tick() {
    const cfg = this.getConfig();
    if (!cfg.enabled || this.running) return;
    if (this._inQuietHours(cfg)) return;
    const due = !this.lastRun || (Date.now() - this.lastRun) >= cfg.intervalMin * 60 * 1000;
    if (!due) return;
    await this.runScan({ reason: 'auto' });
  }

  /* ══════════ 扫描执行 ══════════ */

  /** 当前扫描进度（前端轮询用） */
  progress() {
    return this._progress || { running: this.running, percent: this.running ? 0 : 100 };
  }

  /**
   * 执行一次扫描并归档到台账。
   * @param opts { reason:'auto'|'manual', spec?, user? }
   */
  async runScan({ reason = 'manual', spec = null, user = null } = {}) {
    if (this.running) return { ok: false, error: '已有扫描任务正在进行' };
    this.running = true;
    const cfg = this.getConfig();

    // 未显式指定目标 → 自动挑本机主网段（仅取可扫描的 /22 以上）
    let target = spec;
    if (!target) {
      const nets = localNetworks().filter(n => n.scannable);
      const sub = cfg.subnet || nets[0]?.subnet;
      if (!sub) { this.running = false; return { ok: false, error: '未找到可扫描的本机网段，请手动指定子网' }; }
      target = { subnet: sub, start: cfg.start, end: cfg.end };
    }

    this._progress = { running: true, percent: 0, phase: 'start', reason, startedAt: Date.now() };
    this._signal = { aborted: false };

    try {
      const { items, stats } = await scanNetwork(target, {
        store: this.store,
        signal: this._signal,
        onProgress: (p) => {
          this._progress = { running: true, reason, startedAt: this._progress?.startedAt, ...p };
          this.bus?.broadcastAdmin?.('scan_progress', this._progress);
        },
      });

      // 被取消的扫描结果不完整，不写台账（否则会误判大批设备"失联"）
      if (this._signal.aborted) {
        this._progress = { running: false, percent: 100, phase: 'cancelled' };
        this.bus?.broadcastAdmin?.('scan_done', { cancelled: true });
        return { ok: false, cancelled: true, error: '扫描已取消' };
      }

      const diff = this._merge(items);
      this.lastRun = Date.now();
      this.lastResult = { stats, diff, at: this.lastRun, reason, target };
      this._progress = { running: false, percent: 100, phase: 'done', ...this.lastResult };

      this._report(diff, stats, reason, user);
      this.bus?.broadcastAdmin?.('scan_done', { stats, diff });
      return { ok: true, items, stats, diff };
    } catch (e) {
      this._progress = { running: false, percent: 100, phase: 'error', error: e.message };
      return { ok: false, error: e.message };
    } finally {
      this.running = false;
      this._signal = null;
    }
  }

  /* ══════════ 台账合并与差异检测 ══════════ */

  _merge(items) {
    const col = this.col();
    const now = Date.now();
    const existing = col.all();
    const byKey = new Map(existing.map(d => [keyOf(d), d]));
    const seenKeys = new Set();

    const added = [], changed = [], drifted = [];

    for (const it of items) {
      const key = keyOf(it);
      seenKeys.add(key);
      const prev = byKey.get(key);

      if (!prev) {
        const row = col.insert({
          ip: it.ip, mac: it.mac || '', vendor: it.vendor || '',
          kind: it.kind, kindLabel: it.kindLabel, name: it.name || '',
          confidence: it.confidence, openPorts: it.openPorts, reasons: it.reasons,
          adb: it.adb || null, method: it.method,
          firstSeen: now, lastSeen: now, seenCount: 1, missCount: 0,
          status: 'online',
          acknowledged: false,       // 新设备默认未确认 → 触发告警
          tag: '', note: '', provisionedAt: null,
        });
        added.push(row);
        continue;
      }

      // IP 漂移检测（同 MAC 换了 IP）
      if (prev.ip !== it.ip && it.mac) {
        drifted.push({ id: prev.id, mac: it.mac, from: prev.ip, to: it.ip });
      }
      // 类型变化（可能是设备被换了，或装上了播放端）
      const kindChanged = prev.kind !== it.kind;
      if (kindChanged) changed.push({ id: prev.id, ip: it.ip, from: prev.kindLabel, to: it.kindLabel });

      col.update(prev.id, {
        ip: it.ip,
        mac: it.mac || prev.mac,
        vendor: it.vendor || prev.vendor,
        kind: it.kind, kindLabel: it.kindLabel,
        name: it.name || prev.name,
        confidence: it.confidence, openPorts: it.openPorts, reasons: it.reasons,
        adb: it.adb || null, method: it.method,
        lastSeen: now, seenCount: (prev.seenCount || 0) + 1, missCount: 0,
        status: 'online',
      });
    }

    // 未出现的设备累计 missCount
    const cfg = this.getConfig();
    const missing = [];
    for (const d of existing) {
      if (seenKeys.has(keyOf(d))) continue;
      const miss = (d.missCount || 0) + 1;
      const status = miss >= cfg.missThreshold ? 'gone' : 'missing';
      if (d.status !== status && status === 'gone') missing.push({ id: d.id, ip: d.ip, name: d.name });
      col.update(d.id, { missCount: miss, status });
    }

    return { added, changed, drifted, missing };
  }

  _report(diff, stats, reason, user) {
    const L = this.logger;
    if (!L) return;
    const who = user
      ? { userId: user.id, username: user.username }
      : { userId: 'system', username: 'system' };
    const tag = reason === 'auto' ? '自动巡检' : '手动扫描';
    const rec = (action, target, extra = {}) =>
      L.audit({ ...who, action, target, ...extra });

    try {
      rec('net_scan', `${tag}完成：存活 ${stats.alive}/${stats.total}，新增 ${diff.added.length}，失联 ${diff.missing.length}`,
        { stats, counts: { added: diff.added.length, changed: diff.changed.length, drifted: diff.drifted.length, missing: diff.missing.length } });

      for (const d of diff.added) {
        // 未知/安卓/屏类新设备属于潜在攻击面，单独用 alert 级动作，便于日志页高亮筛选
        const risky = ['android', 'screen', 'unknown'].includes(d.kind);
        rec(risky ? 'net_new_device_alert' : 'net_new_device',
          `发现新设备 ${d.ip}${d.mac ? `(${d.mac})` : ''} 类型=${d.kindLabel}${d.name ? ` 名称=${d.name}` : ''}`,
          { userId: 'system', username: 'system', ip: d.ip, mac: d.mac, kind: d.kind });
      }
      for (const c of diff.changed) {
        rec('net_device_changed', `设备 ${c.ip} 类型变化：${c.from} → ${c.to}`,
          { userId: 'system', username: 'system', ip: c.ip });
      }
      for (const c of diff.drifted) {
        rec('net_ip_drift', `设备 ${c.mac} IP 变更：${c.from} → ${c.to}`,
          { userId: 'system', username: 'system', mac: c.mac });
      }
      for (const m of diff.missing) {
        rec('net_device_gone', `设备失联 ${m.ip}${m.name ? `(${m.name})` : ''}`,
          { userId: 'system', username: 'system', ip: m.ip });
      }
    } catch { /* 日志不可影响主流程 */ }
  }

  /* ══════════ 台账查询与维护 ══════════ */

  list({ kind, status, unacknowledged, q } = {}) {
    let rows = this.col().all();
    if (kind) rows = rows.filter(r => (r.tag || r.kind) === kind);
    if (status) rows = rows.filter(r => r.status === status);
    if (unacknowledged) rows = rows.filter(r => !r.acknowledged);
    if (q) {
      const s = String(q).toLowerCase();
      rows = rows.filter(r => `${r.ip} ${r.mac} ${r.name} ${r.vendor} ${r.note}`.toLowerCase().includes(s));
    }
    const weight = { screen: 0, android: 1, chuto: 2, luma: 3, unknown: 4, pc: 5, router: 6, camera: 7, printer: 8, server: 9 };
    return rows.slice().sort((a, b) => {
      if (!a.acknowledged !== !b.acknowledged) return a.acknowledged ? 1 : -1;   // 未确认置顶
      return (weight[a.kind] ?? 10) - (weight[b.kind] ?? 10) || a.ip.localeCompare(b.ip, undefined, { numeric: true });
    });
  }

  summary() {
    const rows = this.col().all();
    const byKind = {};
    for (const r of rows) {
      const k = r.tag || r.kind;
      byKind[k] = (byKind[k] || 0) + 1;
    }
    return {
      total: rows.length,
      online: rows.filter(r => r.status === 'online').length,
      gone: rows.filter(r => r.status === 'gone').length,
      unacknowledged: rows.filter(r => !r.acknowledged).length,
      provisionable: rows.filter(r => r.status === 'online' && ['adb', 'vendor'].includes(r.method)).length,
      byKind,
      kindMeta: DEVICE_KINDS,
      lastRun: this.lastRun,
      running: this.running,
      config: this.getConfig(),
    };
  }

  acknowledge(ids = []) {
    let n = 0;
    for (const id of ids) if (this.col().update(id, { acknowledged: true, ackAt: Date.now() })) n++;
    return n;
  }
  acknowledgeAll() {
    const ids = this.col().all().filter(d => !d.acknowledged).map(d => d.id);
    return this.acknowledge(ids);
  }

  /** 人工标注设备类型 / 备注 —— 覆盖自动判定 */
  annotate(id, { tag, note, name } = {}) {
    const patch = {};
    if (tag !== undefined) patch.tag = tag && DEVICE_KINDS[tag] ? tag : '';
    if (note !== undefined) patch.note = String(note).slice(0, 200);
    if (name !== undefined) patch.name = String(name).slice(0, 80);
    patch.acknowledged = true;
    return this.col().update(id, patch);
  }

  forget(id) { return this.col().remove(id); }
  /** 清理长期失联的记录 */
  prune(days = 30) {
    const cutoff = Date.now() - days * 86400000;
    return this.col().removeWhere(d => d.status === 'gone' && (d.lastSeen || 0) < cutoff);
  }
}
