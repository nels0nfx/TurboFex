// Persistence and restart-recovery tests. Each "bot run" is a REAL separate process (tests/_persist_child.js) that is
// stopped in a different way (normal exit, SIGTERM like a panel, SIGKILL like a crash) and then started again on the same
// data folder, to prove that settings, counters, records and histories survive.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHILD = path.join(__dirname, '_persist_child.js');
const GROUP = '120363000000000001@g.us';
const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'turbofex-persist-'));
const cleanup = (d) => fs.rmSync(d, { recursive: true, force: true });

// one "bot run": returns what the child printed
function run(dir, action, how = 'exit', arg = '') {
  const r = spawnSync(process.execPath, [CHILD, action, how, arg], { env: { ...process.env, TURBOFEX_DATA: dir }, encoding: 'utf8', timeout: 60000 });
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  let json = null;
  try {
    json = JSON.parse(line);
  } catch (err) {
    json = null;
  }
  return { json, status: r.status, signal: r.signal, stderr: r.stderr };
}

const EXPECT_SETTINGS = {
  mode: 'public', prefix: '#', typing: true, key: 'k-123', region: 'Africa/Lagos', limit: 5, like: true, view: true, emojis: ['🔥'],
  antilink: 'kick', warnLimit: 7, welcomeText: 'hi there', welcome: true, slowmode: 30, bad: ['bad'], warnings: 2, sudo: ['27822222222'],
  reminders: ['call mum'], schedules: ['good morning'], afk: true,
};

for (const how of ['exit', 'term', 'kill', 'kill-late']) {
  test(`settings survive a restart (the first run stops with: ${how})`, () => {
    const dir = freshDir();
    try {
      const a = run(dir, 'settings-set', how);
      assert.ok(a.json && a.json.ok, `first run: ${a.stderr}`);
      if (how === 'kill') assert.strictEqual(a.signal, 'SIGKILL');
      const b = run(dir, 'settings-get');
      assert.deepStrictEqual(b.json, EXPECT_SETTINGS);
    } finally {
      cleanup(dir);
    }
  });
}

test('the status like limit of 5 and the likes already given today survive a restart (the reported bug)', () => {
  const dir = freshDir();
  try {
    const a = run(dir, 'status-run', 'exit', 's1,s2,s3');
    assert.strictEqual(a.json.likeToday, 3);
    assert.strictEqual(a.json.liked, 3);
    // the bot restarts: the counter must NOT go back to zero and the limit must still be 5
    const b = run(dir, 'status-get');
    assert.strictEqual(b.json.limit, 5);
    assert.strictEqual(b.json.likeToday, 3);
    assert.strictEqual(b.json.liked, 3);
    assert.strictEqual(b.json.seen, 3);
    assert.ok(b.json.history >= 3, 'the like history is kept');
    // 4 more arrive after the restart: only 2 more likes fit into the limit of 5, and all 4 are viewed
    const c = run(dir, 'status-run', 'exit', 's4,s5,s6,s7');
    assert.strictEqual(c.json.likeToday, 5);
    assert.strictEqual(c.json.likesSent, 2);
    assert.strictEqual(c.json.viewsSent, 4);
    assert.strictEqual(c.json.liked, 5);
    assert.ok(c.json.limited >= 2);
  } finally {
    cleanup(dir);
  }
});

test('the same status delivered again after a restart is neither viewed nor liked twice', () => {
  const dir = freshDir();
  try {
    run(dir, 'status-run', 'kill-late', 's1,s2');
    const again = run(dir, 'status-run', 'exit', 's1,s2');
    assert.strictEqual(again.json.likesSent, 0, 'no second like');
    assert.strictEqual(again.json.viewsSent, 0, 'no second view');
    assert.strictEqual(again.json.liked, 2, 'the total is not counted twice');
    assert.strictEqual(again.json.seen, 2);
  } finally {
    cleanup(dir);
  }
});

test('the status limit is not passed when many likes wait at the same time', () => {
  const dir = freshDir();
  try {
    const a = run(dir, 'status-run', 'exit', 'a1,a2,a3,a4,a5,a6,a7,a8,a9,a10');
    assert.strictEqual(a.json.likesSent, 5);
    assert.strictEqual(a.json.likeToday, 5);
  } finally {
    cleanup(dir);
  }
});

for (const how of ['exit', 'term', 'kill-late']) {
  test(`counters, money, levels, budgets and seen-lists survive and are not doubled (stop: ${how})`, () => {
    const dir = freshDir();
    try {
      run(dir, 'counters', how);
      const b = run(dir, 'counters-get', 'exit');
      assert.strictEqual(b.json.msgs, 25);
      assert.strictEqual(b.json.limit, 500);
      assert.strictEqual(b.json.spent, 40);
      assert.strictEqual(b.json.seen1, true, 'a handled message is still known');
      assert.strictEqual(b.json.seen3, false);
      assert.ok(b.json.xp >= 5, 'xp kept');
      assert.ok(b.json.coins >= 777, 'the money is kept');
      // a second restart changes nothing (no doubling)
      const c = run(dir, 'counters-get', 'exit');
      assert.strictEqual(c.json.msgs, 25);
      assert.strictEqual(c.json.spent, 40);
      assert.strictEqual(c.json.coins, b.json.coins);
    } finally {
      cleanup(dir);
    }
  });
}

test('money added right before a hard kill is saved within a fraction of a second', () => {
  const dir = freshDir();
  try {
    const a = run(dir, 'add-coins', 'kill-late', '100');
    const b = run(dir, 'counters-get', 'exit');
    assert.strictEqual(b.json.coins, a.json.coins);
  } finally {
    cleanup(dir);
  }
});

test('a feature that forgets to call touch() is still saved (safety net)', () => {
  const dir = freshDir();
  try {
    run(dir, 'unannounced', 'exit');
    assert.strictEqual(run(dir, 'unannounced-get').json.note, 'remember');
  } finally {
    cleanup(dir);
  }
});

test('open verification questions (captcha) continue after a restart', () => {
  const dir = freshDir();
  try {
    assert.strictEqual(run(dir, 'captcha-open', 'exit').json.pending, 1);
    assert.strictEqual(run(dir, 'captcha-get').json.pending, 1);
  } finally {
    cleanup(dir);
  }
});

test('the short chatbot conversation memory survives a restart', () => {
  const dir = freshDir();
  try {
    run(dir, 'chat-memory-set', 'term');
    assert.strictEqual(run(dir, 'chat-memory-get').json.c1, 'hello');
  } finally {
    cleanup(dir);
  }
});

// ----- damaged files -----
test('a half-written or empty groups.json is repaired from its backup copy, nothing resets', () => {
  const dir = freshDir();
  try {
    run(dir, 'settings-set', 'exit');
    run(dir, 'settings-get', 'exit'); // a second run makes sure the backup copy exists
    const file = path.join(dir, 'groups.json');
    assert.ok(fs.existsSync(`${file}.bak`), 'a backup copy exists');
    const good = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, good.slice(0, Math.floor(good.length / 2))); // a write that was cut off
    assert.deepStrictEqual(run(dir, 'settings-get', 'exit').json, EXPECT_SETTINGS);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('groups.json.corrupt-')), 'the damaged file was kept, not deleted');
    fs.writeFileSync(file, ''); // an empty file
    assert.deepStrictEqual(run(dir, 'settings-get', 'exit').json, EXPECT_SETTINGS);
  } finally {
    cleanup(dir);
  }
});

test('when the file AND its backup are damaged, the damaged files are kept and nothing is silently overwritten', () => {
  const dir = freshDir();
  try {
    run(dir, 'settings-set', 'exit');
    run(dir, 'settings-get', 'exit');
    const file = path.join(dir, 'groups.json');
    fs.writeFileSync(file, '{"__bot":{"mode":"pub');
    fs.writeFileSync(`${file}.bak`, 'garbage');
    const r = run(dir, 'settings-get', 'exit');
    assert.strictEqual(r.json.mode, 'private', 'defaults are used only because nothing could be read');
    const kept = fs.readdirSync(dir).filter((f) => f.startsWith('groups.json.corrupt-'));
    assert.ok(kept.length >= 1, 'the damaged file is still there');
    assert.ok(fs.readFileSync(path.join(dir, kept[0]), 'utf8').includes('"mode":"pub'), 'its content is untouched');
  } finally {
    cleanup(dir);
  }
});

test('an interrupted save (only the .tmp file is complete) is picked up on the next start', () => {
  const dir = freshDir();
  try {
    run(dir, 'settings-set', 'exit');
    const file = path.join(dir, 'groups.json');
    fs.renameSync(file, `${file}.tmp`); // the rename never happened
    assert.deepStrictEqual(run(dir, 'settings-get', 'exit').json, EXPECT_SETTINGS);
  } finally {
    cleanup(dir);
  }
});

test('every saved file is JSON that can be read after a SIGKILL during heavy use', () => {
  const dir = freshDir();
  try {
    for (let i = 0; i < 4; i++) run(dir, 'counters', 'kill');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), `${f} is complete`);
    }
  } finally {
    cleanup(dir);
  }
});

// ----- the building blocks -----
test('default values only fill what is missing, they never replace saved values', () => {
  const { fillDefaults } = require('../core/jsonstore');
  const saved = { limit: 5, nested: { a: 1 }, list: [1] };
  fillDefaults(saved, { limit: 200, extra: true, nested: { a: 9, b: 2 }, list: [] });
  assert.deepStrictEqual(saved, { limit: 5, nested: { a: 1, b: 2 }, list: [1], extra: true });
});

test('a failed write keeps the changes and a later write saves them', () => {
  const safefile = require('../core/safefile');
  const jsonstore = require('../core/jsonstore');
  const dir = freshDir();
  try {
    const js = jsonstore.open('retry-test', { n: 0 }, { dir });
    const real = safefile.writeText;
    let fail = true;
    safefile.writeText = (...a) => {
      if (fail) throw new Error('disk full');
      return real(...a);
    };
    js.data.n = 42;
    js.touch();
    assert.strictEqual(js.flush(), false);
    fail = false;
    assert.strictEqual(js.flush(), true);
    safefile.writeText = real;
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'retry-test.json'), 'utf8')).n, 42);
  } finally {
    cleanup(dir);
  }
});

test('the same file is never opened twice (two copies would overwrite each other)', () => {
  const jsonstore = require('../core/jsonstore');
  const a = jsonstore.open('same-twice', { x: 1 });
  const b = jsonstore.open('same-twice', { x: 2 });
  assert.strictEqual(a, b);
});

test('a second bot on the same data folder waits and then stops; a dead lock is ignored', async () => {
  const { spawn } = require('child_process');
  const dir = freshDir();
  const lockPath = JSON.stringify(path.join(__dirname, '../core/lock'));
  const probe = `process.env.TURBOFEX_DATA=${JSON.stringify(dir)};require(${lockPath}).acquire(1500).then((ok)=>{console.log(JSON.stringify({ok}));process.exit(0)})`;
  const holder = `process.env.TURBOFEX_DATA=${JSON.stringify(dir)};require(${lockPath}).acquire(1500).then(()=>{console.log('held');setTimeout(()=>process.exit(0),20000)})`;
  let first = null;
  try {
    first = spawn(process.execPath, ['-e', holder], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve) => first.stdout.once('data', resolve)); // the first bot owns the folder
    const second = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
    assert.strictEqual(JSON.parse(second.stdout.trim().split('\n').pop()).ok, false, 'the second bot is refused');
    first.kill('SIGKILL'); // a crash: the lock file stays behind, but nobody refreshes it any more
    await new Promise((r) => first.once('exit', r));
    const lockFile = path.join(dir, '.bot.lock');
    assert.ok(fs.existsSync(lockFile));
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lockFile, old, old);
    const third = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
    assert.strictEqual(JSON.parse(third.stdout.trim().split('\n').pop()).ok, true, 'a dead lock never blocks a start');
  } finally {
    if (first) first.kill('SIGKILL');
    cleanup(dir);
  }
});

test('a daily copy of every saved file is kept (protects against a wrong save)', () => {
  const dir = freshDir();
  try {
    run(dir, 'settings-set', 'exit');
    run(dir, 'settings-get', 'exit');
    run(dir, 'add-coins', 'exit', '5');
    run(dir, 'add-coins', 'exit', '5');
    const snaps = fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : [];
    assert.ok(snaps.some((f) => f.startsWith('groups.')), 'a copy of groups.json exists');
    assert.ok(snaps.some((f) => f.startsWith('realm.')), 'a copy of the Empire data exists');
  } finally {
    cleanup(dir);
  }
});

test('the old economy files are set aside, never deleted', () => {
  const ecoclean = require('../core/ecoclean');
  const dir = freshDir();
  try {
    fs.writeFileSync(path.join(dir, 'economy.json'), '{"coins":123}');
    assert.strictEqual(ecoclean.run(dir), 1);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'legacy-economy', 'economy.json'), 'utf8'), '{"coins":123}');
  } finally {
    cleanup(dir);
  }
});

// ----- timed jobs -----
test('a scheduled message is sent once, also when the bot restarts in that minute, and a short delay is caught up', async () => {
  const store = require('../whatsapp/store');
  const scheduler = require('../core/scheduler');
  const clock = require('../core/clock');
  const p = clock.parts();
  const sent = [];
  const sock = { sendMessage: async (to, c) => { sent.push(c.text); }, groupSettingUpdate: async () => {} };
  const earlier = new Date(Date.now() - 3 * 60000);
  const hhmm = clock.parts(earlier).hhmm;
  if (clock.parts(earlier).date !== p.date) return; // too close to midnight to test
  const item = store.addSchedule({ jid: GROUP, time: hhmm, text: 'sched-once-test', repeat: { kind: 'daily' } });
  await scheduler.tick(sock); // three minutes "late": it still goes out
  assert.deepStrictEqual(sent.filter((x) => x === 'sched-once-test').length, 1);
  assert.ok(item.lastRun, 'the run is remembered with the item');
  // a restart: the scheduler's own minute-memory is gone, only the saved item is left
  delete require.cache[require.resolve('../core/scheduler')];
  const fresh = require('../core/scheduler');
  await fresh.tick(sock);
  assert.strictEqual(sent.filter((x) => x === 'sched-once-test').length, 1, 'not sent a second time');
  store.removeSchedule(item.id);
});

test('a reminder that could not be sent is kept and tried again, and is removed only after it was sent', async () => {
  const store = require('../whatsapp/store');
  const scheduler = require('../core/scheduler');
  const r = store.addReminder({ jid: '27800000009@s.whatsapp.net', who: '27800000009@s.whatsapp.net', ids: ['27800000009'], at: Date.now() - 1000, text: 'pay rent' });
  let works = false;
  const sock = { sendMessage: async () => { if (!works) throw new Error('offline'); } };
  await scheduler.checkReminders(sock);
  assert.ok(store.reminders().some((x) => x.id === r.id), 'kept after a failed send');
  works = true;
  r.retryAt = 0;
  await scheduler.checkReminders(sock);
  assert.ok(!store.reminders().some((x) => x.id === r.id), 'removed after it was sent');
});

test('birthdays are announced once per group per day, and again on the next day', async () => {
  const birthdays = require('../whatsapp/birthdays');
  const meta = require('../whatsapp/metadata');
  const store = require('../whatsapp/store');
  const g = '120363000000000077@g.us';
  store.update(g, (x) => { x.birthdays = true; });
  const t = birthdays.today();
  birthdays.save(['27855555555'], '27855555555@s.whatsapp.net', { d: t.d, m: t.m });
  const real = meta.getMeta;
  meta.getMeta = async () => ({ participants: [{ id: '27855555555@s.whatsapp.net' }] });
  const sent = [];
  const sock = { sendMessage: async (to, c) => { sent.push(to); } };
  try {
    assert.deepStrictEqual(await birthdays.announceToday(sock), [g]);
    assert.deepStrictEqual(await birthdays.announceToday(sock), [], 'not twice on the same day');
    store.update(g, (x) => { x.birthdayDay = 'yesterday'; });
    assert.deepStrictEqual(await birthdays.announceToday(sock), [g], 'next day again');
  } finally {
    meta.getMeta = real;
    birthdays.remove(['27855555555']);
  }
});

// ----- migration: data written by the previous version stays intact -----
test('a groups.json written by version 0.9.11 loads with every value unchanged', () => {
  const dir = freshDir();
  try {
    const old = {
      '__bot': { mode: 'public', prefix: '.', prefixMigrated: true, auto: { autoread: true }, status: { view: true, like: true, save: false, emojis: ['❤️', '🔥'], delayMin: 2, delayMax: 6, saveTo: null, dailyLikeLimit: 5 }, sudo: ['27822222222'], banned: ['27899999999'], schedules: [{ id: 3, jid: GROUP, time: '07:00', text: 'old', once: false, repeat: { kind: 'daily' } }], scheduleSeq: 3, reminders: [], reminderSeq: 9 },
      [GROUP]: { antilinkMode: 'warn', warnLimit: 4, warnings: { 27811111111: { jid: '27811111111@s.whatsapp.net', count: 2 } }, welcomeText: 'Hello @user', badWords: ['x'], filters: { hi: 'there' }, autoMute: { mute: '22:00', unmute: '06:00' } },
    };
    fs.writeFileSync(path.join(dir, 'groups.json'), JSON.stringify(old));
    const r = spawnSync(process.execPath, ['-e', `
      process.env.TURBOFEX_DATA=${JSON.stringify(dir)};process.env.CONSOLE_CHAT='off';
      const s=require(${JSON.stringify(path.join(__dirname, '../whatsapp/store'))});
      const g=s.getGroup(${JSON.stringify(GROUP)});
      console.log(JSON.stringify({ mode:s.getMode(), limit:s.statusCfg().dailyLikeLimit, emojis:s.statusCfg().emojis, delay:[s.statusCfg().delayMin,s.statusCfg().delayMax], warn:s.getWarnings(${JSON.stringify(GROUP)},'27811111111'), warnLimit:g.warnLimit, filters:g.filters, mute:g.autoMute.mute, sudo:s.getSudo(), banned:s.getBanned(), sched:s.schedules()[0].text, seq:s.addSchedule({jid:'x',time:'01:00',text:'n'}).id }));
      process.exit(0);`], { encoding: 'utf8' });
    const j = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(j, { mode: 'public', limit: 5, emojis: ['❤️', '🔥'], delay: [2, 6], warn: 2, warnLimit: 4, filters: { hi: 'there' }, mute: '22:00', sudo: ['27822222222'], banned: ['27899999999'], sched: 'old', seq: 4 });
  } finally {
    cleanup(dir);
  }
});
