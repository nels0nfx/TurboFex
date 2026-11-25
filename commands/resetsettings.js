const reset = require('../whatsapp/settingsreset');
const store = require('../whatsapp/store');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  name: 'resetsettings',
  aliases: ['resetconfig'],
  category: 'owner',
  ownerOnly: true,
  slow: true, // it counts down for 5 seconds: it must not hold up the chat
  noAgain: true,
  description: 'Put all bot settings back to the defaults after a 5 second countdown; undo stops it, or brings the old settings back for 10 minutes',
  async run({ sock, jid, reply, prefix }) {
    if (reset.countdown.active) return reply(`ℹ️ *A reset is already counting down.*\n▸ \`${prefix}undo\` stops it.`);
    const snap = reset.take(); // taken now: it is exactly what undo brings back
    const me = reset.startCountdown();
    const edit = (key, text) => sock.sendMessage(jid, { text, edit: key }).catch(() => {});
    const body = (n) => `⚠️ *Resetting all settings in ${n}...*\n▸ Send \`${prefix}undo\` to stop it.\n▸ _Reset: the bot-wide settings, auto tag and ignored chats._\n▸ _Kept: owners, banned list, API keys, reminders, group settings, your data and the login._`;
    try {
      const first = await sock.sendMessage(jid, { text: body(5) });
      const key = first && first.key;
      for (let n = 4; n >= 0; n--) {
        await sleep(reset.timing.stepMs);
        if (me.cancelled) {
          if (key) await edit(key, `✅ *The reset was stopped.*\n▸ Nothing was changed.`);
          else await reply('✅ *The reset was stopped.*\n▸ Nothing was changed.');
          return;
        }
        if (n > 0 && key) await edit(key, body(n));
      }
      reset.keepForUndo(snap); // saved BEFORE anything changes
      reset.reset();
      const done = `✅ *All settings are back to the defaults.*\n▸ The prefix is now [ ${store.effectivePrefix() || 'none'} ] and the mode is ${String(store.getMode()).toUpperCase()}.\n▸ \`${store.effectivePrefix()}undo\` brings your old settings back for 10 minutes.\n▸ \`${store.effectivePrefix()}settings\` shows what they are now.`;
      if (key) await edit(key, done);
      else await reply(done);
    } finally {
      reset.stopCountdown();
    }
  },
};
