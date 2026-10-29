// Protection against group take-overs (antipromote / antidemote) and incoming calls (anticall).
const config = require('../config');
const store = require('./store');
const meta = require('./metadata');
const idmap = require('./idmap');
const { num } = require('./utils');

// every number this person is known by (phone number and LID)
function numbersOf(jid) {
  const out = new Set([num(jid)]);
  const pn = idmap.pnSync(jid);
  if (pn) out.add(num(pn));
  const lid = idmap.lidSync(jid);
  if (lid) out.add(num(lid));
  return out;
}

// the bot itself, the bot owner and the sudo users may always do these things
function isTrusted(sock, jid) {
  if (!jid) return false;
  const mine = numbersOf(jid);
  const trusted = [sock.user?.id, sock.user?.lid, config.ownerNumber, ...store.getSudo()].filter(Boolean).map((x) => num(x));
  return trusted.some((t) => mine.has(t));
}

// is this person the creator of the group? (found in the saved group info)
function isCreator(groupMetadata, jid) {
  const mine = numbersOf(jid);
  return !!(groupMetadata?.participants || []).find((p) => p.admin === 'superadmin' && [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).some((x) => mine.has(num(x))));
}

// someone promoted / demoted people. If the protection is on and the author is not trusted, it is undone.
async function guardAdmins(sock, groupJid, action, ids, author) {
  const g = store.getGroup(groupJid);
  if (!((action === 'promote' && g.antipromote) || (action === 'demote' && g.antidemote))) return;
  if (!author || isTrusted(sock, author)) return;
  let info = null;
  try {
    info = await meta.getMeta(sock, groupJid);
  } catch (err) {
    // without the group info the creator cannot be recognised: carry on
  }
  if (info && isCreator(info, author)) return; // the creator of the group may always do this
  const verb = action === 'promote' ? 'promote' : 'demote';
  const tag = (j) => `@${num(j)}`;
  try {
    await sock.groupParticipantsUpdate(groupJid, ids, action === 'promote' ? 'demote' : 'promote');
    await sock.sendMessage(groupJid, {
      text: `🛡️ *Protection*\n${tag(author)} tried to ${verb} ${ids.map(tag).join(', ')}. I undid it.\n_Only the group creator and the bot owner can do this here._`,
      mentions: [author, ...ids],
    });
  } catch (err) {
    await sock.sendMessage(groupJid, { text: `🛡️ *Protection*\n${tag(author)} tried to ${verb} ${ids.map(tag).join(', ')}, but I could not undo it (I need to be an admin).`, mentions: [author, ...ids] }).catch(() => {});
  }
  meta.invalidate(groupJid);
}

// incoming calls: rejected (and the caller blocked when chosen)
const told = new Map();
async function handleCalls(sock, calls) {
  const mode = store.getAnticall();
  if (mode === 'off') return;
  for (const c of calls || []) {
    if (c.status !== 'offer' || !c.from || isTrusted(sock, c.from)) continue;
    try {
      await sock.rejectCall(c.id, c.from);
    } catch (err) {
      console.log('Could not reject a call:', err.message);
    }
    console.log(`📵 Call from ${num(c.from)} rejected${mode === 'block' ? ' and blocked' : ''}`);
    if (Date.now() - (told.get(c.from) || 0) > 10 * 60 * 1000) {
      told.set(c.from, Date.now());
      await sock.sendMessage(c.from, { text: '📵 *Calls are not supported.*\nThis number is a bot. Please send a text message instead.' }).catch(() => {});
    }
    if (mode === 'block') await sock.updateBlockStatus(c.from, 'block').catch(() => {});
  }
}

module.exports = { isTrusted, isCreator, guardAdmins, handleCalls, numbersOf };
