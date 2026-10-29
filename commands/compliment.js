const { getTargets, num } = require('../whatsapp/utils');

const LINES = [
  'you light up every chat you walk into.', 'you have a great sense of humour.', 'your kindness really makes a difference.',
  'you are more talented than you realise.', 'you make hard things look easy.', 'your energy is contagious in the best way.',
  'you are a great friend to have around.', 'you always know how to make people smile.', 'your ideas are brilliant.',
  'you are stronger than you think.', 'you bring out the best in people.', 'you have a heart of gold.',
  'the world is better with you in it.', 'you are doing an amazing job.', 'you have excellent taste.',
];

module.exports = {
  name: 'compliment',
  category: 'fun',
  description: 'Send a nice compliment: compliment @friend',
  async run({ msg, reply }) {
    const target = getTargets(msg)[0];
    const line = LINES[Math.floor(Math.random() * LINES.length)];
    await reply(target ? `💐 @${num(target)}, ${line}` : `💐 Just so you know, ${line}`, { mentions: target ? [target] : [] });
  },
};
