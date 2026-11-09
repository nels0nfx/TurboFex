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
  const plan = accountsMod.load(ROOT, process.env);
  const brand = require('./core/brand');
  let count = 1;

  if (plan && plan.accounts) {
    count = plan.accounts.length;
    for (const p of plan.problems) console.log(`⚠️ ${p}`);
    startMany(plan.accounts);
  } else {
    if (plan) for (const p of plan.problems) console.log(`⚠️ ${p}`);
    startOne();
  }

  // hosts that need an open port (PORT is set): a tiny status page, nothing else
  require('./core/hostport').start({ info: () => ({ bot: brand.botName, version: require('./package.json').version, accounts: count }) });

  // ---------- one account: exactly as before ----------
  function startOne() {
    let child = null;
    let stopping = false;
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
      setTimeout(run, 1000);
    };

    const run = () => {
      child = spawn(process.execPath, [__filename], {
        stdio: 'inherit',
        env: { ...process.env, FLASH_CHILD: '1' },
      });

      child.on('exit', (code) => {
        child = null;
        if (stopping) process.exit(0);
        if (code === 43) process.exit(43); // the bot name was changed: stop (no restart, no rollback)
        if (code === RESTART_CODE) return restartSoon();
        if (code !== 0 && tryRollback()) return restartSoon();
        process.exit(code ?? 1);
      });
    };

    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => {
        stopping = true;
        if (child) child.kill(sig);
        else process.exit(0);
      });
    }

    run();
  }

  // ---------- several accounts: one bot process each ----------
  function startMany(accounts) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const state = new Map(); // name -> { acc, index, child, expected, restarts: [], gaveUp }
    let stopping = false;
    let restartingAll = false;
    const prefixed = accounts.length > 1;

    accounts.forEach((acc, index) => {
      accountsMod.prepare(acc);
      state.set(acc.name, { acc, index, child: null, expected: false, restarts: [], gaveUp: false });
    });
    console.log(`👥 ${accounts.length} account${accounts.length === 1 ? '' : 's'}: ${accounts.map((a) => a.name).join(', ')}`);

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

    const stopAll = (sig) => {
      stopping = true;
      let any = false;
      for (const st of state.values()) if (st.child) { st.expected = true; st.child.kill(sig); any = true; }
      if (!any) process.exit(0);
    };

    const allDone = () => [...state.values()].every((st) => !st.child && (st.gaveUp || st.stoppedClean));

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
        if (st.expected) return afterExpected();
        if (stopping) return afterExpected();
        if (code === 43) { // the bot name was changed: stop everything
          stopAll('SIGTERM');
          setTimeout(() => process.exit(43), 3000).unref?.();
          return;
        }
        if (code === RESTART_CODE) return restartAll(); // an update or a restart changes the shared files: every account restarts
        if (code !== 0 && tryRollback()) return restartAll();
        if (code === 0) { // that account was stopped on purpose; the others keep running
          st.stoppedClean = true;
          console.log(`[${st.acc.name}] stopped.`);
          return afterExpected();
        }
        const now = Date.now();
        st.restarts.push(now);
        while (st.restarts.length && now - st.restarts[0] > 60000) st.restarts.shift();
        if (st.restarts.length > 5) {
          st.gaveUp = true;
          console.error(`[${st.acc.name}] stopped after too many restarts in a row. The other accounts keep running.`);
          return afterExpected();
        }
        console.log(`\n🔄 Restarting account ${st.acc.name}...\n`);
        setTimeout(() => !stopping && !restartingAll && startAccount(st), 1000);
      });
    }

    function afterExpected() {
      if (stopping && [...state.values()].every((s) => !s.child)) process.exit(0);
      if (!stopping && !restartingAll && allDone()) process.exit(1);
    }

    async function restartAll() {
      if (restartingAll || stopping) return;
      restartingAll = true;
      console.log('\n🔄 Restarting all accounts...\n');
      const waits = [];
      for (const st of state.values()) {
        if (!st.child) continue;
        st.expected = true;
        waits.push(new Promise((r) => st.child.once('exit', r)));
        st.child.kill('SIGTERM');
      }
      await Promise.race([Promise.all(waits), sleep(15000)]);
      for (const st of state.values()) if (st.child) st.child.kill('SIGKILL');
      await sleep(1000);
      restartingAll = false;
      for (const st of state.values()) {
        st.gaveUp = false;
        st.restarts = [];
        if (!st.child) startAccount(st);
      }
    }

    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stopAll(sig));
    // the accounts start one after the other, so they do not all load at the same moment on a small server
    (async () => {
      for (const st of state.values()) {
        startAccount(st);
        await sleep(st.index === 0 ? 4000 : 2500);
      }
    })();
  }
}
