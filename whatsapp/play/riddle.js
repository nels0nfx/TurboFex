// Riddles: first one to type the answer wins the round
const { num } = require('../utils');

const timeoutMs = 75000;
const title = 'Riddle';

// [riddle, [accepted answers]]
const RIDDLES = [
  ['What has keys but cannot open locks?', ['keyboard', 'piano']],
  ['What gets wetter the more it dries?', ['towel']],
  ['What has hands but cannot clap?', ['clock', 'watch']],
  ['What can you catch but not throw?', ['cold']],
  ['The more you take, the more you leave behind. What am I?', ['footsteps', 'steps', 'footstep']],
  ['What has a head and a tail but no body?', ['coin']],
  ['What goes up but never comes down?', ['age']],
  ['What has many teeth but cannot bite?', ['comb']],
  ['What runs but never walks, has a mouth but never talks?', ['river']],
  ['What can fill a room but takes up no space?', ['light']],
  ['I speak without a mouth and hear without ears. What am I?', ['echo']],
  ['What has one eye but cannot see?', ['needle']],
  ['What belongs to you but is used more by others?', ['name']],
  ['What has a neck but no head?', ['bottle']],
  ['What can travel around the world while staying in a corner?', ['stamp']],
  ['What building has the most stories?', ['library']],
  ['What is full of holes but still holds water?', ['sponge']],
  ['What comes once in a minute, twice in a moment, but never in a thousand years?', ['m', 'letter m', 'the letter m']],
  ['What has words but never speaks?', ['book']],
  ['What is always in front of you but cannot be seen?', ['future']],
  ['What gets bigger the more you take away from it?', ['hole']],
  ['What tastes better than it smells?', ['tongue']],
  ['What month of the year has 28 days?', ['all', 'all of them', 'every month']],
  ['I have cities but no houses, mountains but no trees, water but no fish. What am I?', ['map']],
];

const norm = (s) => String(s || '').toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9 ]/g, '').trim();
const status = (g) => `🧩 ${g.q}\n💡 Hint: ${g.answers[0][0].toUpperCase()}${'_'.repeat(Math.max(0, g.answers[0].length - 1))} (${g.answers[0].length} letters)`;
const reveal = (g) => `The answer was *${g.answers[0]}*.`;

function create() {
  const [q, answers] = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];
  return { type: 'riddle', q, answers };
}
const intro = (g) => `🧩 *Riddle*\n\n${g.q}\n\nFirst to type the answer wins!`;

async function onMessage({ game, text, who, send, end, touch }) {
  const t = norm(text);
  if (!t || t.length > 40) return;
  touch();
  if (!game.answers.some((a) => norm(a) === t)) return;
  await send(`🎉 @${num(who.jid)} got it! The answer was *${game.answers[0]}*.`, [who.jid]);
  return end(who);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs, RIDDLES, norm };
