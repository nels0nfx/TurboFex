const { setActionMode } = require('../whatsapp/actions');

module.exports = {
  name: 'antiword',
  category: 'group',
  description: 'Banned words: off / delete / warn / kick (admins only)',
  groupOnly: true,
  adminOnly: true,
  run: (ctx) => setActionMode(ctx, { key: 'antiwordMode', label: 'Anti-word', trigger: 'uses a banned word' }),
};
