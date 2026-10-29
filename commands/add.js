const meta = require('../whatsapp/metadata');

const STATUS = {
  200: '✅ added',
  403: '⚠️ their privacy settings block adding (send them the invite link instead)',
  408: '⚠️ they left the group recently',
  409: 'ℹ️ already in the group',
};

module.exports = {
  name: 'add',
  category: 'group',
  description: 'Add a person by phone number, e.g. add 27821234567 (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ sock, jid, args, reply, prefix }) {
    const numbers = args.map((a) => a.replace(/\D/g, '')).filter((n) => n.length >= 7 && n.length <= 15);
    if (!numbers.length) {
      return reply(`Please give the number with its country code.\nExample: ${prefix}add 27821234567`);
    }

    const lines = [];
    for (const n of numbers.slice(0, 10)) {
      try {
        const res = await sock.groupParticipantsUpdate(jid, [`${n}@s.whatsapp.net`], 'add');
        const status = Number(res?.[0]?.status);
        lines.push(`${n}: ${STATUS[status] || `⚠️ could not add (code ${status})`}`);
      } catch (err) {
        lines.push(`${n}: ❌ failed`);
      }
    }
    meta.invalidate(jid);
    await reply(lines.join('\n'));
  },
};
