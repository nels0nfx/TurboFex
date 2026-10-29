const { getTargets, num } = require('../whatsapp/utils');
const { removeMember } = require('../whatsapp/actions');
const store = require('../whatsapp/store');

module.exports = {
  name: 'warn',
  category: 'group',
  description: 'Warn a member, removed after 3 warnings (tag or reply)',
  groupOnly: true,
  adminOnly: true,
  async run({ sock, jid, msg, reply, args, botIds, isBotAdmin, prefix, cmdName }) {
    const targets = getTargets(msg).filter((t) => !botIds.includes(num(t)));
    if (!targets.length) {
      return reply(
        `Please tag the person or reply to their message.\nExample: ${prefix}${cmdName} @person reason`
      );
    }
    const target = targets[0];
    const tag = `@${num(target)}`;
    const reason = args.filter((a) => !a.startsWith('@')).join(' ');
    const { count, max } = store.addWarning(jid, target);

    if (count >= max) {
      if (isBotAdmin) {
        let removed = false;
        try {
          removed = await removeMember(sock, jid, target);
        } catch (err) {
          removed = false;
        }
        if (removed) {
          store.resetWarnings(jid, target);
          return reply(`🚫 ${tag} was removed after ${max} warnings.`, { mentions: [target] });
        }
      }
      return reply(
        `⚠️ ${tag} has ${count}/${max} warnings, but I could not remove them (I must be admin, and they can't be the group owner).`,
        { mentions: [target] }
      );
    }
    return reply(`⚠️ Warning ${count}/${max} for ${tag}${reason ? `\nReason: ${reason}` : ''}`, {
      mentions: [target],
    });
  },
};
