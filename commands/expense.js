const { entry } = require('../whatsapp/budget');

module.exports = {
  name: 'expense',
  category: 'budget',
  description: 'Save money you spent: expense 250 groceries',
  run: (ctx) => entry(ctx, 'out'),
};
