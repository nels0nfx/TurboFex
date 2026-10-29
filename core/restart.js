// Exit code 42 tells index.js: "start me again"
const RESTART_CODE = 42;
const { flushAll } = require('./flush');

function restartBot(delayMs = 2000) {
  setTimeout(() => {
    // everything kept in memory is written to disk first
    flushAll().finally(() => process.exit(RESTART_CODE));
  }, delayMs);
}

module.exports = { RESTART_CODE, restartBot };
