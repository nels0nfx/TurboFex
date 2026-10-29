// Hangman: send one letter at a time, or try the whole word
const { WORDS } = require('./data');
const { num } = require('../utils');

const MAX_WRONG = 6;
const timeoutMs = 120000; // 2 minutes per round
const FACES = ['😀', '🙂', '😐', '😟', '😨', '😱', '💀'];

const title = 'Hangman';
const status = (g) => board(g);
const reveal = (g) => `The word was *${g.word.toUpperCase()}*.`;

function create() {
  const categories = Object.keys(WORDS);
  const category = categories[Math.floor(Math.random() * categories.length)];
  const list = WORDS[category];
  return { type: 'hangman', word: list[Math.floor(Math.random() * list.length)], category, letters: [], wrong: 0 };
}

function board(game, reveal = false) {
  const word = [...game.word].map((c) => (reveal || game.letters.includes(c) ? c.toUpperCase() : '＿')).join(' ');
  const bad = game.letters.filter((c) => !game.word.includes(c));
  return `${FACES[game.wrong]}  ${word}\n❌ Wrong (${game.wrong}/${MAX_WRONG}): ${bad.length ? bad.join(' ').toUpperCase() : '-'}`;
}

const intro = (game) =>
  `🔤 *Hangman*\nCategory: ${game.category} (${game.word.length} letters)\n\n${board(game)}\n\nSend a letter to guess, or the whole word if you know it!`;

async function onMessage({ game, text, who, send, end, touch }) {
  const t = text.toLowerCase();
  const isLetter = /^[a-z]$/.test(t);
  const isWholeWord = /^[a-z]+$/.test(t) && t.length === game.word.length && t.length > 1;
  if (!isLetter && !isWholeWord) return;

  if (isWholeWord) {
    touch();
    if (t === game.word) {
      await send(`🎉 @${num(who.jid)} got the word: *${game.word.toUpperCase()}*!`, [who.jid]);
      return end(who);
    }
    game.wrong += 1;
  } else {
    if (game.letters.includes(t)) return send(`ℹ️ *${t.toUpperCase()}* was already guessed.`);
    touch();
    game.letters.push(t);
    if (!game.word.includes(t)) game.wrong += 1;
  }

  if ([...game.word].every((c) => game.letters.includes(c))) {
    await send(`🎉 @${num(who.jid)} solved it! The word was *${game.word.toUpperCase()}*`, [who.jid]);
    return end(who);
  }
  if (game.wrong >= MAX_WRONG) {
    await send(`💀 Out of guesses! The word was *${game.word.toUpperCase()}*\n\n${board(game, true)}`);
    return end();
  }
  return send(board(game));
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs };
