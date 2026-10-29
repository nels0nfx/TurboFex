const { num } = require('../whatsapp/utils');

module.exports = {
  name: 'requests',
  category: 'group',
  description: 'See join requests, or: requests approve / requests reject (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ sock, jid, args, reply, prefix }) {
    const list = (await sock.groupRequestParticipantsList(jid)) || [];
    if (!list.length) return reply('✅ No pending join requests.');

    const action = (args[0] || '').toLowerCase();
    if (action === 'approve' || action === 'reject') {
      await sock.groupRequestParticipantsUpdate(jid, list.map((r) => r.jid), action);
      return reply(`✅ ${action === 'approve' ? 'Approved' : 'Rejected'} ${list.length} request(s).`);
    }

    const lines = list.map((r, i) => `${i + 1}. @${num(r.jid)}`).join('\n');
    return reply(
      `📥 *Join requests* (${list.length})\n\n${lines}\n\n${prefix}requests approve\n${prefix}requests reject`,
      { mentions: list.map((r) => r.jid) }
    );
  },
};
