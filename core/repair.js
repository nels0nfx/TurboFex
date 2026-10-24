// Fixes "Bad MAC": removes the saved chat sessions (not the login). WhatsApp sets new ones up by itself.
const fs = require('fs');
const path = require('path');

function clearSessions(dir) {
  let removed = 0;
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch (err) {
    return 0;
  }
  for (const f of files) {
    if (/^(session|sender-key)/.test(f)) {
      try {
        fs.rmSync(path.join(dir, f), { force: true });
        removed += 1;
      } catch (err) {
        // skip files that cannot be removed
      }
    }
  }
  return removed;
}

module.exports = { clearSessions };
