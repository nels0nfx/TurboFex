// Auto view-once, anti-delete and anti-edit. Each has a mode (off / all / dm / group) and its own destination chat.
const store = require('./store');
const cache = require('./msgcache');
const meta = require('./metadata');
const clock = require('../core/clock');
const media = require('./media');
const { ownerChat, normalize } = require('./owner');
const { num } = require('./utils');
const { peel, textOf, findViewOnce, editInfo } = require('./unwrap');
const secretedit = require('./secretedit');

const MAX_MEDIA = 2 * 1024 * 1024;
let downloading = 0; // never more than 2 downloads at once (many pictures in a busy group would slow everything) // pictures/videos bigger than this are not kept for anti-delete

// shown by !status
const stats = { editSecret: 0, editUnreadable: 0, editEvents: 0, deleteEvents: 0, viewOnce: 0, viewOnceSaved: 0, deleted: 0, edited: 0, errors: 0, lastError: null };

const inScope = (mode, isGroup) => mode === 'all' || (mode === 'dm' && !isGroup) || (mode === 'group' && isGroup);
const typeIs = (t, number, name) => t === number || t === name;
// these notices go to the owner's private chat: a tag there shows the person's name (or number); see mentions.inPrivate
const tagOf = (jid) => `@${num(jid)}`;
const handled = new Map(); // finished deletions / edits (the same event can arrive twice)

function once(key) {
  const now = Date.now();
  if (now - (handled.get(key) || 0) < 60000) return false;
  handled.set(key, now);
  if (handled.size > 2000) handled.clear();
  return true;
}

async function chatName(sock, jid) {
  if (!jid.endsWith('@g.us')) return 'a private chat';
  try {
    return `the group "${(await meta.getMeta(sock, jid)).subject}"`;
  } catch (err) {
    return 'a group';
  }
}

function kindName(message) {
  const { content: m } = peel(message);
  if (m.imageMessage) return 'picture';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return m.audioMessage.ptt ? 'voice note' : 'audio';
  if (m.stickerMessage) return 'sticker';
  if (m.documentMessage) return 'document';
  return null;
}

// the original message as a "reply", so the copy points back to the chat it came from
function quotedOriginal(item, id) {
  const group = String(item.jid).endsWith('@g.us');
  return {
    key: { remoteJid: item.jid, fromMe: false, id, ...(group ? { participant: item.sender } : {}) },
    message: item.message || { conversation: item.text || '' },
  };
}

async function sendCopy(sock, to, item, header, quoted) {
  const caption = `${header}${item.text ? `\n\n${item.text}` : ''}`;
  const mentions = [...new Set([item.sender, ...(item.mentions || [])].filter(Boolean))];
  const opts = quoted ? { quoted } : undefined;
  if (item.buffer && item.kind) {
    if (item.kind === 'picture') return sock.sendMessage(to, { image: item.buffer, caption, mentions }, opts);
    if (item.kind === 'video') return sock.sendMessage(to, { video: item.buffer, caption, mentions }, opts);
    if (item.kind === 'sticker') {
      await sock.sendMessage(to, { text: header, mentions }, opts);
      return sock.sendMessage(to, { sticker: item.buffer });
    }
    if (item.kind === 'voice note' || item.kind === 'audio') {
      await sock.sendMessage(to, { text: header, mentions }, opts);
      return sock.sendMessage(to, { audio: item.buffer, mimetype: item.mime || 'audio/ogg; codecs=opus', ptt: item.kind === 'voice note' });
    }
  }
  const note = item.kind ? `\n(the ${item.kind} was too big or could not be saved)` : '';
  return sock.sendMessage(to, { text: `${caption}${note}`, mentions }, opts);
}

// when something fails the owner is told, instead of silence (at most once a minute per kind of problem)
const lastWarn = new Map();
async function warnOwner(sock, text, kind = 'general', mentions = []) {
  const every = kind === 'empty' ? 6 * 3600 * 1000 : 60000; // "no content" can happen for many reasons, so it is only said now and then
  if (Date.now() - (lastWarn.get(kind) || 0) < every) return;
  lastWarn.set(kind, Date.now());
  try {
    await sock.sendMessage(ownerChat(sock), { text, mentions });
  } catch (err) {
    // nothing more we can do
  }
}

function problem(what, err) {
  stats.errors += 1;
  stats.lastError = `${what}: ${String(err?.message || err).slice(0, 80)}`;
  console.error(`${what} failed:`, err?.message || err);
}

// downloads a file, trying twice (the second time asks WhatsApp to send the file again)
async function fetchMedia(sock, source) {
  try {
    return await media.download(sock, source);
  } catch (err) {
    if (err.code === 'TOO_BIG') throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return media.download(sock, source);
  }
}

const OPEN_ON_PHONE =
  'WhatsApp only gives view-once files to the phone itself, not to linked devices like this bot.\n' +
  '💡 Reply to the view-once message with *vv* to open it.';

// ---------------------------------------------------------------- view once
// also used by the "vv" command: returns the file + details of a view-once message, or throws a clear problem
async function viewOnce(sock, msg, isGroup) {
  const cfg = store.watchCfg('viewonce');
  if (!inScope(cfg.mode, isGroup)) return;
  const vo = findViewOnce(msg.message);
  if (!vo) return;
  stats.viewOnce += 1;
  console.log(`👁️ View-once found (${vo.kind}, content ${vo.empty ? 'MISSING' : 'present'}), sending to ${cfg.to || 'owner chat'}`);
  const jid = msg.key.remoteJid;
  const sender = isGroup ? msg.key.participant : jid;
  const kind = vo.kind === 'image' ? 'picture' : vo.kind === 'video' ? 'video' : vo.node.ptt ? 'voice note' : 'audio';
  const where = await chatName(sock, jid);
  console.log(`👁️ View-once ${kind} from ${num(sender)} in ${jid}`);

  if (vo.empty) {
    return warnOwner(sock, `👁️ A view-once ${kind} from ${tagOf(sender)} arrived in ${where}, but WhatsApp did not send its content to this device.\n${OPEN_ON_PHONE}`, 'viewonce', [sender]);
  }
  let buffer;
  try {
    buffer = await fetchMedia(sock, msg);
  } catch (err) {
    problem('View-once download', err);
    return warnOwner(sock, `👁️ A view-once ${kind} from ${tagOf(sender)} arrived in ${where}, but I could not save it.\nReason: ${String(err.message).slice(0, 100)}\n${OPEN_ON_PHONE}`, 'viewonce', [sender]);
  }
  const header = `👁️ *View-once ${kind}*\n👤 From ${tagOf(sender)} in ${where}\n🕒 ${clock.stamp(Date.now())}`;
  await sendCopy(sock, normalize(sock, cfg.to) || ownerChat(sock), { kind, buffer, mime: vo.node.mimetype, text: vo.node.caption || '', sender }, header);
  stats.viewOnceSaved += 1;
}

// ---------------------------------------------------------------- remember messages for anti-delete / anti-edit
async function remember(sock, msg, isGroup) {
  const wantDel = inScope(store.watchCfg('delete').mode, isGroup);
  const wantEdit = inScope(store.watchCfg('edit').mode, isGroup);
  if (!wantDel && !wantEdit) return;

  const message = msg.message;
  const kind = kindName(message);
  const item = {
    jid: msg.key.remoteJid, sender: isGroup ? msg.key.participant : msg.key.remoteJid,
    text: textOf(message), kind, message, ts: Number(msg.messageTimestamp) || 0,
  };
  cache.remember(msg.key.id, item); // text and the original message are kept at once, media follows

  if (wantDel && kind && kind !== 'document') {
    const { content: inner } = peel(message);
    const node = inner.imageMessage || inner.videoMessage || inner.audioMessage || inner.stickerMessage;
    const size = Number(node?.fileLength?.low ?? node?.fileLength) || 0;
    if (size && size > MAX_MEDIA) return;
    if (downloading >= 2) return;
    downloading += 1;
    try {
      const buffer = await media.download(sock, msg);
      if (buffer.length <= MAX_MEDIA) cache.remember(msg.key.id, { ...item, buffer, mime: node?.mimetype });
    } catch (err) {
      // the text is still kept
    } finally {
      downloading -= 1;
    }
  }
}

// ---------------------------------------------------------------- deleted / edited (shared by both ways WhatsApp tells us)
async function deletedCore(sock, { jid, id, deleter }) {
  const isGroup = jid.endsWith('@g.us');
  const cfg = store.watchCfg('delete');
  if (!inScope(cfg.mode, isGroup) || !id) return;
  const it = cache.get(id);
  if (!it) return; // we never saw the original
  if (!once(`del|${id}`)) return;
  console.log(`🗑️ Deleted message noticed in ${jid}`);

  const by = deleter && num(deleter) !== num(it.sender) ? `🧹 Deleted by ${tagOf(deleter)}` : '🧹 Deleted by the sender';
  const header = `🗑️ *Deleted message*\n👤 Sent by ${tagOf(it.sender)}\n${by}\n💬 In ${await chatName(sock, jid)}\n🕒 Sent ${it.ts ? clock.stamp(it.ts * 1000) : 'earlier'}`;
  try {
    await sendCopy(sock, normalize(sock, cfg.to) || ownerChat(sock), { ...it, mentions: deleter ? [deleter] : [] }, header, quotedOriginal(it, id));
    stats.deleted += 1;
  } catch (err) {
    problem('Anti-delete copy', err);
    await warnOwner(sock, `🗑️ I noticed a deleted message but could not send you the copy.\nReason: ${String(err.message).slice(0, 100)}`, 'delete');
  }
  cache.drop(id);
}

async function editedCore(sock, { jid, id, after, editor }) {
  const isGroup = jid.endsWith('@g.us');
  const cfg = store.watchCfg('edit');
  if (!inScope(cfg.mode, isGroup) || !after || !id) return;
  const it = cache.get(id);
  const before = it?.text || '(I did not see the original text)';
  if (before === after || !once(`edit|${id}|${after}`)) return;
  console.log(`✏️ Edited message noticed in ${jid}`);

  const sender = it?.sender || editor || jid;
  const header = `✏️ *Edited message*\n👤 By ${tagOf(sender)}\n💬 In ${await chatName(sock, jid)}\n🕒 ${clock.stamp(Date.now())}`;
  const body = { text: `${header}\n\n*Before:*\n${before}\n\n*After:*\n${after}`, mentions: [sender] };
  try {
    try {
      await sock.sendMessage(normalize(sock, cfg.to) || ownerChat(sock), body, it ? { quoted: quotedOriginal(it, id) } : undefined);
    } catch (err) {
      await sock.sendMessage(normalize(sock, cfg.to) || ownerChat(sock), body); // the reply-to-original part failed: send it plain
    }
    stats.edited += 1;
  } catch (err) {
    problem('Anti-edit copy', err);
    await warnOwner(sock, `✏️ I noticed an edited message but could not send you the copy.\nReason: ${String(err.message).slice(0, 100)}`, 'edit');
  }
  if (it) cache.remember(id, { ...it, text: after });
}

// An edit that arrives sealed in a secret envelope (newer WhatsApp): open it with the secret of the original message
async function secretEditCore(sock, msg, sec, who) {
  const jid = msg.key.remoteJid;
  const targetId = sec.targetMessageKey?.id;
  const type = sec.secretEncType;
  if (!targetId || type === 1 || type === 'EVENT_EDIT') return; // not a message edit
  stats.editSecret += 1;
  const it = cache.get(targetId);
  const secret = it && secretedit.findSecret(it.message);
  console.log(`🔒 Edit arrived in a secret envelope (original saved: ${it ? 'yes' : 'no'}, key: ${secret ? 'yes' : 'no'})`);
  if (!inScope(store.watchCfg('edit').mode, jid.endsWith('@g.us'))) return;
  if (!secret) {
    stats.editUnreadable += 1;
    return warnOwner(
      sock,
      `✏️ ${tagOf(who)} edited a message in ${await chatName(sock, jid)}, but I had not saved the original (it was sent before anti-edit was on, or before the bot last restarted), so I cannot read the new text.`,
      'editunknown',
      [who]
    );
  }
  const after = secretedit.decryptEdit({ sec, key: msg.key, secret });
  if (!after) {
    stats.editUnreadable += 1;
    console.log('🔒 Could not open the edit envelope.');
    return warnOwner(sock, `✏️ ${tagOf(who)} edited a message but I could not open the new text.`, 'editunknown');
  }
  return editedCore(sock, { jid, id: targetId, after, editor: who });
}

// ---------------------------------------------------------------- entry points
// A message arrived WITHOUT content. If auto view-once is on, say so (once a minute) instead of staying silent.
async function noContent(sock, msg) {
  const jid = msg.key?.remoteJid;
  if (!jid || msg.key.fromMe || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
  const isGroup = jid.endsWith('@g.us');
  if (!inScope(store.watchCfg('viewonce').mode, isGroup)) return;
  stats.empty = (stats.empty || 0) + 1;
  console.log(`👁️ A message from ${num(isGroup ? msg.key.participant : jid)} arrived without content (stub ${msg.messageStubType ?? 'none'}). Possibly a view-once.`);
  // Many things arrive with no content (group events, messages that could not be decrypted, reactions...), and real view-once
  // files are already reported by their own notice. So this guess is only told to the owner when EMPTY_NOTICE=1 is set.
  if (process.env.EMPTY_NOTICE !== '1' || msg.messageStubType) return;
  await warnOwner(
    sock,
    `👁️ A message from ${tagOf(isGroup ? msg.key.participant : jid)} arrived in ${await chatName(sock, jid)} but WhatsApp sent me no content. If it was a view-once, this is why.\n${OPEN_ON_PHONE}`,
    'empty'
  );
}

// called for every incoming message
async function run(sock, msg) {
  const message = msg.message;
  if (!message) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
  const isGroup = jid.endsWith('@g.us');

  // edits and deletions can come wrapped in other envelopes: open them all first
  const { content } = peel(message);
  const pm = content.protocolMessage;
  if (content.secretEncryptedMessage && !msg.key.fromMe) {
    return secretEditCore(sock, msg, content.secretEncryptedMessage, isGroup ? msg.key.participant : jid);
  }
  if (pm) {
    if (msg.key.fromMe) return;
    const who = isGroup ? msg.key.participant : jid;
    console.log(`🔔 Protocol message in ${jid}: type ${pm.type}`);
    if (typeIs(pm.type, 0, 'REVOKE')) return deletedCore(sock, { jid, id: pm.key?.id, deleter: who });
    if (typeIs(pm.type, 14, 'MESSAGE_EDIT')) {
      stats.editEvents += 1;
      return editedCore(sock, { jid, id: pm.key?.id, after: textOf(pm.editedMessage || {}), editor: who });
    }
    return;
  }
  if (msg.key.fromMe) return;

  await Promise.all([
    viewOnce(sock, msg, isGroup).catch((e) => {
      problem('View-once', e);
      return warnOwner(sock, `👁️ I could not handle a view-once message.\nReason: ${String(e.message).slice(0, 100)}`, 'viewonce');
    }),
    remember(sock, msg, isGroup).catch(() => {}),
  ]);
}

// called for "message updates": the other way WhatsApp reports edits and deletions
async function onUpdate(sock, updates) {
  for (const u of updates || []) {
    const key = u.key;
    if (!key || key.fromMe || !key.remoteJid || key.remoteJid.endsWith('@broadcast')) continue;
    const isGroup = key.remoteJid.endsWith('@g.us');
    const who = isGroup ? key.participant : key.remoteJid;
    const upd = u.update || {};

    const edited = upd.message?.editedMessage || upd.message?.protocolMessage;
    if (edited) {
      const info = editInfo(edited.message || edited);
      stats.editEvents += 1;
      console.log(`🔔 Edit update in ${key.remoteJid} (new text ${info.text ? 'found' : 'NOT found'})`);
      await editedCore(sock, { jid: key.remoteJid, id: info.id || key.id, after: info.text, editor: who });
      continue;
    }
    if (upd.messageStubType === 1 || upd.messageStubType === 'REVOKE') {
      await deletedCore(sock, { jid: key.remoteJid, id: key.id, deleter: upd.key?.participant || who });
    }
  }
}

module.exports = { run, noContent, onUpdate, findViewOnce, inScope, stats, fetchMedia, OPEN_ON_PHONE };
