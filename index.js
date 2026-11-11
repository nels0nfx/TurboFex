// index.js has three jobs:
//  1) Normal start: it launches the bot as a "child" process and watches it.
//  2) If the bot asks for a restart (after an update or !restart), it starts it again.
//  3) If a fresh update crashes the bot on start, it puts the previous version back.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('./core/envfile').load(); // optional config.env (SESSION_ID, PREFIX, ...); the child process inherits it
require('./core/legacyclean').run(__dirname); // files of removed features that an old updater left behind go before the bot loads its commands
const { RESTART_CODE } = require('./core/restart');
const bootnote = require('./core/bootnote');

const ROOT = __dirname;
const RB = path.join(ROOT, 'data', 'rollback');

function tryRollback() {
  try {
    const pending = path.join(RB, 'pending');
    if (!fs.existsSync(pending)) return false;
    const age = Date.now() - Number(fs.readFileSync(pending, 'utf8'));
    fs.rmSync(pending, { force: true });
    if (!(age >= 0 && age < 10 * 60 * 1000)) return false; // only right after an update

    const manifest = JSON.parse(fs.readFileSync(path.join(RB, 'manifest.json'), 'utf8'));
    fs.cpSync(path.join(RB, 'files'), ROOT, { recursive: true, force: true });
    for (const rel of manifest.created || []) {
      if (!rel.includes('..')) fs.rmSync(path.join(ROOT, rel), { force: true });
    }
    fs.writeFileSync(path.join(RB, 'skip-version'), String(manifest.to));
    bootnote.write({ type: 'rollback', from: manifest.to, to: manifest.from }); // the owner is told once the bot is back
    console.log(`\n↩️ The update to v${manifest.to} crashed on start. Went back to v${manifest.from}.\n`);
    return true;
  } catch (err) {
    console.error('Rollback failed:', err.message);
    return false;
  }
}

if (process.env.FLASH_CHILD === '1') {
  require('./core/legacyclean').run(__dirname); // after an update the old supervisor starts this new bot: the clean-up must run here too
  require('./core/integrity').enforce();
  require('./core/boot')
    .start()
    .catch((err) => {
      console.error('Could not start:', err);
      process.exit(1);
    });
} else {
  const accountsMod = require('./core/accounts');
  const brand = require('./core/brand');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let current = null; // what is running now: { kind: 'one' | 'many', halt(sig), has(name), add(accounts) }
  let count = 1;
  let shuttingDown = false;
  let reloading = false;

  const begin = () => {
    const plan = accountsMod.load(ROOT, process.env);
    if (plan) {
      for (const p of plan.problems) console.log(`⚠️ ${p}`);
      for (const n of plan.notes || []) console.log(n);
    }
    if (plan && plan.accounts) {
      count = plan.accounts.length;
      current = startMany(plan.accounts);
    } else {
      count = 1;
      current = startOne();
    }
  };
  begin();

  // hosts that need an open port (PORT is set): a tiny status page, nothing else
  require('./core/hostport').start({ info: () => ({ bot: brand.botName, version: require('./package.json').version, accounts: count }) });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      shuttingDown = true;
      current.halt(sig).then(() => process.exit(0));
    });
  }

  // A new session ID added to session_id.txt (or a new accounts.json) is picked up while the bot runs: the new account is
  // started at once and the running ones are not touched. (A bot that ran as ONE account restarts once to become several.)
  const watched = [path.join(ROOT, 'session_id.txt'), path.join(ROOT, 'accounts.json')];
  const stamp = () => watched.map((f) => { try { return fs.statSync(f).mtimeMs; } catch (err) { return 0; } }).join('|');
  let lastStamp = stamp();
  const watcher = setInterval(async () => {
    if (shuttingDown || reloading) return;
    const now = stamp();
    if (now === lastStamp) return;
    lastStamp = now;
    try {
      const plan = accountsMod.load(ROOT, process.env);
      if (!plan || !plan.accounts) return;
      for (const n of plan.notes || []) console.log(n);
      if (current.kind === 'many') {
        const fresh = plan.accounts.filter((a) => !current.has(a.name));
        if (fresh.length) {
          count += fresh.length;
          current.add(fresh);
        }
      } else if (plan.accounts.length > 1 || plan.notes?.length) {
        reloading = true;
        console.log('\n🔄 Several accounts now: restarting once to start them all...\n');
        await current.halt('SIGTERM');
        begin();
        reloading = false;
      }
    } catch (err) {
      reloading = false;
      console.error('Checking for new accounts failed:', err.message);
    }
  }, 5000);
  if (watcher.unref) watcher.unref();

  // stops a list of child processes and waits for them (15 seconds, then they are forced)
  async function stopChildren(children, sig) {
    const waits = children.map((c) => new Promise((r) => c.once('exit', r)));
    for (const c of children) c.kill(sig);
    await Promise.race([Promise.all(waits), sleep(15000)]);
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  }

  // ---------- one account: exactly as before ----------
  function startOne() {
    let child = null;
    let halted = false;
    const restarts = [];

    const restartSoon = () => {
      const now = Date.now();
      restarts.push(now);
      while (restarts.length && now - restarts[0] > 60000) restarts.shift();
      if (restarts.length > 5) {
        console.error('Too many restarts in a row. Stopping.');
        process.exit(1);
      }
      console.log('\n🔄 Restarting the bot...\n');
      setTimeout(() => !halted && run(), 1000);
    };

    const run = () => {
      child = spawn(process.execPath, [__filename], {
        stdio: 'inherit',
        env: { ...process.env, FLASH_CHILD: '1' },
      });

      child.on('exit', (code) => {
        child = null;
        if (halted) return;
        if (code === 43) process.exit(43); // the bot name was changed: stop (no restart, no rollback)
        if (code === RESTART_CODE) return restartSoon();
        if (code !== 0 && tryRollback()) return restartSoon();
        process.exit(code ?? 1);
      });
    };

    run();
    return {
      kind: 'one',
      has: () => true,
      async halt(sig = 'SIGTERM') {
        halted = true;
        if (child) await stopChildren([child], sig);
      },
    };
  }

  // ---------- several accounts: one bot process each ----------
  function startMany(accounts) {
    const state = new Map(); // name -> { acc, index, child, expected, restarts: [], gaveUp }
    let stopping = false;
    let restartingAll = false;
    let prefixed = accounts.length > 1;

    const pipeLines = (stream, out, tag) => {
      let buf = '';
      stream.on('data', (d) => {
        buf += d;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          out.write(`${tag}${buf.slice(0, nl)}\n`);
          buf = buf.slice(nl + 1);
        }
        if (buf.length > 20000) {
          out.write(`${tag}${buf}\n`);
          buf = '';
        }
      });
      stream.on('end', () => buf && out.write(`${tag}${buf}\n`));
    };

    const allDone = () => [...state.values()].every((st) => !st.child && (st.gaveUp || st.stoppedClean));
    const afterExit = () => {
      if (!stopping && !restartingAll && allDone()) process.exit(1);
    };

    const add = (acc) => {
      const st = { acc, index: state.size, child: null, expected: false, restarts: [], gaveUp: false, stoppedClean: false };
      accountsMod.prepare(acc);
      state.set(acc.name, st);
      return st;
    };

    function startAccount(st) {
      st.expected = false;
      st.stoppedClean = false;
      const child = spawn(process.execPath, [__filename], { stdio: prefixed ? ['inherit', 'pipe', 'pipe'] : 'inherit', env: accountsMod.envFor(st.acc, st.index, process.env) });
      st.child = child;
      if (prefixed) {
        pipeLines(child.stdout, process.stdout, `[${st.acc.name}] `);
        pipeLines(child.stderr, process.stderr, `[${st.acc.name}] `);
      }
      child.on('exit', (code) => {
        st.child = null;
        if (st.expected || stopping) return afterExit();
        if (code === 43) { // the bot name was changed: stop everything
          halt('SIGTERM').then(() => process.exit(43));
          return;
        }
        if (code === RESTART_CODE) return restartAll(); // an update or a restart changes the shared files: every account restarts
        if (code !== 0 && tryRollback()) return restartAll();
        if (code === 0) { // that account was stopped on purpose; the others keep running
          st.stoppedClean = true;
          console.log(`[${st.acc.name}] stopped.`);
          return afterExit();
        }
        const now = Date.now();
        st.restarts.push(now);
        while (st.restarts.length && now - st.restarts[0] > 60000) st.restarts.shift();
        if (st.restarts.length > 5) {
          st.gaveUp = true;
          console.error(`[${st.acc.name}] stopped after too many restarts in a row. The other accounts keep running.`);
          return afterExit();
        }
        console.log(`\n🔄 Restarting account ${st.acc.name}...\n`);
        setTimeout(() => !stopping && !restartingAll && startAccount(st), 1000);
      });
    }

    async function restartAll() {
      if (restartingAll || stopping) return;
      restartingAll = true;
      console.log('\n🔄 Restarting all accounts...\n');
      const kids = [];
      for (const st of state.values()) if (st.child) { st.expected = true; kids.push(st.child); }
      await stopChildren(kids, 'SIGTERM');
      await sleep(1000);
      restartingAll = false;
      for (const st of state.values()) {
        st.gaveUp = false;
        st.restarts = [];
        if (!st.child) startAccount(st);
      }
    }

    async function halt(sig = 'SIGTERM') {
      stopping = true;
      const kids = [];
      for (const st of state.values()) if (st.child) { st.expected = true; kids.push(st.child); }
      if (kids.length) await stopChildren(kids, sig);
    }

    console.log(`👥 ${accounts.length} account${accounts.length === 1 ? '' : 's'}: ${accounts.map((a) => a.name).join(', ')}`);
    accounts.forEach(add);
    // the accounts start one after the other, so they do not all load at the same moment on a small server
    (async () => {
      for (const st of [...state.values()]) {
        if (stopping) return;
        startAccount(st);
        await sleep(st.index === 0 ? 4000 : 2500);
      }
    })();

    return {
      kind: 'many',
      has: (name) => state.has(name),
      halt,
      add(list) { // new accounts join while the others keep running (their log lines get the account name from now on)
        prefixed = true;
        for (const acc of list) {
          console.log(`👥 Starting the new account ${acc.name}...`);
          startAccount(add(acc));
        }
      },
    };
  }
}
