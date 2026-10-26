/**
 * 灵屏 LumaSign · 指令总线
 * 终端 SSE 连接池 + 指令队列（幂等 / ACK 回执 / 超时重投）+ 管理端事件广播。
 */
import { uid } from './store.js';

const ACK_TIMEOUT = 60000;
const MAX_RETRY = 3;

export class Bus {
  constructor(store, logger) {
    this.store = store;
    this.logger = logger;
    this.terminals = new Map();  // terminalId -> Set<sseHandle>
    this.admins = new Set();     // 管理端 SSE
    this.pending = new Map();    // cmdId -> { cmd, terminalId, sentAt, retry }
    // ★ v1.3.49：终端 SSE 瞬断瞬连（视频媒体栈抢占连接池时每 ~15s 一次）不再让管理端
    //   toast 红/绿乱闪——只有「真实状态翻转」才广播。延迟 4s 判定，期间重连即视为抖动。
    this._offlineTimers = new Map();  // terminalId -> Timeout
    this._linkState = new Map();      // terminalId -> 上次广播的在线态
    setInterval(() => this._retryLoop(), 10000).unref?.();
  }

  /* ---------- 终端连接 ---------- */
  attachTerminal(terminalId, handle) {
    if (!this.terminals.has(terminalId)) this.terminals.set(terminalId, new Set());
    this.terminals.get(terminalId).add(handle);
    // 取消待发的「离线」广播（说明是抖动重连，不是真离线）
    const t = this._offlineTimers.get(terminalId);
    if (t) { clearTimeout(t); this._offlineTimers.delete(terminalId); }
    // ★ v1.3.49：仅在状态真正翻转时广播在线（避免每次重连都弹一次「已连接」）
    if (this._linkState.get(terminalId) !== true) {
      this._linkState.set(terminalId, true);
      this.broadcastAdmin('terminal:link', { terminalId, connected: true });
    }
    // 补投该终端未 ACK 的指令
    for (const p of this.pending.values()) if (p.terminalId === terminalId) handle.send('command', p.cmd);
  }
  detachTerminal(terminalId, handle) {
    const set = this.terminals.get(terminalId);
    if (!set) return;
    set.delete(handle);
    if (!set.size) {
      this.terminals.delete(terminalId);
      // ★ v1.3.49：延迟 4s 判定离线，期间重连即取消——管理端不再每秒闪「已断开/已连接」
      if (this._offlineTimers.has(terminalId)) return;
      const timer = setTimeout(() => {
        this._offlineTimers.delete(terminalId);
        if (!this.terminals.has(terminalId)) {
          this._linkState.set(terminalId, false);
          this.broadcastAdmin('terminal:link', { terminalId, connected: false });
        }
      }, 4000);
      this._offlineTimers.set(terminalId, timer);
    }
  }
  isLinked(id) { return this.terminals.has(id); }
  linkedCount() { return this.terminals.size; }

  /* ---------- 下发指令 ---------- */
  send(terminalId, type, payload = {}, opts = {}) {
    const cmd = { cmdId: uid('c_'), type, payload, ts: Date.now() };
    const set = this.terminals.get(terminalId);
    let delivered = false;
    if (set) for (const h of set) { if (h.send('command', cmd)) delivered = true; }

    // 需要回执的指令进入待确认队列（离线终端也入队，上线后补投）
    if (opts.ack !== false) {
      this.pending.set(cmd.cmdId, { cmd, terminalId, sentAt: Date.now(), retry: 0 });
    }
    this.logger?.task({ kind: 'command', terminalId, cmdId: cmd.cmdId, type, delivered });
    return { cmdId: cmd.cmdId, delivered };
  }

  broadcast(terminalIds, type, payload, opts) {
    return terminalIds.map(id => ({ terminalId: id, ...this.send(id, type, payload, opts) }));
  }

  ack(cmdId, ok, message) {
    const p = this.pending.get(cmdId);
    if (!p) return false;
    this.pending.delete(cmdId);
    this.logger?.task({ kind: 'command_ack', terminalId: p.terminalId, cmdId, type: p.cmd.type, ok, message });
    this.broadcastAdmin('command:ack', { cmdId, terminalId: p.terminalId, type: p.cmd.type, ok, message });
    return true;
  }

  pendingFor(terminalId) {
    const out = [];
    for (const p of this.pending.values()) if (p.terminalId === terminalId) out.push(p.cmd);
    return out;
  }

  _retryLoop() {
    const now = Date.now();
    for (const [id, p] of this.pending) {
      if (now - p.sentAt < ACK_TIMEOUT) continue;
      if (p.retry >= MAX_RETRY) {
        this.pending.delete(id);
        this.logger?.task({ kind: 'command_timeout', terminalId: p.terminalId, cmdId: id, type: p.cmd.type });
        this.broadcastAdmin('command:timeout', { cmdId: id, terminalId: p.terminalId, type: p.cmd.type });
        continue;
      }
      p.retry++; p.sentAt = now;
      const set = this.terminals.get(p.terminalId);
      if (set) for (const h of set) h.send('command', p.cmd);
    }
  }

  /* ---------- 管理端事件 ---------- */
  attachAdmin(handle) { this.admins.add(handle); }
  detachAdmin(handle) { this.admins.delete(handle); }
  broadcastAdmin(event, data) {
    for (const h of this.admins) if (!h.send(event, data)) this.admins.delete(h);
  }
}
