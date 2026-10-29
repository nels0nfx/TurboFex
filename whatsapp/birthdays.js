// Birthdays: everybody saves their own, groups that switch it on get a message at 08:00 on the day.
const jsonstore = require('../core/jsonstore');
const clock = require('../core/clock');
const store = require('./store');
const meta = require('./metadata');
const { num } = require('./utils');

const js = jsonstore.open('birthdays', {}); // { personKey: { d, m, jid, ids: [numbers] } }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// "25-12", "25/12", "25.12", "25 Dec", "Dec 25", "25 december" -> { d, m } or null (a year is ignored)
function parse(text) {
  const t = String(text || '').toLowerCase().trim();
  let d;
  let m;
  let x = /^(\d{1,2})\s*[-/. ]\s*(\d{1,2})(?:\s*[-/. ]\s*\d{2,4})?$/.exec(t);
  if (x) {
    d = Number(x[1]);
    m = Number(x[2]);
  } else if ((x = /^(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+\d{2,4})?$/.exec(t))) {
    d = Number(x[1]);
    m = MONTHS.indexOf(x[2].slice(0, 3)) + 1;
  } else if ((x = /^([a-z]{3,9})\s+(\d{1,2})(?:\s*(?:st|nd|rd|th))?(?:\s+\d{2,4})?$/.exec(t))) {
    d = Number(x[2]);
    m = MONTHS.indexOf(x[1].slice(0, 3)) + 1;
  } else {
    return null;
  }
  return m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN[m - 1] ? { d, m } : null;
}

const keyOf = (ids) => ids[0];
function save(ids, jid, bd) {
  js.data[keyOf(ids)] = { ...bd, jid, ids };
  js.touch();
}
function remove(ids) {
  const had = !!find(ids);
  for (const [k, v] of Object.entries(js.data)) if (v.ids.some((i) => ids.includes(i))) delete js.data[k];
  js.touch();
  return had;
}
function find(ids) {
  return Object.values(js.data).find((v) => v.ids.some((i) => ids.includes(i))) || null;
}

// today's day and month in the bot's time zone
function today(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: clock.zone(), day: 'numeric', month: 'numeric' }).formatToParts(now);
  return { d: Number(f.find((p) => p.type === 'day').value), m: Number(f.find((p) => p.type === 'month').value) };
}

// days until the next birthday (0 = today)
function daysUntil(bd, now = new Date()) {
  const t = today(now);
  const base = Date.UTC(2001, t.m - 1, t.d); // 2001 is no leap year: 29 Feb counts as 1 Mar
  let next = Date.UTC(2001, bd.m - 1, Math.min(bd.d, bd.m === 2 && bd.d === 29 ? 28 : bd.d));
  if (next < base) next = Date.UTC(2002, bd.m - 1, Math.min(bd.d, bd.m === 2 && bd.d === 29 ? 28 : bd.d));
  return Math.round((next - base) / 86400000);
}

// the members of a group (saved group info) who saved a birthday: [{ bd, jid }]
function inGroup(groupMetadata) {
  const out = [];
  for (const p of groupMetadata?.participants || []) {
    const ids = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map((x) => num(x));
    const bd = find(ids);
    if (bd) out.push({ bd, jid: p.id });
  }
  return out;
}

// 08:00: groups that switched birthdays on are told
async function announceToday(sock) {
  const t = today();
  const sent = [];
  const groups = [];
  store.forEachGroup((jid, g) => {
    if (g.birthdays) groups.push(jid);
  });
  for (const jid of groups) {
    try {
      const info = await meta.getMeta(sock, jid);
      const list = inGroup(info).filter((x) => x.bd.d === t.d && x.bd.m === t.m);
      if (!list.length) continue;
      const tags = list.map((x) => `@${num(x.jid)}`).join(', ');
      // "@all" is WhatsApp's own tag-all: it notifies every member (nonJidMentions: 1). The birthday people are tagged by name as well.
      await sock.sendMessage(jid, {
        text: `@all\n🎂 *Happy Birthday!*\n${tags}\n_Wishing you a wonderful day from everyone here!_`,
        mentions: list.map((x) => x.jid),
        contextInfo: { nonJidMentions: 1 },
      });
      sent.push(jid);
    } catch (err) {
      console.log(`Birthday message failed for ${jid}: ${err.message}`);
    }
  }
  return sent;
}

module.exports = { parse, save, remove, find, today, daysUntil, inGroup, announceToday, MONTHS };
