// Everyone who joined sends rock, paper or scissors. Each player is compared with the bot's move.
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];

const MOVES = { rock: '🪨', paper: '📄', scissors: '✂️' };
const ALIAS = { r: 'rock', p: 'paper', s: 'scissors', '🪨': 'rock', '📄': 'paper', '✂️': 'scissors', '✂': 'scissors' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

const title = 'Rock Paper Scissors';
const timeoutMs = 25000;
const key = (p) => p.ids[0] || p.jid;
const tag = (p) => `@${num(p.jid)}`;

function create() {
  const names = Object.keys(MOVES);
  return { botMove: names[Math.floor(Math.random() * names.length)], choices: {} };
}

const intro = () =>
  '✊ *Rock Paper Scissors*\nI picked my move in secret!\nEveryone who joined: send *rock*, *paper* or *scissors* (or r / p / s). Beat me to score a point.';

const status = (g) => {
  const waiting = g.players.filter((p) => !g.choices[key(p)]);
  return waiting.length ? `Waiting for: ${waiting.map(tag).join(' ')}` : 'Everybody chose!';
};

function resolve(g) {
  const lines = [];
  const winners = [];
  for (const p of g.players) {
    const c = g.choices[key(p)];
    if (!c) {
      lines.push(`${tag(p)}: no move ⏰`);
      continue;
    }
    const beat = BEATS[c] === g.botMove;
    if (beat) winners.push(p);
    lines.push(`${tag(p)} ${MOVES[c]} → ${c === g.botMove ? 'draw 🤝' : beat ? 'you beat me 🎉' : 'I win 🤖'}`);
  }
  return { text: `🤖 I played ${MOVES[g.botMove]} *${g.botMove}*\n\n${lines.join('\n')}`, winners, mentions: g.players.map((p) => p.jid) };
}

async function onMessage({ game, players, text, who, send, end, touch }) {
  const t = text.trim().toLowerCase();
  const move = ALIAS[t] || (MOVES[t] ? t : null);
  if (!move) return;
  const me = players.find((p) => p.ids.some((i) => who.ids.includes(i)));
  if (!me || game.choices[key(me)]) return; // the first move counts
  touch();
  game.choices[key(me)] = move;
  if (Object.keys(game.choices).length >= players.length) {
    const r = resolve(game);
    await send(r.text, r.mentions);
    return end(r.winners);
  }
}

function onTimeout(g) {
  if (!Object.keys(g.choices).length) return { text: "⌛ Time's up! Nobody chose a move.", winners: [] };
  const r = resolve(g);
  return { text: `⌛ Time's up!\n${r.text}`, winners: r.winners, mentions: r.mentions };
}

module.exports = { title, timeoutMs, status, create, intro, onMessage, onTimeout, MOVES, ALIAS, BEATS };
