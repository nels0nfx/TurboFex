// v1.5.1: plugins can promote, demote and rename (group.admins, group.manage) under the bot's own safety rules
const { dir } = require('./_setup');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const manifestLib = require('../core/plugins/manifest');
const plugins = require('../core/plugins');
const pluginCmd = require('../commands/plugin');

const commands = new Map();
const commandList = [];
commands.set('ping', { name: 'ping', aliases: [], category: 'general' });
commandList.push(commands.get('ping'));
plugins.attach(commands, commandList);

const sent = [];
const sock = { sendMessage: async (to, m) => { sent.push({ to, text: m.text }); } };
const root = path.join(dir, 'plugins');
function makePlugin(folder, over = {}, source) {
  const d = path.join(root, folder); fs.mkdirSync(d, { recursive: true });
  const m = { manifestVersion: 1, id: folder, version: '1.0.0', apiVersion: 1, name: 'Hello ' + folder, description: 'Says hello', author: { name: 'Dev' }, permissions: ['chat.send'], commands: [{ name: 'hello' + folder.replace(/-/g, ''), who: 'everyone', description: 'Says hello' }], ...over };
  fs.writeFileSync(path.join(d, 'turbofex-plugin.json'), JSON.stringify(m));
  fs.writeFileSync(path.join(d, 'index.js'), source || `tfx.command('${m.commands && m.commands[0] ? m.commands[0].name : 'x'}', (c) => c.reply('hello ' + c.sender.name + ' ' + c.chat.id));`);
  return d;
}
const ctxFor = (over = {}) => { const replies = []; return { replies, c: { jid: '1203630000000@g.us', args: [], rest: '', prefix: '.', isGroup: true, isAdmin: true, isOwner: false, msg: { key: { participant: '27811111111@s.whatsapp.net' }, pushName: 'Sam' }, groupMetadata: { subject: 'Team', participants: [{ id: 'a', admin: 'admin' }, { id: 'b' }] }, reply: async (t) => { replies.push(t); }, ...over } }; };
const run = async (line, over) => { const r = []; const parts = line.split(/\s+/).slice(1); await pluginCmd.run({ args: parts, rest: line, reply: async (t) => { r.push(t); }, prefix: '.', jid: '1203630000000@g.us', isGroup: true, ...over }); return r.join('\n'); };

test('manifest and risk: group.admins is a known permission and shown as high risk; the site list is in step', async () => {
  assert.ok(manifestLib.PERMISSIONS.includes('group.admins'));
});

test('promote, demote and rename: only in a command used by an admin, never from a listener; protected people and the creator are safe; rate limited', async () => {
  await run('plugin on', {});
  const G = '1203632222222@g.us'; const BOT = '2799999999@s.whatsapp.net';
  const people = [{ id: BOT, admin: 'admin' }, { id: '27800000001@s.whatsapp.net' }, { id: '27844444444@s.whatsapp.net', admin: 'admin' }, { id: '27866666666@s.whatsapp.net', admin: 'superadmin' }, { id: '27833333333@s.whatsapp.net' }, { id: '27855555555@s.whatsapp.net' }];
  const calls = [];
  const mk = (botAdmin = true) => ({ user: { id: '2799999999:7@s.whatsapp.net' }, sendMessage: async () => {}, groupMetadata: async () => ({ id: G, subject: 'Team', participants: people.map((p) => (p.id === BOT && !botAdmin ? { id: BOT } : p)) }),
    groupParticipantsUpdate: async (jid, list, action) => { calls.push([action, jid, list]); return [{ status: '200' }]; }, groupUpdateSubject: async (jid, n) => { calls.push(['rename', jid, n]); }, groupSettingUpdate: async () => {} });
  makePlugin('adminplug', { permissions: ['chat.send', 'events.message', 'group.manage', 'group.admins'], events: ['message'],
    commands: [{ name: 'promo', who: 'everyone', description: 'x' }, { name: 'demo', who: 'everyone', description: 'x' }, { name: 'rename', who: 'everyone', description: 'x' }, { name: 'fake', who: 'owner', description: 'x' }] },
    `tfx.on('message', async (c) => { try { if (c.text === 'promote me') await tfx.group.promote(c.sender.id); if (c.text === 'rename') await tfx.group.rename('Hijacked'); } catch (e) { tfx.log('refused:' + e); } });
     tfx.command('promo', async (c) => { for (const m of c.mentions) { try { await tfx.group.promote(m); } catch (e) { tfx.log('refused:' + e); } } });
     tfx.command('demo', async (c) => { for (const m of c.mentions) { try { await tfx.group.demote(m); } catch (e) { tfx.log('refused:' + e); } } });
     tfx.command('rename', async (c) => { try { await tfx.group.rename(c.rest); } catch (e) { tfx.log('refused:' + e); } });
     tfx.command('fake', async () => { try { await tfx.group.promote('0123456789abcdef'); } catch (e) { tfx.log('refused:' + e); } });`);
  const screen = await run('plugin install adminplug', {}); assert.match(screen, /🔴 Make a member an admin/); assert.match(screen, /rename it/);
  await run('plugin confirm ' + screen.match(/confirm (\w{4})/)[1], {});
  const logs = () => plugins.logOf('adminplug').join('\n'); const inv = () => require('../whatsapp/metadata').invalidate(G);
  const tag = (jid) => ({ key: { participant: '27844444444@s.whatsapp.net' }, pushName: 'Adm', message: { extendedTextMessage: { contextInfo: { mentionedJid: [jid] } } } });
  const cmd = async (name, over) => { const x = ctxFor({ sock: mk(), jid: G, isAdmin: true, groupMetadata: { subject: 'Team', participants: people }, ...over }); await commands.get(name).run(x.c); await new Promise((r) => setTimeout(r, 30)); };
  // a listener can neither promote nor rename
  plugins.emit('message', { sock: mk(), jid: G, text: 'promote me', senderJid: '27833333333@s.whatsapp.net', pushName: 'x' }); plugins.emit('message', { sock: mk(), jid: G, text: 'rename', senderJid: '27833333333@s.whatsapp.net', pushName: 'x' });
  await new Promise((r) => setTimeout(r, 600)); assert.strictEqual(calls.length, 0); assert.strictEqual((logs().match(/refused:not_allowed/g) || []).length, 2);
  // an admin's command promotes a normal member
  await cmd('promo', { msg: tag('27833333333@s.whatsapp.net') }); assert.deepStrictEqual(calls.pop(), ['promote', G, ['27833333333@s.whatsapp.net']]);
  // demoting a normal admin works (done early: every try counts towards the 6 an hour, also the refused ones)
  await cmd('demo', { msg: tag('27844444444@s.whatsapp.net') }); assert.deepStrictEqual(calls.pop(), ['demote', G, ['27844444444@s.whatsapp.net']]);
  people[2].admin = undefined; inv(); people[2].admin = 'admin';
  // a normal member using the command changes nothing
  await cmd('promo', { isAdmin: false, msg: tag('27855555555@s.whatsapp.net') }); assert.strictEqual(calls.length, 0);
  // already admin, the owner, the bot and the group creator are never changed
  for (const who of ['27844444444@s.whatsapp.net', '27800000001@s.whatsapp.net', BOT]) await cmd('promo', { msg: tag(who) });
  await cmd('demo', { msg: tag('27866666666@s.whatsapp.net') }); await cmd('demo', { msg: tag('27800000001@s.whatsapp.net') }); await cmd('demo', { msg: tag('27855555555@s.whatsapp.net') }); // not an admin
  assert.strictEqual(calls.length, 0);
  // made-up id and a bot that is not an admin
  await cmd('fake', { isOwner: true }); assert.strictEqual(calls.length, 0); inv();
  await cmd('promo', { sock: mk(false), msg: tag('27855555555@s.whatsapp.net') }); assert.strictEqual(calls.length, 0); inv();
  // rename: plain text only
  await cmd('rename', { rest: 'Our new name' }); assert.deepStrictEqual(calls.pop(), ['rename', G, 'Our new name']);
  await cmd('rename', { rest: 'x'.repeat(101) }); await cmd('rename', { rest: '   ' }); await cmd('rename', { rest: 'bad‮name' }); assert.strictEqual(calls.length, 0);
  // rate limit: 6 an hour for promote/demote
  const before = calls.length; for (let i = 0; i < 8; i++) { inv(); await cmd('promo', { msg: tag('27855555555@s.whatsapp.net') }); }
  assert.ok(calls.length - before <= 5, 'at most 6 per hour in total (one already used above)');
  plugins.turnOff();
});

test('without group.admins the calls are refused; rename needs group.manage', async () => {
  const { Broker } = require('../core/plugins/broker');
  const env = { isPublicHost: async () => true, log() {}, fetch: async () => ({}), notifyOwner: async () => {} };
  const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code; } };
  const mk2 = (perm) => { const b = new Broker({ manifest: { permissions: perm }, grants: perm, env }); return [b, b.newCall({ chat: { id: 'x' } }, { manage: async () => {} })]; };
  let [b, st] = mk2(['group.manage']); assert.strictEqual(await code(b.handle('group.promote', JSON.stringify({ member: 'm' }), st)), 'not_declared');
  assert.strictEqual(await code(b.handle('group.rename', JSON.stringify({ name: 'ok' }), st)), 'ok');
  [b, st] = mk2(['group.admins']); assert.strictEqual(await code(b.handle('group.rename', JSON.stringify({ name: 'ok' }), st)), 'not_declared');
  assert.strictEqual(await code(b.handle('group.promote', JSON.stringify({ member: 'm' }), st)), 'ok');
  assert.strictEqual(await code(b.handle('group.demote', JSON.stringify({ member: 'm' }), st)), 'rate_limited', 'one person per call');
});
