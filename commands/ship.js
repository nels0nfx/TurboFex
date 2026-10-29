const { getTargets, num } = require('../whatsapp/utils');

function score(a, b) {
  const text = [a, b].map((s) => s.toLowerCase()).sort().join('+');
  let h = 7;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 1009;
  return h % 101;
}

module.exports = {
  name: 'ship',
  category: 'fun',
  description: 'Love meter: ship @a @b, or ship Anna | Tom',
  async run({ msg, rest, reply, prefix }) {
    const tagged = getTargets(msg);
    let names;
    let mentions = [];
    if (tagged.length >= 2) {
      names = [`@${num(tagged[0])}`, `@${num(tagged[1])}`];
      mentions = tagged.slice(0, 2);
    } else {
      names = rest.split('|').map((s) => s.trim()).filter(Boolean);
    }
    if (names.length < 2) return reply(`Give me two names.\nExample: ${prefix}ship Anna | Tom`);

    const pct = score(names[0], names[1]);
    const bar = '❤️'.repeat(Math.round(pct / 10)) + '🤍'.repeat(10 - Math.round(pct / 10));
    const verdict = pct >= 80 ? 'A perfect match! 💍' : pct >= 50 ? 'There is something there 😉' : pct >= 25 ? 'Maybe just friends 🙂' : 'Not meant to be 😅';
    await reply(`💘 *Love meter*\n${names[0]} + ${names[1]}\n\n${bar}\n*${pct}%*  ${verdict}`, { mentions });
  },
};
