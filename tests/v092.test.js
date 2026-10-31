// v0.9.2: silent permissions, a clean .ping, a real .help, friendly errors, and documents that match the code
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const { groupByCategory } = require('../whatsapp/categories');

baileys.setForTests({});
const ROOT = path.join(__dirname, '..');
const OWNER = '27800000001@s.whatsapp.net';
const MEMBER = '27811111111@s.whatsapp.net';
const GROUP = '120363000000000092@g.us';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async () => ({ subject: 'G', participants: [{ id: '555000111@lid', phoneNumber: MEMBER }, { id: OWNER }] }),
};
let n = 0;
const gmsg = (who, text) => ({ key: { remoteJid: GROUP, participant: who, id: `Q${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
const texts = () => sent.filter((s) => s.c.text).map((s) => s.c.text);
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 60)); };
async function say(who, text) {
  sent.length = 0;
  await handler.handleMessage(sock, gmsg(who, text));
  await settle();
  return texts();
}
const allCommands = () => [].concat(...fs.readdirSync(path.join(ROOT, 'commands')).filter((f) => f.endsWith('.js')).map((f) => require(`../commands/${f}`)));

test('restricted commands: a member who is not allowed gets NO answer at all (admin, owner and main-owner commands)', async () => {
  store.setMode('public');
  for (const text of ['.kick @27822222222', '.tagall hello', '.antilink off', '.status', '.restart', '.update now', '.god', '.addsudo 27822222222', '.broadcast hi']) {
    const out = await say(MEMBER, text);
    assert.deepStrictEqual(out, [], `${text} stays silent for a member`);
  }
});

test('restricted commands: asking many times never produces a "slow down" or any other answer', async () => {
  store.setMode('public');
  let total = 0;
  for (let i = 0; i < 40; i += 1) total += (await say(MEMBER, '.status')).length;
  assert.strictEqual(total, 0);
});

test('restricted commands: a command that is only for a group (not private) stays silent for people who may not use it', async () => {
  store.setMode('public');
  sent.length = 0;
  await handler.handleMessage(sock, { key: { remoteJid: MEMBER, id: `Q${++n}`, fromMe: false }, message: { conversation: '.kick @27822222222' }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
  assert.deepStrictEqual(texts(), []);
});

test('restricted commands: the people who ARE allowed still get a normal answer', async () => {
  store.setMode('public');
  const owner = await say(OWNER, '.status');
  assert.ok(owner.some((t) => /Status/.test(t)), 'the owner sees the status');
  const ping = await say(MEMBER, '.ping');
  assert.ok(ping.some((t) => /Pong/.test(t)), 'everybody can ping in public mode');
});

test('restricted sub-actions inside commands are silent too (rank, delete, schedule a command)', async () => {
  store.setMode('public');
  for (const text of ['.rank off', '.rank on', '.delete', '.schedule daily 07:00 run ping']) {
    const out = await say(MEMBER, text);
    assert.ok(!out.some((t) => /Only (the )?(group )?(admins|bot owner|main)/i.test(t)), `${text} does not explain the restriction`);
  }
  assert.deepStrictEqual(await say(MEMBER, '.rank off'), []);
  assert.deepStrictEqual(await say(MEMBER, '.schedule daily 07:00 run ping'), []);
});

test('ping: one clear response time, no internal breakdown', async () => {
  store.setMode('public');
  const out = await say(MEMBER, '.ping');
  const text = out.join('\n');
  assert.match(text, /Pong/);
  assert.match(text, /Response time: \*?\d+ ms/);
  assert.ok(!/Bot:|WhatsApp:/i.test(text), 'no internal split');
});

test('help: a friendly guide for new people, no developer words; menu keeps the full list', async () => {
  store.setMode('public');
  assert.strictEqual(handler.resolveCommand('help').name, 'help');
  assert.strictEqual(handler.resolveCommand('menu').name, 'menu');
  const help = (await say(MEMBER, '.help')).join('\n');
  assert.match(help, /\.menu/);
  assert.match(help, /\.ping/);
  assert.ok(!/npm|config\.js|session_id|\.env|source code/i.test(help));
  assert.ok(!/status|\.mode public/.test(help), 'owner tips are only for the owner');
  const ownerHelp = (await say(OWNER, '.help')).join('\n');
  assert.match(ownerHelp, /bot owner/i);
});

test('menu: command help says who can use it, and unknown names are explained', async () => {
  store.setMode('public');
  const one = (await say(MEMBER, '.menu kick')).join('\n');
  assert.match(one, /KICK/);
  assert.match(one, /Group admins/);
  const none = (await say(MEMBER, '.menu nonsense')).join('\n');
  assert.match(none, /No command found/);
});

test('commands that need input explain what is missing and give an example with the real prefix', async () => {
  store.setMode('public');
  for (const name of ['trade', 'weather', 'define', 'translate', 'currency']) {
    const out = (await say(OWNER, `.${name}`)).join('\n');
    assert.ok(out.length > 20, `${name} answers`);
    assert.match(out, new RegExp(`\\.${name}|\\.[a-z]+ `), `${name} shows a command example`);
    assert.ok(!/undefined|Invalid input|\[object/i.test(out), `${name} has no vague error`);
  }
});

test('errors: members get a simple message, the owner gets the reason, nobody gets paths or stack traces', async () => {
  store.setMode('public');
  const cmd = handler.resolveCommand('coin');
  const original = cmd.run;
  const quiet = console.error;
  console.error = () => {};
  cmd.run = async () => { throw new Error('boom at /home/container/core/secret.js:12'); };
  try {
    const member = (await say(MEMBER, '.coin')).join('\n');
    assert.match(member, /Something went wrong/);
    assert.ok(!/boom|\/home|secret\.js|\n\s+at /.test(member), 'nothing internal for members');
    const owner = (await say(OWNER, '.coin')).join('\n');
    assert.match(owner, /Reason: boom/);
    assert.ok(!/\n\s+at /.test(owner), 'no stack trace');
  } finally {
    cmd.run = original;
    console.error = quiet;
  }
});

test('private mode: strangers still get no answer for anything, help included', async () => {
  store.setMode('private');
  try {
    assert.deepStrictEqual(await say(MEMBER, '.help'), []);
    assert.deepStrictEqual(await say(MEMBER, '.ping'), []);
  } finally {
    store.setMode('public');
  }
});

test('public README: the numbers match the code and the session ID wording matches the implementation', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const cmds = allCommands();
  const visible = cmds.filter((c) => !(c.ownerOnly || c.realOwnerOnly));
  const cats = groupByCategory(cmds, false).length;
  const m = readme.match(/<!--\s*counts:\s*(\d+)\s+commands,\s*(\d+)\s+categories\s*-->/);
  assert.ok(m, 'README carries a counts marker the test can check');
  assert.strictEqual(Number(m[1]), visible.length, 'command count matches the commands members can see');
  assert.strictEqual(Number(m[2]), cats, 'category count matches the menu members see');
  assert.ok(!/24 hours/i.test(readme), 'no 24 hour session wording');
  const site = fs.readFileSync(path.join(ROOT, 'core/sessionid.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'core/setup.js'), 'utf8');
  assert.match(site, /expires after 5 minutes/);
  assert.match(readme, /5 minutes/);
  for (const bad of ['npm install', 'config.env', 'CONSOLE_LINK', 'GitHub Actions', 'core/boot.js']) assert.ok(!readme.includes(bad), `the public README does not mention ${bad}`);
});

test('public README: no claims the code cannot prove', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(!/for months|without attention|every message with a link|every command reply|guarantee/i.test(readme));
});

test('PROJECT_GUIDE.md exists, covers the required topics and holds no secrets', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'PROJECT_GUIDE.md'), 'utf8');
  for (const topic of ['Architecture', 'Folder', 'Baileys', 'Pairing', 'Command', 'Permissions', 'Data storage', 'Environment variables', 'Error handling', 'Update', 'Testing', 'Deployment', 'Known limitations', 'Instructions for AI']) {
    assert.ok(new RegExp(topic, 'i').test(guide), `guide covers ${topic}`);
  }
  assert.ok(!/TFX-(?!XXXX|K7M2)[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(guide), 'no real-looking session ID');
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(guide.replace(/https?:\/\/\S+/g, '')), 'no long token-like strings');
});
