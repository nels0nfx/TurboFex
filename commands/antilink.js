const { setActionMode } = require('../whatsapp/actions');

module.exports = {
  name: 'antilink',
  category: 'group',
  description: 'Links: off / delete / warn / kick (admins only)',
  groupOnly: true,
  adminOnly: true,
  run: (ctx) => setActionMode(ctx, { key: 'antilinkMode', label: 'Anti-link', trigger: 'sends a link' }),
};
