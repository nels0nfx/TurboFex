require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const handler = require('../whatsapp/handler');
const menu = require('../commands/menu');
const ownername = require('../whatsapp/ownername');
const names = require('../whatsapp/names');
const ownerCmd = require('../commands/ownername');

const OWNER = '27800000001@s.whatsapp.net';
const own = (name) => ({ user: { id: '27800000001:1@s.whatsapp.net', name } });
const other = { user: { id: '27899999999:1@s.whatsapp.net', name: 'The Bot Number' } };

const header = async (sock, isOwner = true) => {
  let out = '';
  await menu.run({ reply: async (t) => { out = t; }, commandList: handler.commandList || [], prefix: '.', args: [], isOwner, isAdmin: false, timing: {}, sock, jid: OWNER, msg: {} });
  return out.split('╚═')[0];
};
const reset = () => { delete ownername.js.data.custom; delete ownername.js.data.detected; };

test('v1.4.3: the menu header shows the owner name that WhatsApp gives for the bot account', async () => {
  reset();
  const head = await header(own('Nelson FX'));
  assert.match(head, /👑 \*[^*]+\* ▸ Nelson FX/);
  assert.ok(head.indexOf('👑') < head.indexOf('👤'), 'the owner is the first line under the title');
  assert.match(await header(own('Nelson FX'), false), /▸ Nelson FX/, 'members see it too');
});

test('v1.4.3: no name yet = no owner line (never a number); the name from the owner\'s own messages fills it in and is remembered', async () => {
  reset();
  const sock = own(undefined);
  assert.ok(!/👑/.test(await header(sock)), 'nothing is shown until WhatsApp tells the name');
  ownername.learn(sock, { key: { fromMe: true, remoteJid: '27811110099@s.whatsapp.net' }, pushName: 'Nelson FX' });
  assert.match(await header(sock), /▸ Nelson FX/);
  assert.match(await header(own(undefined)), /▸ Nelson FX/, 'remembered when WhatsApp does not give it again');
  ownername.learn(sock, { key: { fromMe: true }, pushName: '27800000001' });
  assert.match(await header(sock), /▸ Nelson FX/, 'a name that is only a number is ignored');
});

test('v1.4.3: when the bot runs on another number, the owner\'s own WhatsApp name is used (not the bot account name)', async () => {
  reset();
  assert.ok(!/👑/.test(await header(other)), 'the name of the bot number is never shown as the owner');
  names.learnMessage({ key: { remoteJid: OWNER, fromMe: false }, pushName: 'Nelson FX' });
  assert.match(await header(other), /▸ Nelson FX/);
  ownername.learn(other, { key: { fromMe: true }, pushName: 'The Bot Number' }); // a bot-number message must not become the owner's name
  reset();
  assert.match(await header(other), /▸ Nelson FX/);
});

test('v1.4.3: ownername shows, sets and resets the name; the handler learns it from the owner\'s messages', async () => {
  reset();
  const lines = [];
  const run = (args) => ownerCmd.run({ sock: own('Nelson FX'), args, rest: args.join(' '), reply: async (t) => lines.push(t), prefix: '.' });
  await run([]);
  assert.match(lines.at(-1), /Nelson FX[\s\S]*from WhatsApp/);
  await run(['set', 'Boss', 'Nel']);
  assert.match(lines.at(-1), /\*Boss Nel\*/);
  assert.match(await header(own('Nelson FX')), /▸ Boss Nel/, 'the name set by the owner wins');
  await run(['auto']);
  assert.match(await header(own('Nelson FX')), /▸ Nelson FX/);
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'whatsapp', 'handler.js'), 'utf8');
  assert.match(src, /ownername\.learn\(sock, msg\)/);
});
