// New members must answer a small sum, or they are removed. Also: raid protection (many people joining at once).
const levels = require('./levels');
const idmap = require('./idmap');
const { num, whoIds } = require('./utils');
const jsonstore = require('../core/jsonstore');

// Open questions are saved (data/captcha-pending.json). A restart used to forget them: new members who had not answered yet
// were never removed. Now every open question is picked up again after a restart (resume below).
const js = jsonstore.open('captcha-pending', { items: {} }, { delay: 300 });

const pending = new Map(); // "group|key" -> { answer, tries, jids, ids, timer }
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

// After a restart or a reconnect: every question that was still open gets its timer back. A person whose time ran out while
// the bot was away gets at least one more minute (they could not answer while the bot was offline).
function resume(sock) {
  for (const [key, it] of Object.entries(js.data.items)) {
    if (pending.has(key)) continue;
    const left = Math.max(60000, (it.until || 0) - Date.now());
    const timer = setTimeout(() => {
      if (pending.delete(key)) {
        forgetSaved(key);
        kick(sock, it.group, it.jid, 'did not answer the verification in time').catch(() => {});
      }
    }, left);
    if (timer.unref) timer.unref();
    pending.set(key, { answer: it.answer, tries: it.tries || 0, ids: it.ids || [num(it.jid)], jid: it.jid, timer });
  }
}

async function kick(sock, group, jid, why) {
  try {
    await sock.groupParticipantsUpdate(group, [jid], 'remove');
    await sock.sendMessage(group, { text: `🚪 @${num(jid)} was removed: ${why}`, mentions: [jid] });
  } catch (err) {
    await sock.sendMessage(group, { text: `⚠️ I could not remove @${num(jid)}. I must be a group admin.`, mentions: [jid] }).catch(() => {});
  }
}

async function onJoin(sock, group, jids, g) {
  if (!g.captcha) return;
  for (const jid of jids) {
    const a = 2 + Math.floor(Math.random() * 8);
    const b = 2 + Math.floor(Math.random() * 8);
    const key = keyFor(group, jid);
    clearTimeout(pending.get(key)?.timer);
    const timer = setTimeout(() => {
      if (pending.delete(key)) {
        forgetSaved(key);
        kick(sock, group, jid, `did not answer the verification in ${g.captchaSeconds} seconds`).catch(() => {});
      }
    }, g.captchaSeconds * 1000);
    if (timer.unref) timer.unref();
    pending.set(key, { answer: a + b, tries: 0, ids: idsOf(jid), jid, timer });
    saveItem(key, group, { answer: a + b, tries: 0, ids: idsOf(jid), jid, until: Date.now() + g.captchaSeconds * 1000 });
    await sock.sendMessage(group, { text: `🔐 *Verification*\nWelcome @${num(jid)}! Answer this to stay in the group:\n\n*${a} + ${b} = ?*\n\n_Send only the number. You have ${g.captchaSeconds} seconds and ${MAX_TRIES} tries._`, mentions: [jid] }).catch(() => {});
  }
}

// a message in the group: true when it was a verification answer (it is then not handled as normal chat)
function check(sock, msg, group, text, botIds) {
  if (!pending.size) return false;
  const ids = whoIds(msg, botIds);
  const entry = [...pending.entries()].find(([k, v]) => k.startsWith(`${group}|`) && v.ids.some((i) => ids.includes(i)));
  if (!entry || !/^\s*-?\d{1,3}\s*$/.test(text)) return false;
  const [key, v] = entry;
  if (Number(text) === v.answer) {
    clearTimeout(v.timer);
    pending.delete(key);
    forgetSaved(key);
    sock.sendMessage(group, { text: `✅ @${num(v.jid)} is verified. Welcome!`, mentions: [v.jid] }).catch(() => {});
    return true;
  }
  v.tries += 1;
  if (js.data.items[key]) {
    js.data.items[key].tries = v.tries;
    js.touch();
  }
  if (v.tries >= MAX_TRIES) {
    clearTimeout(v.timer);
    pending.delete(key);
    forgetSaved(key);
    kick(sock, group, v.jid, 'failed the verification').catch(() => {});
  } else {
    sock.sendMessage(group, { text: `❌ Wrong answer, @${num(v.jid)}. ${MAX_TRIES - v.tries} ${MAX_TRIES - v.tries === 1 ? 'try' : 'tries'} left.`, mentions: [v.jid] }).catch(() => {});
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

module.exports = { onJoin, check, onRaid, pending, resume };
