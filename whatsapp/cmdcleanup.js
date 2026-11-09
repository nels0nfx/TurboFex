// Cleans a group after a command, so the owner does not have to delete things by hand.
//   delcmd own  (default)  the commands typed on the bot's own account (the owner's) and the bot's answers to them
//   delcmd all             also the commands of members (when the bot is a group admin) and the answers to them
//   delcmd off             nothing is deleted
//   delcmd reply on / off  the bot's answers are deleted too (default ON)
//   delcmd time 60         seconds, minutes or hours the answer stays (5 seconds to 1 hour, default 60 seconds)
// Games are never touched (a lobby and a board answer the command message, and games go on over several messages).
const store = require('./store');

const timing = { wait: 2500 }; // the command message goes this long after the answer (tests make it tiny)
const MIN = 5;
const MAX = 3600;
const DEFAULT_TIME = 60;

const mode = () => {
  const m = store.getAuto('delcmd', 'own');
  return ['off', 'own', 'all'].includes(m) ? m : 'own';
};
const replyOn = () => store.getAuto('delcmdReply', true) !== false;
const seconds = () => {
  const n = Number(store.getAuto('delcmdTime', DEFAULT_TIME));
  return Number.isInteger(n) && n >= MIN && n <= MAX ? n : DEFAULT_TIME;
};

// "45", "45s", "2m", "1h", "1m30s" -> seconds (5 seconds to 1 hour); anything else -> null
function parseTime(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  let n = null;
  if (/^\d+$/.test(t)) n = Number(t);
  else {
    const m = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s(?:ec)?)?$/.exec(t);
    if (m && (m[1] || m[2] || m[3])) n = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  }
  return Number.isInteger(n) && n >= MIN && n <= MAX ? n : null;
}

const GAME_COMMANDS = new Set(['hotseat', 'storychain', 'pet']);
const isGame = (cmd) => !!cmd && (cmd.category === 'games' || GAME_COMMANDS.has(cmd.name));

// things the bot sends that must stay: a poll is answered later, and edits, deletes and reactions are not messages of their own
const keeps = (content) => !!content && (!!content.poll || !!content.delete || !!content.react || !!content.edit);

const later = (ms, fn) => {
  const t = setTimeout(fn, ms);
  if (t.unref) t.unref();
};

// replies = the keys of the messages the bot sent as the answer
function afterCommand(sock, msg, { isBotAdmin, cmd, replies = [] } = {}) {
  try {
    if (isGame(cmd)) return false;
    const m = mode();
    if (m === 'off' || !msg?.key?.id) return false;
    const mine = !!msg.key.fromMe;
    if (!mine && m !== 'all') return false;
    const jid = msg.key.remoteJid;
    const gone = (key) => Promise.resolve(sock.sendMessage(jid, { delete: key })).catch((err) => console.log(`🧹 Could not delete a message: ${err?.message || err}`));
    let did = false;
    // the command message: members' messages only when the bot is an admin
    if (mine || isBotAdmin) {
      const key = { remoteJid: jid, id: msg.key.id, fromMe: mine, ...(msg.key.participant ? { participant: msg.key.participant } : {}) };
      later(timing.wait, () => gone(key));
      did = true;
    }
    // the bot's own answers
    if (replyOn()) {
      for (const k of replies) {
        if (!k?.id) continue;
        later(Math.max(timing.wait, seconds() * 1000), () => gone({ remoteJid: jid, id: k.id, fromMe: true }));
        did = true;
      }
    }
    return did;
  } catch (err) {
    return false;
  }
}

module.exports = { afterCommand, mode, replyOn, seconds, parseTime, keeps, timing, isGame, MIN, MAX, DEFAULT_TIME };
