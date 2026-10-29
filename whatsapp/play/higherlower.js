// Higher or lower: everybody guesses if the next number (1-100) is higher or lower. Wrong or silent players are out. Last one standing wins.
const { num } = require('../utils');

const timeoutMs = 600000;
const title = 'Higher or Lower';
const limits = () => ({ min: 2, max: 10 });
const ROUND_MS = 15000;
const MAX_ROUNDS = 8;

const keyOf = (p) => p.ids[0] || p.jid;
const find = (game, who) => game.players.find((p) => p.ids.some((i) => who.ids.includes(i)));
const rnd = () => 1 + Math.floor(Math.random() * 100);
const tags = (game, keys) => game.players.filter((p) => keys.includes(keyOf(p)));
const at = (game) => tags(game, game.alive).map((p) => `@${num(p.jid)}`).join(' ');

function create(opts, players) {
  return { type: 'higherlower', alive: players.map(keyOf), round: 0, n: rnd(), answers: {}, token: 0, done: false };
}
const intro = (g) => `🔢 *Higher or Lower*\n${g.players.length} players. Each round I show a number from 1 to 100.\nAnswer *higher* or *lower* (or *h* / *l*) in ${ROUND_MS / 1000} seconds. Wrong or silent = out!`;
const status = (g) => `🔢 Number ${g.n}. Alive: ${at(g)}`;
const reveal = () => 'The game ended.';

function startRound(game) {
  const ctx = game.ctx;
  game.round += 1;
  game.token += 1;
  game.answers = {};
  const token = game.token;
  ctx.send(`🔢 *Round ${game.round}/${MAX_ROUNDS}* – the number is *${game.n}*\nWill the next one be *higher* or *lower*?\n${at(game)}`, tags(game, game.alive).map((p) => p.jid));
  ctx.later(ROUND_MS, () => resolve(game, token));
}

async function resolve(game, token) {
  if (game.done || game.token !== token) return;
  const ctx = game.ctx;
  let next = rnd();
  while (next === game.n) next = rnd();
  const correct = next > game.n ? 'h' : 'l';
  const survivors = game.alive.filter((k) => game.answers[k] === correct);
  const out = game.alive.filter((k) => !survivors.includes(k));
  game.n = next;
  game.alive = survivors;
  game.token += 1; // ignore late answers
  const outText = out.length ? `\n❌ Out: ${tags(game, out).map((p) => `@${num(p.jid)}`).join(' ')}` : '';
  const line = `➡️ The next number is *${next}* – *${correct === 'h' ? 'higher' : 'lower'}*!${outText}`;
  const mentions = tags(game, [...survivors, ...out]).map((p) => p.jid);
  if (!survivors.length) {
    game.done = true;
    await ctx.send(`${line}\n\n😵 Nobody survived. No winner this time.`, mentions);
    return ctx.end();
  }
  if (survivors.length === 1 || game.round >= MAX_ROUNDS) {
    game.done = true;
    const winners = tags(game, survivors);
    await ctx.send(`${line}\n\n🏆 *${winners.length === 1 ? 'Winner' : 'Winners'}:* ${winners.map((p) => `@${num(p.jid)}`).join(' ')}`, mentions);
    return ctx.end(winners);
  }
  await ctx.send(`${line}\n✅ Still in: ${at(game)}`, mentions);
  ctx.later(2500, () => !game.done && startRound(game));
}

async function onStart(ctx) {
  ctx.game.ctx = ctx;
  ctx.later(2500, () => startRound(ctx.game));
}

async function onMessage({ game, text, who, touch }) {
  const p = find(game, who);
  const word = text.toLowerCase();
  const a = /^(h|higher|up|high)$/.test(word) ? 'h' : /^(l|lower|down|low)$/.test(word) ? 'l' : null;
  if (!p || !a || game.done || !game.alive.includes(keyOf(p)) || game.answers[keyOf(p)]) return;
  touch();
  game.answers[keyOf(p)] = a;
  if (game.alive.every((k) => game.answers[k])) await resolve(game, game.token); // everybody answered: no need to wait
}

module.exports = { title, limits, create, intro, status, reveal, onStart, onMessage, timeoutMs };
