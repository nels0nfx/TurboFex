'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { make, CTX, stopAll, fakeEnv } = require('./plugins-helpers');
const { Broker } = require('../core/plugins/broker');
test.afterEach(stopAll);

const ctx = (o) => ({ ...CTX, ...(o || {}) });
const ok = (host, name = 'go', c) => host.call('command', name, ctx(c));
const code = async (p) => { try { await p; return 'resolved'; } catch (e) { return e.code + (e.message && e.message !== e.code ? ':' + e.message : ''); } };

test('a plugin loads, handles a command and replies in the same chat', async () => {
  const { host, env } = make("tfx.command('go', (c) => c.reply('hello ' + c.sender.name));");
  await ok(host);
  assert.deepStrictEqual(env.sends, [{ chat: 'chat-1', text: 'hello Sam' }]);
});

test('a broken plugin fails to load without hurting anything', async () => {
  const { host } = make('this is not javascript (');
  assert.match(await code(ok(host)), /^load_failed/);
});

test('an error inside a handler is reported and the engine keeps working', async () => {
  const { host, env } = make("tfx.command('bad', () => { throw new Error('boom'); }); tfx.command('go', (c) => c.reply('still alive'));");
  assert.match(await code(ok(host, 'bad')), /^plugin_error:boom/);
  await ok(host, 'go');
  assert.strictEqual(env.sends.length, 1);
});

test('ESCAPE: none of the usual ways out of the sandbox reach the bot', async () => {
  const src = `
  tfx.command('go', async (c) => {
    const t = {
      process: () => typeof process, require: () => typeof require, module: () => typeof module,
      globalProcess: () => typeof globalThis.process, thisProcess: () => typeof (function () { return this; })().process,
      FunctionCtor: () => Function('return typeof process')(), evalRequire: () => eval('typeof require'),
      indirectEval: () => (0, eval)('typeof process'), ctorChain: () => [].constructor.constructor('return typeof process')(),
      asyncCtor: async () => await (async function () {}).constructor('return typeof process')(),
      WebAssembly: () => typeof WebAssembly, fetch: () => typeof fetch, Buffer: () => typeof Buffer, setTimeout: () => typeof setTimeout,
      XMLHttpRequest: () => typeof XMLHttpRequest, std: () => typeof std, os: () => typeof os,
      hostSync: () => typeof __hostSync, hostAsync: () => typeof __hostAsync, hostDone: () => typeof __hostDone,
    };
    const out = {};
    for (const k of Object.keys(t)) { try { out[k] = String(await t[k]()); } catch (e) { out[k] = 'threw'; } }
    try { out.dynamicImport = await import('fs').then(() => 'LOADED', () => 'rejected'); } catch (e) { out.dynamicImport = 'threw'; }
    for (const k of Object.keys(out)) tfx.log(k + '=' + out[k]);
  });`;
  const { host, env } = make(src);
  await ok(host);
  const out = Object.fromEntries(env.logs.map((l) => l.split('=')));
  assert.ok(Object.keys(out).length >= 20, 'every attempt reported');
  for (const [k, v] of Object.entries(out)) assert.ok(['undefined', 'threw', 'rejected'].includes(v), 'REACHABLE: ' + k + ' = ' + v);
});

test('ESCAPE: the plugin sees only the standard language objects plus tfx', async () => {
  const { host, env } = make("tfx.command('go', () => { const n = Object.getOwnPropertyNames(globalThis); for (let i = 0; i < n.length; i += 15) tfx.log(n.slice(i, i + 15).join(',')); });");
  await ok(host);
  const names = env.logs.join(',').split(',');
  const forbidden = ['process', 'require', 'module', 'Buffer', 'fetch', 'WebAssembly', 'setTimeout', 'setInterval', 'std', 'os', '__hostSync', '__hostAsync', '__hostDone', 'global', 'window', 'self'];
  assert.deepStrictEqual(names.filter((n) => forbidden.includes(n)), []);
  assert.ok(names.includes('tfx'));
});

test('the API object cannot be changed by a plugin to gain new powers', async () => {
  const { host, env } = make("tfx.command('go', () => { 'use strict'; let r = []; try { tfx.evil = 1; } catch (e) { r.push('frozen'); } try { tfx.net.fetch = null; } catch (e) { r.push('frozen2'); } tfx.log(r.join(',')); });");
  await ok(host);
  assert.strictEqual(env.logs[0], 'frozen,frozen2');
});

test('two plugins are fully separate (globals and prototype changes do not leak)', async () => {
  const a = make("globalThis.leak = 42; Object.prototype.poison = 1; tfx.command('go', () => {});", { id: 'a' });
  const b = make("tfx.command('go', () => tfx.log(typeof leak + ',' + typeof ({}).poison));", { id: 'b' });
  await ok(a.host); await ok(b.host);
  assert.strictEqual(b.env.logs[0], 'undefined,undefined');
  assert.strictEqual(({}).poison, undefined, 'the bot itself was not polluted');
});

test('LIMIT: an endless loop is stopped, the bot is never frozen, and the plugin works again afterwards', async () => {
  const { host, env } = make("tfx.command('loop', () => { while (true) {} }); tfx.command('go', (c) => c.reply('back'));", { limits: { cpuMs: 300, wallMs: 3000 } });
  let maxLag = 0, last = Date.now(); const iv = setInterval(() => { const n = Date.now(); maxLag = Math.max(maxLag, n - last - 10); last = n; }, 10);
  const t0 = Date.now(); const r = await code(ok(host, 'loop')); const took = Date.now() - t0; clearInterval(iv);
  assert.strictEqual(r.split(':')[0], 'cpu_limit'); assert.ok(took < 2500, 'stopped in ' + took + ' ms');
  assert.ok(maxLag < 250, 'main thread was blocked for ' + maxLag + ' ms');
  await ok(host, 'go'); assert.strictEqual(env.sends.length, 1);
});

test('LIMIT: a memory bomb is stopped (by the engine limit or the clock), the bot does not grow, and the plugin recovers', async () => {
  // Finding: one long built-in call (like repeat) cannot be interrupted from inside, so the wall-clock stop is the real backstop.
  const { host, env } = make("tfx.command('bomb', () => { const a = []; for (;;) a.push('x'.repeat(1000000) + a.length); }); tfx.command('go', (c) => c.reply('back'));", { limits: { cpuMs: 4000, wallMs: 4000 } });
  const before = process.memoryUsage().rss;
  const r = await code(ok(host, 'bomb')); const grew = (process.memoryUsage().rss - before) / 1048576;
  assert.ok(['memory_limit', 'memory_guard', 'cpu_limit', 'timeout'].includes(r.split(':')[0]), r);
  assert.ok(grew < 300, 'bot memory grew by ' + grew.toFixed(0) + ' MB');
  await ok(host, 'go'); assert.strictEqual(env.sends.length, 1);
});

test('LIMIT: endless recursion is an error, not a crash', async () => {
  const { host } = make("tfx.command('rec', () => { const f = () => f() + 1; f(); });");
  assert.match(await code(ok(host, 'rec')), /^(stack_limit|plugin_error|memory_limit)/);
});

test('LIMIT: a regular expression that never finishes is stopped', async () => {
  const { host } = make("tfx.command('re', () => /(a+)+$/.test('a'.repeat(40) + 'b'));", { limits: { cpuMs: 300, wallMs: 2500 } });
  const t0 = Date.now(); const r = await code(ok(host, 're'));
  assert.ok(['cpu_limit', 'timeout'].includes(r.split(':')[0]), r); assert.ok(Date.now() - t0 < 4500);
});

test('LIMIT: a handler that waits forever is cut off by the wall-clock limit', async () => {
  const { host } = make("tfx.command('hang', () => new Promise(() => {}));", { limits: { wallMs: 800 } });
  assert.strictEqual(await code(ok(host, 'hang')), 'timeout');
});

test('LIMIT: the memory limit is real but normal work fits inside it', async () => {
  const { host, env } = make("tfx.command('go', (c) => { const s = 'x'.repeat(8000000); c.reply('len ' + s.length); });");
  await ok(host); assert.strictEqual(env.sends[0].text, 'len 8000000');
});

test('POLICY: three faults in the window switch the plugin off', async () => {
  const { host } = make("tfx.command('loop', () => { while (true) {} });", { limits: { cpuMs: 120, wallMs: 2000, crashLimit: 3 } });
  for (let i = 0; i < 3; i++) await code(ok(host, 'loop'));
  assert.strictEqual(await code(ok(host, 'loop')), 'disabled');
});

test('PERMISSION: a call without the permission in the manifest is refused', async () => {
  const { host, env } = make("tfx.command('go', async () => { await tfx.owner.notify('hi'); });", { permissions: ['chat.send'] });
  assert.match(await code(ok(host)), /not_declared/); assert.deepStrictEqual(env.notified, []);
});

test('PERMISSION: declared but not granted by the owner is refused', async () => {
  const { host, env } = make("tfx.command('go', async () => { await tfx.owner.notify('hi'); });", { permissions: ['owner.notify'], grants: [] });
  assert.match(await code(ok(host)), /not_granted/); assert.deepStrictEqual(env.notified, []);
});

test('PERMISSION: a granted call works, and is capped at 3 messages to the owner per hour', async () => {
  const { host, env } = make("tfx.command('go', async () => { await tfx.owner.notify('hi'); });", { permissions: ['owner.notify'] });
  await ok(host); await ok(host); await ok(host);
  assert.match(await code(ok(host)), /rate_limited/); assert.strictEqual(env.notified.length, 3);
});

test('PERMISSION: group info gives only a name and counts, and only inside a group', async () => {
  const { host, env } = make("tfx.command('go', async () => { tfx.log(JSON.stringify(await tfx.group.info())); });", { permissions: ['group.read'] });
  await host.call('command', 'go', ctx(), { groupInfo: { name: 'Team', size: 5, admins: 2, participants: ['secret'] } });
  assert.strictEqual(env.logs[0], '{"name":"Team","size":5,"admins":2}');
  assert.match(await code(ok(host)), /not_allowed/);
});

test('POLICY: too many messages in one call are cut at 5; messages per minute are capped at 20', async () => {
  const { host, env } = make("tfx.command('go', (c) => { for (let i = 0; i < 50; i++) c.reply('m' + i); });");
  await ok(host); assert.strictEqual(env.sends.length, 5);
  for (let i = 0; i < 6; i++) await ok(host);
  assert.strictEqual(env.sends.length, 20);
});

test('POLICY: empty and oversized messages are refused', async () => {
  const { host, env } = make("tfx.command('go', (c) => { c.reply('x'.repeat(5000)); c.reply(''); });");
  await ok(host); assert.strictEqual(env.sends.length, 0);
});

test('POLICY: a flood of log lines is capped', async () => {
  const { host, env } = make("tfx.command('go', () => { for (let i = 0; i < 500; i++) tfx.log('l' + i); });");
  await ok(host); assert.ok(env.logs.length <= 100);
});

test('NETWORK: only listed https domains on public addresses are reachable', async () => {
  const src = "tfx.command('go', async (c) => { try { const r = await tfx.net.fetch(c.rest); tfx.log('OK ' + r.status); } catch (e) { tfx.log('DENIED ' + e); } });";
  const { host, env } = make(src, { permissions: ['chat.send', 'network'], domains: ['api.example.com', 'internal.example.com'] });
  const cases = { 'https://api.example.com/x': 'OK 200', 'http://api.example.com/x': 'DENIED net_denied', 'https://evil.example.org/': 'DENIED net_denied',
    'https://internal.example.com/': 'DENIED net_denied', 'https://api.example.com:8443/': 'DENIED net_denied', 'https://u:p@api.example.com/': 'DENIED net_denied', 'not a url': 'DENIED bad_args' };
  for (const [url, want] of Object.entries(cases)) { env.logs.length = 0; await ok(host, 'go', { rest: url }); assert.strictEqual(env.logs[0], want, url); }
});

test('NETWORK: at most 3 requests per call', async () => {
  const { host, env } = make("tfx.command('go', async () => { let n = 0; for (let i = 0; i < 6; i++) { try { await tfx.net.fetch('https://api.example.com/'); n++; } catch (e) {} } tfx.log('n=' + n); });", { permissions: ['network'], domains: ['api.example.com'] });
  await ok(host); assert.strictEqual(env.logs[0], 'n=3');
});

test('STORAGE: keys are checked, values and total size are capped, and plugins cannot see each other', async () => {
  const src = `tfx.command('go', async (c) => { const out = [];
    try { await tfx.storage.set('a', 'v'); out.push(await tfx.storage.get('a')); } catch (e) { out.push('E1'); }
    try { await tfx.storage.set('../x', 'v'); out.push('BAD'); } catch (e) { out.push('badkey'); }
    try { await tfx.storage.set('big', 'x'.repeat(70000)); out.push('BAD'); } catch (e) { out.push('toolong'); }
    let full = 'no'; for (let i = 0; i < 30; i++) { try { await tfx.storage.set('k' + i, 'x'.repeat(60000)); } catch (e) { full = String(e); break; } } out.push(full);
    tfx.log(out.join('|')); });`;
  const a = make(src, { permissions: ['storage'], id: 'a' }); await ok(a.host);
  assert.strictEqual(a.env.logs[0], 'v|badkey|toolong|quota');
  const b = make("tfx.command('go', async () => tfx.log(String(await tfx.storage.get('a'))));", { permissions: ['storage'], id: 'b' }); await ok(b.host);
  assert.strictEqual(b.env.logs[0], 'null');
});

test('BROKER (forged requests): unknown calls, extra fields, __proto__ and wrong types are all refused', async () => {
  const env = fakeEnv(); const b = new Broker({ manifest: { id: 'x', permissions: ['chat.send'] }, grants: ['chat.send'], env });
  const st = b.newCall(CTX);
  const bad = async (name, json) => { try { await b.handle(name, json, st); return 'accepted'; } catch (e) { return e.code; } };
  assert.strictEqual(await bad('fs.readFile', '{}'), 'unknown_api');
  assert.strictEqual(await bad('chat.send', '{"text":"x","chat":"other-chat"}'), 'bad_args');
  assert.strictEqual(await bad('chat.send', '{"__proto__":{"polluted":1},"text":"x"}'), 'bad_args');
  assert.strictEqual(await bad('chat.send', '{"text":{"a":1}}'), 'bad_args');
  assert.strictEqual(await bad('chat.send', '[1,2]'), 'bad_args');
  assert.strictEqual(await bad('chat.send', 'x'.repeat(200000)), 'bad_args');
  assert.strictEqual(({}).polluted, undefined); assert.deepStrictEqual(env.sends, []);
  assert.ok(b.strikes >= 5);
});

test('POLICY: repeated rule-breaking switches the plugin off', async () => {
  const { host } = make("tfx.command('go', async () => { for (let i = 0; i < 8; i++) { try { await tfx.owner.notify('u'); } catch (e) {} } });", { permissions: ['chat.send'] });
  await ok(host); assert.strictEqual(await code(ok(host)), 'disabled');
});
