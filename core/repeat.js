// Repeating schedules: how a "schedule" line is understood, written back in words, and when an item is due.
//   schedule 18:30 Dinner time!                     every day (the old way keeps working)
//   schedule once 18:30 Meeting now                 one time
//   schedule weekdays 07:30 Good morning            Monday to Friday   (also: weekends)
//   schedule weekly mon,thu 19:00 Training today    chosen days        (short form: schedule mon,thu 19:00 text)
//   schedule monthly 1 09:00 Rent is due            a day of the month (29-31: the last day in shorter months)
//   schedule every 2h Drink some water              every 10 minutes ... 7 days
// The owner can also schedule a BOT COMMAND instead of text:  schedule daily 07:00 run joke   (or with the prefix: .joke)
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_WORDS = { mon: 'mon', monday: 'mon', tue: 'tue', tues: 'tue', tuesday: 'tue', wed: 'wed', wednesday: 'wed', thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu', fri: 'fri', friday: 'fri', sat: 'sat', saturday: 'sat', sun: 'sun', sunday: 'sun' };
const MIN_EVERY_MIN = 10;
const MAX_EVERY_MIN = 7 * 24 * 60;

const hhmm = (t) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(t || '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

function days(word) {
  const list = String(word || '').toLowerCase().split(/[,/]/).filter(Boolean).map((d) => DAY_WORDS[d]);
  return list.length && list.every(Boolean) ? [...new Set(list)].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)) : null;
}

function every(word) {
  const m = /^(\d{1,4})\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i.exec(String(word || '').trim());
  if (!m) return null;
  const unit = m[2][0].toLowerCase();
  return Number(m[1]) * (unit === 'm' ? 1 : unit === 'h' ? 60 : 1440);
}

// rest = everything after "schedule". Returns { repeat, time, body } or { error }
function parse(rest) {
  const words = String(rest || '').trim().split(/\s+/);
  let i = 0;
  const w = (words[i] || '').toLowerCase();
  let repeat = { kind: 'daily' };
  let time = null;

  if (w === 'once' || w === 'one' || w === 'today') {
    repeat = { kind: 'once' };
    i += 1;
  } else if (w === 'daily' || w === 'everyday') {
    i += 1;
  } else if (w === 'weekdays') {
    repeat = { kind: 'weekdays' };
    i += 1;
  } else if (w === 'weekends') {
    repeat = { kind: 'weekends' };
    i += 1;
  } else if (w === 'weekly' || (w === 'every' && days(words[i + 1]))) {
    const d = days(words[i + 1]);
    if (!d) return { error: 'days' };
    repeat = { kind: 'weekly', days: d };
    i += 2;
  } else if (days(w)) {
    repeat = { kind: 'weekly', days: days(w) };
    i += 1;
  } else if (w === 'monthly') {
    const dom = Number(words[i + 1]);
    if (!Number.isInteger(dom) || dom < 1 || dom > 31) return { error: 'monthday' };
    repeat = { kind: 'monthly', dom };
    i += 2;
  } else if (w === 'every') {
    const min = every(words[i + 1]) || every(`${words[i + 1] || ''}${words[i + 2] || ''}`);
    if (!min) return { error: 'every' };
    if (min < MIN_EVERY_MIN) return { error: 'tooOften' };
    if (min > MAX_EVERY_MIN) return { error: 'tooRare' };
    repeat = { kind: 'interval', everyMin: min };
    i += every(words[i + 1]) ? 2 : 3;
  }

  if (repeat.kind !== 'interval') {
    time = hhmm(words[i]);
    if (!time) return { error: 'time' };
    i += 1;
  }
  const body = words.slice(i).join(' ');
  // keep the original spacing and new lines of the message
  const at = String(rest).trim();
  let cut = 0;
  for (let k = 0; k < i; k += 1) cut = at.indexOf(words[k], cut) + words[k].length;
  const text = at.slice(cut).trim() || body;
  if (!text) return { error: 'text' };
  return { repeat, time, text };
}

// the words behind an item, e.g. "every day at 18:30", "Mon, Thu at 19:00", "every 2 hours"
function describe(item) {
  const r = item.repeat || { kind: item.once ? 'once' : 'daily' };
  const cap = (d) => d[0].toUpperCase() + d.slice(1);
  switch (r.kind) {
    case 'once': return `once at ${item.time}`;
    case 'weekdays': return `Mon-Fri at ${item.time}`;
    case 'weekends': return `Sat-Sun at ${item.time}`;
    case 'weekly': return `${r.days.map(cap).join(', ')} at ${item.time}`;
    case 'monthly': return `day ${r.dom} of the month at ${item.time}`;
    case 'interval': return r.everyMin % 1440 === 0 ? `every ${r.everyMin / 1440} day(s)` : r.everyMin % 60 === 0 ? `every ${r.everyMin / 60} hour(s)` : `every ${r.everyMin} minutes`;
    default: return `every day at ${item.time}`;
  }
}

const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

// parts = clock.parts(): { hhmm, dow, dom, y, mo }. Time-of-day items only (an "every N hours" item is checked by dueInterval).
function isDue(item, parts) {
  const r = item.repeat || { kind: item.once ? 'once' : 'daily' };
  if (r.kind === 'interval' || item.time !== parts.hhmm) return false;
  switch (r.kind) {
    case 'weekdays': return !['sat', 'sun'].includes(parts.dow);
    case 'weekends': return ['sat', 'sun'].includes(parts.dow);
    case 'weekly': return r.days.includes(parts.dow);
    case 'monthly': return parts.dom === Math.min(r.dom, lastDayOf(parts.y, parts.mo));
    default: return true; // daily, once
  }
}

// "every N minutes" items: true when it is time. nextAt moves forward by itself.
function dueInterval(item, now = Date.now()) {
  const r = item.repeat;
  if (!r || r.kind !== 'interval') return false;
  if (!item.nextAt) {
    item.nextAt = now + r.everyMin * 60000;
    return false;
  }
  if (now < item.nextAt) return false;
  item.nextAt = now + r.everyMin * 60000; // never "catches up" after the bot was offline
  return true;
}

module.exports = { parse, describe, isDue, dueInterval, MIN_EVERY_MIN, DAYS };
