'use strict';
// Plugin sandbox, part 3 of 3: starts one worker thread per plugin, sends it calls, and stops it when it misbehaves.
// Three safety nets work together: the engine limits (memory, stack, CPU) inside the sandbox, a clock that stops the worker if a
// call takes too long, and a memory guard that watches the bot's memory (the engine's own memory limit is not trusted: it
// misses some kinds of memory use, found in testing).
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { Broker, BrokerError } = require('./broker');

class HostError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }
const DEFAULT_LIMITS = { memoryBytes: 32 * 1024 * 1024, stackBytes: 512 * 1024, cpuMs: 1500, wallMs: 5000, workerHeapMb: 64, memoryGuardMb: 96, guardEveryMs: 20, crashLimit: 3, crashWindowMs: 10 * 60 * 1000 };

class PluginHost {
  constructor({ id, manifest, source, grants, limits, env, policy, onDisabled }) {
    this.id = id; this.source = source; this.limits = { ...DEFAULT_LIMITS, ...(limits || {}) };
    this.env = env; this.broker = new Broker({ manifest, grants, env, policy }); this.onDisabled = onDisabled;
    this.worker = null; this.seq = 0; this.cur = null; this.faults = []; this.disabled = false; this._q = Promise.resolve();
    this.spawns = 0; this.readyMs = []; this.events = []; this.lastUsed = Date.now();
  }
  busy() { return !!this.cur; }
  call(kind, name, ctx, extra) { const run = () => this._call(kind, name, ctx, extra); const p = this._q.then(run, run); this._q = p.catch(() => {}); return p; }
  stop() { if (this.worker) { const w = this.worker; this.worker = null; w.terminate(); } }

  _note(e) { this.events.push(e); if (this.events.length > 200) this.events.shift(); }
  _disable(why) { if (this.disabled) return; this.disabled = true; this._note('disabled:' + why); if (this.onDisabled) { try { this.onDisabled(why); } catch (e) { /* ignore */ } } }
  _fault(reason) {
    const t = Date.now(); this.faults = this.faults.filter((x) => t - x < this.limits.crashWindowMs); this.faults.push(t);
    this._note(reason);
    if (this.faults.length >= this.limits.crashLimit) this._disable('faults');
    else if (this.broker.strikes >= this.broker.p.strikeLimit) this._disable('rules');
  }
  _spawn() {
    return new Promise((resolve, reject) => {
      const t0 = Date.now(); this.spawns++;
      const w = new Worker(path.join(__dirname, 'worker.js'), {
        workerData: { limits: this.limits },
        resourceLimits: { maxOldGenerationSizeMb: this.limits.workerHeapMb, maxYoungGenerationSizeMb: 8 },
      });
      let ready = false;
      const fail = (e) => { if (!ready) { ready = true; reject(e); } };
      w.on('message', (m) => {
        if (m.t === 'ready') w.postMessage({ t: 'load', source: this.source });
        else if (m.t === 'loaded') { ready = true; this.worker = w; this.readyMs.push(Date.now() - t0); resolve(); }
        else if (m.t === 'loadfail' || m.t === 'bootfail') { fail(new HostError('load_failed', m.error)); w.terminate(); }
        else this._onMessage(w, m);
      });
      w.on('error', (e) => { if (this.worker === w || this.cur) this._crash(w, e && e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'worker_memory' : 'worker_error'); fail(new HostError('load_failed', String(e && e.message))); });
      w.on('exit', () => { if (this.worker === w) this._crash(w, 'worker_exit'); fail(new HostError('load_failed', 'worker exited')); });
    });
  }
  _crash(w, reason) {
    if (this.worker === w) this.worker = null;
    try { w.terminate(); } catch (e) { /* already gone */ }
    this._fault(reason);
    if (this.cur) { const c = this.cur; this.cur = null; clearTimeout(c.timer); clearInterval(c.guard); c.reject(new HostError(reason)); }
  }
  async _onMessage(w, m) {
    const c = this.cur; if (!c || m.call !== c.id) return;
    if (m.t === 'eff') {
      const p = this.broker.handle(m.name, m.args, c.st).catch((e) => { this._note('effect_denied:' + (e.code || 'x')); });
      c.st.pending.push(p);
    } else if (m.t === 'req') {
      let msg;
      try { msg = { t: 'res', id: m.id, ok: true, value: await this.broker.handle(m.name, m.args, c.st) }; }
      catch (e) { msg = { t: 'res', id: m.id, ok: false, error: e.code || 'failed' }; }
      if (this.worker === w && this.cur === c) w.postMessage(msg);
    } else if (m.t === 'done') {
      clearTimeout(c.timer); clearInterval(c.guard); this.cur = null;
      await Promise.allSettled(c.st.pending);
      if (m.ok) return c.resolve({ ok: true });
      const e = String(m.error || '');
      const code = /interrupted/i.test(e) ? 'cpu_limit' : /out of memory/i.test(e) ? 'memory_limit' : /stack/i.test(e) ? 'stack_limit' : 'plugin_error';
      if (code !== 'plugin_error') { this.worker = null; w.terminate(); this._fault(code); } // the engine is replaced after a limit was hit
      c.reject(new HostError(code, e));
    }
  }
  async _call(kind, name, ctx, extra) {
    if (this.broker.strikes >= this.broker.p.strikeLimit) this._disable('rules');
    if (this.disabled) throw new HostError('disabled');
    this.lastUsed = Date.now();
    if (!this.worker) await this._spawn();
    const w = this.worker; const id = ++this.seq; const st = this.broker.newCall(ctx, extra);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this._crash(w, 'timeout'), this.limits.wallMs);
      const base = process.memoryUsage.rss(); const max = this.limits.memoryGuardMb * 1048576;
      const guard = setInterval(() => { if (process.memoryUsage.rss() - base > max) this._crash(w, 'memory_guard'); }, this.limits.guardEveryMs);
      this.cur = { id, resolve, reject, timer, guard, st };
      w.postMessage({ t: 'call', call: id, kind, name, ctx: JSON.stringify(ctx) });
    });
  }
}
module.exports = { PluginHost, HostError, BrokerError, DEFAULT_LIMITS };
