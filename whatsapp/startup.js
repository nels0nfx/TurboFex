// The message the bot sends after it restarted or finished an update: "I am back", what changed, a short menu and the links.
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const brand = require('../core/brand');
const clock = require('../core/clock');
const bootnote = require('../core/bootnote');
const store = require('./store');
const { ownerChat } = require('./owner');
const { DATA } = require('../core/paths');

function notesText(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^TurboFex v\d/i.test(l))
    .slice(0, 12)
    .map((l) => (/^[-*]\s+/.test(l) ? `• ${l.replace(/^[-*]\s+/, '')}` : l));
  const text = lines.join('\n');
  return text.length > 900 ? `${text.slice(0, 900).trimEnd()}…` : text;
}

function linksBlock() {
  const l = brand.links;
  return `💬 ${l.telegramSupport}\n📣 ${l.telegramChannel}\n🟢 ${l.whatsappChannel}`;
}

function compose(note, prefix) {
  const now = clock.stamp(Date.now());
  const head = {
    update: ['✅', 'Update complete', note.from && note.to ? `📦 v${note.from}  ➜  v${note.to}` : `📦 v${pkg.version}`],
    restart: ['🔄', 'Restart complete', `📦 v${pkg.version}`],
    repair: ['🛠️', 'Repair complete', `📦 v${pkg.version}`],
    rollback: ['↩️', 'Update was unsafe, old version restored', note.from && note.to ? `📦 v${note.from} failed, back on v${note.to}` : `📦 v${pkg.version}`],
  }[note.type] || ['🟢', 'Bot is back', `📦 v${pkg.version}`];

  const rule = '────────────────';
  const parts = [
    `*${head[0]} ${head[1].replace(/\s+—.*$/, '')}*`,
    `_${brand.botName} is online and ready_`,
    rule,
    '```',
    `Version  ${head[2].replace(/^📦 /, '')}`,
    `Time     ${now}`,
    '```',
  ];
  if (note.type === 'update' && note.notes) parts.push('', '*What\'s new*', notesText(note.notes));
  parts.push(
    '',
    '*Quick menu*',
    `▸ ${prefix}menu   ▸ ${prefix}ping   ▸ ${prefix}alive   ▸ ${prefix}support`,
    '',
    '*Stay connected*',
    linksBlock().replace(/💬 |📣 |🟢 /g, '▸ ')
  );
  return parts.join('\n');
}

// An update that was installed by an OLDER copy of the bot leaves no note, but it does leave a marker in
// data/rollback. If that marker is fresh, make the note here so the owner is still told "update complete".
function noteFromUpdateMarker() {
  try {
    const rb = path.join(DATA, 'rollback');
    const age = Date.now() - Number(fs.readFileSync(path.join(rb, 'pending'), 'utf8'));
    if (!(age >= 0 && age < 10 * 60 * 1000)) return;
    if (bootnote.peek()) return; // a note already exists
    const manifest = JSON.parse(fs.readFileSync(path.join(rb, 'manifest.json'), 'utf8'));
    if (!manifest.to || manifest.from === manifest.to) return;
    let notes = '';
    try {
      notes = fs.readFileSync(path.join(__dirname, '..', 'changelog.txt'), 'utf8').split(/\r?\n/).slice(1).join('\n');
    } catch (err) {
      notes = '';
    }
    bootnote.write({ type: 'update', from: manifest.from, to: manifest.to, notes });
  } catch (err) {
    // no fresh update: nothing to announce
  }
}

// sends the message if a note was left before the restart. Returns true when it was sent.
async function announce(sock) {
  const note = bootnote.peek();
  if (!note) return false;
  if (!store.getRestartMsg() && note.type !== 'update' && note.type !== 'rollback') {
    bootnote.clear();
    return false;
  }
  const to = note.chat || ownerChat(sock);
  try {
    await sock.sendMessage(to, { text: compose(note, store.effectivePrefix()) });
    bootnote.clear(); // only forgotten once it was really sent
    return true;
  } catch (err) {
    console.log('Could not send the restart message yet (will try again):', err.message);
    return false;
  }
}

module.exports = { announce, compose, noteFromUpdateMarker };
