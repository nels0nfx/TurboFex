// Turns "27821234567:12@s.whatsapp.net" into "27821234567"
const num = (jid) => {
  const s = typeof jid === 'string' ? jid : String(jid || '');
  const at = s.indexOf('@');
  let end = at >= 0 ? at : s.length;
  const colon = s.indexOf(':');
  if (colon >= 0 && colon < end) end = colon;
  return end === s.length ? s : s.slice(0, end);
};

function getInner(msg) {
  const m = msg.message || {};
  return (
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.documentWithCaptionMessage?.message ||
    m
  );
}

function getText(msg) {
  const m = getInner(msg);
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

function getContextInfo(msg) {
  const m = getInner(msg);
  const part = m.extendedTextMessage || m.imageMessage || m.videoMessage || {};
  return part.contextInfo || {};
}

// People tagged in the message, or the person whose message was replied to
function getTargets(msg) {
  const info = getContextInfo(msg);
  const list = [...(info.mentionedJid || [])];
  if (!list.length && info.participant) list.push(info.participant);
  return [...new Set(list)];
}

// The message that was replied to (or null)
function getQuoted(msg) {
  const info = getContextInfo(msg);
  if (!info.quotedMessage) return null;
  return { id: info.stanzaId, participant: info.participant, message: info.quotedMessage };
}

function quotedText(quoted) {
  const m = quoted?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

// A tagged person, a replied-to person, or a phone number typed in the command
function resolveTarget(msg, args = []) {
  const tagged = getTargets(msg);
  if (tagged.length) return tagged[0];
  for (const a of args) {
    const d = String(a).replace(/\D/g, '');
    if (d.length >= 7 && d.length <= 15) return `${d}@s.whatsapp.net`;
  }
  return null;
}

// All the ways WhatsApp might identify a group member
function participantIds(p) {
  return [p.id, p.lid, p.jid, p.phoneNumber].filter(Boolean).map(num);
}

// All the ways WhatsApp might identify the sender of a message
function senderIds(msg) {
  const k = msg.key || {};
  return [k.participant, k.participantAlt, k.participantPn, k.remoteJid, k.remoteJidAlt]
    .filter(Boolean)
    .map(num);
}

// True when `phrase` appears in `text` as whole word(s), ignoring capital letters
function hasPhrase(text, phrase) {
  const esc = String(phrase).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'u').test(String(text).toLowerCase());
}

// The bot's own jid with no device number, e.g. 27821234567@s.whatsapp.net
function selfJid(sock) {
  return `${num(sock.user?.id)}@s.whatsapp.net`;
}

// Who wrote the message, as phone/LID numbers. Works in groups, in private chats,
// and when the message was typed on the bot's own account (fromMe).
function whoIds(msg, botIds) {
  const k = msg.key || {};
  if (k.fromMe) return botIds;
  const group = String(k.remoteJid).endsWith('@g.us');
  const raw = group ? [k.participant, k.participantAlt, k.participantPn] : [k.remoteJid, k.remoteJidAlt];
  return [...new Set(raw.filter(Boolean).map(num))];
}

// The same person as a jid that can be tagged
function whoJid(msg, sock) {
  const k = msg.key || {};
  if (k.fromMe) return selfJid(sock);
  return String(k.remoteJid).endsWith('@g.us') ? k.participant : k.remoteJid;
}

// Every jid WhatsApp knows for one person in a group (phone form and LID form)
function jidVariants(groupMetadata, target) {
  const out = [target];
  const n = num(target);
  for (const p of groupMetadata?.participants || []) {
    if (participantIds(p).includes(n)) {
      for (const j of [p.id, p.jid, p.phoneNumber, p.lid]) if (j && String(j).includes('@')) out.push(j);
    }
  }
  return [...new Set(out)];
}

// Is this message a command? "." + a word. Things like "...", ". hello" or ".5" are normal chat, not commands.
// In "no prefix" mode the prefix is empty: a message is a command when its FIRST WORD is a command name (isKnown tells).
function isCommandText(text, prefix, isKnown) {
  const t = String(text || '').trim();
  if (!prefix) {
    if (typeof isKnown !== 'function') return false;
    const first = t.split(/\s+/)[0].toLowerCase();
    return !!first && /^[\p{L}\p{N}]+$/u.test(first) && isKnown(first);
  }
  if (!t.startsWith(prefix)) return false;
  const next = t.slice(prefix.length, prefix.length + 1);
  return !!next && /[\p{L}\p{N}]/u.test(next);
}

module.exports = {
  isCommandText, getContextInfo,
  getInner,
  selfJid, whoIds, whoJid, jidVariants,
  hasPhrase, num, getText, getTargets, getQuoted, quotedText, resolveTarget, participantIds, senderIds,
};
