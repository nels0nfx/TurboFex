// Quick maths: first one to send the right answer wins
const { num } = require('../utils');

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const timeoutMs = 45000; // 45 seconds per round
const title = 'Maths Quiz';
const status = (g) => `➗ ${g.question} = ?`;
const reveal = (g) => `${g.question} = *${g.answer}*`;

function create(options = {}) {
  const level = options.level || 'easy';
  let question;
  let answer;
  if (level === 'hard') {
    const a = rand(12, 30);
    const b = rand(3, 12);
    const c = rand(10, 99);
    question = `${a} × ${b} + ${c}`;
    answer = a * b + c;
  } else if (level === 'medium') {
    if (Math.random() < 0.5) {
      const a = rand(2, 12);
      const b = rand(2, 12);
      question = `${a} × ${b}`;
      answer = a * b;
    } else {
      const a = rand(30, 99);
      const b = rand(10, 60);
      const plus = Math.random() < 0.5;
      question = `${a} ${plus ? '+' : '-'} ${b}`;
      answer = plus ? a + b : a - b;
    }
  } else {
    const a = rand(2, 20);
    const b = rand(2, 20);
    const plus = Math.random() < 0.5;
    question = `${Math.max(a, b)} ${plus ? '+' : '-'} ${Math.min(a, b)}`;
    answer = plus ? a + b : Math.max(a, b) - Math.min(a, b);
  }
  return { type: 'mathquiz', level, question, answer };
}

const intro = (game) => `➗ *Maths quiz* (${game.level})\nWhat is *${game.question}* ?\nFirst correct answer wins!`;

async function onMessage({ game, text, who, send, end, touch }) {
  if (!/^-?\d{1,7}$/.test(text)) return;
  touch(); // counts as playing, even when the answer is wrong
  if (Number(text) !== game.answer) return;
  await send(`🎉 @${num(who.jid)} got it! ${game.question} = *${game.answer}*`, [who.jid]);
  return end(who);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs };
