const { entry } = require('../whatsapp/budget');

module.exports = {
  name: 'income',
  category: 'budget',
  description: 'Save money you received: income 5000 salary',
  run: (ctx) => entry(ctx, 'in'),
};
