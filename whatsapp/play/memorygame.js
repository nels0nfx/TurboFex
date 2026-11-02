// Memory: the bot shows a row of emojis for a few seconds, then hides it. The first player to type the row back wins the round.
// Every round the row is one emoji longer.
const { num } = require('../utils');

const title = 'Memory';
const timeoutMs = 60000;
const limits = () => ({ min: 1, max: 8 });
const settings = { showMs: 3500, perEmojiMs: 900 }; // how long the row is visible: showMs + perEmojiMs for each emoji (tests make it short)
const POOL = ['🍎', '🍌', '🍇', '🍒', '🐶', '🐱', '🐸', '🦁', '⚽', '🚗', '🌟', '🎈'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => String(s || '').replace(/\uFE0F/g, '');

const create = () => ({ type: 'memorygame', sequence: [], ready: false });
const intro = () => '🧠 *Memory*\nI will show a row of emojis for a few seconds, then hide it. Type the row back (spaces do not matter). First one wins the round!';
const reveal = (g) => `The row was ${g.sequence.join(' ')}`;
const status = (g) => (g.ready ? '🙈 Type the row you saw!' : '👀 Watch closely...');

// after the intro: the row is shown, then hidden
async function onStart(ctx) {
  const g = ctx.game;
  const level = 2 + (g.series ? g.series.round : 1);
  const seq = Array.from({ length: Math.min(level, 10) }, () => POOL[Math.floor(Math.random() * POOL.length)]);
  g.sequence = seq;
  g.ready = false;
  const roundId = g.roundId;
  const shown = await ctx.send(`👀 *Memorize!* (${seq.length} emojis)\n\n${seq.join(' ')}`);
  await sleep(settings.showMs + settings.perEmojiMs * seq.length);
  if (g.roundId !== roundId || g.phase !== 'playing') return; // the round or the game ended
  try {
    await ctx.sock.sendMessage(ctx.jid, { text: `🙈 *Hidden!* Type the ${seq.length} emojis you saw.`, edit: shown.key });
  } catch (err) {
    await ctx.send(`🙈 *Hidden!* Type the ${seq.length} emojis you saw.`);
  }
  g.ready = true;
}

async function onMessage({ game: g, text, who, send, end, touch }) {
  if (!g.ready) return;
  const got = strip(text).match(/\p{Extended_Pictographic}/gu) || [];
  if (got.length !== g.sequence.length) return;
  touch();
  if (got.join('') !== g.sequence.map(strip).join('')) return send('❌ Not quite. Try again!');
  g.ready = false;
  await send(`🎉 @${num(who.jid)} remembered it! ${g.sequence.join(' ')}`, [who.jid]);
  return end(who);
}

module.exports = { title, limits, create, intro, status, reveal, onStart, onMessage, timeoutMs, settings, POOL };
