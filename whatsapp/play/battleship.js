// Battleship for the whole group against a hidden fleet: 6x6 sea, 3 ships (sizes 3, 2 and 2), 20 shots shared by everybody.
// Type a square like B4 to fire. Sink the whole fleet before the shots run out!
const { num } = require('../utils');

const title = 'Battleship';
const timeoutMs = 15 * 60 * 1000;
const limits = () => ({ min: 1, max: 8 });
const SIZE = 6;
const SHOTS = 20;
const SHIPS = [{ name: 'Cruiser', size: 3 }, { name: 'Destroyer', size: 2 }, { name: 'Patrol boat', size: 2 }];
const COLS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫'];
const ROWS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
const keyOf = (p) => p.ids[0] || p.jid;
const cellName = (c, r) => `${'ABCDEF'[c]}${r + 1}`;

// places the ships at random, never touching each other's squares
function place() {
  const taken = new Set();
  const ships = [];
  for (const s of SHIPS) {
    for (let tries = 0; tries < 500; tries++) {
      const horizontal = Math.random() < 0.5;
      const c = Math.floor(Math.random() * (horizontal ? SIZE - s.size + 1 : SIZE));
      const r = Math.floor(Math.random() * (horizontal ? SIZE : SIZE - s.size + 1));
      const cells = Array.from({ length: s.size }, (_, i) => (horizontal ? [c + i, r] : [c, r + i]).join(','));
      if (cells.some((x) => taken.has(x))) continue;
      cells.forEach((x) => taken.add(x));
      ships.push({ name: s.name, cells, hits: new Set() });
      break;
    }
  }
  return ships;
}

const create = () => ({ type: 'battleship', ships: place(), fired: new Map(), shots: SHOTS, hitBy: {}, over: false });

function board(g, showShips = false) {
  const sunk = new Set(g.ships.filter((s) => s.hits.size === s.cells.length).flatMap((s) => s.cells));
  const lines = [`⬛${COLS.join('')}`];
  for (let r = 0; r < SIZE; r++) {
    let line = ROWS[r];
    for (let c = 0; c < SIZE; c++) {
      const k = `${c},${r}`;
      const shot = g.fired.get(k);
      const ship = g.ships.some((s) => s.cells.includes(k));
      line += shot === 'hit' ? (sunk.has(k) ? '💥' : '🔥') : shot === 'miss' ? '⚪' : showShips && ship ? '🚢' : '🟦';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

const intro = (g) => `🚢 *Battleship*\nA hidden fleet of ${SHIPS.length} ships (${SHIPS.map((s) => s.size).join(', ')} squares) is in the sea. You share *${g.shots} shots*. Type a square like *B4* to fire!\n\n${board(g)}`;
const status = (g) => `${board(g)}\n🎯 ${g.shots} shots left`;
const reveal = (g) => `The fleet was here:\n${board(g, true)}`;

function onTimeout(g) {
  return { text: `⌛ Time is up!\n\n${reveal(g)}`, winners: null, mentions: [] };
}

async function onMessage({ game: g, text, who, send, end, touch }) {
  if (g.over) return;
  const t = /^([a-f])\s?([1-6])$/i.exec(text) || (() => {
    const x = /^([1-6])\s?([a-f])$/i.exec(text);
    return x ? [x[0], x[2], x[1]] : null;
  })();
  if (!t) return;
  const c = 'abcdef'.indexOf(t[1].toLowerCase());
  const r = Number(t[2]) - 1;
  const k = `${c},${r}`;
  touch();
  if (g.fired.has(k)) return send(`⚠️ ${cellName(c, r)} was already fired at. Pick another square.`);
  g.shots -= 1;
  const ship = g.ships.find((s) => s.cells.includes(k));
  let line;
  if (ship) {
    g.fired.set(k, 'hit');
    ship.hits.add(k);
    g.hitBy[who.jid] = (g.hitBy[who.jid] || 0) + 1;
    line = ship.hits.size === ship.cells.length ? `💥 @${num(who.jid)} *SANK the ${ship.name}!*` : `🔥 @${num(who.jid)} *hit* a ship at ${cellName(c, r)}!`;
  } else {
    g.fired.set(k, 'miss');
    line = `⚪ @${num(who.jid)} fired at ${cellName(c, r)}: *miss*.`;
  }
  const all = g.ships.every((s) => s.hits.size === s.cells.length);
  if (all) {
    g.over = true;
    const heroes = g.players.filter((p) => g.hitBy[p.jid]);
    await send(`${line}\n\n${board(g)}\n\n🏆 *The whole fleet is sunk with ${g.shots} shots to spare!*\n${heroes.map((p) => `@${num(p.jid)} (${g.hitBy[p.jid]} hits)`).join(' • ')}`, g.players.map((p) => p.jid));
    return end(heroes.length ? heroes : null);
  }
  if (g.shots <= 0) {
    g.over = true;
    await send(`${line}\n\n😢 *Out of shots!* The fleet survived.\n\n${reveal(g)}`, [who.jid]);
    return end(null);
  }
  return send(`${line}\n\n${board(g)}\n🎯 ${g.shots} shot${g.shots === 1 ? '' : 's'} left`, [who.jid]);
}

module.exports = { title, limits, create, intro, status, reveal, onTimeout, onMessage, timeoutMs, place, board, SHOTS };
