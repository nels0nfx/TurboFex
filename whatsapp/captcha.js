// New members must answer a small sum, or they are removed. Also: raid protection (many people joining at once).
const levels = require('./levels');
const idmap = require('./idmap');
const { num, whoIds } = require('./utils');
const jsonstore = require('../core/jsonstore');
const store = require('./store');
const meta = require('./metadata');
const intro = require('./intro');

// Open questions are saved (data/captcha-pending.json). A restart used to forget them: new members who had not answered yet
// were never removed. Now every open question is picked up again after a restart (resume below).
const js = jsonstore.open('captcha-pending', { items: {} }, { delay: 300 });

const pending = new Map(); // "group|key" -> { answer, tries, jid, ids, timer, intro }
const joins = new Map(); // group -> [{ t, jid }]
const MAX_TRIES = 3;

// every number the person can be known by (phone number and hidden id)
const idsOf = (jid) => {
  const out = new Set([num(jid)]);
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : null;
  const lid = idmap.isPn(jid) ? idmap.lidSync(jid) : null;
  if (pn) out.add(num(pn));
  if (lid) out.add(num(lid));
  return [...out];
};
const keyFor = (group, jid) => `${group}|${levels.keyOf(jid)}`;

function saveItem(key, group, item) {
  js.data.items[key] = { group, ...item };
  js.touch();
}
function forgetSaved(key) {
  if (js.data.items[key]) {
    delete js.data.items[key];
    js.touch();
  }
}
// writes what the open question looks like now (tries, the extra minute) so a restart continues from the same point
function persist(key) {
  const v = pending.get(key);
  if (v) saveItem(key, v.group, { answer: v.answer, question: v.question, tries: v.tries, ids: v.ids, jid: v.jid, until: v.until, total: v.total, grace: v.grace, intro: v.intro });
}

const GRACE_MS = 60 * 1000; // when the time is up the person is tagged and gets this one extra minute

// when the reminders are sent, in seconds after the question: halfway, and (for 4 minutes or more) when 1 minute is left
function reminderPoints(totalSec) {
  const pts = [Math.round(totalSec / 2)];
  if (totalSec >= 240) pts.push(totalSec - 60);
  return pts;
}

function clearTimers(v) {
  clearTimeout(v.timer);
  for (const t of v.reminders || []) clearTimeout(t);
  v.reminders = [];
}

// (re)starts the reminder timers and the end timer of an open question
function schedule(sock, key) {
  const v = pending.get(key);
  if (!v) return;
  clearTimers(v);
  const now = Date.now();
  if (!v.grace) {
    const started = v.until - v.total * 1000;
    for (const sec of reminderPoints(v.total)) {
      const at = started + sec * 1000;
      if (at <= now + 1000 || at >= v.until - 5000) continue;
      const t = setTimeout(() => remind(sock, key), at - now);
      if (t.unref) t.unref();
      v.reminders.push(t);
    }
  }
  v.timer = setTimeout(() => expire(sock, key), Math.max(0, v.until - now));
  if (v.timer.unref) v.timer.unref();
}

function remind(sock, key) {
  const v = pending.get(key);
  if (!v) return;
  const left = Math.max(1, Math.round((v.until - Date.now()) / 1000));
  sock.sendMessage(v.group, { text: `⏰ *Reminder:* @${num(v.jid)}, you have not solved the puzzle yet.\n▸ About ${words(left)} left.\n▸ Just type the answer: *${v.question} = ?*\n_If it is not solved in time, you will be removed from the group._`, mentions: [v.jid] }).catch(() => {});
}

// the time is up: the first time the person is tagged and gets one extra minute, the second time they are removed
function expire(sock, key) {
  const v = pending.get(key);
  if (!v) return;
  if (!v.grace) {
    v.grace = true;
    v.until = Date.now() + GRACE_MS;
    persist(key);
    schedule(sock, key);
    sock.sendMessage(v.group, { text: `⏳ *Time is up, @${num(v.jid)}!*\nYou have not solved the puzzle yet, so here is *1 extra minute* as your last chance.\n▸ Type only the answer: *${v.question} = ?*\n▸ If it is still not solved after this minute, you will be removed from the group.`, mentions: [v.jid] }).catch(() => {});
    return;
  }
  pending.delete(key);
  forgetSaved(key);
  kick(sock, v.group, v.jid, `the puzzle was not solved in ${words(v.total)} plus the extra minute`).catch(() => {});
}

// After a restart or a reconnect: every question that was still open gets its timers back. A person whose time ran out while
// the bot was away gets at least one more minute (they could not answer while the bot was offline).
function resume(sock) {
  for (const [key, it] of Object.entries(js.data.items)) {
    if (pending.has(key)) continue;
    const now = Date.now();
    let until = it.until || 0;
    let grace = it.grace === true;
    let tell = false;
    if (until - now < 1000) { // the time ran out while the bot was away
      if (!grace) tell = true;
      grace = true;
      until = now + GRACE_MS;
    }
    pending.set(key, { group: it.group, answer: it.answer, question: it.question || 'the sum', tries: it.tries || 0, ids: it.ids || [num(it.jid)], jid: it.jid, until, total: it.total || 300, grace, intro: it.intro === true, reminders: [] });
    persist(key);
    schedule(sock, key);
    if (tell) sock.sendMessage(it.group, { text: `⏳ *Time is up, @${num(it.jid)}!*\nYou have not solved the puzzle yet, so here is *1 extra minute* as your last chance.\n▸ Type only the answer: *${it.question || 'the sum'} = ?*\n▸ If it is still not solved after this minute, you will be removed from the group.`, mentions: [it.jid] }).catch(() => {});
  }
}

// The introduction of a new member waits for the verification. It is sent once the sum is answered right, with the
// introduction settings of the group as they are at that moment (the admins may have changed them in the meantime).
async function sendIntro(sock, group, jid) {
  const g = store.getGroup(group);
  if (!g.intro || !g.intro.on) return;
  let info = null;
  try {
    info = await meta.getMeta(sock, group);
  } catch (err) {
    info = null;
  }
  await intro.send(sock, group, [jid], info?.subject || 'the group', info?.participants?.length, g.intro).catch((e) => console.error('Introduction error:', e.message));
}

const DEFAULT_VERIFIED = (jid) => `🎉 *Yay, you did it!* @${num(jid)} solved the puzzle. Welcome, you are in! ✅`;

// the message after a right answer: the one the admins saved (@user is the new member), or the default
function verifiedText(group, jid) {
  const own = store.getGroup(group).captchaVerified;
  if (!own) return DEFAULT_VERIFIED(jid);
  const tag = `@${num(jid)}`;
  const text = own.replace(/@user/gi, () => tag);
  return text.includes(tag) ? text : `${tag}\n${text}`; // the new member is always tagged
}

// seconds -> "90 seconds", "5 minutes", "1 hour 30 minutes"
function words(sec) {
  if (sec < 120) return `${sec} seconds`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const parts = [];
  if (m >= 60) parts.push(`${Math.floor(m / 60)} ${Math.floor(m / 60) === 1 ? 'hour' : 'hours'}`);
  if (m % 60) parts.push(`${m % 60} ${m % 60 === 1 ? 'minute' : 'minutes'}`);
  if (s) parts.push(`${s} seconds`);
  return parts.join(' ');
}

// "90", "90s", "5m", "2m30s", "1h" -> seconds (30 seconds to 1 hour); anything else -> null
const MIN_SECONDS = 30;
const MAX_SECONDS = 3600;
function parseSeconds(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(t)) return inRange(Number(t));
  const m = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s(?:ec)?)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return inRange(Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0));
}
const inRange = (n) => (Number.isInteger(n) && n >= MIN_SECONDS && n <= MAX_SECONDS ? n : null);

async function kick(sock, group, jid, why) {
  try {
    await sock.groupParticipantsUpdate(group, [jid], 'remove');
    await sock.sendMessage(group, { text: `🚪 @${num(jid)} was removed: ${why}`, mentions: [jid] });
  } catch (err) {
    await sock.sendMessage(group, { text: `⚠️ *I could not remove @${num(jid)}.*\n▸ Make me a group admin and try again.`, mentions: [jid] }).catch(() => {});
  }
}

// Returns the people who got a question. Their introduction waits until they have answered it.
async function onJoin(sock, group, jids, g) {
  if (!g.captcha) return [];
  const asked = [];
  for (const jid of jids) {
    const a = 2 + Math.floor(Math.random() * 8);
    const b = 2 + Math.floor(Math.random() * 8);
    const key = keyFor(group, jid);
    const old = pending.get(key);
    if (old) clearTimers(old);
    const withIntro = !!(g.intro && g.intro.on);
    const until = Date.now() + g.captchaSeconds * 1000;
    pending.set(key, { group, answer: a + b, question: `${a} + ${b}`, tries: 0, ids: idsOf(jid), jid, until, total: g.captchaSeconds, grace: false, intro: withIntro, reminders: [] });
    persist(key);
    schedule(sock, key);
    asked.push(jid);
    await sock.sendMessage(group, { text: `🔐 *Quick puzzle!*\nHi @${num(jid)}! 👋 Welcome!\n\n*What is this?* This group checks that every new member is a real person and not a spam bot. It only takes a few seconds.\n\n*What to do:* please solve this little puzzle:\n\n*${a} + ${b} = ?*\n\n▸ Count it on your fingers if you like ✋\n▸ Type only the answer number, nothing else.\n▸ You have ${words(g.captchaSeconds)} and ${MAX_TRIES} tries.\n\n⚠️ If it is not solved in time, you will be removed from the group.`, mentions: [jid] }).catch(() => {});
  }
  return asked;
}

// a message in the group: true when it was a verification answer (it is then not handled as normal chat)
function check(sock, msg, group, text, botIds) {
  if (!pending.size) return false;
  const ids = whoIds(msg, botIds);
  const entry = [...pending.entries()].find(([k, v]) => k.startsWith(`${group}|`) && v.ids.some((i) => ids.includes(i)));
  if (!entry || !/^\s*-?\d{1,3}\s*$/.test(text)) return false;
  const [key, v] = entry;
  if (Number(text) === v.answer) {
    clearTimers(v);
    pending.delete(key);
    forgetSaved(key);
    const done = sock.sendMessage(group, { text: verifiedText(group, v.jid), mentions: [v.jid] }).catch(() => {});
    if (v.intro) done.then(() => sendIntro(sock, group, v.jid)).catch(() => {}); // the introduction follows the verification
    return true;
  }
  v.tries += 1;
  if (js.data.items[key]) {
    js.data.items[key].tries = v.tries;
    js.touch();
  }
  if (v.tries >= MAX_TRIES) {
    clearTimers(v);
    pending.delete(key);
    forgetSaved(key);
    kick(sock, group, v.jid, 'the puzzle was not solved after 3 tries').catch(() => {});
  } else {
    sock.sendMessage(group, { text: `❌ *Oops, not quite,* @${num(v.jid)}. Look again and try once more! You have ${MAX_TRIES - v.tries} ${MAX_TRIES - v.tries === 1 ? 'try' : 'tries'} left.`, mentions: [v.jid] }).catch(() => {});
  }
  return true;
}

// raid protection: too many joins in a short time -> lock the group (and remove the new ones)
async function onRaid(sock, group, jids, g, now = Date.now()) {
  if (g.antiraid === 'off') return false;
  const list = (joins.get(group) || []).filter((j) => now - j.t < g.antiraidSeconds * 1000);
  for (const jid of jids) list.push({ t: now, jid });
  joins.set(group, list);
  if (joins.size > 500) joins.clear();
  if (list.length < g.antiraidJoins) return false;
  joins.delete(group);
  try {
    await sock.groupSettingUpdate(group, 'announcement'); // only admins can write
    if (g.antiraid === 'kick') await sock.groupParticipantsUpdate(group, list.map((j) => j.jid), 'remove');
    await sock.sendMessage(group, { text: `🚨 *Raid protection*\n${list.length} people joined within ${g.antiraidSeconds} seconds.\nThe group is now *locked* (only admins can write)${g.antiraid === 'kick' ? ' and the new members were removed' : ''}.\n_Admins: open it again when it is safe._` });
  } catch (err) {
    await sock.sendMessage(group, { text: '🚨 *Raid warning:* many people joined at once, but I could not lock the group. Make me an admin.' }).catch(() => {});
  }
  return true;
}

module.exports = { reminderPoints, GRACE_MS, onJoin, check, onRaid, pending, resume, sendIntro, verifiedText, DEFAULT_VERIFIED, words, parseSeconds, MIN_SECONDS, MAX_SECONDS };
