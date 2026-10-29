// Personal money tracker, one record per person (data/budget.json)
const fs = require('fs');
const path = require('path');
const clock = require('../core/clock');
const { whoIds, num } = require('./utils');
const { DATA } = require('../core/paths');

const dir = DATA;
const file = path.join(dir, 'budget.json');
const MAX_ENTRIES = 500;

let db = {};
try {
  db = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  db = {};
}

function save() {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db));
  } catch (err) {
    console.error('Could not save budget data:', err.message);
  }
}

function user(key) {
  const u = db[key] || (db[key] = { limit: null, entries: [] });
  if (!Array.isArray(u.entries)) u.entries = [];
  return u;
}

function add(key, type, amount, note) {
  const u = user(key);
  u.entries.push({ t: Date.now(), type, amt: amount, note: String(note || '').slice(0, 60) });
  if (u.entries.length > MAX_ENTRIES) u.entries.splice(0, u.entries.length - MAX_ENTRIES);
  save();
}

function setLimit(key, amount) {
  user(key).limit = amount;
  save();
}

function clear(key) {
  delete db[key];
  save();
}

// totals for the current month
function month(key) {
  const u = user(key);
  const nowKey = clock.monthOf();
  const list = u.entries.filter((e) => clock.monthOf(e.t) === nowKey);
  const income = list.filter((e) => e.type === 'in').reduce((a, e) => a + e.amt, 0);
  const spent = list.filter((e) => e.type === 'out').reduce((a, e) => a + e.amt, 0);
  return { limit: u.limit, income, spent, list };
}

function money(n) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function parseAmount(text) {
  const n = parseFloat(String(text || '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 && n < 1e12 ? Math.round(n * 100) / 100 : null;
}

// who the money belongs to
const userKey = (msg, botIds) => whoIds(msg, botIds)[0] || num(msg.key.remoteJid);

const PRIVACY = '\n🔒 Tip: use this in a private chat with me so others cannot see your money.';

// Shared code for !income and !expense
async function entry(ctx, type) {
  const { msg, args, reply, prefix, cmdName, isGroup, botIds } = ctx;
  const amount = parseAmount(args[0]);
  if (!amount) return reply(`Type the amount first.\nExample: ${prefix}${cmdName} 250 groceries`);

  const note = args.slice(1).join(' ');
  const key = userKey(msg, botIds);
  add(key, type, amount, note);
  const m = month(key);

  let text = `${type === 'out' ? '📤 Expense' : '📥 Income'} saved: ${money(amount)}${note ? ` (${note})` : ''}`;
  text += `\n📅 ${clock.monthLabel()}: income ${money(m.income)} • spent ${money(m.spent)}`;
  if (type === 'out' && m.limit) {
    const left = m.limit - m.spent;
    text += left >= 0
      ? `\n🎯 ${money(left)} left of your ${money(m.limit)} budget`
      : `\n🚨 You are ${money(-left)} over your ${money(m.limit)} budget!`;
  }
  return reply(text + (isGroup ? PRIVACY : ''));
}

module.exports = { add, setLimit, clear, month, money, parseAmount, userKey, entry, PRIVACY };
