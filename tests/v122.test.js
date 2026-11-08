// v1.2.2: rules without the 1500 limit, a puzzle for small children, and a chatbot that can tell chat from bot questions.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const knowledge = require('../whatsapp/botknowledge');
const store = require('../whatsapp/store');
const captcha = require('../whatsapp/captcha');

const all = [].concat(...fs.readdirSync(path.join(__dirname, '..', 'commands')).filter((f) => f.endsWith('.js')).map((f) => require(`../commands/${f}`)));
const ask = (question, extra = {}) => knowledge.forQuestion({ question, commandList: all, isOwner: false, ...extra });

test('setrules: long rules are saved (no 1500 character limit)', async () => {
  const cmd = require('../commands/rules').find((c) => c.name === 'setrules');
  const G = '120363000000000122@g.us';
  const replies = [];
  const long = 'Rule: be kind and respectful to everybody in this group.\n'.repeat(200); // about 11,000 characters
  await cmd.run({ jid: G, msg: {}, rest: long, reply: async (t) => replies.push(t), prefix: '.' });
  assert.match(replies.at(-1), /Rules saved/);
  assert.strictEqual(store.getGroup(G).rules.length, long.trim().length);
  const huge = 'x'.repeat(70000);
  await cmd.run({ jid: G, msg: {}, rest: huge, reply: async (t) => replies.push(t), prefix: '.' });
  assert.match(replies.at(-1), /too long for one message/);
});

test('the puzzle for new members is written for a small child', async () => {
  const sent = [];
  const sock = { sendMessage: async (jid, c) => { sent.push(c.text); return {}; }, groupParticipantsUpdate: async () => [] };
  const G = '120363000000000123@g.us';
  const kid = '27822220001@s.whatsapp.net';
  await captcha.onJoin(sock, G, [kid], { captcha: true, captchaSeconds: 120 });
  const q = sent.at(-1);
  assert.match(q, /Quick puzzle/);
  assert.match(q, /fingers/);
  assert.match(q, /only the answer number/);
  assert.match(q, /2 minutes/);
  const [, a, b] = /\*(\d+) \+ (\d+) = \?\*/.exec(q);
  const msg = (t) => ({ key: { remoteJid: G, participant: kid, id: `K${Math.random()}` }, message: { conversation: t } });
  const wrong = String(Number(a) + Number(b) + 1);
  captcha.check(sock, msg(wrong), G, wrong, []);
  assert.match(sent.at(-1), /Oops, not quite[\s\S]*2 tries left/);
  const right = String(Number(a) + Number(b));
  captcha.check(sock, msg(right), G, right, []);
  assert.match(sent.at(-1), /Yay, you did it/);
});

test('normal chat gets no command talk; real bot questions still do', () => {
  const casual = [
    'hello how are you today',
    'I want to play football later, the weather looks good',
    'can you tell me a joke',
    'my help is needed with my homework, what is photosynthesis',
    'I will kick off the party at 5, who is coming',
    'what is the capital of France',
    'send me a sticker of your feelings lol',
  ];
  for (const q of casual) {
    const text = ask(q);
    assert.ok(!/COMMANDS THAT FIT|BOT KNOWLEDGE|ALL .* COMMANDS|CATEGORIES \(/.test(text), `no command list for: ${q}`);
    assert.match(text, /Do NOT mention bot commands/);
  }
  const botQuestions = ['how do I make a sticker?', 'what commands does the bot have?', 'what can you do?', 'how do I kick someone from the group?', 'how do I use the menu'];
  for (const q of botQuestions) assert.match(ask(q), /BOT KNOWLEDGE/, `bot knowledge for: ${q}`);
  assert.match(ask('how do I make a sticker?'), /\.sticker/);
});

test('captcha message: admins can set their own "verified" message', async () => {
  const cmd = require('../commands/groupextras2').find((c) => c.name === 'captcha');
  const G = '120363000000000124@g.us';
  const replies = [];
  const run = (rest) => cmd.run({ jid: G, args: rest.split(' '), rest, reply: async (t) => replies.push(t), prefix: '.', isBotAdmin: true });
  await run('message Well done @user! Welcome to the family 🎉');
  assert.match(replies.at(-1), /Message saved/);
  assert.strictEqual(captcha.verifiedText(G, '27833330001@s.whatsapp.net'), 'Well done @27833330001! Welcome to the family 🎉');
  await run('message Welcome aboard!');
  assert.strictEqual(captcha.verifiedText(G, '27833330001@s.whatsapp.net'), '@27833330001\nWelcome aboard!', 'the member is always tagged');
  await run('message reset');
  assert.match(captcha.verifiedText(G, '27833330001@s.whatsapp.net'), /Yay, you did it/);
  // it is what the new member sees after a right answer
  await run('message Great job @user!');
  const sent = [];
  const sock = { sendMessage: async (j, c) => { sent.push(c.text); return {}; }, groupParticipantsUpdate: async () => [] };
  const kid = '27833330002@s.whatsapp.net';
  await captcha.onJoin(sock, G, [kid], { captcha: true, captchaSeconds: 60 });
  const [, a, b] = /\*(\d+) \+ (\d+) = \?\*/.exec(sent.at(-1));
  const right = String(Number(a) + Number(b));
  captcha.check(sock, { key: { remoteJid: G, participant: kid, id: 'Z1' }, message: { conversation: right } }, G, right, []);
  assert.strictEqual(sent.at(-1), 'Great job @27833330002!');
});
