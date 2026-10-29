const store = require('../whatsapp/store');
const clock = require('../core/clock');

module.exports = {
  name: 'aunmute',
  category: 'group',
  description: 'Open the group automatically every day at a time, e.g. aunmute 06:00 (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ jid, args, reply, prefix }) {
    const g = store.getGroup(jid);
    const a = (args[0] || '').toLowerCase();

    if (a === 'off') {
      store.update(jid, (grp) => {
        grp.autoMute.unmute = null;
      });
      return reply('✅ Automatic opening is now *OFF*.');
    }
    const t = clock.parseHHMM(a);
    if (!t) {
      return reply(
        `⏰ Auto-open is ${g.autoMute.unmute ? `set for *${g.autoMute.unmute}*` : '*OFF*'} (${clock.zone()} time).\n` +
          `To set it: ${prefix}aunmute 06:00\nTo stop it: ${prefix}aunmute off`
      );
    }
    store.update(jid, (grp) => {
      grp.autoMute.unmute = t;
    });
    return reply(`✅ The group will open every day at *${t}* (${clock.zone()} time).`);
  },
};
