// Connect 4 for two players: send a column number from 1 to 7. First to line up four discs wins.
const { num } = require('../utils');

const ROWS = 6;
const COLS = 7;
const DISC = { R: '🔴', Y: '🟡' };
const HEAD = '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣';
const timeoutMs = 600000;
const title = 'Connect 4';
const limits = () => ({ min: 2, max: 2 });

const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const render = (b) => `${HEAD}\n${b.map((row) => row.map((c) => (c ? DISC[c] : '⚪')).join('')).join('\n')}`;

// the first free row from the bottom in a column, or -1
function drop(b, col, disc) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!b[r][col]) {
      b[r][col] = disc;
      return r;
    }
  }
  return -1;
}

function wins(b, r, c) {
  const me = b[r][c];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (const s of [1, -1]) {
      let rr = r + dr * s;
      let cc = c + dc * s;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr][cc] === me) {
        n += 1;
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (n >= 4) return true;
  }
  return false;
}

const full = (b) => b[0].every(Boolean);
const isPlayer = (p, ids) => ids.some((i) => p.ids.includes(i));

function create(opts, players) {
  return { type: 'connect4', board: emptyBoard(), red: players[0], yellow: players[1], turn: 'R' };
}

const intro = (g) =>
  `🔴 *Connect 4*\n@${num(g.red.jid)} (🔴) vs @${num(g.yellow.jid)} (🟡)\n\n${render(g.board)}\n\n@${num(g.red.jid)} goes first. Send a column number from 1 to 7.`;
const status = (g) => `${render(g.board)}\n${DISC[g.turn]} to play`;
const reveal = () => 'Nobody won.';

async function onMessage({ game, text, who, send, end, touch }) {
  if (!/^[1-7]$/.test(text)) return;
  const side = isPlayer(game.red, who.ids) ? 'R' : isPlayer(game.yellow, who.ids) ? 'Y' : null;
  if (!side) return;
  if (side !== game.turn) return send("⏳ It's not your turn yet.");
  const col = Number(text) - 1;
  const row = drop(game.board, col, side);
  if (row < 0) return send('⚠️ That column is full. Pick another one.');
  touch();
  const me = side === 'R' ? game.red : game.yellow;
  const other = side === 'R' ? game.yellow : game.red;
  if (wins(game.board, row, col)) {
    end();
    return send(`🎉 @${num(me.jid)} wins with four ${DISC[side]} in a row!\n\n${render(game.board)}`, [me.jid]);
  }
  if (full(game.board)) {
    end();
    return send(`🤝 The board is full: it's a draw!\n\n${render(game.board)}`);
  }
  game.turn = side === 'R' ? 'Y' : 'R';
  return send(`${render(game.board)}\n\n${DISC[game.turn]} Your turn @${num(other.jid)}`, [other.jid]);
}

module.exports = { title, limits, create, intro, status, reveal, onMessage, timeoutMs, render, drop, wins, emptyBoard, ROWS, COLS };
