const store = require('./store');
const { removeMember } = require('./actions');
const { num } = require('./utils');

async function tryRemove(sock, jid, id) {
  try {
    return await removeMember(sock, jid, id);
  } catch (err) {
    return false;
  }
}

// Deletes a member's message as an admin. A group status needs the sender in the key, so it is filled in when WhatsApp left it
// out; if the first try fails, a second one is made with a plain revoke message after a short wait.
async function deleteOffending(sock, jid, msg, sender) {
  const key = { ...msg.key, remoteJid: jid, fromMe: false, participant: msg.key.participant || sender };
  try {
    await sock.sendMessage(jid, { delete: key });
    return true;
  } catch (err) {
    console.log('Could not delete message (first try):', err.message);
  }
  try {
    await new Promise((r) => setTimeout(r, process.env.TURBOFEX_FAST ? 1 : 1200));
    await sock.relayMessage(jid, { protocolMessage: { key, type: 0 } }, {});
    return true;
  } catch (err) {
    console.log('Could not delete message (second try):', err.message);
    return false;
  }
}

// Applies delete / warn / kick to a member who broke a rule
async function enforce({ sock, jid, sender, mode, msg, reason, rule, deleteMessage = true }) {
  let deleted;
  if (deleteMessage && msg) deleted = await deleteOffending(sock, jid, msg, sender);
  if (mode === 'delete') return deleted;

  const tag = `@${num(sender)}`;

  if (mode === 'kick') {
    const removed = await tryRemove(sock, jid, sender);
    await sock.sendMessage(jid, {
      text: removed
        ? `🚫 ${tag} was removed for ${reason}.`
        : `⚠️ ${tag} was caught ${reason} but I could not remove them.`,
      mentions: [sender],
    });
    return deleted;
  }

  // mode === 'warn'
  const { count, max } = store.addWarning(jid, sender);
  if (count >= max) {
    const removed = await tryRemove(sock, jid, sender);
    if (removed) store.resetWarnings(jid, sender);
    await sock.sendMessage(jid, {
      text: removed
        ? `🚫 ${tag} was removed after ${max} warnings (${reason}).`
        : `⚠️ ${tag} reached ${max} warnings but I could not remove them.`,
      mentions: [sender],
    });
  } else {
    await sock.sendMessage(jid, {
      text: `⚠️ ${tag}, ${rule || 'that is not allowed here'}.\n*Warning ${count}/${max}*`,
      mentions: [sender],
    });
  }
  return deleted;
}

module.exports = { enforce };
