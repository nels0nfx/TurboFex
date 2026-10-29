// Blackjack against the dealer. On your turn: hit (another card) or stand. 21 wins, over 21 busts. A bet is optional.
const { num } = require('../utils');
const A = require('../../core/realm/aurum');
const ui = require('../../core/realm/ui');

const timeoutMs = 900000;
const title = 'Blackjack';
const limits = () => ({ min: 1, max: 6 });

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const deck = () => {
  const d = SUITS.flatMap((s) => RANKS.map((r) => ({ r, s })));
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

// the value of a hand: aces count 11 until that would bust
function value(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === 'A') {
      aces += 1;
      total += 11;
    } else total += ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}
const natural = (hand) => hand.length === 2 && value(hand) === 21;
const show = (hand) => `${hand.map((c) => `${c.r}${c.s}`).join(' ')}  (*${value(hand)}*)`;
const keyOf = (p) => p.ids[0] || p.jid;

function create(opts, players) {
  const cards = deck();
  const draw = () => cards.pop();
  return { type: 'blackjack', cards, bet: opts.bet || 0, group: opts.group, dealer: [draw(), draw()], hands: players.map(() => [draw(), draw()]), done: players.map(() => false), idx: 0, over: false };
}

const lines = (g) => g.players.map((p, i) => `@${num(p.jid)}: ${show(g.hands[i])}${g.done[i] && value(g.hands[i]) > 21 ? ' 💥' : ''}`).join('\n');
const intro = (g) => `🃏 *Blackjack*${g.bet ? ` – bet *${ui.money(g.bet)}*` : ''}\n*Dealer:* ${g.dealer[0].r}${g.dealer[0].s} ❔\n\n${lines(g)}\n\nOn your turn send *hit* or *stand*.`;
const status = (g) => `*Dealer:* ${g.dealer[0].r}${g.dealer[0].s} ❔\n${lines(g)}`;
const reveal = () => 'The game ended.';

// moves on to the next player who still has to play; false when everybody is done
function nextPlayer(g) {
  while (g.idx < g.players.length && (g.done[g.idx] || value(g.hands[g.idx]) >= 21)) {
    g.done[g.idx] = true;
    g.idx += 1;
  }
  return g.idx < g.players.length;
}

// the dealer plays and the bets are paid
function results(g) {
  while (value(g.dealer) < 17) g.dealer.push(g.cards.pop());
  const dv = value(g.dealer);
  const out = [];
  g.players.forEach((p, i) => {
    const pv = value(g.hands[i]);
    let outcome;
    if (pv > 21) outcome = 'lose';
    else if (natural(g.hands[i]) && !natural(g.dealer)) outcome = 'blackjack';
    else if (dv > 21 || pv > dv) outcome = 'win';
    else if (pv === dv) outcome = 'push';
    else outcome = 'lose';
    let money = '';
    if (g.bet) {
      if (outcome === 'win') A.add(g.group, p.jid, g.bet), (money = ` +${ui.fmt(g.bet)}`);
      else if (outcome === 'blackjack') A.add(g.group, p.jid, Math.floor(g.bet * 1.5)), (money = ` +${ui.fmt(Math.floor(g.bet * 1.5))}`);
      else if (outcome === 'lose') {
        const lost = Math.min(g.bet, A.balance(g.group, p.jid));
        A.take(g.group, p.jid, lost);
        money = lost ? ` -${ui.fmt(lost)}` : '';
      }
    }
    const word = { win: '✅ wins', blackjack: '🎉 BLACKJACK', push: '🤝 push', lose: pv > 21 ? '💥 bust' : '❌ loses' }[outcome];
    out.push(`@${num(p.jid)} ${show(g.hands[i])} ${word}${money}`);
  });
  return `*Dealer:* ${show(g.dealer)}${dv > 21 ? ' 💥' : ''}\n\n${out.join('\n')}`;
}

async function finish(g, send, end) {
  g.over = true;
  await send(`🃏 *Results*\n${results(g)}`, g.players.map((p) => p.jid));
  return end(g.players.filter((p, i) => value(g.hands[i]) <= 21));
}

async function onStart({ game, send, end }) {
  if (!nextPlayer(game)) return finish(game, send, end); // everybody was dealt 21
  await send(`👉 @${num(game.players[game.idx].jid)}, *hit* or *stand*?`, [game.players[game.idx].jid]);
}

async function onMessage({ game, text, who, send, end, touch }) {
  const w = text.toLowerCase();
  const move = /^(h|hit)$/.test(w) ? 'hit' : /^(s|stand|stay)$/.test(w) ? 'stand' : null;
  if (!move || game.over) return;
  const i = game.players.findIndex((p) => p.ids.some((id) => who.ids.includes(id)));
  if (i < 0) return;
  if (i !== game.idx) return send("⏳ It's not your turn yet.");
  touch();
  if (move === 'hit') {
    game.hands[i].push(game.cards.pop());
    if (value(game.hands[i]) < 21) return send(`🃏 @${num(who.jid)}: ${show(game.hands[i])}\n*hit* or *stand*?`, [who.jid]);
  } else game.done[i] = true;
  await send(`🃏 @${num(who.jid)}: ${show(game.hands[i])}${value(game.hands[i]) > 21 ? ' 💥 bust!' : move === 'stand' ? ' – stands.' : ''}`, [who.jid]);
  game.done[i] = true;
  game.idx = i + 1;
  if (!nextPlayer(game)) return finish(game, send, end);
  const next = game.players[game.idx];
  return send(`👉 @${num(next.jid)}, your turn: ${show(game.hands[game.idx])}\n*hit* or *stand*?`, [next.jid]);
}

module.exports = { title, limits, create, intro, status, reveal, onStart, onMessage, timeoutMs, value, natural, results, deck };
