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

// Applies delete / warn / kick to a member who broke a rule
async function enforce({ sock, jid, sender, mode, msg, reason, rule, deleteMessage = true }) {
  if (deleteMessage && msg) {
    try {
      await sock.sendMessage(jid, { delete: msg.key });
    } catch (err) {
      console.log('Could not delete message:', err.message);
    }
  }
  if (mode === 'delete') return;

  const tag = `@${num(sender)}`;

  if (mode === 'kick') {
    const removed = await tryRemove(sock, jid, sender);
    await sock.sendMessage(jid, {
      text: removed
        ? `🚫 ${tag} was removed for ${reason}.`
        : `⚠️ ${tag} was caught ${reason} but I could not remove them.`,
      mentions: [sender],
    });
    return;
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
}

module.exports = { enforce };
