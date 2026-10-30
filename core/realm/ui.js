// One look for every reply of the Empire of Fex: a bold title, the facts, and a few hints. All commands use these.
const AURUM = 'Aurum';
const SIGN = '🪙';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const money = (n) => `${fmt(n)} ${AURUM}`;
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
const tag = (jid) => `@${num(jid)}`;
const signed = (n) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
function dur(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const bar = (a, b, size = 10) => {
  const f = Math.max(0, Math.min(size, Math.round((a / Math.max(1, b)) * size)));
  return `${'█'.repeat(f)}${'░'.repeat(size - f)}`;
};

// a tiny chart of the last values: ▁▂▃▄▅▆▇█
const spark = (values, size = 12) => {
  const v = values.slice(-size);
  if (v.length < 2) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const bars = '▁▂▃▄▅▆▇█';
  return v.map((x) => bars[hi === lo ? 3 : Math.round(((x - lo) / (hi - lo)) * 7)]).join('');
};

// card('🎁', 'Daily gift', ['*Earned:* +300 Aurum', ...], ['`.purse` – your money'], 'a note')
function card(icon, title, rows = [], hints = [], note = '') {
  const out = [`${icon} *${title}*`];
  if (rows.length) out.push(...rows);
  if (hints.length) out.push('', ...hints.map((h) => `▸ ${h}`));
  if (note) out.push('', `_${note}_`);
  return out.join('\n');
}
const warn = (text) => `⚠️ *${text}*`;
const info = (text) => `ℹ️ *${text}*`;
const wait = (what, ms) => `⏳ *${what}* Try again in *${dur(ms)}*.`;

module.exports = { spark, AURUM, SIGN, fmt, money, num, tag, signed, dur, bar, card, warn, info, wait };
