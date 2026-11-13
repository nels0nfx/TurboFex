'use strict';
// Plugin sandbox, part 1 of 3. This file runs INSIDE a worker thread and holds ONE sealed engine (QuickJS compiled to
// WebAssembly) with ONE plugin in it. The plugin can only talk to the outside through two functions that are removed from
// its view before its code runs; they only send plain text to the bot, where core/plugins/broker.js decides what is allowed.
const { parentPort, workerData } = require('node:worker_threads');
const { getQuickJS } = require('quickjs-emscripten');
const { limits } = workerData;

// What a plugin sees as "tfx" (Plugin API v1, stage 1a). Every call becomes a text message to the broker.
const PRELUDE = `(function () {
  var hs = globalThis.__hostSync, ha = globalThis.__hostAsync, hd = globalThis.__hostDone;
  delete globalThis.__hostSync; delete globalThis.__hostAsync; delete globalThis.__hostDone;
  var handlers = { command: Object.create(null), schedule: Object.create(null), event: Object.create(null) };
  var send = function (name, args) { return hs(name, JSON.stringify(args === undefined ? {} : args)); };
  var ask = function (name, args) { return ha(name, JSON.stringify(args === undefined ? {} : args)).then(function (s) { return JSON.parse(s); }); };
  var tfx = {
    command: function (n, f) { handlers.command[String(n)] = f; },
    schedule: function (n, f) { handlers.schedule[String(n)] = f; },
    on: function (n, f) { handlers.event[String(n)] = f; },
    log: function (t) { send('log', { text: String(t) }); },
    net: Object.freeze({
      fetch: function (url) { return ask('net.fetch', { url: String(url) }); },
      fetchBytes: function (url) { return ask('net.fetchBytes', { url: String(url) }); }
    }),
    media: Object.freeze({
      toSticker: function (data) { return ask('media.toSticker', { data: String(data || '') }); },
      toAudio: function (data) { return ask('media.toAudio', { data: String(data || '') }); },
      send: function (o) { o = o || {}; return ask('media.send', { kind: String(o.kind || ''), data: String(o.data || ''), mimetype: String(o.mimetype || ''), fileName: String(o.fileName || ''), caption: String(o.caption || '') }); }
    }),
    util: Object.freeze({
      toBase64: function (text) { // plain JavaScript: the sandbox has no Buffer or btoa
        var s = unescape(encodeURIComponent(String(text))), k = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = [], i = 0;
        for (; i + 2 < s.length; i += 3) { var n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i + 2); o.push(k[n >> 18], k[(n >> 12) & 63], k[(n >> 6) & 63], k[n & 63]); }
        if (s.length - i === 1) { var a = s.charCodeAt(i) << 16; o.push(k[a >> 18], k[(a >> 12) & 63], '=', '='); }
        else if (s.length - i === 2) { var b = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8); o.push(k[b >> 18], k[(b >> 12) & 63], k[(b >> 6) & 63], '='); }
        return o.join('');
      }
    }),
    storage: Object.freeze({
      get: function (k) { return ask('storage.get', { key: String(k) }); },
      set: function (k, v) { return ask('storage.set', { key: String(k), value: String(v) }); },
      delete: function (k) { return ask('storage.delete', { key: String(k) }); },
      list: function () { return ask('storage.list', {}); }
    }),
    group: Object.freeze({
      info: function () { return ask('group.info', {}); },
      kick: function (m) { return ask('group.kick', { member: String(m) }); },
      open: function () { return ask('group.open', {}); },
      close: function () { return ask('group.close', {}); },
      promote: function (m) { return ask('group.promote', { member: String(m) }); },
      demote: function (m) { return ask('group.demote', { member: String(m) }); },
      rename: function (n) { return ask('group.rename', { name: String(n) }); }
    }),
    owner: Object.freeze({ notify: function (t) { return ask('owner.notify', { text: String(t) }); } })
  };
  Object.freeze(tfx);
  globalThis.tfx = tfx;
  return function (kind, name, ctxJson) {
    var h = handlers[kind] && handlers[kind][name];
    if (typeof h !== 'function') { hd('fail', 'no such handler'); return; }
    var raw = JSON.parse(ctxJson);
    var ctx = { args: raw.args, rest: raw.rest, prefix: raw.prefix, chat: raw.chat, sender: raw.sender, event: raw.event, text: raw.text, settings: Object.freeze(raw.settings || {}), members: raw.members, mentions: raw.mentions,
                reply: function (t) { return send('chat.send', { text: String(t) }); },
                react: function (e) { return send('chat.react', { emoji: String(e) }); } };
    Promise.resolve().then(function () { return h(ctx); }).then(
      function () { hd('ok', ''); },
      function (e) { hd('fail', String(e && e.message ? e.message : e)); });
  };
})()`;

(async () => {
  const QuickJS = await getQuickJS();
  const rt = QuickJS.newRuntime();
  rt.setMemoryLimit(limits.memoryBytes);
  rt.setMaxStackSize(limits.stackBytes);
  let deadline = Infinity;
  rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  let curCall = 0, rid = 0, cpuLeft = 0, finished = false;
  const waits = new Map();
  const str = (h) => { if (vm.typeof(h) !== 'string') throw new Error('bad argument'); return vm.getString(h); };
  const dumpErr = (e) => { let m; try { m = vm.dump(e); } catch (x) { m = 'error'; } return String(m && m.message ? m.message : JSON.stringify(m)).slice(0, 300); };

  const finish = (ok, msg) => { if (finished) return; finished = true; parentPort.postMessage({ t: 'done', call: curCall, ok, error: msg }); };
  const timed = (fn) => { // runs plugin code with a CPU budget; the interrupt handler stops endless loops
    const t0 = Date.now(); deadline = t0 + Math.max(1, cpuLeft);
    try { return fn(); } finally { cpuLeft -= Date.now() - t0; deadline = Infinity; }
  };
  const pump = () => {
    if (finished) return;
    const r = timed(() => rt.executePendingJobs());
    if (r && r.error) { const m = dumpErr(r.error); r.error.dispose(); finish(false, m); }
  };

  vm.newFunction('__hostSync', (n, a) => { parentPort.postMessage({ t: 'eff', call: curCall, name: str(n), args: str(a) }); return vm.newString('null'); })
    .consume((f) => vm.setProp(vm.global, '__hostSync', f));
  vm.newFunction('__hostAsync', (n, a) => {
    const d = vm.newPromise(); const id = ++rid; waits.set(id, d);
    parentPort.postMessage({ t: 'req', call: curCall, id, name: str(n), args: str(a) });
    return d.handle;
  }).consume((f) => vm.setProp(vm.global, '__hostAsync', f));
  vm.newFunction('__hostDone', (k, m) => { finish(str(k) === 'ok', str(m)); return vm.undefined; })
    .consume((f) => vm.setProp(vm.global, '__hostDone', f));

  let dispatch = null;
  const evalGuest = (code, name) => { const r = timed(() => vm.evalCode(code, name)); if (r.error) { const m = dumpErr(r.error); r.error.dispose(); throw new Error(m); } return r.value; };

  parentPort.on('message', (m) => {
    try {
      if (m.t === 'load') {
        cpuLeft = limits.cpuMs;
        dispatch = evalGuest(PRELUDE, 'prelude.js');
        evalGuest(m.source, 'plugin.js').dispose();
        parentPort.postMessage({ t: 'loaded' });
      } else if (m.t === 'call') {
        curCall = m.call; finished = false; cpuLeft = limits.cpuMs;
        const a = vm.newString(m.kind), b = vm.newString(m.name), c = vm.newString(m.ctx);
        const r = timed(() => vm.callFunction(dispatch, vm.undefined, a, b, c));
        a.dispose(); b.dispose(); c.dispose();
        if (r.error) { const e = dumpErr(r.error); r.error.dispose(); finish(false, e); } else { r.value.dispose(); pump(); }
      } else if (m.t === 'res') {
        const d = waits.get(m.id); if (!d) return; waits.delete(m.id);
        const h = vm.newString(m.ok ? m.value : String(m.error));
        if (m.ok) d.resolve(h); else d.reject(h);
        h.dispose(); d.dispose();
        pump();
      }
    } catch (e) {
      if (m.t === 'load') parentPort.postMessage({ t: 'loadfail', error: String(e.message || e).slice(0, 300) });
      else finish(false, String(e.message || e).slice(0, 300));
    }
  });
  parentPort.postMessage({ t: 'ready' });
})().catch((e) => { parentPort.postMessage({ t: 'bootfail', error: String(e && e.message || e) }); });
