// Reads an optional config.env file in the bot's main folder (the same idea as other WhatsApp bots) and puts its
// settings in the environment, e.g.
//     SESSION_ID=TFX-K7M2-9QXA-4BNP
//     PREFIX=.
//     TIMEZONE=Africa/Lagos
// A setting that the host already has (a panel variable) is never overwritten, and an empty value is ignored.
// Lines starting with # are notes. Quotes around a value are removed. "export KEY=value" works too.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'config.env');

function parse(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const q = value.match(/^(["'`])(.*)\1\s*(?:#.*)?$/);
    if (q) value = q[2];
    else value = value.replace(/\s+#.*$/, '').trim(); // an unquoted value may end with a # note
    if (value) out[m[1]] = value;
  }
  return out;
}

// returns the names of the settings it applied (nothing happens when the file does not exist)
function load(file = FILE, env = process.env) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return [];
  }
  const applied = [];
  const parsed = parse(text);
  // an extra account (see core/accounts.js) never takes the login or the number of the main account from this file
  const isolated = env.TURBOFEX_ISOLATED === '1';
  // Termux has its own PREFIX (a folder path): the PREFIX of this file then becomes BOT_PREFIX so it still works
  if (parsed.PREFIX && env.PREFIX && /[\\/\s]/.test(env.PREFIX) && !env.BOT_PREFIX) env.BOT_PREFIX = parsed.PREFIX;
  for (const [key, value] of Object.entries(parsed)) {
    if (isolated && /^(SESSION_ID|NUMBER|PAIRING_NUMBER|OWNER_NUMBER)$/.test(key)) continue;
    if (env[key] !== undefined && env[key] !== '') continue; // the host's own setting wins
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

module.exports = { load, parse, FILE };
