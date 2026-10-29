// Tic-tac-toe, played by sending 1-9. Can be two people, or one person against the bot.
const { num } = require('../utils');

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const NUMS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const MARK = { X: '❌', O: '⭕' };

function render(board) {
  const cell = (i) => (board[i] ? MARK[board[i]] : NUMS[i]);
  return [0, 3, 6].map((r) => `${cell(r)}${cell(r + 1)}${cell(r + 2)}`).join('\n');
}

function winnerOf(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

const emptyCells = (board) => board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);

// the bot plays O; it is perfect most of the time but slips now and then so it can be beaten
function minimax(board, turn) {
  const w = winnerOf(board);
  if (w) return { score: w === 'O' ? 1 : -1 };
  const cells = emptyCells(board);
  if (!cells.length) return { score: 0 };
  let best = null;
  for (const i of cells) {
    board[i] = turn;
    const { score } = minimax(board, turn === 'O' ? 'X' : 'O');
    board[i] = null;
    if (best === null || (turn === 'O' ? score > best.score : score < best.score)) best = { score, move: i };
  }
  return best;
}

function botMove(board) {
  const cells = emptyCells(board);
  if (Math.random() < 0.25) return cells[Math.floor(Math.random() * cells.length)];
  return minimax([...board], 'O').move;
}

const title = 'Tic-Tac-Toe';
// two players, or one player against the bot (options.ai)
const limits = (opts) => (opts.ai ? { min: 1, max: 1 } : { min: 2, max: 2 });

// players come from the lobby: [first, second]
function create(opts, players) {
  const x = players[0];
  const o = opts.ai ? { jid: opts.botJid, ids: [], ai: true } : players[1];
  return { board: Array(9).fill(null), x, o, turn: 'X' };
}

const isPlayer = (player, ids) => !player.ai && ids.some((i) => player.ids.includes(i));

function intro(game) {
  const o = game.o.ai ? '🤖 TurboFex' : `@${num(game.o.jid)}`;
  return (
    `🎮 *Tic-Tac-Toe*\n@${num(game.x.jid)} (❌) vs ${o} (⭕)\n\n${render(game.board)}\n\n` +
    `@${num(game.x.jid)} goes first. Send a number from 1 to 9 to play.`
  );
}

async function onMessage({ game, text, who, send, end, touch }) {
  if (!/^[1-9]$/.test(text)) return;
  const side = isPlayer(game.x, who.ids) ? 'X' : isPlayer(game.o, who.ids) ? 'O' : null;
  if (!side) return; // somebody who is not playing
  if (side !== game.turn) return send("⏳ It's not your turn yet.");
  const cell = Number(text) - 1;
  if (game.board[cell]) return send('⚠️ That spot is taken. Pick another number.');

  touch();
  game.board[cell] = side;
  const me = side === 'X' ? game.x : game.o;
  const other = side === 'X' ? game.o : game.x;

  if (winnerOf(game.board)) {
    end();
    return send(`🎉 @${num(me.jid)} wins!\n\n${render(game.board)}`, [me.jid]);
  }
  if (!emptyCells(game.board).length) {
    end();
    return send(`🤝 It's a draw!\n\n${render(game.board)}`);
  }

  if (game.o.ai) {
    const move = botMove(game.board);
    game.board[move] = 'O';
    const note = `You: ❌ ${cell + 1}   Me: ⭕ ${move + 1}`;
    if (winnerOf(game.board)) {
      end();
      return send(`🤖 I win this time!\n${note}\n\n${render(game.board)}`);
    }
    if (!emptyCells(game.board).length) {
      end();
      return send(`🤝 It's a draw!\n${note}\n\n${render(game.board)}`);
    }
    return send(`${note}\n\n${render(game.board)}\n\nYour turn, send 1-9`);
  }

  game.turn = side === 'X' ? 'O' : 'X';
  return send(`${render(game.board)}\n\n${MARK[game.turn]} Your turn @${num(other.jid)}`, [other.jid]);
}

module.exports = { title, limits, create, intro, isPlayer, onMessage, render };
