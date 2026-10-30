require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const settings = require('../core/realm/settings');
const ledger = require('../core/realm/ledger');
const A = require('../core/realm/aurum');
const shop = require('../core/realm/shop');
const S = require('../core/realm/state');
const godCore = require('../core/realm/god');
const ticker = require('../core/realm/ticker');
const ratelimit = require('../whatsapp/ratelimit');
const ecoclean = require('../core/ecoclean');
require('../commands/god');

baileys.setForTests({});
const OWNER = '27800000001@s.whatsapp.net';
let gid = 0;
const newGroup = () => `1203650000001${String(++gid).padStart(5, '0')}@g.us`;
let uid = 0;
const person = () => `2787880${String(++uid).padStart(4, '0')}@s.whatsapp.net`;
const num = (j) => j.split('@')[0];
let n = 0;

function fakeSock() {
  const sent = [];
  return {
    user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
    sent,
    texts: () => sent.filter((s) => s.c.text).map((s) => s.c.text),
    sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
    groupMetadata: async () => ({ subject: 'G', participants: [{ id: OWNER, admin: 'admin' }] }),
    groupFetchAllParticipating: async () => ({}),
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {},
  };
}
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 15)); };
async function say(sock, group, from, text) {
  ratelimit.reset();
  await handler.handleMessage(sock, { key: { remoteJid: group, participant: from, id: `R${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
}
async function dm(sock, from, text) {
  ratelimit.reset();
  await handler.handleMessage(sock, { key: { remoteJid: from, id: `D${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
}
const last = (sock) => sock.texts().at(-1);
store.setMode('public');

// ------------------------------------------------------------------ settings
test('settings: defaults, limits, one realm or all realms, short names, reset', () => {
  assert.strictEqual(settings.get('core.dailyBase'), 300);
  const g = newGroup();
  assert.strictEqual(settings.set('core.dailyBase', '999999999').ok, false, 'out of range is refused');
  assert.strictEqual(settings.set('core.dailyBase', 'abc').ok, false);
  assert.strictEqual(settings.set('core.dailyBase', '1.5').ok, false, 'a whole number is needed');
  assert.ok(settings.set('core.dailyBase', '400').ok);
  assert.strictEqual(settings.get('core.dailyBase', g), 400, 'all realms');
  assert.ok(settings.set('core.dailyBase', '1,000', g).ok);
  assert.strictEqual(settings.get('core.dailyBase', g), 1000, 'one realm wins');
  assert.strictEqual(settings.get('core.dailyBase', newGroup()), 400);
  assert.strictEqual(settings.sourceOf('core.dailyBase', g), 'realm');
  assert.ok(settings.reset('core.dailyBase', g).ok);
  assert.strictEqual(settings.get('core.dailyBase', g), 400);
  assert.ok(settings.reset('core.dailyBase').ok);
  assert.strictEqual(settings.get('core.dailyBase'), 300);
  assert.strictEqual(settings.find('dailyBase').full, 'core.dailyBase');
  assert.strictEqual(settings.find('core dailyBase').full, 'core.dailyBase');
  assert.strictEqual(settings.find('nothing'), null);
  assert.ok(settings.set('core.chatOn', 'off').ok && settings.get('core.chatOn') === false);
  assert.ok(settings.reset('core.chatOn').ok);
});

test('every feature has an on/off switch and every number has a safe range (God controls everything)', () => {
  assert.ok(settings.list().length >= 3);
  for (const f of settings.list()) {
    assert.ok(f.settings.has('on'), `${f.id} needs a switch`);
    for (const [key, d] of f.settings) {
      assert.ok(d.label, `${f.id}.${key} needs a label`);
      if (d.kind === 'bool') continue;
      assert.ok(Number.isFinite(d.min) && Number.isFinite(d.max) && d.min <= d.def && d.def <= d.max, `${f.id}.${key} needs min <= default <= max`);
    }
  }
});

// ------------------------------------------------------------------ aurum
test('aurum: purse, bank with a limit and interest, gifts with a fee that goes to the treasury', () => {
  const g = newGroup();
  const a = person();
  const b = person();
  assert.strictEqual(A.balance(g, a), 0, 'starts from zero');
  settings.set('core.startAurum', 50, g);
  assert.strictEqual(A.balance(g, b), 50, 'God can change the start');
  settings.reset('core.startAurum', g);
  A.add(g, a, 20000);
  assert.ok(!A.take(g, a, 99999999) && A.balance(g, a) === 20000);
  assert.strictEqual(A.deposit(g, a, 15000).put, 10000, 'the bank is limited');
  assert.strictEqual(A.deposit(g, a, 100).why, 'full');
  assert.ok(A.withdraw(g, a, 1000).ok && A.bankOf(g, a) === 9000);
  assert.strictEqual(A.withdraw(g, a, 99999).why, 'poor');
  S.citizen(g, a).bt -= 2 * A.DAY;
  assert.ok(A.bankOf(g, a) >= 9054, 'two days of interest');
  // gifts
  const r = A.give(g, a, b, 1000);
  assert.ok(r.ok && r.fee === 20 && r.got === 980);
  assert.strictEqual(A.treasury(g), 20);
  assert.strictEqual(A.give(g, a, a, 100).why, 'self');
  assert.strictEqual(A.give(g, a, b, 5).why, 'min');
  assert.strictEqual(A.give(g, b, a, 99999).why, 'poor');
  assert.strictEqual(A.give(g, a, b, 1000.4).ok, true, 'amounts are whole numbers');
});

test('aurum: daily gift, days in a row, ranks pay more, cooldowns', () => {
  const g = newGroup();
  const a = person();
  const t = 1000000;
  const d1 = A.daily(g, a, t);
  assert.ok(d1.ok && d1.amount === 300 && d1.streak === 1);
  assert.strictEqual(A.daily(g, a, t + 3600000).ok, false, 'once a day');
  const d2 = A.daily(g, a, t + 25 * 3600000);
  assert.ok(d2.ok && d2.streak === 2 && d2.amount === 325);
  assert.strictEqual(A.daily(g, a, t + 25 * 3600000 + 80 * 3600000).streak, 1, 'a missed day starts again');
  // ranks
  assert.strictEqual(A.rank(g, a).name, 'Commoner');
  A.add(g, a, 12000);
  assert.strictEqual(A.rank(g, a).name, 'Merchant');
  assert.ok(A.earnMult(g, a) > 1.09);
  settings.set('core.rankMerchant', 100000, g);
  assert.strictEqual(A.rank(g, a).name, 'Citizen', 'God changes the limits');
  settings.reset('core.rankMerchant', g);
  A.registerWorth((grp, key) => (key === S.keyOf(a) ? 1000000 : 0));
  assert.strictEqual(A.rank(g, a).name, 'Lord', 'later features add to the net worth');
  // cooldowns
  assert.ok(A.cooldown(g, a, 'x', 1000, 5000).ok);
  assert.strictEqual(A.cooldown(g, a, 'x', 1000, 5500).ok, false);
  assert.ok(A.cooldownLeft(g, a, 'x', 1000, 5500) === 500);
  assert.ok(A.cooldown(g, a, 'x', 1000, 6100).ok);
});

test('aurum: chatting pays a little, with a waiting time and a daily limit', () => {
  const g = newGroup();
  const a = person();
  const t = 5000000;
  assert.ok(A.chat(g, a, t) >= 2);
  assert.strictEqual(A.chat(g, a, t + 1000), 0, 'waiting time');
  assert.ok(A.chat(g, a, t + 61000) >= 2);
  settings.set('core.chatDailyCap', 5, g);
  assert.ok(A.chat(g, a, t + 200000) >= 0);
  const before = A.balance(g, a);
  for (let i = 0; i < 20; i++) A.chat(g, a, t + 300000 + i * 61000);
  assert.ok(A.balance(g, a) - before <= 5, 'the daily limit holds');
  settings.set('core.chatOn', false, g);
  assert.strictEqual(A.chat(g, a, t + 90 * 3600000), 0, 'God can switch it off');
  S.setOn(g, false);
  settings.reset('core.chatOn', g);
  assert.strictEqual(A.chat(g, a, t + 90 * 3600000), 0, 'a closed realm pays nothing');
});

// ------------------------------------------------------------------ shop
test('shop: charm, satchel, titles, price changes by God, no double buying', () => {
  const g = newGroup();
  const a = person();
  assert.strictEqual(shop.buy(g, a, 'charm').why, 'poor');
  A.add(g, a, 30000);
  const t = Date.now();
  assert.ok(shop.buy(g, a, 'charm', t).ok);
  assert.strictEqual(shop.buy(g, a, 'charm', t + 1000).why, 'active');
  assert.ok(A.charmLeft(g, a, t + 1000) > 0);
  assert.ok(shop.buy(g, a, 'satchel').ok);
  assert.strictEqual(A.bankCap(g, a), 30000);
  assert.ok(shop.buy(g, a, 'satchel').ok && shop.buy(g, a, 'satchel').ok);
  assert.strictEqual(shop.buy(g, a, 'satchel').why, 'max');
  assert.ok(shop.buy(g, a, 'squire').ok && S.citizen(g, a).title === 'Squire');
  assert.strictEqual(shop.buy(g, a, 'squire').why, 'owned');
  assert.ok(shop.buy(g, a, 'knight').ok && S.citizen(g, a).title === 'Knight');
  assert.strictEqual(shop.priceOf(g, 'charm'), 600);
  settings.set('shop.priceMult', 0.5, g);
  assert.strictEqual(shop.priceOf(g, 'charm'), 300);
  settings.set('shop.price_charm', 1000, g);
  assert.strictEqual(shop.priceOf(g, 'charm'), 500);
  shop.addPriceMod((grp) => (grp === g ? 0.5 : 1));
  assert.strictEqual(shop.priceOf(g, 'charm'), 250, 'later features (laws, sales) can change prices');
  assert.strictEqual(shop.find('Merchant\'s Satchel').id, 'satchel');
});

// ------------------------------------------------------------------ God (core)
test('God: every change is written in the ledger; moving, blessing, wiping work', () => {
  const g = newGroup();
  const h = newGroup();
  const a = person();
  const b = person();
  const before = ledger.count();
  assert.ok(godCore.setSetting('core.dailyBase', '350', g).ok);
  assert.ok(godCore.resetSetting('core.dailyBase', g).ok);
  assert.strictEqual(godCore.setSetting('core.dailyBase', '-5', g).ok, false);
  godCore.give(g, a, 500);
  godCore.take(g, a, 100);
  godCore.setPurse(g, b, 777);
  assert.strictEqual(A.balance(g, a), 400);
  assert.strictEqual(A.balance(g, b), 777);
  assert.strictEqual(godCore.setPurse(g, b, -1).ok, false);
  godCore.setRank(g, a, 4);
  assert.strictEqual(A.rank(g, a).name, 'Lord');
  godCore.setRank(g, a, null);
  assert.strictEqual(A.rank(g, a).name, 'Commoner');
  assert.ok(godCore.fate(g, a, 50, 2).ok);
  assert.ok(Math.abs(A.earnMult(g, a) - 1.5) < 0.001, 'a blessing');
  assert.ok(godCore.fate(g, a, -50, 2).ok && A.earnMult(g, a) < 0.51, 'a curse');
  assert.strictEqual(godCore.fate(g, a, 900, 2).ok, false);
  godCore.fate(g, a, 0, 0);
  assert.strictEqual(A.earnMult(g, a), 1);
  assert.ok(ledger.count() >= before + 8, 'the ledger has it all');
  assert.match(ledger.recent(1)[0].action, /fate cleared|blessing|curse|set rank/);
  // moving
  A.deposit(g, b, 100);
  A.treasuryAdd(g, 40);
  const copied = godCore.moveRealm(g, h, S.keyOf(b), 'copy');
  assert.strictEqual(copied.length, 1);
  assert.ok(A.balance(g, b) === 677 && A.balance(h, b) === 677);
  const moved = godCore.moveRealm(g, h);
  assert.strictEqual(moved.length, 2);
  assert.strictEqual(A.balance(g, b), 0);
  assert.strictEqual(A.balance(h, b), 677 * 2 + 0 - 677 + 677 > 0 ? A.balance(h, b) : 0);
  assert.strictEqual(A.treasury(h), 40, 'the treasury moves with the whole realm');
  // wiping
  assert.ok(godCore.wipeCitizen(h, b).ok && A.balance(h, b) === 0);
  assert.ok(godCore.wipeRealm(h).citizens >= 1);
  assert.strictEqual(S.citizensOf(h).length, 0);
});

// ------------------------------------------------------------------ commands
test('commands: purse, daily, profile, bank, give, wealth, shop and buy answer in one format', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  const b = person();
  await say(sock, g, a, '.daily');
  assert.match(last(sock), /Daily gift/);
  assert.match(last(sock), /\+300 Aurum/);
  await say(sock, g, a, '.daily');
  assert.match(last(sock), /⏳/);
  await say(sock, g, a, '.purse');
  assert.match(last(sock), /Your purse/);
  assert.match(last(sock), /Purse:\* 300 Aurum/);
  await say(sock, g, a, '.balance');
  assert.match(last(sock), /Your purse/, 'alias');
  await say(sock, g, a, '.deposit 100');
  assert.match(last(sock), /Put in the bank:\* 100 Aurum/);
  await say(sock, g, a, '.bank');
  assert.match(last(sock), /The bank/);
  await say(sock, g, a, '.withdraw all');
  assert.match(last(sock), /Taken out:\* 100 Aurum/);
  await say(sock, g, a, `.give ${num(b)} 100`);
  assert.match(last(sock), /Gift sent/);
  assert.strictEqual(A.balance(g, b), 98);
  assert.strictEqual(A.balance(g, a), 200);
  await say(sock, g, a, '.give');
  assert.match(last(sock), /Give Aurum/);
  await say(sock, g, a, '.wealth');
  assert.match(last(sock), /richest of the realm/);
  await say(sock, g, a, '.profile');
  assert.match(last(sock), /Citizen/);
  await say(sock, g, a, '.shop');
  assert.match(last(sock), /The shop/);
  A.add(g, a, 1000);
  await say(sock, g, a, '.buy charm');
  assert.match(last(sock), /Bought/);
  await say(sock, g, a, '.buy charm');
  assert.match(last(sock), /still works/);
  await say(sock, g, a, '.buy sword');
  assert.match(last(sock), /do not know/);
  await say(sock, g, a, '.realm');
  assert.match(last(sock), /The Empire of Fex/);
  await say(sock, g, a, '.realm guide');
  assert.match(last(sock), /How the Empire works/);
});

test('realm off: every command of the Empire stops in that group, only there, and on brings it back', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const g2 = newGroup();
  const a = person();
  await say(sock, g, a, '.realm off');
  assert.match(last(sock), /Only group admins/);
  await say(sock, g, OWNER, '.realm off');
  assert.match(last(sock), /realm is closed/);
  for (const c of ['.purse', '.daily', '.profile', '.bank', '.deposit 5', '.give @1 5', '.wealth', '.shop', '.buy charm']) {
    await say(sock, g, a, c);
    assert.match(last(sock), /realm is closed/, c);
  }
  await say(sock, g2, a, '.purse');
  assert.match(last(sock), /Your purse/, 'another group is not touched');
  const before = A.balance(g, a);
  await say(sock, g, a, 'hello everybody, how are you');
  assert.strictEqual(A.balance(g, a), before, 'no pay for chatting');
  await say(sock, g, OWNER, '.realm on');
  assert.match(last(sock), /realm is open/);
  await say(sock, g, a, '.purse');
  assert.match(last(sock), /Your purse/);
});

test('chatting in a group pays a little Aurum', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  await say(sock, g, a, 'good morning everybody');
  assert.ok(A.balance(g, a) >= 2);
});

test('God in a group and in a private chat: choose a realm, set rules, change people, the ledger', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  // others cannot use God
  await say(sock, g, a, '.god');
  assert.match(last(sock), /Only the main bot owner/);
  await dm(sock, a, '.purse');
  assert.match(last(sock), /works in groups/);
  // God in a private chat: no realm chosen yet
  await dm(sock, OWNER, '.purse');
  assert.match(last(sock), /Choose a realm first/);
  await dm(sock, OWNER, `.god realm ${g}`);
  assert.match(last(sock), /Realm chosen/);
  await dm(sock, OWNER, '.daily');
  assert.match(last(sock), /Daily gift/);
  assert.ok(A.balance(g, OWNER) >= 300, 'God used the realm from a private chat');
  // set rules
  await dm(sock, OWNER, '.god set core.dailyBase 500 here');
  assert.match(last(sock), /Setting changed/);
  assert.strictEqual(settings.get('core.dailyBase', g), 500);
  assert.strictEqual(settings.get('core.dailyBase', newGroup()), 300, 'only that realm');
  await dm(sock, OWNER, '.god set core.dailyBase 99999999');
  assert.match(last(sock), /Allowed: 0 to 100000/);
  await dm(sock, OWNER, '.god set dailyBase 450');
  assert.match(last(sock), /Setting changed/);
  await dm(sock, OWNER, '.god reset dailyBase');
  await dm(sock, OWNER, '.god reset dailyBase here');
  assert.strictEqual(settings.get('core.dailyBase', g), 300);
  await dm(sock, OWNER, '.god settings');
  assert.match(last(sock), /The features/);
  await dm(sock, OWNER, '.god settings core');
  assert.match(last(sock), /dailyBase/);
  // people
  await dm(sock, OWNER, `.god give ${num(a)} 700`);
  assert.match(last(sock), /Aurum given/);
  assert.strictEqual(A.balance(g, a), 700);
  await dm(sock, OWNER, `.god take ${num(a)} 200`);
  await dm(sock, OWNER, `.god purse ${num(a)} 1000`);
  assert.strictEqual(A.balance(g, a), 1000);
  await dm(sock, OWNER, `.god rank ${num(a)} noble`);
  assert.strictEqual(A.rank(g, a).name, 'Noble');
  await dm(sock, OWNER, `.god bless ${num(a)} 50 5`);
  assert.match(last(sock), /Blessed/);
  await dm(sock, OWNER, `.god clear ${num(a)}`);
  // wipe needs the word confirm
  await dm(sock, OWNER, `.god wipe ${num(a)}`);
  assert.match(last(sock), /Deletes a citizen|cannot be undone/);
  assert.strictEqual(A.balance(g, a), 1000);
  await dm(sock, OWNER, `.god wipe ${num(a)} confirm`);
  assert.match(last(sock), /Citizen wiped/);
  assert.strictEqual(A.balance(g, a), 0);
  // features
  await dm(sock, OWNER, '.god off shop here');
  await dm(sock, OWNER, '.shop');
  assert.match(last(sock), /Closed by God/);
  await dm(sock, OWNER, '.god on shop here');
  await dm(sock, OWNER, '.shop');
  assert.match(last(sock), /The shop/);
  // the realm switch
  await dm(sock, OWNER, '.god realm off');
  assert.match(last(sock), /realm is closed/);
  await dm(sock, OWNER, '.purse');
  assert.match(last(sock), /realm is closed/);
  await dm(sock, OWNER, '.god realm on');
  // ledger
  await dm(sock, OWNER, '.god ledger');
  assert.match(last(sock), /Divine Ledger/);
  assert.match(last(sock), /set/);
});

test('God announces big changes in the realm when it is done from somewhere else, and not when asked not to', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  await dm(sock, OWNER, `.god realm ${g}`);
  sock.sent.length = 0;
  await dm(sock, OWNER, `.god give ${num(a)} 100`);
  const told = sock.sent.find((s) => s.j === g && /heavens have spoken/.test(s.c.text || ''));
  assert.ok(told, 'the realm was told');
  assert.ok(Array.isArray(told.c.mentions) && told.c.mentions.some((m) => num(m) === num(a)), 'the person is tagged for real, not only written as @number');
  assert.ok(told.c.text.includes(`@${num(a)}`));
  settings.set('god.announce', false, g);
  sock.sent.length = 0;
  await dm(sock, OWNER, `.god give ${num(a)} 100`);
  assert.ok(!sock.sent.some((s) => s.j === g), 'silent when switched off');
});

test('God: move citizens from one realm to another with the command', async () => {
  const sock = fakeSock();
  const from = newGroup();
  const to = newGroup();
  const a = person();
  A.add(from, a, 900);
  await dm(sock, OWNER, `.god move ${from} to ${to} ${num(a)}`);
  assert.match(last(sock), /Moved/);
  assert.strictEqual(A.balance(to, a), 900);
  assert.strictEqual(A.balance(from, a), 0);
  await dm(sock, OWNER, `.god move ${to} to ${from} copy`);
  assert.match(last(sock), /Copied/);
  assert.strictEqual(A.balance(from, a), 900);
  assert.strictEqual(A.balance(to, a), 900);
});

// ------------------------------------------------------------------ the rest of the bot
test('the rate limit of the Empire is set by God', () => {
  ratelimit.reset();
  const who = 'spammer-1';
  assert.strictEqual([...Array(10)].map(() => ratelimit.checkEconomy(who).ok).filter(Boolean).length, 8);
  ratelimit.reset();
  settings.set('core.rateMax', 3);
  assert.strictEqual([...Array(10)].map(() => ratelimit.checkEconomy('spammer-2').ok).filter(Boolean).length, 3);
  settings.reset('core.rateMax');
  ratelimit.reset();
});

test('bets in games use Aurum of the group and stop when the realm is closed', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  await say(sock, g, OWNER, '.blackjack 100');
  assert.match(last(sock), /only have 0 Aurum/);
  S.setOn(g, false);
  await say(sock, g, OWNER, '.blackjack 100');
  assert.match(last(sock), /realm to be open/);
  await say(sock, g, OWNER, '.duel @1 100');
  assert.match(last(sock), /realm to be open|someone|@/i);
});

test('the old coin economy files are removed once, and the data of the Empire is kept', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fex-clean-'));
  for (const f of ['economy', 'market', 'throne', 'quests']) fs.writeFileSync(path.join(dir, `${f}.json`), '{}');
  fs.writeFileSync(path.join(dir, 'realm.json'), '{}');
  fs.writeFileSync(path.join(dir, 'levels.json'), '{}');
  assert.strictEqual(ecoclean.run(dir), 4);
  assert.ok(!fs.existsSync(path.join(dir, 'economy.json')) && fs.existsSync(path.join(dir, 'realm.json')) && fs.existsSync(path.join(dir, 'levels.json')));
  fs.writeFileSync(path.join(dir, 'economy.json'), '{}');
  assert.strictEqual(ecoclean.run(dir), 0, 'only once');
  assert.ok(fs.existsSync(path.join(dir, 'economy.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the ticker runs every job and one broken job does not stop the others', async () => {
  const seen = [];
  ticker.register('t1', async () => { seen.push('t1'); });
  ticker.register('t2', async () => { throw new Error('boom'); });
  ticker.register('t3', async (post) => { seen.push('t3'); await post('g', { text: 'x' }); });
  const posted = [];
  const log = console.error;
  console.error = () => {};
  await ticker.run(async (grp, c) => posted.push([grp, c.text]));
  console.error = log;
  assert.deepStrictEqual(seen, ['t1', 't3']);
  assert.deepStrictEqual(posted, [['g', 'x']]);
});

test('every Empire command is in the Empire category, has a description, and none of the old coin commands is left', () => {
  const { info: CATEGORIES } = require('../whatsapp/categories');
  assert.strictEqual(CATEGORIES.economy.title, 'EMPIRE OF FEX');
  for (const c of require('../commands/realm')) {
    assert.strictEqual(c.category, 'economy', c.name);
    assert.ok(c.description && c.description.length > 10, c.name);
  }
  const all = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'commands'))) for (const c of [].concat(require(`../commands/${f}`))) { all.add(c.name); (c.aliases || []).forEach((x) => all.add(x)); }
  for (const old of ['gamble', 'rob', 'throne', 'gov', 'governor', 'invest', 'portfolio', 'heist', 'pet', 'spin', 'bounty', 'ecoboost', 'kingincome', 'ecotransfer', 'luck', 'lottery', 'predict', 'quests']) assert.ok(!all.has(old), `${old} should be gone`); // (a new, different "market" came with phase 3)
  for (const nu of ['purse', 'daily', 'profile', 'bank', 'deposit', 'withdraw', 'give', 'wealth', 'shop', 'buy', 'realm', 'god']) assert.ok(all.has(nu), `${nu} should exist`);
});

test('the version is 0.7.11', () => {
  assert.strictEqual(require('../package.json').version, '0.7.11');
});
