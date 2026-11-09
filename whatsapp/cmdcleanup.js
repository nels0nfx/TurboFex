// Removes the command message from a group once the bot has answered, so the owner does not have to delete them by hand.
//   delcmd own  (default)  the commands typed on the bot's own account (the owner's)
//   delcmd all             also the commands of members, when the bot is a group admin
//   delcmd off             nothing is deleted
const store = require('./store');

const timing = { wait: 2500 }; // the answer and the ✅ stay in view for a moment first (tests make it tiny)

const mode = () => {
  const m = store.getAuto('delcmd', 'own');
  return ['off', 'own', 'all'].includes(m) ? m : 'own';
};

function afterCommand(sock, msg, { isBotAdmin } = {}) {
  try {
    const m = mode();
    if (m === 'off' || !msg?.key?.id) return false;
    const mine = !!msg.key.fromMe;
    if (!mine && !(m === 'all' && isBotAdmin)) return false;
    const key = { remoteJid: msg.key.remoteJid, id: msg.key.id, fromMe: mine, ...(msg.key.participant ? { participant: msg.key.participant } : {}) };
    const t = setTimeout(() => {
      Promise.resolve(sock.sendMessage(key.remoteJid, { delete: key })).catch((err) => console.log(`🧹 Could not delete the command message: ${err?.message || err}`));
    }, timing.wait);
    if (t.unref) t.unref();
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { afterCommand, mode, timing };
