// Introduction message: when someone joins a group where the admins switched it on, the bot sends the introduction text the
// admins saved (and the picture they attached, if any), tags the new member, and tells them how long they have to introduce
// themselves. If the welcome message is ON, it goes out first and the introduction follows it.
const fs = require('fs');
const path = require('path');
const { DATA } = require('../core/paths');
const clock = require('../core/clock');
const { num } = require('./utils');

const DIR = path.join(DATA, 'intro');
const MAX_TEXT = 900;
const MIN_MS = 5 * 60 * 1000; // 5 minutes
const MAX_MS = 30 * 24 * 3600 * 1000; // 30 days

const DEFAULT_INTRO = '👋 *Please introduce yourself*\n▸ Your name\n▸ Your age\n▸ Where you are from\n▸ What brings you here';

const fileOf = (jid) => path.join(DIR, `${String(jid).replace(/[^0-9a-z-]/gi, '_')}.jpg`);
const hasImage = (jid) => fs.existsSync(fileOf(jid));
const loadImage = (jid) => {
  try {
    return fs.readFileSync(fileOf(jid));
  } catch (err) {
    return null;
  }
};
const removeImage = (jid) => fs.rmSync(fileOf(jid), { force: true });

// keeps the picture small and as a JPEG when the picture tool exists; otherwise the picture is kept as it is
async function saveImage(jid, buffer, sharp) {
  let out = buffer;
  if (sharp) {
    try {
      out = await sharp(buffer).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    } catch (err) {
      out = buffer;
    }
  }
  if (out.length > 5 * 1024 * 1024) throw Object.assign(new Error('That picture is too big. Please send one under 5 MB.'), { code: 'TOO_BIG' });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(jid), out);
}

// "24h", "2d", "90m", "1h30m", "1d12h" -> milliseconds; "off" / "none" / "0" -> 0; anything else -> null
function parseLimit(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  if (['off', 'none', 'no', '0'].includes(t)) return 0;
  const m = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const ms = ((Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 60000;
  return ms >= MIN_MS && ms <= MAX_MS ? ms : null;
}

// "1 day", "24 hours", "90 minutes" (said to the new member)
function words(ms) {
  const mins = Math.round(ms / 60000);
  if (mins >= 2880 && mins % 1440 === 0) return `${mins / 1440} days`; // 24 hours reads better than 1 day
  if (mins % 60 === 0) return `${mins / 60} ${mins / 60 === 1 ? 'hour' : 'hours'}`;
  if (mins > 60) return clock.duration(ms);
  return `${mins} minutes`;
}

// the finished message for the new members (@user, {group}, {count} and {time} are filled in)
function compose(intro, ids, name, count) {
  const tags = ids.map((j) => `@${num(j)}`).join(' ');
  const limit = Number(intro.timeMs) > 0 ? words(intro.timeMs) : '';
  let text = String(intro.text || DEFAULT_INTRO)
    .replace(/@user/gi, () => tags)
    .replace(/\{group\}/gi, () => name || 'the group')
    .replace(/\{count\}/gi, () => String(count ?? ''))
    .replace(/\{time\}/gi, () => limit);
  if (!/@user/i.test(String(intro.text || '')) && !text.includes(tags)) text = `${tags}\n\n${text}`; // the new member is always tagged
  if (limit && !/\{time\}/i.test(String(intro.text || ''))) text += `\n\n⏳ *You have ${limit} to introduce yourself.*`;
  return text;
}

// sends the introduction for these new members; returns true when something was sent
async function send(sock, groupJid, ids, name, count, intro) {
  if (!ids.length) return false;
  const text = compose(intro, ids, name, count);
  const image = hasImage(groupJid) ? loadImage(groupJid) : null;
  if (image && text.length <= 1000) {
    await sock.sendMessage(groupJid, { image, caption: text, mentions: ids });
    return true;
  }
  if (image) await sock.sendMessage(groupJid, { image });
  await sock.sendMessage(groupJid, { text, mentions: ids });
  return true;
}

module.exports = { DEFAULT_INTRO, MAX_TEXT, MIN_MS, MAX_MS, parseLimit, words, compose, send, hasImage, loadImage, saveImage, removeImage, fileOf };
