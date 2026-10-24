// index.js has three jobs:
//  1) Normal start: it launches the bot as a "child" process and watches it.
//  2) If the bot asks for a restart (after an update or !restart), it starts it again.
//  3) If an update crashes on the first start, it rolls back to the previous version.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const bootnote = require('./core/bootnote');

const RESTART_CODE = 42;
const ROLLBACK_FILE = path.join(__dirname, 'data', 'rollback.json');

function tryRollback() {
  try {
    if (!fs.existsSync(ROLLBACK_FILE)) return false;
    const manifest = JSON.parse(fs.readFileSync(ROLLBACK_FILE, 'utf8'));
    if (!manifest || !manifest.from || !manifest.to) return false;

    const root = __dirname;
    const backupDir = path.join(root, 'data', 'update-backup');
    if (!fs.existsSync(backupDir)) return false;

    // restore every file that was replaced
    for (const rel of manifest.files || []) {
      const src = path.join(backupDir, rel);
      const dest = path.join(root, rel);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }

    // restore package.json version
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.version = manifest.from;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }

    fs.unlinkSync(ROLLBACK_FILE);
    bootnote.write({ type: 'rollback', from: String(manifest.to), to: String(manifest.from) }); // the owner is told once the bot is back
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
