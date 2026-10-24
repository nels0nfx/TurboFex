// Hides the noisy dumps the WhatsApp encryption library prints ("Closing session",
// "Session error: Bad MAC", ...). Real errors of the bot itself are NOT hidden.
const health = require('./health');

const NOISE =
  /^(Closing (open |stale open )?session|Removing old closed session|Opening session|Session already (closed|open)|Migrating session|Decrypted message with closed session)/i;
const ERROR_NOISE =
  /Bad MAC|Session error|Failed to decrypt message|No matching sessions found|No session found to decrypt|No session record|MessageCounterError|Key used already or never filled|Over 2000 messages into the future/i;

function textOf(args) {
  return args.map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' && a.message ? String(a.message) : '')).join(' ');
}

function isNoise(args) {
  if (args.some((a) => a && typeof a === 'object' && a.constructor && a.constructor.name === 'SessionEntry')) return true;
  return typeof args[0] === 'string' && NOISE.test(args[0]);
}

for (const method of ['log', 'info', 'warn', 'debug']) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (isNoise(args)) return;
    original(...args);
  };
}

const originalError = console.error.bind(console);
console.error = (...args) => {
  if (ERROR_NOISE.test(textOf(args))) {
    health.recordDecryptFailure(); // counted (for the automatic repair), not printed
    return;
  }
  originalError(...args);
};
