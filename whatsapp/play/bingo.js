// Bingo: every player gets 3 numbers from 1 to 15. I draw a number every few seconds. The first card to be complete wins.
const { num } = require('../utils');

const timeoutMs = 600000;
const title = 'Bingo';
const limits = () => ({ min: 2, max: 10 });
const RANGE = 15;
const PER_CARD = 3;
const DRAW_MS = 4000;

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const card = () => shuffle(Array.from({ length: RANGE }, (_, i) => i + 1)).slice(0, PER_CARD).sort((a, b) => a - b);

function create(opts, players) {
  return { type: 'bingo', cards: players.map(() => card()), drawn: [], pool: shuffle(Array.from({ length: RANGE }, (_, i) => i + 1)), over: false };
}
const mark = (g, i) => g.cards[i].map((n) => (g.drawn.includes(n) ? `✅${n}` : `⬜${n}`)).join('  ');
const intro = (g) => `🎱 *Bingo!*\nNumbers go from 1 to ${RANGE}. I draw one every ${DRAW_MS / 1000} seconds. The first complete card wins!\n\n${g.players.map((p, i) => `@${num(p.jid)}: *${g.cards[i].join(' • ')}*`).join('\n')}\n\n_Send *card* to see your marks._`;
const status = (g) => `🎱 Drawn: ${g.drawn.join(', ') || 'nothing yet'}`;
const reveal = () => 'The game ended.';

function drawNext(game, ctx) {
  if (game.over) return;
  const n = game.pool.pop();
  if (n === undefined) {
    game.over = true;
    ctx.send('🎱 All the numbers are drawn and nobody completed a card.');
    return ctx.end();
  }
  game.drawn.push(n);
  const winners = game.players.filter((p, i) => game.cards[i].every((x) => game.drawn.includes(x)));
  if (winners.length) {
    game.over = true;
    ctx.send(`🎱 *${n}*  (${game.drawn.join(', ')})\n\n🎉 *BINGO!* ${winners.map((p) => `@${num(p.jid)}`).join(' ')} completed a card!`, winners.map((p) => p.jid));
    return ctx.end(winners);
  }
  ctx.send(`🎱 *${n}*  _(drawn: ${game.drawn.join(', ')})_`);
  ctx.later(DRAW_MS, () => drawNext(game, ctx));
}

async function onStart(ctx) {
  ctx.later(DRAW_MS, () => drawNext(ctx.game, ctx));
}

async function onMessage({ game, text, who, send, touch }) {
  if (text.toLowerCase() !== 'card') return;
  const i = game.players.findIndex((p) => p.ids.some((id) => who.ids.includes(id)));
  if (i < 0) return;
  touch();
  await send(`🎴 @${num(who.jid)}: ${mark(game, i)}`, [who.jid]);
}

module.exports = { title, limits, create, intro, status, reveal, onStart, onMessage, timeoutMs };
