// Word chain: take turns. Each word must start with the LAST letter of the word before it, has at least 3 letters and cannot
// be used twice. Whoever does not answer in time is out. The last player standing wins.
// (There is no dictionary: a word is a word when the players accept it.)
const { num } = require('../utils');

const title = 'Word Chain';
const timeoutMs = 20 * 60 * 1000; // the whole game, a safety net
const limits = () => ({ min: 2, max: 10 });
const settings = { turnMs: 25000 }; // the time for one turn (tests make it short)

const keyOf = (p) => p.ids[0] || p.jid;
const find = (g, who) => g.players.find((p) => p.ids.some((i) => who.ids.includes(i)));
const current = (g) => g.players.find((p) => keyOf(p) === g.alive[g.turn % g.alive.length]);
const tag = (p) => `@${num(p.jid)}`;
const reveal = () => 'The game ended.';

function create(opts, players) {
  return { type: 'wordchain', alive: players.map(keyOf), turn: 0, used: new Set(), last: '', over: false, turnId: 0, turnTimer: null };
}

const intro = (g) => `🔗 *Word chain*\nTake turns. Each word starts with the *last letter* of the word before it (3 letters or more, no repeats). If you do not answer in ${Math.round(settings.turnMs / 1000)} seconds you are out!\n\n👉 ${tag(current(g))}, start with any word.`;
const status = (g) => `👉 ${tag(current(g))} to play${g.last ? ` - the word must start with *${g.last.slice(-1).toUpperCase()}*` : ''}`;

// the timer of one turn
function armTurn(ctx) {
  const g = ctx.game;
  clearTimeout(g.turnTimer);
  const id = ++g.turnId;
  g.turnTimer = ctx.later(settings.turnMs, () => timeUp(ctx, id));
}

async function timeUp(ctx, id) {
  const g = ctx.game;
  if (g.over || g.turnId !== id) return;
  const p = current(g);
  const at = g.turn % g.alive.length;
  g.alive.splice(at, 1);
  g.turn = g.alive.length ? at % g.alive.length : 0; // the next player takes the place of the one who left
  if (g.alive.length === 1) return win(ctx, `⌛ @${num(p.jid)} ran out of time and is out!`);
  await ctx.send(`⌛ ${tag(p)} ran out of time and is out! ${g.alive.length} players left.\n${status(g)}`, g.players.map((x) => x.jid));
  armTurn(ctx);
}

async function win(ctx, line) {
  const g = ctx.game;
  g.over = true;
  clearTimeout(g.turnTimer);
  const winner = g.players.find((p) => keyOf(p) === g.alive[0]);
  await ctx.send(`${line}\n\n🏆 *Winner:* ${tag(winner)} after ${g.used.size} words!`, g.players.map((x) => x.jid));
  return ctx.end(winner);
}

async function onStart(ctx) {
  armTurn(ctx);
}

async function onMessage(ctx) {
  const { game: g, text, who, send, touch } = ctx;
  if (g.over) return;
  const w = text.toLowerCase();
  if (!/^[a-z]{3,}$/.test(w)) return; // chatting is ignored
  const p = find(g, who);
  if (!p || !g.alive.includes(keyOf(p))) return;
  if (keyOf(current(g)) !== keyOf(p)) return;
  if (g.last && w[0] !== g.last.slice(-1)) return send(`⚠️ The word must start with *${g.last.slice(-1).toUpperCase()}*.`);
  if (g.used.has(w)) return send('⚠️ That word was already used. Try another one.');
  touch();
  g.used.add(w);
  g.last = w;
  g.turn += 1;
  armTurn(ctx);
  await send(`✅ *${w.toUpperCase()}*\n👉 ${tag(current(g))}, a word starting with *${w.slice(-1).toUpperCase()}*`, g.players.map((x) => x.jid));
}

module.exports = { title, limits, create, intro, status, reveal, onStart, onMessage, timeoutMs, settings };
