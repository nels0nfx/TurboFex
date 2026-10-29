// Unscramble the word, first one to type it wins
const { WORDS } = require('./data');
const { num } = require('../utils');

const timeoutMs = 60000; // 1 minute per round
const title = 'Word Scramble';
const status = (g) => `🔀 ${[...g.scrambled].join(' ').toUpperCase()} (${g.word.length} letters, starts with ${g.word[0].toUpperCase()})`;
const reveal = (g) => `The word was *${g.word.toUpperCase()}*.`;

function shuffle(word) {
  const letters = [...word];
  for (let tries = 0; tries < 10; tries++) {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    if (letters.join('') !== word) break;
  }
  return letters.join('');
}

function create() {
  const all = Object.values(WORDS).flat().filter((w) => w.length >= 5);
  const word = all[Math.floor(Math.random() * all.length)];
  return { type: 'scramble', word, scrambled: shuffle(word) };
}

const intro = (game) =>
  `🔀 *Word scramble*\nUnscramble this word:\n\n*${[...game.scrambled].join(' ').toUpperCase()}*\n\nHint: it starts with "${game.word[0].toUpperCase()}" and has ${game.word.length} letters. First to type it wins!`;

async function onMessage({ game, text, who, send, end, touch }) {
  const t = text.toLowerCase();
  if (!/^[a-z]+$/.test(t) || t.length !== game.word.length) return;
  touch(); // counts as playing, even when the guess is wrong
  if (t !== game.word) return;
  await send(`🎉 @${num(who.jid)} got it! The word was *${game.word.toUpperCase()}*`, [who.jid]);
  return end(who);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs };
