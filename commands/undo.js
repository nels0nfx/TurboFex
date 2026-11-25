const reset = require('../whatsapp/settingsreset');
const store = require('../whatsapp/store');

module.exports = {
  name: 'undo',
  category: 'owner',
  ownerOnly: true,
  noAgain: true,
  description: 'Stop a settings reset that is counting down, or bring back the settings from before the last reset (for 10 minutes)',
  async run({ reply, prefix }) {
    if (reset.cancelCountdown()) return; // the countdown says that it was stopped, in its own message
    const snap = reset.undoable();
    if (!snap) return reply(`ℹ️ *There is nothing to undo.*\n▸ _A settings reset can be undone for 10 minutes. ${prefix}resetsettings starts one._`);
    reset.restore(snap);
    reset.clearUndo();
    return reply(`↩️ *Your old settings are back.*\n▸ The prefix is [ ${store.effectivePrefix() || 'none'} ] and the mode is ${String(store.getMode()).toUpperCase()} again.\n▸ \`${store.effectivePrefix()}settings\` shows them.`);
  },
};
