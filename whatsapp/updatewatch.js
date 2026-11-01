// Tells the owner when a new version is available, and what is in it (once per version).
// It never installs anything: "update now" does that, or auto-update at the next start.
const updater = require('../core/updater');
const { isNewer } = updater;
const jsonstore = require('../core/jsonstore');
const store = require('./store');
const { ownerChat } = require('./owner');
const brand = require('../core/brand');

const js = jsonstore.open('update-notice', () => ({ told: '' }), { delay: 500 }); // the last version the owner was told about
const EVERY_MS = 6 * 60 * 60 * 1000;

// the changelog blocks of every version newer than the one running, newest first (max 3 blocks), as short bullet lines
function whatChanged(raw, current) {
  const blocks = String(raw || '').split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    const head = /^TurboFex v(\d+\.\d+\.\d+)\b\s*-?\s*(.*)$/im.exec(b.split(/\r?\n/)[0]);
    if (!head || !isNewer(head[1], current)) continue;
    const bullets = b.split(/\r?\n/).slice(1).map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l))
      .slice(0, 8).map((l) => `• ${l.replace(/^[-*]\s+/, '').replace(/^(FIXED|NEW|CHANGED|TESTS?|NOTE)\s*:?\s*/i, (m) => `${m.trim().replace(/:$/, '')}: `).slice(0, 170)}`);
    out.push(`*v${head[1]}*${head[2] ? ` - ${head[2]}` : ''}\n${bullets.join('\n')}`);
    if (out.length >= 3) break;
  }
  return out.join('\n\n').slice(0, 1500);
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
    if (!info || !info.ok || !info.available || !info.latest) return false;
    if (js.data.told === info.latest) return false;
    await sock.sendMessage(ownerChat(sock), { text: compose(info, store.effectivePrefix()) });
    js.data.told = info.latest; // only remembered once it was really sent
    js.touch();
    return true;
  } catch (err) {
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

module.exports = { check, start, stop, whatChanged, compose, store: js };
