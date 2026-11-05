// Tells the owner when a new version is available, and what is in it (once per version).
// It never installs anything: "update now" does that, or auto-update at the next start.
const updater = require('../core/updater');
const { isNewer } = updater;
const jsonstore = require('../core/jsonstore');
const store = require('./store');
const { ownerChat } = require('./owner');
const brand = require('../core/brand');

const js = jsonstore.open('update-notice', () => ({ told: '' }), { delay: 500 }); // the last version the owner was told about
const EVERY_MS = 60 * 60 * 1000; // once an hour

// A long text is sent in several messages (WhatsApp keeps about 4000 characters per message), cut at line breaks, never in the
// middle of a line. Nothing is dropped. A single message when it fits.
function splitText(text, limit = 3500) {
  const lines = String(text).split('\n');
  const out = [];
  let cur = '';
  for (let line of lines) {
    while (line.length > limit) { // a single huge line: cut at a space
      const at = line.lastIndexOf(' ', limit) > limit / 2 ? line.lastIndexOf(' ', limit) : limit;
      if (cur) { out.push(cur); cur = ''; }
      out.push(line.slice(0, at));
      line = line.slice(at).trimStart();
    }
    if (cur && cur.length + line.length + 1 > limit) { out.push(cur); cur = line; } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

// sends a long text as one or more messages, in order
async function sendLong(sock, to, text) {
  for (const part of splitText(text)) await sock.sendMessage(to, { text: part });
}

// the changelog blocks of every version newer than the one running, newest first, ALL their lines (nothing is cut)
function whatChanged(raw, current) {
  const blocks = String(raw || '').split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    const head = /^TurboFex v(\d+\.\d+\.\d+)\b\s*-?\s*(.*)$/im.exec(b.split(/\r?\n/)[0]);
    if (!head || !isNewer(head[1], current)) continue;
    const bullets = b.split(/\r?\n/).slice(1).map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l))
      .map((l) => `• ${l.replace(/^[-*]\s+/, '').replace(/^(FIXED|NEW|CHANGED|TESTS?|NOTE|CLEANED|FASTER|RULE)\s*:?\s*/i, (m) => `${m.trim().replace(/:$/, '')}: `)}`);
    out.push(`*v${head[1]}*${head[2] ? ` - ${head[2]}` : ''}\n${bullets.join('\n')}`);
    if (out.length >= 12) break; // twelve versions at most: a bot that skipped a year of updates still gets a readable list
  }
  return out.join('\n\n');
}

function compose(info, prefix) {
  const changes = whatChanged(info.notes, info.current);
  const auto = store.getAutoUpdate();
  return [
    `*🆕 Update available*`,
    `_${brand.botName}_`,
    '────────────────',
    `📦 v${info.current}  ➜  v${info.latest}`,
    changes ? `\n*What changed*\n${changes}` : '',
    '',
    `▸ Install now: *${prefix}update now*`,
    auto ? '▸ Auto-update is ON: it also installs when the bot next starts.' : `▸ Auto-update is OFF: turn it on with *${prefix}autoupdate on*`,
  ].filter((l) => l !== null).join('\n');
}

let running = false;
// checks once; sends the notice if this version was not announced yet. Returns true when a notice was sent.
async function check(sock) {
  if (running) return false;
  running = true;
  try {
    const info = await updater.getLatest();
    if (!info || !info.ok) {
      console.log(`🔄 Update check: ${info?.reason ? updater.reasonText(info.reason) : 'no answer'}`);
      return false;
    }
    if (!info.available || !info.latest) {
      console.log(`🔄 Update check: v${info.current} is the newest version.`);
      return false;
    }
    if (js.data.told === info.latest) return false;
    await sendLong(sock, ownerChat(sock), compose(info, store.effectivePrefix()));
    console.log(`🔄 Update check: told the owner about v${info.latest}.`);
    js.data.told = info.latest; // only remembered once it was really sent
    js.touch();
    return true;
  } catch (err) {
    console.log(`🔄 Update check failed: ${err.message}`);
    return false; // no network or GitHub busy: tried again at the next check
  } finally {
    running = false;
  }
}

let timer = null;
function start(sock, alive = () => true) {
  stop();
  setTimeout(() => { if (alive()) check(sock); }, 60 * 1000).unref?.(); // a minute after connecting
  timer = setInterval(() => { if (alive()) check(sock); }, EVERY_MS);
  timer.unref?.();
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { check, start, stop, whatChanged, compose, splitText, sendLong, store: js };
