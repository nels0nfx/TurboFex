const store = require('../whatsapp/store');
const clock = require('../core/clock');

module.exports = {
  name: 'amute',
  category: 'group',
  description: 'Close the group automatically every day at a time, e.g. amute 22:00 (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ jid, args, reply, prefix }) {
    const g = store.getGroup(jid);
    const a = (args[0] || '').toLowerCase();

    if (a === 'off') {
      store.update(jid, (grp) => {
        grp.autoMute.mute = null;
      });
      return reply('✅ Automatic closing is now *OFF*.');
    }
    const t = clock.parseHHMM(a);
    if (!t) {
      return reply(
        `⏰ Auto-close is ${g.autoMute.mute ? `set for *${g.autoMute.mute}*` : '*OFF*'} (${clock.zone()} time).\n` +
          `To set it: ${prefix}amute 22:00\nTo stop it: ${prefix}amute off`
      );
    }
    store.update(jid, (grp) => {
      grp.autoMute.mute = t;
    });
    return reply(`✅ The group will close every day at *${t}* (${clock.zone()} time).`);
  },
};
