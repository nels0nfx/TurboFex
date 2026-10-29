const store = require('./store');
const meta = require('./metadata');
const replay = require('./replay');
const { num } = require('./utils');
const adminguard = require('./adminguard');
const captcha = require('./captcha');

const recent = new Map();

// WhatsApp can deliver the same group event twice
function isDuplicate(update) {
  const ids = (update.participants || []).map((p) => (typeof p === 'string' ? p : p?.id)).sort().join(',');
  const key = `${update.id}|${update.action}|${ids}`;
  const now = Date.now();
  if (now - (recent.get(key) || 0) < 30000) return true;
  recent.set(key, now);
  if (recent.size > 500) recent.clear();
  return false;
}

// Fills in @user, {group} and {count} in the saved message
function render(template, jid, name, count) {
  return template
    .replace(/@user/gi, () => `@${num(jid)}`)
    .replace(/\{group\}/gi, () => name)
    .replace(/\{count\}/gi, () => String(count ?? ''));
}

// Runs when people join, leave, or are promoted / demoted
async function handleParticipants(sock, update) {
  const { id, participants, action, author } = update;
  if (!meta.applyParticipants(id, action, participants)) meta.invalidate(id);
  if (isDuplicate(update)) return;
  // events WhatsApp replays right after (re)connecting are old news: no greetings for them
  const stale = replay.inWindow();

  const g = store.getGroup(id);
  const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(num);
  const ids = (participants || [])
    .map((p) => (typeof p === 'string' ? p : p?.id))
    .filter(Boolean)
    .filter((j) => !botIds.includes(num(j)));
  if (!ids.length) return;

  // Protection against take-overs: unauthorised promotions / demotions are undone
  if ((action === 'promote' || action === 'demote') && !stale) adminguard.guardAdmins(sock, id, action, ids, author).catch((e) => console.error('Admin guard error:', e.message));

  // Promote / demote notices
  if (action === 'promote' || action === 'demote') {
    if (!g.pdm || stale) return;
    const by = author ? ` by @${num(author)}` : '';
    const text = ids
      .map((j) => `${action === 'promote' ? '👑' : '⬇️'} @${num(j)} was ${action === 'promote' ? 'promoted to admin' : 'demoted'}${by}.`)
      .join('\n');
    return sock.sendMessage(id, { text, mentions: [...ids, ...(author ? [author] : [])] });
  }

  if (action !== 'add' && action !== 'remove') return;
  if (action === 'add' && !stale) {
    captcha.onRaid(sock, id, ids, g).catch((e) => console.error('Raid protection error:', e.message)); // many joins at once
    captcha.onJoin(sock, id, ids, g).catch((e) => console.error('Verification error:', e.message)); // a question for every new member
  }

  let removed = [];
  if (action === 'add' && g.antifake.length) {
    // Anti-fake: only numbers starting with the allowed country codes may join
    const bad = ids.filter(
      (j) => j.endsWith('@s.whatsapp.net') && !g.antifake.some((p) => num(j).startsWith(p))
    );
    if (bad.length) {
      try {
        await sock.groupParticipantsUpdate(id, bad, 'remove');
        removed = bad;
        meta.invalidate(id);
        await sock.sendMessage(id, {
          text: `🚫 Removed ${bad.map((j) => '@' + num(j)).join(' ')}: numbers from other countries are not allowed here.`,
          mentions: bad,
        });
      } catch (err) {
        // the bot is not an admin, nothing we can do
      }
    }
  }

  if (action === 'add' && (!g.welcome || stale)) return;
  if (action === 'remove' && (!g.goodbye || stale)) return;

  let info = null;
  try {
    info = await meta.getMeta(sock, id);
  } catch (err) {
    info = null;
  }
  const name = info?.subject || 'the group';
  const count = info?.participants?.length;
  const template =
    action === 'add'
      ? g.welcomeText || store.DEFAULT_WELCOME
      : g.goodbyeText || store.DEFAULT_GOODBYE;

  for (const j of ids.filter((x) => !removed.includes(x))) {
    await sock.sendMessage(id, { text: render(template, j, name, count), mentions: [j] });
  }
}

module.exports = { handleParticipants };
