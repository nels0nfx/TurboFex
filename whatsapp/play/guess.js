// Guess the number between 1 and 100, everyone in the chat can play
const { num } = require('../utils');

const MAX_TRIES = 12;
const timeoutMs = 150000; // 2.5 minutes per round

const title = 'Guess the Number';
const status = (g) => `🔢 It is between ${g.lo} and ${g.hi} • ${MAX_TRIES - g.tries} tries left`;
const reveal = (g) => `The number was *${g.number}*.`;

function create() {
  return { type: 'guess', number: 1 + Math.floor(Math.random() * 100), lo: 1, hi: 100, tries: 0 };
}

const intro = () => `🔢 *Guess the number*\nI am thinking of a number from 1 to 100.\nSend your guess! You have ${MAX_TRIES} tries as a team.`;

async function onMessage({ game, text, who, send, end, touch }) {
  if (!/^\d{1,3}$/.test(text)) return;
  const n = Number(text);
  if (n < 1 || n > 100) return;

  touch();
  game.tries += 1;
  if (n === game.number) {
    await send(`🎉 @${num(who.jid)} got it! The number was *${game.number}* (try #${game.tries}).`, [who.jid]);
    return end(who);
  }
  if (game.tries >= MAX_TRIES) {
    await send(`😵 Out of tries! The number was *${game.number}*.`);
    return end();
  }
  if (n < game.number) game.lo = Math.max(game.lo, n + 1);
  else game.hi = Math.min(game.hi, n - 1);
  return send(`${n < game.number ? '🔼 Higher' : '🔽 Lower'} than ${n}. It is between ${game.lo} and ${game.hi}. (${MAX_TRIES - game.tries} tries left)`);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs };
