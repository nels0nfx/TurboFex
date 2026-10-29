// Typing race: the first to type the sentence exactly wins the round
const { num } = require('../utils');

const timeoutMs = 60000;
const title = 'Typing Race';

const SENTENCES = [
  'The quick brown fox jumps over the lazy dog',
  'A good friend is worth more than gold',
  'Slow and steady wins the race',
  'Every morning brings a new chance to start again',
  'Practice makes a person better every single day',
  'Never trust a calm sea or a quiet room full of cats',
  'Hard work beats talent when talent does not work hard',
  'The best time to plant a tree was twenty years ago',
  'Small steps every day lead to big changes',
  'A smile costs nothing but gives so much',
  'Strong winds teach the trees to grow deep roots',
  'Fast fingers win the game but calm minds win the war',
  'Bring your own water and share your last biscuit',
  'The market opens early for those who wake up first',
  'Music makes the long road feel much shorter',
  'Patience is bitter but its fruit is sweet',
  'Help someone today and you will help yourself tomorrow',
  'Rain on the roof sounds best with a warm cup of tea',
  'Do not count the days, make the days count',
  'A river cuts through rock by being persistent not powerful',
];

const norm = (s) => String(s || '').toLowerCase().replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();
const status = (g) => `⌨️ ${g.sentence}`;
const reveal = (g) => `The sentence was: _${g.sentence}_`;
const create = () => ({ type: 'typerace', sentence: SENTENCES[Math.floor(Math.random() * SENTENCES.length)], startedAt: 0 });
const intro = (g) => `⌨️ *Typing race*\nType this sentence exactly, as fast as you can:\n\n\`${g.sentence}\``;

async function onMessage({ game, text, who, send, end, touch }) {
  if (!game.startedAt) game.startedAt = game.t || Date.now();
  touch();
  if (norm(text) !== norm(game.sentence)) return;
  const secs = Math.max(0.1, (Date.now() - game.startedAt) / 1000);
  const wpm = Math.round(game.sentence.split(' ').length / (secs / 60));
  await send(`🏁 @${num(who.jid)} wins!\n*Time:* ${secs.toFixed(1)} s  •  *Speed:* ${wpm} words per minute`, [who.jid]);
  return end(who);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs, SENTENCES, norm };
