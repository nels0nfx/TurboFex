// Time helpers. The time zone comes from (in order): TIMEZONE variable, config.js "timezone", or Johannesburg.
const config = require('../config');

function zone() {
  const z = process.env.TIMEZONE || config.timezone || 'Africa/Johannesburg';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: z });
    return z;
  } catch (err) {
    return 'UTC';
  }
}

function parts(date = new Date()) {
  const timeZone = zone();
  const fmt = (locale, opts) => new Intl.DateTimeFormat(locale, { timeZone, ...opts }).format(date);
  return {
    zone: timeZone,
    time: fmt('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    day: fmt('en-GB', { weekday: 'long' }),
    date: fmt('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    hhmm: fmt('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  };
}

// "6:30" -> "06:30", anything invalid -> null
function parseHHMM(text) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

// 3725 seconds -> "1h 2m"
function uptime(seconds = process.uptime()) {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

// "2026-10" for the month a timestamp falls in (in the bot's time zone)
function monthOf(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone(), year: 'numeric', month: '2-digit' }).format(new Date(ts));
}

// "Oct 2026"
function monthLabel(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone(), month: 'short', year: 'numeric' }).format(new Date(ts));
}

// "3 Oct"
function shortDate(ts) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone(), day: 'numeric', month: 'short' }).format(new Date(ts));
}

// 5400000 -> "1h 30m"
function duration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'less than a minute';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

// "3 Oct, 18:30"
function stamp(ts) {
  const d = new Date(ts);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone(), day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${day}, ${time}`;
}

module.exports = { zone, parts, parseHHMM, uptime, monthOf, monthLabel, shortDate, duration, stamp };
