// Helper for tests/persistence.test.js. It is NOT a test: it is started as a separate process ("a bot run"), does one job
// against the data folder in TURBOFEX_DATA, prints a JSON line, and then stops in the way the test asks
// (exit, SIGTERM like a panel, or SIGKILL like a crash).
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.CONSOLE_CHAT = 'off';
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || '27800000001';
const [action, how = 'exit', arg = ''] = process.argv.slice(2);
require(path.join(ROOT, 'core/flush')).installSignals();

const GROUP = '120363000000000001@g.us';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

async function leave() {
  if (how === 'exit') process.exit(0);
  if (how === 'term') {
    process.kill(process.pid, 'SIGTERM');
    await wait(5000);
  }
  if (how === 'kill') process.kill(process.pid, 'SIGKILL');
  if (how === 'kill-late') {
    await wait(1700); // longer than the save delay of the money and settings files
    process.kill(process.pid, 'SIGKILL');
  }
  if (how === 'end') return; // just finish: the exit hook writes everything
}

const makeSock = () => {
  const EventEmitter = require('events');
  const ws = new EventEmitter();
  const log = [];
  const sock = {
    ws, user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
    sendReceipt: async () => { log.push('view'); }, readMessages: async () => {},
    sendMessage: async (to, c, o) => {
      log.push(to === 'status@broadcast' ? 'like' : 'direct');
      setTimeout(() => ws.emit(`CB:ack,id:${o.messageId}`, { attrs: {} }), 2);
      return { key: { id: o.messageId } };
    },
  };
  return { sock, log };
};
const post = (id) => ({ key: { remoteJid: 'status@broadcast', id, participant: '222488650874994@lid', fromMe: false }, message: { imageMessage: {} }, messageTimestamp: Math.floor(Date.now() / 1000) });

(async () => {
  const store = require(path.join(ROOT, 'whatsapp/store'));
  if (action === 'settings-set') {
    store.setMode('public');
    store.setPrefix('#');
    store.setAuto('autotyping', true);
    store.setAuto('apikeys', { gemini: 'k-123' });
    store.setRegion('Africa/Lagos');
    store.updateStatusCfg((s) => { s.view = true; s.like = true; s.dailyLikeLimit = 5; s.emojis = ['🔥']; });
    store.update(GROUP, (g) => { g.antilinkMode = 'kick'; g.warnLimit = 7; g.welcomeText = 'hi there'; g.welcome = true; g.slowmode = 30; g.badWords = ['bad']; });
    store.addWarning(GROUP, '27811111111@s.whatsapp.net');
    store.addWarning(GROUP, '27811111111@s.whatsapp.net');
    store.addSudo('27822222222');
    store.addReminder({ jid: GROUP, who: '27811111111@s.whatsapp.net', ids: ['27811111111'], at: Date.now() + 3600000, text: 'call mum' });
    store.addSchedule({ jid: GROUP, time: '09:30', text: 'good morning', repeat: { kind: 'daily' } });
    store.afkSet(['27833333333'], 'gym');
    out({ ok: true });
  } else if (action === 'settings-get') {
    const g = store.getGroup(GROUP);
    const s = store.statusCfg();
    out({
      mode: store.getMode(), prefix: store.effectivePrefix(), typing: store.getAuto('autotyping'), key: store.getApiKey('gemini'), region: store.getRegion(),
      limit: s.dailyLikeLimit, like: s.like, view: s.view, emojis: s.emojis,
      antilink: g.antilinkMode, warnLimit: g.warnLimit, welcomeText: g.welcomeText, welcome: g.welcome, slowmode: g.slowmode, bad: g.badWords,
      warnings: store.getWarnings(GROUP, '27811111111@s.whatsapp.net'), sudo: store.getSudo(),
      reminders: store.reminders().map((r) => r.text), schedules: store.schedules().map((x) => x.text), afk: !!store.afkGet(['27833333333']),
    });
  } else if (action === 'status-run') {
    const status = require(path.join(ROOT, 'whatsapp/status'));
    status.settings.likeGapMs = 0;
    const baileys = require(path.join(ROOT, 'core/baileys'));
    baileys.setForTests({ generateMessageIDV2: () => `ID${Math.random().toString(36).slice(2, 10).toUpperCase()}` });
    store.updateStatusCfg((s) => { s.view = true; s.like = true; s.dailyLikeLimit = 5; s.delayMin = 0; s.delayMax = 0; });
    const { sock, log } = makeSock();
    const ids = String(arg).split(',').filter(Boolean);
    for (const id of ids) await status.handleStatus(sock, post(id));
    await wait(2500 + ids.length * 250);
    out({ likeToday: status.likeToday(), liked: status.stats.liked, viewed: status.stats.viewed, seen: status.stats.seen, limited: status.stats.limited, likesSent: log.filter((x) => x === 'like').length, viewsSent: log.filter((x) => x === 'view').length });
  } else if (action === 'status-get') {
    const status = require(path.join(ROOT, 'whatsapp/status'));
    out({ likeToday: status.likeToday(), liked: status.stats.liked, viewed: status.stats.viewed, seen: status.stats.seen, limit: store.statusCfg().dailyLikeLimit, history: status.history(50).length });
  } else if (action === 'counters') {
    const activity = require(path.join(ROOT, 'whatsapp/activity'));
    const budget = require(path.join(ROOT, 'whatsapp/budget'));
    const seen = require(path.join(ROOT, 'whatsapp/seen'));
    const levels = require(path.join(ROOT, 'whatsapp/levels'));
    const A = require(path.join(ROOT, 'core/realm/aurum'));
    for (let i = 0; i < 25; i++) activity.count(GROUP, '27811111111@s.whatsapp.net');
    budget.setLimit('p1', 500);
    budget.add('p1', 'out', 40, 'bread');
    seen.check('chat', 'MSG1');
    seen.check('chat', 'MSG2');
    levels.award(GROUP, '27811111111@s.whatsapp.net');
    A.add(GROUP, '27811111111@s.whatsapp.net', 777);
    out({ ok: true });
  } else if (action === 'counters-get') {
    const activity = require(path.join(ROOT, 'whatsapp/activity'));
    const budget = require(path.join(ROOT, 'whatsapp/budget'));
    const seen = require(path.join(ROOT, 'whatsapp/seen'));
    const levels = require(path.join(ROOT, 'whatsapp/levels'));
    const A = require(path.join(ROOT, 'core/realm/aurum'));
    out({
      msgs: activity.total(GROUP), limit: budget.month('p1').limit, spent: budget.month('p1').spent,
      seen1: seen.check('chat', 'MSG1'), seen3: seen.check('chat', 'MSG3'),
      xp: (levels.statsOf(GROUP, '27811111111@s.whatsapp.net') || {}).xp, coins: A.balance(GROUP, '27811111111@s.whatsapp.net'),
    });
  } else if (action === 'add-coins') {
    const A = require(path.join(ROOT, 'core/realm/aurum'));
    A.add(GROUP, '27811111111@s.whatsapp.net', Number(arg) || 1);
    out({ coins: A.balance(GROUP, '27811111111@s.whatsapp.net') });
  } else if (action === 'unannounced') {
    // changes the data WITHOUT calling touch(): the safety net must still save it
    const js = require(path.join(ROOT, 'core/jsonstore')).open('notes', {});
    js.data.person = { notes: [{ t: 'remember', at: 1 }], todos: [] };
    out({ ok: true });
  } else if (action === 'unannounced-get') {
    const js = require(path.join(ROOT, 'core/jsonstore')).open('notes', {});
    out({ note: js.data.person && js.data.person.notes[0].t });
  } else if (action === 'captcha-open') {
    const captcha = require(path.join(ROOT, 'whatsapp/captcha'));
    const sent = [];
    const sock = { sendMessage: async (to, c) => { sent.push(c.text); }, groupParticipantsUpdate: async () => {} };
    await captcha.onJoin(sock, GROUP, ['27844444444@s.whatsapp.net'], { captcha: true, captchaSeconds: 300 });
    out({ pending: captcha.pending.size });
  } else if (action === 'captcha-get') {
    const captcha = require(path.join(ROOT, 'whatsapp/captcha'));
    captcha.resume({ sendMessage: async () => {}, groupParticipantsUpdate: async () => {} });
    out({ pending: captcha.pending.size });
    for (const v of captcha.pending.values()) clearTimeout(v.timer);
  } else if (action === 'chat-memory-set') {
    const chatbot = require(path.join(ROOT, 'whatsapp/chatbot'));
    const js = require(path.join(ROOT, 'core/jsonstore')).open('chatbot-memory', { chats: {} });
    js.data.chats.c1 = [{ role: 'user', content: 'hello' }];
    js.touch();
    out({ ok: !!chatbot });
  } else if (action === 'chat-memory-get') {
    const js = require(path.join(ROOT, 'core/jsonstore')).open('chatbot-memory', { chats: {} });
    out({ c1: js.data.chats.c1 && js.data.chats.c1[0].content });
  } else {
    out({ error: `unknown action ${action}` });
  }
  await leave();
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
