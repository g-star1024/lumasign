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
    setInterval(() => this._retryLoop(), 10000).unref?.();
  }

  /* ---------- 终端连接 ---------- */
  attachTerminal(terminalId, handle) {
    if (!this.terminals.has(terminalId)) this.terminals.set(terminalId, new Set());
    this.terminals.get(terminalId).add(handle);
    this.broadcastAdmin('terminal:link', { terminalId, connected: true });
    // 补投该终端未 ACK 的指令
    for (const p of this.pending.values()) if (p.terminalId === terminalId) handle.send('command', p.cmd);
  }
  detachTerminal(terminalId, handle) {
    const set = this.terminals.get(terminalId);
    if (!set) return;
    set.delete(handle);
    if (!set.size) {
      this.terminals.delete(terminalId);
      this.broadcastAdmin('terminal:link', { terminalId, connected: false });
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
