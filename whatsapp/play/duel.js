// Duel: two players fight turn by turn. 1 = attack, 2 = defend (the next hit hurts much less), 3 = heal (only twice). The winner takes the bet.
const { num } = require('../utils');
const A = require('../../core/realm/aurum');
const ui = require('../../core/realm/ui');

const HP = 100;
const timeoutMs = 600000;
const title = 'Duel';
const limits = () => ({ min: 2, max: 2 });

const hit = (rand = Math.random) => 12 + Math.floor(rand() * 15); // 12 to 26
const isPlayer = (p, ids) => ids.some((i) => p.ids.includes(i));

function create(opts, players) {
  return { type: 'duel', bet: opts.bet || 0, group: opts.group, a: { ...players[0], hp: HP, guard: false, heals: 2 }, b: { ...players[1], hp: HP, guard: false, heals: 2 }, turn: 'a' };
}

const bar = (hp) => `${'🟥'.repeat(Math.ceil(Math.max(0, hp) / 20))}${'⬜'.repeat(5 - Math.ceil(Math.max(0, hp) / 20))} ${Math.max(0, hp)}`;
const stats = (g) => `@${num(g.a.jid)}  ${bar(g.a.hp)}\n@${num(g.b.jid)}  ${bar(g.b.hp)}`;
const intro = (g) =>
  `⚔️ *Duel!*${g.bet ? ` Bet: *${ui.money(g.bet)}*` : ''}\n${stats(g)}\n\n@${num(g.a.jid)} starts. Send:\n*1* attack • *2* defend • *3* heal (twice only)`;
const status = (g) => stats(g);
const reveal = () => 'The duel ended in a draw.';

// the winner takes the bet (at most what the loser really has)
function settle(g, winner, loser) {
  if (!g.bet) return '';
  const amount = Math.min(g.bet, A.balance(g.group, loser.jid));
  if (amount > 0 && A.take(g.group, loser.jid, amount)) A.add(g.group, winner.jid, amount);
  return amount > 0 ? `\n💰 @${num(winner.jid)} wins *${ui.money(amount)}*!` : '';
}

async function onMessage({ game, text, who, send, end, touch, rand = Math.random }) {
  if (!/^[1-3]$/.test(text)) return;
  const side = isPlayer(game.a, who.ids) ? 'a' : isPlayer(game.b, who.ids) ? 'b' : null;
  if (!side) return;
  if (side !== game.turn) return send("⏳ It's not your turn yet.");
  touch();
  const me = game[side];
  const foe = game[side === 'a' ? 'b' : 'a'];
  let line;
  me.guard = false;

  if (text === '1') {
    const miss = rand() < 0.1;
    let dmg = miss ? 0 : hit(rand);
    if (foe.guard) dmg = Math.round(dmg * 0.4);
    foe.hp -= dmg;
    foe.guard = false;
    line = miss ? `💨 @${num(me.jid)} attacks and *misses*!` : `🗡️ @${num(me.jid)} hits for *${dmg}*${dmg < 12 ? ' (blocked most of it)' : ''}!`;
  } else if (text === '2') {
    me.guard = true;
    line = `🛡️ @${num(me.jid)} defends.`;
  } else {
    if (me.heals <= 0) return send('⚠️ You have no heals left. Choose 1 or 2.');
    me.heals -= 1;
    const gain = 15 + Math.floor(rand() * 11);
    me.hp = Math.min(HP, me.hp + gain);
    line = `💚 @${num(me.jid)} heals *${gain}* (${me.heals} heal${me.heals === 1 ? '' : 's'} left).`;
  }

  if (foe.hp <= 0) {
    end();
    const prize = settle(game, me, foe);
    return send(`${line}\n\n🏆 *@${num(me.jid)} wins the duel!*${prize}\n\n${stats(game)}`, [me.jid, foe.jid]);
  }
  game.turn = side === 'a' ? 'b' : 'a';
  return send(`${line}\n\n${stats(game)}\n\n👉 @${num(foe.jid)}: *1* attack • *2* defend • *3* heal`, [me.jid, foe.jid]);
}

module.exports = { title, limits, create, intro, status, reveal, onMessage, timeoutMs, settle, HP };
