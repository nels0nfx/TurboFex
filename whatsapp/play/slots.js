// Everyone who joined types "spin". The best spin wins the round: three matching > a pair.
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];

const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '⭐', '7️⃣'];
const title = 'Slots';
const timeoutMs = 25000;
const key = (p) => p.ids[0] || p.jid;
const tag = (p) => `@${num(p.jid)}`;
const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

const scoreOf = (a, b, c) => (a === b && b === c ? 100 : a === b || b === c || a === c ? 30 : 0);
const labelOf = (score) => (score === 100 ? '🎉 JACKPOT' : score === 30 ? '😮 a pair' : '😅 no match');

const create = () => ({ spins: {} });
const intro = () => '🎰 *Slots*\nEveryone who joined: type *spin*!\nThe best spin wins the round (three matching beats a pair).';

const status = (g) => {
  const waiting = g.players.filter((p) => !g.spins[key(p)]);
  return waiting.length ? `Waiting for: ${waiting.map(tag).join(' ')}` : 'Everybody spun!';
};

function resolve(g) {
  const spun = g.players.filter((p) => g.spins[key(p)]);
  const best = Math.max(0, ...spun.map((p) => g.spins[key(p)].score));
  const winners = best > 0 ? spun.filter((p) => g.spins[key(p)].score === best) : [];
  const text = winners.length
    ? `🏆 Round winner: ${winners.map(tag).join(' ')} (${labelOf(best)})`
    : '🤷 Nobody got a match this round.';
  return { text, winners, mentions: winners.map((p) => p.jid) };
}

async function onMessage({ game, players, text, who, send, end, touch }) {
  const t = text.trim().toLowerCase();
  if (t !== 'spin' && t !== '🎰') return;
  const me = players.find((p) => p.ids.some((i) => who.ids.includes(i)));
  if (!me || game.spins[key(me)]) return;
  touch();
  const [a, b, c] = [pick(), pick(), pick()];
  const score = scoreOf(a, b, c);
  game.spins[key(me)] = { reels: `${a} ${b} ${c}`, score };
  await send(`🎰 ${tag(me)}\n| ${a} | ${b} | ${c} |\n${labelOf(score)}`, [me.jid]);
  if (Object.keys(game.spins).length >= players.length) {
    const r = resolve(game);
    await send(r.text, r.mentions);
    return end(r.winners);
  }
}

function onTimeout(g) {
  if (!Object.keys(g.spins).length) return { text: "⌛ Time's up! Nobody spun.", winners: [] };
  const r = resolve(g);
  return { text: `⌛ Time's up!\n${r.text}`, winners: r.winners, mentions: r.mentions };
}

module.exports = { title, timeoutMs, status, create, intro, onMessage, onTimeout, scoreOf };
