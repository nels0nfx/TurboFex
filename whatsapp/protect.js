const store = require('./store');
const { peel } = require('./unwrap');
const { enforce } = require('./moderation');
const levels = require('./levels');
const { num } = require('./utils');

const LINK_REGEX =
  /(https?:\/\/\S+|www\.\S+|chat\.whatsapp\.com\/\S+|wa\.me\/\S+|t\.me\/\S+|discord\.gg\/\S+)/i;

const hits = new Map();

// Is this member flooding? cfg = { limit, seconds, repeat }: too many messages in a short time, or the same text again and again
function isSpam(jid, sender, cfg = {}, text = '') {
  const { limit = 6, seconds = 8, repeat = 0 } = cfg;
  const key = `${jid}|${sender}`;
  const now = Date.now();
  const norm = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const list = (hits.get(key) || []).filter((h) => now - h.t < seconds * 1000);
  list.push({ t: now, text: norm });
  const same = norm ? list.filter((h) => h.text === norm).length : 0;
  if (list.length >= limit || (repeat >= 2 && same >= repeat)) {
    hits.delete(key);
    return true;
  }
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

// Does the message contain one of these WhatsApp message types (also inside wrappers)?
function hasType(obj, names, depth = 3) {
  if (!obj || typeof obj !== 'object' || depth < 0) return false;
  for (const k of Object.keys(obj)) {
    if (names.includes(k) && obj[k]) return true;
    if (depth > 0 && obj[k] && typeof obj[k] === 'object' && hasType(obj[k], names, depth - 1)) return true;
  }
  return false;
}

// which kind of media does a message hold? (also inside wrappers)
const MEDIA_KINDS = { stickerMessage: 'sticker', imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', documentMessage: 'document', ptvMessage: 'video' };
function mediaKindOf(message) {
  const { content } = peel(message);
  for (const [key, kind] of Object.entries(MEDIA_KINDS)) if (content[key]) return kind;
  return null;
}

// Messages written by another bot. Bot libraries (Baileys) build message ids in their own pattern, which the phone apps do
// not use: "BAE5" + 12 characters (older), and "3EB0" + a long id (newer). The "3EB0" ones are also what WhatsApp Web
// can produce, so that part can be switched off (antibot strict off). Returns { bot, why }.
function botVerdict(id, strict = true) {
  const s = String(id || '');
  if (/^BAE5[0-9A-F]{12}$/i.test(s)) return { bot: true, why: 'the id starts with BAE5 (a bot library)' };
  if (strict && /^3EB0[0-9A-F]{18,}$/i.test(s)) return { bot: true, why: 'the id starts with 3EB0 and is long (a linked-device bot; WhatsApp Web users can look like this too)' };
  return { bot: false, why: 'the id looks like it came from a phone app' };
}
const looksLikeBot = (id, strict = true) => botVerdict(id, strict).bot;

// the largest number of people tagged in one message
function mentionCount(message) {
  const { content } = peel(message);
  let max = 0;
  for (const v of Object.values(content || {})) {
    const n = v && typeof v === 'object' ? v.contextInfo?.mentionedJid?.length || 0 : 0;
    if (n > max) max = n;
  }
  return max;
}

// slow mode: when did each member last write? (a message that is too soon is deleted)
const lastPost = new Map();
function tooSoon(jid, sender, seconds) {
  if (!seconds) return false;
  const key = `${jid}|${sender}`;
  const now = Date.now();
  if (now - (lastPost.get(key) || 0) < seconds * 1000) return true;
  lastPost.set(key, now);
  if (lastPost.size > 20000) lastPost.clear();
  return false;
}

// a short notice, at most once in a while per person, so a flood of deleted messages is not answered with a flood of notices
const noticed = new Map();
async function notice(sock, jid, sender, text) {
  const key = `${jid}|${sender}`;
  if (Date.now() - (noticed.get(key) || 0) < 30000) return;
  noticed.set(key, Date.now());
  if (noticed.size > 5000) noticed.clear();
  try {
    await sock.sendMessage(jid, { text, mentions: [sender] });
  } catch (err) {
    // the message was deleted already: the notice is a courtesy
  }
}

const GROUP_MENTION = ['groupStatusMentionMessage']; // "X mentioned this group in a status"
const GROUP_POST = ['groupStatusMessage', 'groupStatusMessageV2']; // a status posted inside the group
const { isGroupStatusPost, shapeOf } = require('./shape');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findBadWord(text, words) {
  if (!words.length) return null;
  const lower = text.toLowerCase();
  return (
    words.find((w) =>
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(w)}($|[^\\p{L}\\p{N}])`, 'u').test(lower)
    ) || null
  );
}

// "antigstatus debug" (owner): for 10 minutes the owner gets the SHAPE (only the names of the parts, never the content) of the
// messages that look unusual, so a group status that is not recognised can be seen and fixed.
// What happened to group statuses since the bot started (shown by the antigstatus command, so nobody needs the console)
const gstats = { seen: 0, deleted: 0, refused: 0, adminPosted: 0, botNotAdmin: 0, ownPosts: 0 };
const debug = { until: 0, left: 0 };
const COMMON = new Set(['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage', 'reactionMessage', 'contactMessage', 'locationMessage', 'messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage', 'pollCreationMessage', 'pollUpdateMessage', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']);
function startDebug() {
  debug.until = Date.now() + 10 * 60 * 1000;
  debug.left = 8;
}
async function debugReport(sock, jid, msg, sender, roles, outcome) {
  const keys = Object.keys(msg.message || {});
  const unusual = !keys.length || keys.some((k) => !COMMON.has(k));
  if (!unusual && !outcome) return;
  debug.left -= 1;
  const me = String(sock.user?.id || '').replace(/:\d+@/, '@');
  try {
    await sock.sendMessage(me, { text: `🔎 *Anti group status check*\n▸ *Parts:* ${shapeOf(msg.message).join(', ') || 'none (empty message)'}\n▸ *Sender is admin:* ${roles.isAdmin ? 'yes' : 'no'}\n▸ *Bot is admin:* ${roles.isBotAdmin ? 'yes' : 'no'}\n▸ *Recognised as group status:* ${outcome ? 'yes' : 'no'}${outcome === 'deleted' ? '\n▸ *Delete:* sent' : outcome ? '\n▸ *Delete:* failed' : ''}${outcome ? `\n▸ *WhatsApp answered:* ${require('./delivery').last.delete}` : ''}` });
  } catch (err) {
    // nothing more we can do
  }
}

// Returns true if the message broke a rule and was dealt with
async function runProtections({ sock, msg, jid, text, getRoles }) {
  const sender = msg.key.participant || msg.key.participantAlt || msg.participant; // newer WhatsApp can hide the first one
  if (!sender) return false;
  const g = store.getGroup(jid);

  const hasLink = g.antilinkMode !== 'off' && text && LINK_REGEX.test(text);
  const badWord = g.antiwordMode !== 'off' && text ? findBadWord(text, g.badWords) : null;
  const spam = g.antispamMode !== 'off' ? isSpam(jid, sender, { limit: g.antispamLimit, seconds: g.antispamSeconds, repeat: g.antispamRepeat }, text) : false;
  const groupMention = g.antigmMode !== 'off' && hasType(msg.message, GROUP_MENTION);
  const groupPost = g.antigstatusMode !== 'off' && (hasType(msg.message, GROUP_POST) || isGroupStatusPost(msg.message));
  const media = Object.values(g.antimedia).some(Boolean) ? mediaKindOf(msg.message) : null;
  const blockedMedia = media && g.antimedia[media] ? media : null;
  const slow = g.slowmode ? tooSoon(jid, sender, g.slowmode) : false;
  const silenced = g.silenced.length > 0 && g.silenced.includes(levels.keyOf(sender));
  const otherBot = g.antibotMode !== 'off' && (g.botList.includes(levels.keyOf(sender)) || looksLikeBot(msg.key.id, g.antibotStrict));
  const massTag = g.antitagMode !== 'off' && mentionCount(msg.message) >= g.antitagLimit;
  if (!hasLink && !badWord && !spam && !groupMention && !groupPost && !blockedMedia && !slow && !silenced && !otherBot && !massTag) return false;

  const roles = await getRoles();
  const watching = debug.left > 0 && Date.now() < debug.until && g.antigstatusMode !== 'off';
  if (watching && !groupPost) await debugReport(sock, jid, msg, sender, roles, null);
  if (groupPost) gstats.seen += 1;
  if (!roles.isBotAdmin || roles.isAdmin || roles.isOwner) {
    if (groupPost) {
      if (!roles.isBotAdmin) gstats.botNotAdmin += 1;
      else gstats.adminPosted += 1;
    }
    if (watching && groupPost) await debugReport(sock, jid, msg, sender, roles, 'not handled (admin rules)');
    if ((groupPost || groupMention) && !roles.isBotAdmin) console.log(`Anti group status: a group status was posted in ${jid}, but the bot is not an admin there, so it cannot be deleted.`);
    return false;
  }

  // a group status is dealt with FIRST: the other rules (slow mode, media, mentions) must never get in its way
  if (groupPost) {
    const deleted = await enforce({ sock, jid, sender, msg, mode: g.antigstatusMode, reason: 'posting a group status', rule: 'group status posts are not allowed here' });
    if (deleted === false) gstats.refused += 1;
    else gstats.deleted += 1;
    console.log(`Anti group status: a group status from ${String(sender).split('@')[0]} in ${jid} was ${deleted === false ? 'NOT deleted (WhatsApp refused)' : 'deleted'}.`);
    if (watching) await debugReport(sock, jid, msg, sender, roles, deleted === false ? 'failed' : 'deleted');
    return true;
  }

  if (silenced) {
    const key = levels.keyOf(sender);
    const first = !g.silenceTold.includes(key);
    await enforce({ sock, jid, sender, msg, mode: 'delete', reason: 'being silenced', rule: '' });
    if (first) {
      // the first time they write, they are told why their message disappeared
      store.update(jid, (grp) => {
        grp.silenceTold.push(key);
        if (grp.silenceTold.length > 500) grp.silenceTold.shift();
      });
      await sock.sendMessage(jid, { text: `🤫 @${num(sender)}, an admin has silenced you in this group.\nYour messages will be deleted until you are unsilenced.`, mentions: [sender] }).catch(() => {});
    }
    return true;
  }
  if (otherBot) {
    await enforce({ sock, jid, sender, msg, mode: g.antibotMode, reason: 'looking like another bot', rule: 'other bots are not allowed here' });
    return true;
  }
  if (massTag) {
    await enforce({ sock, jid, sender, msg, mode: g.antitagMode, reason: `tagging ${g.antitagLimit}+ people`, rule: 'mass tagging is not allowed here' });
    return true;
  }
  if (blockedMedia) {
    await enforce({ sock, jid, sender, msg, mode: 'delete', reason: `sending a ${blockedMedia}`, rule: '' });
    await notice(sock, jid, sender, `🚫 @${String(sender).split('@')[0].split(':')[0]}, ${blockedMedia === 'audio' ? 'voice notes and audio are' : `${blockedMedia}s are`} not allowed in this group.`);
    return true;
  }
  if (slow) {
    await enforce({ sock, jid, sender, msg, mode: 'delete', reason: 'writing too fast', rule: '' });
    await notice(sock, jid, sender, `⏳ @${String(sender).split('@')[0].split(':')[0]}, slow mode is on: please wait ${g.slowmode} seconds between messages.`);
    return true;
  }
  if (groupMention) {
    await enforce({ sock, jid, sender, msg, mode: g.antigmMode, reason: 'mentioning the group in a status', rule: 'mentioning this group in a status is not allowed here' });
    return true;
  }
  if (hasLink) {
    await enforce({ sock, jid, sender, msg, mode: g.antilinkMode, reason: 'sending a link', rule: 'links are not allowed here' });
    return true;
  }
  if (badWord) {
    await enforce({ sock, jid, sender, msg, mode: g.antiwordMode, reason: 'using a banned word', rule: 'banned words are not allowed here' });
    return true;
  }
  await enforce({ sock, jid, sender, msg, mode: g.antispamMode, reason: 'spamming', rule: 'please do not spam' });
  return true;
}

module.exports = { mediaKindOf, looksLikeBot, botVerdict, mentionCount, runProtections, LINK_REGEX, findBadWord, hasType, GROUP_MENTION, GROUP_POST, isGroupStatusPost, startDebug, gstats };
