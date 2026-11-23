// Keeps the bot "warm" for the chats that are used, so the first reply after a quiet time is as fast as the second.
//
// Why the first ping after a long break was slow: before a message is sent, the WhatsApp library needs the list of devices of everybody who
// will receive it (in a group: every member). That list is remembered (core/cache.js), but it expires, and after the break it had to be asked
// from WhatsApp again, for the whole group, in the middle of your command. That was most of the "2000+ ms" in the first ping.
//
// Now every 15 minutes the lists of the chats that were used lately (the 8 most recent, within the last 7 days) are refreshed in the
// background, one chat at a time, so they never expire while the bot runs. Costs a few small requests per hour. If the library does not offer
// the call (older versions) nothing happens and the bot works exactly as before.
const meta = require('./metadata');
const { withTimeout } = require('./timeout');

const EVERY_MS = 15 * 60 * 1000;
const FIRST_MS = 60 * 1000;
const GAP_MS = 4000;
const MAX_CHATS = 8;
const RECENT_MS = 7 * 24 * 3600 * 1000;

const used = new Map(); // chat -> the last time a command or the owner was seen there
const stats = { rounds: 0, refreshed: 0, failed: 0, unsupported: false };

function touch(jid) {
  if (!jid || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
  used.delete(jid);
  used.set(jid, Date.now());
  if (used.size > 60) used.delete(used.keys().next().value);
}

// newest first (chats touched in the same millisecond: the one touched last comes first)
const chats = (now = Date.now()) => [...used.entries()].reverse().filter(([, t]) => now - t < RECENT_MS).sort((a, b) => b[1] - a[1]).slice(0, MAX_CHATS).map(([j]) => j);

function membersOf(sock, jid) {
  if (jid.endsWith('@g.us')) {
    const g = meta.peek(jid);
    return g && Array.isArray(g.participants) ? g.participants.map((p) => p.id).filter(Boolean) : [];
  }
  return [jid, sock.user && sock.user.id].filter(Boolean); // a private chat: the person and my own other devices
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let running = false;

// one round: refresh the device lists of the recently used chats (never throws)
async function tick(sock, gap = GAP_MS) {
  if (running) return;
  if (!sock || typeof sock.getUSyncDevices !== 'function') {
    stats.unsupported = true;
    return;
  }
  running = true;
  try {
    stats.rounds += 1;
    for (const jid of chats()) {
      const ids = membersOf(sock, jid);
      if (!ids.length) continue;
      try {
        await withTimeout(Promise.resolve(sock.getUSyncDevices(ids, false, false)), 25000, 'device refresh timed out'); // false = ask WhatsApp, do not use the memory
        stats.refreshed += 1;
      } catch (err) {
        stats.failed += 1;
      }
      await sleep(gap);
    }
  } finally {
    running = false;
  }
}

let timer = null;
let first = null;
function stop() {
  clearTimeout(first);
  clearInterval(timer);
  first = null;
  timer = null;
}
function start(sock) {
  stop();
  first = setTimeout(() => tick(sock).catch(() => {}), FIRST_MS);
  timer = setInterval(() => tick(sock).catch(() => {}), EVERY_MS);
  if (first.unref) first.unref();
  if (timer.unref) timer.unref();
}

module.exports = { touch, chats, tick, start, stop, stats, EVERY_MS, MAX_CHATS };
