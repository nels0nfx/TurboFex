// inactive = see the silent members AND remove them. purge is its alias.
//   inactive / purge          -> the list of members who never wrote a message since the bot started counting
//   inactive confirm          -> removes up to 25 of them (never admins). Needs the bot to be an admin.
const activity = require('../whatsapp/activity');
const { num, participantIds } = require('../whatsapp/utils');

const sleep = (ms) => (process.env.TURBOFEX_FAST ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const MIN_COUNTED = 100; // removing needs at least this many counted messages, so a new counter never empties the group
const BATCH = 25;

module.exports = {
  name: 'inactive',
  aliases: ['purge'],
  category: 'group',
  description: 'List members who never wrote a message (inactive) and remove them (inactive confirm / purge confirm) (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ sock, jid, args, reply, prefix, groupMetadata, botIds, isBotAdmin }) {
    const counts = activity.get(jid);
    if (!activity.total(jid)) {
      return reply('😴 *I have not counted any messages in this group yet,* so I cannot tell who is silent.');
    }
    const quiet = groupMetadata.participants.filter((p) => !participantIds(p).some((i) => counts[i] || botIds.includes(i)));
    const removable = quiet.filter((p) => !p.admin);
    const word = (args[0] || '').toLowerCase();

    // ---- remove them
    if (word === 'confirm') {
      if (!isBotAdmin) return reply('⚠️ *I need to be a group admin to remove members.*\n_Please make me an admin, then try again._');
      if (activity.total(jid) < MIN_COUNTED) return reply(`😴 *I have not counted enough messages yet* (at least ${MIN_COUNTED}) to know who is silent. Try again later.`);
      if (!removable.length) return reply('✅ *Everybody has written at least once.* Nobody to remove.');
      let done = 0;
      for (const p of removable.slice(0, BATCH)) {
        try {
          await sock.groupParticipantsUpdate(jid, [p.id], 'remove');
          done += 1;
        } catch (err) {
          break; // WhatsApp said stop
        }
        await sleep(1500); // slowly, so WhatsApp does not mind
      }
      const left = removable.length - done;
      return reply(`🧹 *Purge done:* ${done} member(s) removed.${left > 0 ? `\n_${left} still to go: run_ \`${prefix}inactive confirm\` _again._` : ''}`);
    }

    // ---- show them
    if (!quiet.length) return reply('✅ *Everyone has sent at least one message.*');
    const shown = quiet.slice(0, 40);
    const more = quiet.length > shown.length ? `\n_...and ${quiet.length - shown.length} more_` : '';
    const list = shown.map((p, i) => `${i + 1}. @${num(p.id)}`).join('\n');
    await reply(
      `😴 *Silent members* (${quiet.length})\n_No message seen since I started counting._\n\n${list}${more}\n\n` +
        `▸ \`${prefix}inactive confirm\` – remove up to ${BATCH} of them _(admins are never removed)_`,
      { mentions: shown.map((p) => p.id) }
    );
  },
};
