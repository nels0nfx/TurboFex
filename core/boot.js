require('./quiet'); // must come first, before the WhatsApp library loads
const fs = require('fs');
const path = require('path');
const config = require('../config');
const brand = require('./brand');
const health = require('./health');
const repair = require('./repair');
const { RESTART_CODE } = require('./restart');
const bootnote = require('./bootnote');
const { DATA } = require('./paths');

// A flood of "Bad MAC" errors means the saved chat sessions are broken. Clear them and restart (at most every 3 hours).
function installAutoRepair() {
  const marker = path.join(DATA, 'last-repair.txt');
  health.onStorm(() => {
    let last = 0;
    try {
      last = Number(fs.readFileSync(marker, 'utf8')) || 0;
    } catch (err) {
      last = 0;
    }
    if (Date.now() - last < 3 * 3600 * 1000) return;
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, String(Date.now()));
    } catch (err) {
      // not important
    }
    const n = repair.clearSessions(config.sessionDir);
    bootnote.write({ type: 'repair' });
    console.log(`🛠️ Too many decryption errors ("Bad MAC"). Cleared ${n} old chat session files and restarting. This is safe, you stay logged in.`);
    setTimeout(() => process.exit(RESTART_CODE), 1000);
  });
}

async function start() {
  console.log(`\n⚡ Starting ${brand.botName} by ${brand.creator}...\n`);

  process.on('unhandledRejection', (err) => console.error('Unhandled error:', err));
  process.on('uncaughtException', (err) => console.error('Crash prevented:', err));
  installAutoRepair();

  // Look for a new version BEFORE the bot loads
  const { autoUpdateOnStart } = require('./updater');
  const updated = await autoUpdateOnStart();
  if (updated) {
    console.log('✅ Update installed. Restarting...');
    process.exit(RESTART_CODE);
  }

  // Linking: the login comes from the pairing site (SESSION_ID). The console never asks for a number or a pairing code
  // (only when CONSOLE_LINK=1 is set on purpose, see core/setup.js).
  const sessionid = require('./sessionid');
  const setup = require('./setup');
  const restored = await sessionid.restore(config);
  if (restored === 'restored') setup.adoptLinkedNumber(config); // the number and the owner are the ones of this login
  const linkState = await setup.ensure(config);
  if (linkState && linkState.needsSession) {
    setup.waitForSession(config, restored === 'failed' ? 'failed' : 'none'); // explains what to do and waits; no connection is made
    return;
  }

  const { startWhatsApp } = require('../whatsapp/connection');
  await startWhatsApp();
}

module.exports = { start };
