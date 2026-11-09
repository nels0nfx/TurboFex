// When the owner replies to somebody's status, that status is saved (picture, video, voice note or text) and sent to the place
// chosen with "statusjid" (default: the owner's own chat). Nothing is sent or reacted in the chat where the reply was written.
// It is OFF until the owner switches it on with "statusreply on".
const store = require('./store');
const status = require('./status');
const { ownerChat, normalize } = require('./owner');
const { getQuoted } = require('./utils');
const { peel } = require('./unwrap');

const done = new Map(); // status id -> time: one status is saved once, even if the owner replies several times
const WAIT = 60 * 60 * 1000;

// the status that this message replies to, or null
function statusQuote(msg) {
  const q = getQuoted(msg);
  if (!q || !q.message) return null;
  const info = peel(msg.message).content;
  const ctx = (info.extendedTextMessage || info.imageMessage || info.videoMessage || info.stickerMessage || info.audioMessage || info.documentMessage || {}).contextInfo || {};
  if (ctx.remoteJid !== 'status@broadcast') return null;
  return { id: q.id, who: q.participant || ctx.participant, message: q.message };
}

// roles: a function that tells if the writer is the owner (only used when it is not the owner's own phone)
async function maybe(sock, msg, isOwnerFn) {
  if (!store.statusCfg().saveReply) return false;
  const q = statusQuote(msg);
  if (!q) return false;
  if (!msg.key.fromMe && !(await isOwnerFn())) return false;
  const now = Date.now();
  if (q.id && now - (done.get(q.id) || 0) < WAIT) return false;
  if (q.id) done.set(q.id, now);
  if (done.size > 500) done.clear();
  const to = normalize(sock, store.statusCfg().saveTo) || ownerChat(sock);
  try {
    await status.saveStatus(sock, { key: { remoteJid: 'status@broadcast', id: q.id, participant: q.who, fromMe: false }, message: q.message }, to, q.who);
    status.stats.saved += 1;
    return true;
  } catch (err) {
    if (q.id) done.delete(q.id);
    console.error('Saving the replied status failed:', err.message);
    try {
      await sock.sendMessage(ownerChat(sock), { text: `⚠️ I could not save the status you replied to.\nReason: ${String(err.message).slice(0, 100)}\n▸ WhatsApp does not always give the file to a linked device.` });
    } catch (e) {
      // nothing more to do
    }
    return false;
  }
}

module.exports = { maybe, statusQuote, done };
