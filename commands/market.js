// The Empire, phase 3 (the market): market, market buy grain 10, herald.
// The market loads core/realm/market.js, which registers its timed job (the Herald) with the ticker.
const market = require('../core/realm/market');
const A = require('../core/realm/aurum');
const stuff = require('../core/realm/stuff');
const settings = require('../core/realm/settings');
const ui = require('../core/realm/ui');
const { realmCommand } = require('../core/realm/cmd');

const pct = (n, d = 1) => (Math.abs(n) < 0.05 ? '▬' : `${n >= 0 ? '▲ +' : '▼ −'}${Math.abs(n).toFixed(d)}%`);
const px = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2).replace(/\.00$/, ''));
// cheap or dear compared with the normal value
const mood = (group, id) => {
  const rel = (market.price(group, id) / market.baseOf(group, id) - 1) * 100;
  return rel <= -8 ? '🟢' : rel >= 8 ? '🔴' : '⚪';
};
const amountOf = (words) => {
  for (const w of [...words].reverse()) {
    const t = String(w).toLowerCase().replace(/[,_]/g, '');
    if (t === 'all') return -1;
    if (/^\d{1,9}$/.test(t)) return parseInt(t, 10);
  }
  return NaN;
};

module.exports = [
  realmCommand({
    name: 'market',
    aliases: ['prices', 'exchange'],
    feature: 'market',
    description: 'The prices of goods in this realm: market / market grain / market buy grain 10',
    async run({ args, reply, myJid, prefix }, { group }) {
      const sub = (args[0] || '').toLowerCase();
      market.advance(group);
      const m = market.market(group);
      if (sub === 'buy') {
        const it = stuff.find(args.slice(1).filter((a) => !/^(all|\d+)$/i.test(a)).join(' '));
        if (!it || it.kind !== 'good') return reply(ui.warn(`Name a good: ${market.GOODS().join(', ')}. Example: \`${prefix}market buy grain 10\``));
        let n = amountOf(args.slice(1));
        if (n === -1) n = Math.max(0, Math.floor(A.balance(group, myJid) / market.buyPrice(group, it.id)));
        const r = market.buy(group, myJid, it.id, Number.isNaN(n) ? 1 : n);
        if (!r.ok) {
          const msg = { bag: ui.warn(`Your bag has room for ${r.room} more.`), poor: ui.warn(`That costs ${ui.money(r.cost || 0)}. You need ${ui.fmt(r.need || 0)} more.`), amount: ui.warn('Give an amount, for example 10.') }[r.why];
          return reply(msg || ui.warn('That did not work.'));
        }
        return reply(ui.card('🛒', `Bought ${it.icon} ${it.name} ×${r.n}`, [`*Price:* ${px(r.each)} each`, `*Paid:* ${ui.money(r.cost)}`, `*Purse:* ${ui.money(A.balance(group, myJid))}`], [`\`${prefix}sell ${it.id} all\` when the price is high`], 'Buying pushes the price up a little.'));
      }
      if (sub === 'sell') return reply(ui.card('💰', 'Selling', ['Sell to the market with the sell command.'], [`\`${prefix}sell grain 10\` • \`${prefix}sell all\``]));
      const it = stuff.find(args.join(' '));
      if (it && it.kind === 'good') {
        const base = market.baseOf(group, it.id);
        const now = m.p[it.id];
        const hist = market.history(group, it.id);
        const pushes = (m.fx || []).filter((f) => f.id === it.id);
        const push = pushes.reduce((t, f) => t + f.v, 0);
        const rows = [
          `*Price now:* ${px(now)} Aurum ${mood(group, it.id)}`,
          `*Normal value:* ${px(base)} • ${pct((now / base - 1) * 100)} from normal`,
          `*Last day:* ${pct(market.change24(group, it.id))}${ui.spark(hist, 24) ? `  ${ui.spark(hist, 24)}` : ''}`,
          `*You buy at:* ${ui.fmt(market.buyPrice(group, it.id))} • *you sell at:* ${ui.fmt(stuff.sellPrice(group, it.id))}`,
          `*You hold:* ${stuff.countOf(group, myJid, it.id)}`,
          pushes.length ? `*News push:* ${push >= 0 ? 'upward' : 'downward'} for ${Math.max(...pushes.map((f) => f.left))} more updates` : null,
        ].filter(Boolean);
        return reply(ui.card(it.icon, it.name, rows, [`\`${prefix}market buy ${it.id} 10\` • \`${prefix}sell ${it.id} 10\``]));
      }
      const tick = settings.get('market.tickMinutes', group) * 60000;
      const rows = market.GOODS().map((id) => {
        const g = stuff.get(id);
        const have = stuff.countOf(group, myJid, id);
        return `${g.icon} *${g.name}* ${px(m.p[id])} ${pct(market.change24(group, id))} ${mood(group, id)}\n   buy ${ui.fmt(market.buyPrice(group, id))} • sell ${ui.fmt(stuff.sellPrice(group, id))}${have ? ` • you hold ${have}` : ''}`;
      });
      await reply(ui.card('📈', 'The Realm Market', rows, [`\`${prefix}market grain\` – one good in detail`, `\`${prefix}market buy grain 10\` • \`${prefix}sell all\``, `\`${prefix}herald\` – the news`], `Next update in ${ui.dur(Math.max(60000, m.at + tick - Date.now()))}. 🟢 cheap • 🔴 dear • last day change.`));
    },
  }),
  realmCommand({
    name: 'herald',
    aliases: ['marketnews', 'realmnews'],
    feature: 'herald',
    description: 'The Realm Herald: the market news. herald shows it, herald on / off (admins) posts it here every update',
    async run({ args, reply, prefix, isAdmin, isOwner, isRealOwner }, { group }) {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'on' || sub === 'off') {
        if (!isAdmin && !isOwner && !isRealOwner) return; // not allowed: stay silent
        market.setHerald(group, sub === 'on');
        const every = settings.get('market.tickMinutes', group);
        return reply(sub === 'on' ? ui.card('📰', 'The Herald is on', [`The news of the market is posted here after every price update (about every ${every} minutes). People who own a good that moved are tagged.`], [`\`${prefix}herald off\` stops it`]) : ui.card('📰', 'The Herald is off', ['No more news is posted. You can still read it with the herald command.']));
      }
      const ed = market.edition(group, false, prefix);
      await reply(`${ed.text}\n\n${market.heraldOn(group) ? '_The Herald is posted here by itself._' : `_Admins can post this news here by itself: ${prefix}herald on_`}`, { mentions: ed.mentions });
    },
  }),
];
