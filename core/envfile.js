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
  for (const [key, value] of Object.entries(parse(text))) {
    if (env[key] !== undefined && env[key] !== '') continue; // the host's own setting wins
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

module.exports = { load, parse, FILE };
