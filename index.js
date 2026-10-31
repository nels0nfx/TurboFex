// index.js has three jobs:
//  1) Normal start: it launches the bot as a "child" process and watches it.
//  2) If the bot asks for a restart (after an update or !restart), it starts it again.
//  3) If a fresh update crashes the bot on start, it puts the previous version back.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('./core/envfile').load(); // optional config.env (SESSION_ID, PREFIX, ...); the child process inherits it
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
  require('./core/integrity').enforce();
  require('./core/boot')
    .start()
    .catch((err) => {
      console.error('Could not start:', err);
      process.exit(1);
    });
} else {
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
