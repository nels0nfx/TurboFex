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
const { isGroupStatusPost } = require('./shape');
const delivery = require('./delivery');

// A group status is NOT removed by a normal delete (WhatsApp ignores it). It needs the delete wrapped the same way the status was
// posted: a revoke inside the group-status envelope, sent as an admin delete (edit 8).
async function revokeGroupStatus(sock, jid, key, messageId) {
  if (typeof sock.relayMessage !== 'function') throw new Error('this WhatsApp library cannot send a wrapped revoke');
  await sock.relayMessage(jid, { groupStatusMessageV2: { message: { protocolMessage: { key, type: 0 } } } }, { messageId, additionalAttributes: { edit: '8' }, additionalNodes: [{ tag: 'meta', attrs: { is_group_status: 'true' } }] }); // the same stanza marker as the status itself
}

const describe = (v) => (v.result === 'refused' ? `WhatsApp refused it (error ${v.error || 'unknown'})` : v.result === 'ok' ? 'WhatsApp accepted it' : 'no answer from WhatsApp');

async function deleteOffending(sock, jid, msg, sender) {
  const key = { ...msg.key, remoteJid: jid, fromMe: false, participant: msg.key.participant || sender };
  if (isGroupStatusPost(msg.message)) {
    // 1) the wrapped revoke   2) the plain delete as a backup when the first one was refused or not answered
    let answer = 'not sent';
    let accepted = false;
    try {
      const id = delivery.newId();
      await revokeGroupStatus(sock, jid, key, id);
      const v = await delivery.expect(id, 4000);
      answer = `wrapped revoke: ${describe(v)}`;
      accepted = v.result === 'ok';
    } catch (err) {
      answer = `wrapped revoke failed: ${err.message}`;
      console.log('Could not delete the group status (wrapped revoke):', err.message);
    }
    if (!accepted) {
      try {
        const id = delivery.newId();
        await sock.sendMessage(jid, { delete: key }, { messageId: id });
        const v = await delivery.expect(id, 4000);
        answer += `; plain delete: ${describe(v)}`;
        accepted = v.result === 'ok';
      } catch (err) {
        answer += `; plain delete failed: ${err.message}`;
        console.log('Could not delete the group status (plain delete):', err.message);
      }
    }
    delivery.last.delete = answer;
    console.log(`Anti group status: ${answer}`);
    return !/refused|failed/.test(answer) || accepted;
  }
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
