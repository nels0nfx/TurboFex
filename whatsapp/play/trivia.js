// Multiple-choice quiz. Answer with 1, 2, 3 or 4. Everyone gets one try.
const { QUESTIONS } = require('./data');
const { num } = require('../utils');

const timeoutMs = 45000; // 45 seconds per round
const title = 'Trivia';
const status = (g) => `❓ ${g.question}\n${g.options.map((o, i) => `${i + 1}. ${o}`).join(' • ')}`;
const reveal = (g) => `The answer was *${g.options[g.answer]}*.`;

function create() {
  const [question, correct, ...wrong] = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  const options = [correct, ...wrong].sort(() => Math.random() - 0.5);
  return { type: 'trivia', question, options, answer: options.indexOf(correct), tried: [] };
}

const intro = (game) =>
  `🧠 *Trivia*\n${game.question}\n\n${game.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nReply with 1, 2, 3 or 4. One try each!`;

async function onMessage({ game, players, text, who, send, end, touch }) {
  if (!/^[1-4]$/.test(text)) return;
  const id = who.ids[0] || who.jid;
  if (game.tried.includes(id)) return;
  game.tried.push(id);
  touch();

  if (Number(text) - 1 === game.answer) {
    await send(`🎉 @${num(who.jid)} is right! The answer is *${game.options[game.answer]}*`, [who.jid]);
    return end(who);
  }
  if (game.tried.length >= players.length) {
    await send(`😅 Nobody got it. The answer was *${game.options[game.answer]}*`);
    return end();
  }
  return send(`❌ @${num(who.jid)}, not that one. Others can still try!`, [who.jid]);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs };
