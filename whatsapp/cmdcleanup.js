// Cleans a group after a command, so the owner does not have to delete things by hand.
//   delcmd own  (default)  the commands typed on the bot's own account (the owner's) and the bot's answers to them
//   delcmd all             also the commands of members (when the bot is a group admin) and the answers to them
//   delcmd off             nothing is deleted
//   delcmd reply on / off  the bot's answers are deleted too (default ON)
//   delcmd time 1          seconds, minutes or hours the answer stays (1 second to 1 hour, default 1 second: as soon as possible)
// Only SETTINGS commands are cleaned (see SETTINGS_WITH_ARGS below). Games are never touched.
const store = require('./store');

const timing = { wait: 1000 }; // the command message goes this long after the answer (tests make it tiny)
const MIN = 1;
const MAX = 3600;
const DEFAULT_TIME = 1; // as soon as possible

const mode = () => {
  const m = store.getAuto('delcmd', 'own');
  return ['off', 'own', 'all'].includes(m) ? m : 'own';
};
const replyOn = () => store.getAuto('delcmdReply', true) !== false;
const seconds = () => {
  const n = Number(store.getAuto('delcmdTime', DEFAULT_TIME));
  return Number.isInteger(n) && n >= MIN && n <= MAX ? n : DEFAULT_TIME;
};

// "45", "45s", "2m", "1h", "1m30s" -> seconds (1 second to 1 hour); anything else -> null
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

// WHICH commands are cleaned up: only the ones that change a setting, where the answer is just a confirmation. Everything that
// somebody wants to read or use (menu, ping, rules, rank, tagall, downloads, stickers, AI answers, moderation notices...) stays.
// A setting command typed WITHOUT anything after it shows its panel (people want to read that), so it stays too.
const SETTINGS_WITH_ARGS = new Set([
  // group settings
  'antilink', 'antiword', 'badword', 'antispam', 'antibot', 'antitag', 'antimedia', 'antifake', 'antiraid', 'antidemote', 'antipromote',
  'antigstatus', 'antigm', 'captcha', 'welcome', 'goodbye', 'setwelcome', 'setgoodbye', 'welcomedm', 'intro', 'setrules', 'setname',
  'setdesc', 'gpp', 'setgpp', 'slowmode', 'disappear', 'amute', 'autosticker', 'pdm', 'disable', 'enable', 'warnlimit', 'nickname',
  'filter', 'stop',
  // the owner's settings, typed in a group
  'autotyping', 'autorecording', 'alwaysonline', 'autoread', 'autobio', 'autoreact', 'pmblocker', 'mode', 'setprefix', 'cmdreact',
  'linkpreview', 'watermark', 'restartmsg', 'stickerpack', 'setmenu', 'anticall', 'privacy', 'ratelimit', 'region', 'autoupdate',
  'maintenance', 'delcmd', 'phonepush', 'antidelete', 'antiedit', 'autoviewonce', 'viewoncejid', 'deletejid', 'editjid', 'setgreet',
  'delgreet', 'gfilter', 'pfilter', 'gstop', 'pstop', 'setapi', 'setbio', 'ytcookies',
]);
const SETTINGS_ALWAYS = new Set(['open', 'close', 'lock', 'unlock', 'lockdown']); // switches: no text needed

const extra = () => (Array.isArray(store.getAuto('delcmdAdd', [])) ? store.getAuto('delcmdAdd', []) : []);
const skipped = () => (Array.isArray(store.getAuto('delcmdSkip', [])) ? store.getAuto('delcmdSkip', []) : []);

// is this command one the clean-up deletes? (hasArgs: something was written after the command word)
function isCleaned(cmd, hasArgs) {
  if (!cmd || isGame(cmd)) return false;
  const name = cmd.name;
  if (skipped().includes(name)) return false;
  if (extra().includes(name)) return true;
  if (SETTINGS_ALWAYS.has(name)) return true;
  return SETTINGS_WITH_ARGS.has(name) && !!hasArgs;
}

// things the bot sends that must stay: a poll is answered later, and edits, deletes and reactions are not messages of their own
const keeps = (content) => !!content && (!!content.poll || !!content.delete || !!content.react || !!content.edit);

const later = (ms, fn) => {
  const t = setTimeout(fn, ms);
  if (t.unref) t.unref();
};

// replies = the keys of the messages the bot sent as the answer
function afterCommand(sock, msg, { isBotAdmin, cmd, hasArgs = false, replies = [] } = {}) {
  try {
    if (!isCleaned(cmd, hasArgs)) return false;
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

module.exports = { afterCommand, isCleaned, SETTINGS_WITH_ARGS, SETTINGS_ALWAYS, extra, skipped, mode, replyOn, seconds, parseTime, keeps, timing, isGame, MIN, MAX, DEFAULT_TIME };
