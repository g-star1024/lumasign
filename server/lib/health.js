/**
 * 灵屏 LumaSign · 终端健康度模型（P0-3）
 *
 * 采集维度（来自终端心跳上报）：
 *   cpu / 内存占用、存储剩余、CPU 温度、网络延迟、运行时长、崩溃次数、在线状态。
 *
 * 输出：
 *   1) 健康度评分 0–100（越低越糟），四档：good / warn / bad / crit
 *   2) 异常项列表（storage/temp/cpu/mem/latency/crash/offline）
 *   3) 失联侦测（超过 offlineMinutes 未心跳 → 0 分 + 离线告警）
 *   4) 异常自动告警（管理端红点 + 既有的 Webhook/邮件通道）
 *   5) 存储严重不足时下发 clear_cache 指令自动清理
 *   6) 最近 N 次采样历史（用于趋势迷你图）
 */
import { raiseAlertThrottled } from '../api/terminal.js';

export const HEALTH_DEFAULTS = {
  storageWarn: 20, storageCrit: 10,   // 剩余空间百分比
  tempWarn: 60, tempCrit: 75,         // CPU 温度 °C
  cpuWarn: 80, cpuCrit: 95,           // 占用百分比
  memWarn: 80, memCrit: 95,           // 占用百分比
  latWarn: 300, latCrit: 800,         // 心跳 RTT ms
  crashWarn: 1, crashCrit: 5,         // 累计崩溃次数
  offlineMinutes: 5,                  // 超过该时长未心跳判失联
};

const LABEL = {
  storage: '存储', temp: '温度', cpu: 'CPU', mem: '内存',
  latency: '网络', crash: '崩溃', offline: '在线',
};

export function scoreLevel(s) {
  if (s >= 80) return 'good';
  if (s >= 60) return 'warn';
  if (s >= 30) return 'bad';
  return 'crit';
}

export function computeHealth(t, cfg, now = Date.now()) {
  const hb = t.lastHeartbeat || 0;
  const gap = hb ? now - hb : Infinity;
  const offlineMs = (cfg.offlineMinutes || 5) * 60000;

  if (!hb || gap > offlineMs) {
    return {
      score: 0, level: 'crit', offline: true,
      issues: [{ key: 'offline', sev: 'crit', msg: hb ? `已失联 ${Math.round(gap / 1000)}s` : '从未上报心跳' }],
    };
  }

  let score = 100;
  const issues = [];
  const h = t.health || {};
  const st = t.hardware?.storageTotal, sf = t.hardware?.storageFree;

  if (st && sf != null) {
    const freePct = (sf / st) * 100;
    if (freePct < cfg.storageCrit) { score -= 40; issues.push({ key: 'storage', sev: 'crit', msg: `存储仅剩 ${freePct.toFixed(1)}%` }); }
    else if (freePct < cfg.storageWarn) { score -= 20; issues.push({ key: 'storage', sev: 'warn', msg: `存储偏低 ${freePct.toFixed(1)}%` }); }
  }
  if (t.cpuTemp != null) {
    if (t.cpuTemp >= cfg.tempCrit) { score -= 35; issues.push({ key: 'temp', sev: 'crit', msg: `温度 ${t.cpuTemp}°C` }); }
    else if (t.cpuTemp >= cfg.tempWarn) { score -= 15; issues.push({ key: 'temp', sev: 'warn', msg: `温度偏高 ${t.cpuTemp}°C` }); }
  }
  if (h.cpu != null) {
    if (h.cpu >= cfg.cpuCrit) { score -= 30; issues.push({ key: 'cpu', sev: 'crit', msg: `CPU ${h.cpu}%` }); }
    else if (h.cpu >= cfg.cpuWarn) { score -= 12; issues.push({ key: 'cpu', sev: 'warn', msg: `CPU 偏高 ${h.cpu}%` }); }
  }
  if (h.mem != null) {
    if (h.mem >= cfg.memCrit) { score -= 30; issues.push({ key: 'mem', sev: 'crit', msg: `内存 ${h.mem}%` }); }
    else if (h.mem >= cfg.memWarn) { score -= 12; issues.push({ key: 'mem', sev: 'warn', msg: `内存偏高 ${h.mem}%` }); }
  }
  if (h.latency != null && h.latency >= cfg.latCrit) {
    score -= 15; issues.push({ key: 'latency', sev: 'warn', msg: `延迟 ${h.latency}ms` });
  }
  const crashes = h.crashCount || 0;
  if (crashes >= cfg.crashCrit) { score -= 25; issues.push({ key: 'crash', sev: 'crit', msg: `崩溃 ${crashes} 次` }); }
  else if (crashes >= cfg.crashWarn) { score -= 10; issues.push({ key: 'crash', sev: 'warn', msg: `崩溃 ${crashes} 次` }); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, level: scoreLevel(score), offline: false, issues };
}

export class HealthMonitor {
  constructor(ctx) {
    this.store = ctx.store;
    this.bus = ctx.bus;
    this.logger = ctx.logger;
    this.history = new Map();      // id -> [{ts,score,...}]
    this.maxSamples = 240;
    this._timer = null;
    this._cleanupThrottle = new Map();
  }

  cfg() {
    const s = this.store.col('settings').byId('settings') || {};
    return {
      ...HEALTH_DEFAULTS,
      ...(s.health || {}),
      offlineMinutes: s.alert?.offlineMinutes || HEALTH_DEFAULTS.offlineMinutes,
    };
  }

  record(t, now = Date.now()) {
    const c = this.cfg();
    const hp = computeHealth(t, c, now);

    this.store.col('terminals').touch(t.id, {
      healthScore: hp.score,
      healthLevel: hp.offline ? 'crit' : hp.level,
      healthIssues: hp.issues,
      healthOffline: hp.offline,
      healthUpdatedAt: now,
    });

    const st = t.hardware?.storageTotal, sf = t.hardware?.storageFree, h = t.health || {};
    const sample = {
      ts: now, score: hp.score, level: hp.offline ? 'crit' : hp.level,
      cpu: h.cpu ?? null, mem: h.mem ?? null, temp: t.cpuTemp ?? null,
      freePct: (st && sf != null) ? +(sf / st * 100).toFixed(1) : null,
      latency: h.latency ?? null, crash: h.crashCount || 0,
    };
    let arr = this.history.get(t.id) || [];
    arr.push(sample);
    if (arr.length > this.maxSamples) arr = arr.slice(-this.maxSamples);
    this.history.set(t.id, arr);

    this._alert(t, hp, c, now);
    return hp;
  }

  _alert(t, hp, c, now) {
    if (hp.offline) {
      raiseAlertThrottled(this.store, this.bus, `offline_${t.id}`, {
        level: 'crit', type: 'terminal_offline', terminalId: t.id,
        title: '终端失联', message: `${t.name || t.id} 已超过 ${c.offlineMinutes} 分钟未上报心跳`,
      }, 30 * 60000);
      return;
    }
    for (const it of hp.issues) {
      if (it.sev === 'crit') {
        raiseAlertThrottled(this.store, this.bus, `${it.key}_${t.id}`, {
          level: 'crit', type: `health_${it.key}`, terminalId: t.id,
          title: `终端${LABEL[it.key] || ''}异常`, message: `${t.name || t.id}：${it.msg}`,
        }, 30 * 60000);
      }
    }
    // 存储严重不足 → 自动下发清理缓存指令（每小时每终端最多一次）
    const st = t.hardware?.storageTotal, sf = t.hardware?.storageFree;
    if (st && sf != null && (sf / st) * 100 < c.storageCrit) {
      const k = `clr_${t.id}`, last = this._cleanupThrottle.get(k) || 0;
      if (now - last > 3600000) {
        this._cleanupThrottle.set(k, now);
        this.bus?.send?.(t.id, 'clear_cache', {}, { ack: false });
        this.logger?.system?.({ event: 'health_auto_cleanup', terminalId: t.id, name: t.name });
      }
    }
  }

  summary(now = Date.now()) {
    const c = this.cfg();
    const terms = this.store.col('terminals').all();
    const bands = { good: 0, warn: 0, bad: 0, crit: 0, offline: 0 };
    let sum = 0, n = 0;
    const terminals = terms.map(t => {
      const hp = computeHealth(t, c, now);
      const key = hp.offline ? 'offline' : hp.level;
      bands[key]++;
      if (!hp.offline) { sum += hp.score; n++; }
      return {
        id: t.id, name: t.name, code: t.code,
        score: hp.score, level: hp.offline ? 'crit' : hp.level, offline: hp.offline,
        issues: hp.issues, lastHeartbeat: t.lastHeartbeat || null, playing: t.playing || null,
        healthUpdatedAt: t.healthUpdatedAt || null,
      };
    }).sort((a, b) => a.score - b.score);
    return { ok: true, avgScore: n ? Math.round(sum / n) : 0, bands, total: terms.length, terminals };
  }

  historyOf(id) { return this.history.get(id) || []; }

  start() {
    this._timer = setInterval(() => {
      const now = Date.now();
      for (const t of this.store.col('terminals').all()) {
        try { this.record(t, now); } catch { /* ignore */ }
      }
    }, 60 * 1000);
    this._timer.unref?.();
  }

  stop() { if (this._timer) clearInterval(this._timer); }
}
