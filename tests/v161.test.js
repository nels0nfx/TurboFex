'use strict';
// v1.6.1: Plugin API 1.1 (quote, mention, typing, poll, dm, group members/describe/invite, media download, POST, chat notes, hash, fromBase64, new events)
const test = require('node:test');
const assert = require('node:assert');
const { make, CTX, stopAll } = require('./plugins-helpers');
const manifestLib = require('../core/plugins/manifest');
test.afterEach(stopAll);
const code = async (p) => { try { await p; return 'resolved'; } catch (e) { return e.code + (e.message && e.message !== e.code ? ':' + e.message : ''); } };
const run = (host, c, extra, name = 'go') => host.call('command', name, { ...CTX, ...(c || {}) }, extra || {});

test('the version and the new permissions and events are known', () => {
  assert.strictEqual(require('../package.json').version, '1.8.4');
  for (const p of ['user.dm', 'group.members', 'media.read', 'group.invite']) assert.ok(manifestLib.PERMISSIONS.includes(p), p);
  assert.strictEqual(manifestLib.EVENTS['member.promote'], 'events.members');
  assert.strictEqual(manifestLib.EVENTS['member.demote'], 'events.members');
});

test('quote, mention, typing and poll go through the bot and count against the message limits', async () => {
  const got = [];
  const { host } = make(`tfx.command('go', async (c) => {
    await c.typing('typing'); await c.quote('hi'); await c.mention('hello {1}', ['p1']); await c.poll('Lunch?', ['Rice', 'Beans'], false); }); `, { permissions: ['chat.send'] });
  await run(host, {}, { quote: async (t) => got.push(['quote', t]), mention: async (t, ids) => got.push(['mention', t, ids]), presence: async (k) => got.push(['presence', k]), poll: async (q, o, m) => got.push(['poll', q, o, m]) });
  assert.deepStrictEqual(got, [['presence', 'typing'], ['quote', 'hi'], ['mention', 'hello {1}', ['p1']], ['poll', 'Lunch?', ['Rice', 'Beans'], false]]);
});

test('bad polls, mentions and typing kinds are refused', async () => {
  const src = (body) => `tfx.command('go', async (c) => { ${body} });`;
  const extra = { quote: async () => {}, mention: async () => {}, presence: async () => {}, poll: async () => {} };
  for (const body of ["await c.poll('q', ['only one'], false);", "await c.poll('q', ['a', 'a'], false);", "await c.poll('', ['a', 'b'], false);", "await c.mention('x', []);", "await c.mention('x', ['1','2','3','4','5','6','7','8','9','10','11']);", "await c.typing('dancing');"]) {
    const { host } = make(src(body), { permissions: ['chat.send'] });
    assert.match(await code(run(host, {}, extra)), /^plugin_error/, body);
  }
});

test('the new calls need their permission', async () => {
  for (const body of ["await c.dm('x')", "await tfx.group.members()", "await tfx.media.download('any')", "await tfx.group.inviteLink()", "await tfx.group.describe('x')"]) {
    const { host } = make(`tfx.command('go', async (c) => { ${body} });`, { permissions: ['chat.send'] });
    const r = await code(run(host, {}, { dm: async () => {}, members: async () => [], download: async () => null, manage: async () => {} }));
    assert.match(r, /^plugin_error/, body);
  }
});

test('dm goes only through the command extra, one per call, and is rate limited', async () => {
  const sent = [];
  const { host } = make("tfx.command('go', async (c) => { await c.dm('private'); });", { permissions: ['user.dm'] });
  await run(host, {}, { dm: async (t) => sent.push(t) });
  assert.deepStrictEqual(sent, ['private']);
  const two = make("tfx.command('go', async (c) => { await c.dm('a'); await c.dm('b'); });", { permissions: ['user.dm'] });
  assert.match(await code(run(two.host, {}, { dm: async () => {} })), /^plugin_error/);
  const noCmd = make("tfx.command('go', async (c) => { await c.dm('a'); });", { permissions: ['user.dm'] });
  assert.match(await code(run(noCmd.host, {}, {})), /^plugin_error/); // no dm extra = an event or timer
});

test('group.members returns ids and admin flags only', async () => {
  let seen;
  const { host } = make("tfx.command('go', async (c) => { const l = await tfx.group.members(); await c.reply(JSON.stringify(l)); });", { permissions: ['chat.send', 'group.members'] });
  const { env } = { env: null };
  await run(host, {}, { members: async () => [{ id: 'a1', admin: true, phone: '2348000' }, { id: 'a2', admin: false }], send: async (t) => { seen = t; } });
  assert.strictEqual(seen, JSON.stringify([{ id: 'a1', admin: true }, { id: 'a2', admin: false }]));
});

test('describe and invite link use the manage door', async () => {
  const calls = [];
  const { host } = make("tfx.command('go', async (c) => { await tfx.group.describe('Rules: be kind'); const l = await tfx.group.inviteLink(); await c.reply(l); });", { permissions: ['chat.send', 'group.manage', 'group.invite'] });
  let said;
  await run(host, {}, { manage: async (a, x) => { calls.push([a, x]); return a === 'invite' ? 'https://chat.whatsapp.com/ABC' : undefined; }, send: async (t) => { said = t; } });
  assert.deepStrictEqual(calls, [['describe', 'Rules: be kind'], ['invite', undefined]]);
  assert.strictEqual(said, 'https://chat.whatsapp.com/ABC');
  const long = make("tfx.command('go', async () => { await tfx.group.describe('x'.repeat(501)); });", { permissions: ['group.manage'] });
  assert.match(await code(run(long.host, {}, { manage: async () => {} })), /^plugin_error/);
});

test('media.download returns base64 and refuses big files', async () => {
  const buf = Buffer.from('hello picture');
  let out;
  const { host } = make("tfx.command('go', async (c) => { const m = await tfx.media.download('quoted'); await c.reply(m.kind + ':' + m.mimetype + ':' + m.size + ':' + tfx.util.fromBase64(m.base64)); });", { permissions: ['chat.send', 'media.read'] });
  await run(host, {}, { download: async (w) => ({ kind: 'image', buffer: buf, mimetype: 'image/png' }), send: async (t) => { out = t; } });
  assert.strictEqual(out, 'image:image/png:13:hello picture');
  const big = make("tfx.command('go', async () => { await tfx.media.download('any'); });", { permissions: ['media.read'] });
  assert.match(await code(run(big.host, {}, { download: async () => ({ kind: 'image', buffer: Buffer.alloc(3 * 1024 * 1024) }) })), /^plugin_error/);
  const none = make("tfx.command('go', async (c) => { const m = await tfx.media.download('any'); await c.reply(String(m)); });", { permissions: ['chat.send', 'media.read'] });
  let s2; await run(none.host, {}, { download: async () => null, send: async (t) => { s2 = t; } });
  assert.strictEqual(s2, 'null');
});

test('net.post only to listed domains, only allowed types, and is rate limited', async () => {
  const posts = [];
  const env = { post: async (u, b, t) => { posts.push([u, b, t]); return { status: 201, text: 'made' }; } };
  const { host } = make("tfx.command('go', async (c) => { const r = await tfx.net.post('https://api.example.com/x', '{\"a\":1}'); await c.reply(r.status + r.text); });", { permissions: ['chat.send', 'network'], domains: ['api.example.com'], env });
  let said; await run(host, {}, { send: async (t) => { said = t; } });
  assert.strictEqual(said, '201made'); assert.deepStrictEqual(posts, [['https://api.example.com/x', '{"a":1}', 'application/json']]);
  const other = make("tfx.command('go', async () => { await tfx.net.post('https://evil.example.org/x', 'a'); });", { permissions: ['network'], domains: ['api.example.com'], env });
  assert.match(await code(run(other.host)), /^plugin_error/);
  const type = make("tfx.command('go', async () => { await tfx.net.post('https://api.example.com/x', 'a', 'text/html'); });", { permissions: ['network'], domains: ['api.example.com'], env });
  assert.match(await code(run(type.host)), /^plugin_error/);
  const priv = make("tfx.command('go', async () => { await tfx.net.post('https://internal.example.com/x', 'a'); });", { permissions: ['network'], domains: ['internal.example.com'], env });
  assert.match(await code(run(priv.host)), /^plugin_error/);
});

test('chat notes are kept per chat and do not mix with the plugin notes', async () => {
  const { host, env } = make(`tfx.command('go', async (c) => {
    await tfx.storage.chat.set('rules', c.rest || 'one'); await tfx.storage.set('rules', 'global');
    await c.reply((await tfx.storage.chat.get('rules')) + '|' + (await tfx.storage.get('rules')));
    await tfx.storage.chat.delete('rules'); await c.reply(String(await tfx.storage.chat.get('rules'))); });`, { permissions: ['chat.send', 'storage'] });
  await run(host, { chat: { id: 'chat-A', isGroup: true, name: 'A' } });
  assert.deepStrictEqual(env.sends.map((x) => x.text), ['one|global', 'null']);
  const { host: h2, env: e2 } = make("tfx.command('go', async (c) => { await c.reply(String(await tfx.storage.chat.get('rules'))); });", { permissions: ['chat.send', 'storage'] });
  await run(h2, { chat: { id: 'chat-B', isGroup: true, name: 'B' } }); assert.strictEqual(e2.sends[0].text, 'null');
  const bad = make("tfx.command('go', async () => { await tfx.storage.chat.get('a b'); });", { permissions: ['storage'] });
  assert.match(await code(run(bad.host)), /^plugin_error/);
});

test('util.hash and util.fromBase64 work without any permission', async () => {
  const { host, env } = make("tfx.command('go', async (c) => { await c.reply((await tfx.util.hash('abc')) + ' ' + (await tfx.util.hash('abc', 'md5')) + ' ' + tfx.util.fromBase64(tfx.util.toBase64('héllo ✓'))); });");
  await run(host);
  assert.strictEqual(env.sends[0].text, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad 900150983cd24fb0d6963f7d28e17f72 héllo ✓');
  const bad = make("tfx.command('go', async () => { await tfx.util.hash('a', 'sha512'); });");
  assert.match(await code(run(bad.host)), /^plugin_error/);
});

test('the command context carries quoted and hasMedia', async () => {
  const { host, env } = make("tfx.command('go', async (c) => { await c.reply((c.quoted ? c.quoted.text + '/' + c.quoted.media : 'none') + '/' + c.hasMedia); });");
  await run(host, { quoted: { text: 'original', sender: 'x1', media: 'image' }, hasMedia: 'sticker' });
  assert.strictEqual(env.sends[0].text, 'original/image/sticker');
});

test('events: promote and demote need events.members', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx170-'));
  const base = { manifestVersion: 1, id: 'promo-watch', version: '1.0.0', apiVersion: 1, name: 'Promo Watch', description: 'x', author: { name: 'a' }, entry: 'index.js', events: ['member.promote', 'member.demote'] };
  fs.writeFileSync(path.join(d, 'index.js'), "tfx.on('member.promote', (c) => c.reply('up'));");
  fs.writeFileSync(path.join(d, 'turbofex-plugin.json'), JSON.stringify({ ...base, permissions: ['events.members', 'chat.send'] }));
  assert.strictEqual(manifestLib.validate(d, { botVersion: '1.6.1', taken: new Set() }).ok, true);
  fs.writeFileSync(path.join(d, 'turbofex-plugin.json'), JSON.stringify({ ...base, permissions: ['chat.send'] }));
  assert.strictEqual(manifestLib.validate(d, { botVersion: '1.6.1', taken: new Set() }).ok, false);
});

test('the whole bot passes the updater\'s own safety check (no file needs a file that is not shipped)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { validateEntries } = require('../core/updater');
  const root = path.join(__dirname, '..'), entries = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name === '.git') continue;
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else entries.push({ isDirectory: false, entryName: path.relative(root, p).split(path.sep).join('/'), getData: () => fs.readFileSync(p) });
    }
  })(root);
  assert.doesNotThrow(() => validateEntries(entries, ''));
});
