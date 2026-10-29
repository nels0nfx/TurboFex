// Minesweeper for a group: 25 squares, 5 hide a mine. Take turns picking a number. A mine knocks you out.
const { num } = require('../utils');

const timeoutMs = 900000;
const title = 'Mines';
const limits = () => ({ min: 1, max: 10 });
const SIZE = 25;
const MINES = 5;

const keyOf = (p) => p.ids[0] || p.jid;
const find = (game, who) => game.players.find((p) => p.ids.some((i) => who.ids.includes(i)));

function create(opts, players) {
  const mines = new Set();
  while (mines.size < MINES) mines.add(1 + Math.floor(Math.random() * SIZE));
  return { type: 'mines', mines, opened: new Set(), score: {}, alive: players.map(keyOf), turn: 0, over: false };
}

function board(g) {
  const cell = (n) => (g.opened.has(n) ? (g.mines.has(n) ? ' ✖ ' : ' ◆ ') : String(n).padStart(2, ' ') + ' ');
  const rows = [];
  for (let r = 0; r < 5; r++) rows.push(Array.from({ length: 5 }, (_, c) => cell(r * 5 + c + 1)).join(''));
  return '```\n' + rows.join('\n') + '\n```';
}
const current = (g) => g.players.find((p) => keyOf(p) === g.alive[g.turn % g.alive.length]);
const intro = (g) => `💣 *Mines*\n${SIZE} squares, ${MINES} hide a mine. Pick a number on your turn: a safe square (◆) scores a point, a mine (✖) knocks you out.\n\n${board(g)}\n👉 @${num(current(g).jid)}, pick a number.`;
const status = (g) => board(g);
const reveal = () => 'The game ended.';

async function onMessage({ game, text, who, send, end, touch }) {
  if (game.over || !/^\d{1,2}$/.test(text)) return;
  const p = find(game, who);
  if (!p || !game.alive.includes(keyOf(p))) return;
  const me = current(game);
  if (keyOf(me) !== keyOf(p)) return send("⏳ It's not your turn yet.");
  const n = Number(text);
  if (n < 1 || n > SIZE) return;
  if (game.opened.has(n)) return send('⚠️ That square is already open. Pick another one.');
  touch();
  game.opened.add(n);
  let line;
  if (game.mines.has(n)) {
    line = `💥 @${num(p.jid)} hit a *mine* and is out!`;
    const at = game.alive.indexOf(keyOf(p));
    game.alive.splice(at, 1);
    game.turn = at; // the next player takes the place of the one who left
  } else {
    game.score[keyOf(p)] = (game.score[keyOf(p)] || 0) + 1;
    line = `◆ @${num(p.jid)} found a safe square! (${game.score[keyOf(p)]} point${game.score[keyOf(p)] > 1 ? 's' : ''})`;
    game.turn += 1;
  }
  const safeLeft = SIZE - MINES - [...game.opened].filter((x) => !game.mines.has(x)).length;
  const finish = async (winners, why) => {
    game.over = true;
    await send(`${line}\n\n${board(game)}\n${why}${winners.length ? `\n🏆 *${winners.length === 1 ? 'Winner' : 'Winners'}:* ${winners.map((w) => `@${num(w.jid)}`).join(' ')}` : ''}`, game.players.map((x) => x.jid));
    return end(winners);
  };
  if (!game.alive.length) return finish([], '😵 Everybody hit a mine. No winner!');
  if (game.players.length > 1 && game.alive.length === 1) return finish([game.players.find((x) => keyOf(x) === game.alive[0])], 'The last player standing!');
  if (safeLeft <= 0) {
    const best = Math.max(...game.alive.map((k) => game.score[k] || 0));
    return finish(game.players.filter((x) => game.alive.includes(keyOf(x)) && (game.score[keyOf(x)] || 0) === best), 'Every safe square is open!');
  }
  const next = current(game);
  return send(`${line}\n\n${board(game)}\n👉 @${num(next.jid)}, your turn.`, [p.jid, next.jid]);
}

module.exports = { title, limits, create, intro, status, reveal, onMessage, timeoutMs, board };
