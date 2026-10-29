const store = require('../whatsapp/store');

const KINDS = ['sticker', 'image', 'video', 'audio', 'document'];

module.exports = {
  name: 'antimedia',
  category: 'group',
  description: 'Do not allow some kinds of media in this group: antimedia sticker on, antimedia all off',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ jid, args, reply, prefix }) {
    const kind = (args[0] || '').toLowerCase().replace(/s$/, '');
    const state = (args[1] || '').toLowerCase();
    const g = store.getGroup(jid);

    if (!kind) {
      const rows = KINDS.map((k) => `▸ *${k}:* ${g.antimedia[k] ? 'NOT allowed' : 'allowed'}`).join('\n');
      return reply(`*Media in this group*\n${rows}\n\n▸ \`${prefix}antimedia sticker on\`\n▸ \`${prefix}antimedia all off\`\n_Admins are never limited. Blocked media is deleted._`);
    }
    if (!(kind === 'all' || KINDS.includes(kind)) || !['on', 'off'].includes(state)) {
      return reply(`⚠️ Use it like this: ${prefix}antimedia sticker on\nKinds: ${KINDS.join(', ')}, all`);
    }
    store.update(jid, (x) => {
      for (const k of kind === 'all' ? KINDS : [kind]) x.antimedia[k] = state === 'on';
    });
    return reply(`✅ *${kind}* is now ${state === 'on' ? 'NOT allowed' : 'allowed'} in this group.`);
  },
};
