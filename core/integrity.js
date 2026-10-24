// The bot name is part of the bot. If core/brand.js is edited to show a different name, the bot refuses to start
// (restore the file, or update the bot, and it runs again). The name cannot be set from a panel setting or an
// environment variable either: it only comes from the code.
const crypto = require('crypto');
const brand = require('./brand');

const EXPECTED = '21b617649cd865f144ff3fdeb3afd2a28e85de59c77837f29ebcd34218888fb2'; // sha256 of the bot name

const ok = () => crypto.createHash('sha256').update(String(brand.botName)).digest('hex') === EXPECTED;

// exit code 43 = "do not restart, do not roll back": the files were changed on purpose
function enforce() {
  if (ok()) return;
  console.error('\n⛔ The bot name was changed in core/brand.js. This bot must keep its original name.');
  console.error('   Restore core/brand.js (or update the bot) and start it again.\n');
  process.exit(43);
}

module.exports = { enforce, ok };
