// The Empire of Fex, part 1: the purse, the bank, the daily gift, gifts, ranks, the profile, the shop and the realm itself.
const A = require('../core/realm/aurum');
const shop = require('../core/realm/shop');
const S = require('../core/realm/state');
const ui = require('../core/realm/ui');
const god = require('../core/realm/god');
const { realmCommand } = require('../core/realm/cmd');
const careers = require('../core/realm/careers');
const estates = require('../core/realm/estates');
const stuff = require('../core/realm/stuff');
const { resolveTarget } = require('../whatsapp/utils');

// "500", "1,000", "all" (-1) or NaN
const amountOf = (words) => {
  for (const w of [...words].reverse()) {
    const t = String(w).toLowerCase().replace(/[,_]/g, '');
    if (t === 'all') return -1;
    if (/^\d{1,12}$/.test(t)) return parseInt(t, 10);
  }
  return NaN;
};
const rankLine = (r) => `${r.icon} *${r.name}*${r.next ? ` _(${ui.fmt(r.needed)} more for ${r.next.name})_` : ' _(the highest rank)_'}`;
const titleOf = (c) => (c.title ? ` • ${c.title}` : '');

module.exports = [
  // ---------------------------------------------------------------- purse
  realmCommand({
    name: 'purse',
    aliases: ['balance', 'bal', 'wallet', 'money'],
    description: 'Your Aurum: purse, bank, net worth and rank (purse @user to see another citizen)',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const who = resolveTarget(msg, args) || myJid;
      const c = S.citizen(group, who);
      A.accrue(group, c);
      const r = A.rank(group, who);
      const mine = S.keyOf(who) === S.keyOf(myJid);
      await reply(
        ui.card(
          '👛',
          mine ? 'Your purse' : `Purse of ${ui.tag(who)}`,
          [`*Purse:* ${ui.money(c.coins)}`, `*Bank:* ${ui.money(c.bank)} / ${ui.fmt(A.bankCap(group, who))}`, `*Net worth:* ${ui.money(r.worth)}`, `*Rank:* ${rankLine(r)}${titleOf(c)}`],
          mine ? [`\`${prefix}daily\` – your gift of the day`, `\`${prefix}work\` • \`${prefix}profile\``] : []
        ),
        { mentions: [who] }
      );
    },
  }),

  // ---------------------------------------------------------------- daily
  realmCommand({
    name: 'daily',
    aliases: ['dailygift', 'gift'],
    description: 'Your gift of the day: the more days in a row, the bigger it gets',
    async run({ reply, myJid, prefix }, { group }) {
      const r = A.daily(group, myJid);
      if (!r.ok) return reply(ui.wait('You took your gift today.', r.waitMs));
      const rows = [`*Gift:* +${ui.money(r.amount)}${r.bonus > 0.001 ? ` _(+${Math.round(r.bonus * 100)}% for your rank and charm)_` : ''}`, `*Days in a row:* ${r.streak} 🔥`, `*Purse:* ${ui.money(r.coins)}`];
      await reply(ui.card('🎁', 'Daily gift', rows, [`\`${prefix}shop\` – spend it`], 'Come back tomorrow to keep your days in a row.'));
    },
  }),

  // ---------------------------------------------------------------- profile
  realmCommand({
    name: 'profile',
    aliases: ['citizen', 'me'],
    description: 'Everything about a citizen: rank, money, title, days in a row (profile @user)',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const who = resolveTarget(msg, args) || myJid;
      const c = S.citizen(group, who);
      A.accrue(group, c);
      const r = A.rank(group, who);
      const now = Date.now();
      const perks = [];
      if (A.charmLeft(group, who, now) > 0) perks.push(`🍀 Fortune Charm (${ui.dur(A.charmLeft(group, who, now))})`);
      if (c.satchels) perks.push(`🎒 Satchel ×${c.satchels}`);
      if (c.fate && c.fate.until > now) perks.push(`${c.fate.pct > 0 ? '✨ Blessed' : '🌑 Cursed'} ${c.fate.pct > 0 ? '+' : ''}${c.fate.pct}% (${ui.dur(c.fate.until - now)})`);
      const rows = [
        `*Rank:* ${rankLine(r)}`,
        c.title ? `*Title:* ${c.title}` : null,
        (() => { const st = careers.status(group, who); return st.career ? `*Career:* ${st.career.icon} ${st.career.name} • level ${st.level}` : null; })(),
        Object.keys(c.estates || {}).length ? `*Estates:* ${Object.entries(c.estates).map(([id, e]) => `${estates.byId(id).icon} lv ${e.lv}`).join(' • ')}` : null,
        `*Net worth:* ${ui.money(r.worth)}`,
        `*Purse:* ${ui.fmt(c.coins)} • *Bank:* ${ui.fmt(c.bank)}`,
        `*Days in a row:* ${c.streak || 0} 🔥`,
        `*Pay bonus:* +${Math.round((A.earnMult(group, who, now) - 1) * 100)}%`,
        perks.length ? `*Perks:* ${perks.join(' • ')}` : null,
        `*In the realm since:* ${new Date(c.since || now).toISOString().slice(0, 10)}`,
      ].filter(Boolean);
      await reply(ui.card('📜', `Citizen ${ui.tag(who)}`, rows, S.keyOf(who) === S.keyOf(myJid) ? [`\`${prefix}shop\` – charms, satchels, titles`] : []), { mentions: [who] });
    },
  }),

  // ---------------------------------------------------------------- bank
  realmCommand({
    name: 'bank',
    aliases: ['vault'],
    description: 'Your bank: it pays interest every day (see deposit and withdraw)',
    async run({ reply, myJid, prefix }, { group }) {
      const c = S.citizen(group, myJid);
      const gain = A.accrue(group, c);
      const cap = A.bankCap(group, myJid);
      await reply(
        ui.card('🏦', 'The bank', [`*Purse:* ${ui.money(c.coins)}`, `*In the bank:* ${ui.money(c.bank)} / ${ui.fmt(cap)}`, `${ui.bar(c.bank, cap)}`, gain ? `*Interest just added:* +${ui.fmt(gain)}` : null].filter(Boolean), [`\`${prefix}deposit 500\` or \`${prefix}deposit all\``, `\`${prefix}withdraw 500\` or \`${prefix}withdraw all\``], 'Interest is paid on what is in the bank. A bigger bank needs a Merchant\'s Satchel.')
      );
    },
  }),
  realmCommand({
    name: 'deposit',
    aliases: ['dep'],
    description: 'Put Aurum in the bank where it earns interest: deposit 500 / deposit all',
    async run({ args, reply, myJid, prefix }, { group }) {
      let n = amountOf(args);
      if (Number.isNaN(n)) return reply(ui.card('🏦', 'Deposit', [], [`\`${prefix}deposit 500\` or \`${prefix}deposit all\``]));
      if (n === -1) n = A.balance(group, myJid);
      const r = A.deposit(group, myJid, n);
      if (!r.ok) return reply(r.why === 'full' ? ui.warn(`Your bank is full (${ui.fmt(r.cap)}). A Merchant's Satchel adds space.`) : r.why === 'poor' ? ui.warn(`You only have ${ui.money(r.have)} in your purse.`) : ui.warn('Give an amount, for example 500.'));
      await reply(ui.card('🏦', 'Deposit', [`*Put in the bank:* ${ui.money(r.put)}${r.capped ? ' _(the bank is now full)_' : ''}`, `*Purse:* ${ui.money(A.balance(group, myJid))}`, `*Bank:* ${ui.money(A.bankOf(group, myJid))} / ${ui.fmt(r.cap)}`]));
    },
  }),
  realmCommand({
    name: 'withdraw',
    aliases: ['wd'],
    description: 'Take Aurum out of the bank: withdraw 500 / withdraw all',
    async run({ args, reply, myJid, prefix }, { group }) {
      let n = amountOf(args);
      if (Number.isNaN(n)) return reply(ui.card('🏦', 'Withdraw', [], [`\`${prefix}withdraw 500\` or \`${prefix}withdraw all\``]));
      if (n === -1) n = A.bankOf(group, myJid);
      const r = A.withdraw(group, myJid, n);
      if (!r.ok) return reply(r.why === 'poor' ? ui.warn(`You only have ${ui.money(r.have)} in the bank.`) : ui.warn('Give an amount, for example 500.'));
      await reply(ui.card('🏦', 'Withdraw', [`*Taken out:* ${ui.money(r.took)}`, `*Purse:* ${ui.money(A.balance(group, myJid))}`, `*Bank:* ${ui.money(A.bankOf(group, myJid))}`]));
    },
  }),

  // ---------------------------------------------------------------- give
  realmCommand({
    name: 'give',
    aliases: ['pay', 'send'],
    description: 'Give Aurum to a citizen: give @user 100',
    async run({ msg, args, reply, myJid, prefix, botIds }, { group }) {
      const to = resolveTarget(msg, args);
      let n = amountOf(args.filter((a) => !/^\d{13,}$/.test(a))); // a phone number written before the amount is not the amount
      if (!to || Number.isNaN(n)) return reply(ui.card('🎁', 'Give Aurum', [], [`\`${prefix}give @user 100\``], `At least ${ui.fmt(require('../core/realm/settings').get('core.giveMin', group))} Aurum. A small fee goes to the realm's treasury.`));
      if (botIds && botIds.includes(ui.num(to))) return reply(ui.warn('The bot does not keep Aurum.'));
      if (n === -1) n = A.balance(group, myJid);
      const r = A.give(group, myJid, to, n);
      if (!r.ok) {
        const m = { self: ui.warn('You cannot give Aurum to yourself.'), min: ui.warn(`The least you can give is ${ui.money(r.min || 0)}.`), poor: ui.warn(`You only have ${ui.money(r.have || 0)} in your purse.`) }[r.why];
        return reply(m || ui.warn('That did not work.'));
      }
      await reply(ui.card('🎁', 'Gift sent', [`${ui.tag(myJid)} → ${ui.tag(to)}`, `*Sent:* ${ui.money(r.sent)}`, `*They got:* ${ui.money(r.got)}${r.fee ? ` _(fee ${ui.fmt(r.fee)} went to the treasury)_` : ''}`, `*Your purse:* ${ui.money(A.balance(group, myJid))}`]), { mentions: [myJid, to] });
    },
  }),

  // ---------------------------------------------------------------- wealth
  realmCommand({
    name: 'wealth',
    aliases: ['richest', 'rich'],
    description: 'The richest citizens of this realm',
    async run({ reply, myJid }, { group }) {
      const top = A.richest(group, 10);
      if (!top.length) return reply(ui.card('🏆', 'The richest', ['Nobody has Aurum yet. Be the first with `daily`.']));
      const medals = ['🥇', '🥈', '🥉'];
      const mine = top.findIndex((r) => r.key === S.keyOf(myJid));
      const rows = top.map((r, i) => `${medals[i] || `${i + 1}.`} ${ui.tag(r.jid)}${r.title ? ` _${r.title}_` : ''} – *${ui.fmt(r.worth)}*`);
      await reply(ui.card('🏆', 'The richest of the realm', rows, [], mine < 0 ? `Your net worth: ${ui.fmt(A.netWorth(group, myJid))}` : `You are number ${mine + 1}`), { mentions: top.map((r) => r.jid) });
    },
  }),

  // ---------------------------------------------------------------- shop
  realmCommand({
    name: 'shop',
    aliases: ['store'],
    feature: 'shop',
    description: 'What you can buy with Aurum',
    async run({ reply, myJid, prefix }, { group }) {
      const rows = shop.list().map((i) => {
        const left = i.kind === 'timed' ? A.charmLeft(group, myJid) : 0;
        return `${i.icon} *${i.name}* – ${ui.money(shop.priceOf(group, i.id))}\n   _${shop.aboutOf(group, i.id)}_${left ? ` ✅ active, ${ui.dur(left)} left` : ''}\n   \`${prefix}buy ${i.id}\``;
      });
      await reply(ui.card('🛍️', 'The shop', rows, [], `Your purse: ${ui.money(A.balance(group, myJid))}`));
    },
  }),
  realmCommand({
    name: 'buy',
    feature: 'shop',
    description: 'Buy something from the shop: buy charm',
    async run({ args, reply, myJid, prefix }, { group }) {
      const it = shop.find(args.join(' '));
      if (!it) return reply(ui.warn(`I do not know that item. See \`${prefix}shop\`.`));
      const r = shop.buy(group, myJid, it.id);
      if (!r.ok) {
        const m = {
          active: ui.info(`Your ${it.name} still works for ${ui.dur(r.left || 0)}.`),
          owned: ui.info(`You are a ${it.name} already.`),
          max: ui.warn(`You can own at most ${r.max} of these.`),
          poor: ui.warn(`${it.name} costs ${ui.money(r.price || 0)}. You need ${ui.fmt(r.need || 0)} more.`),
        }[r.why];
        return reply(m || ui.warn('That did not work.'));
      }
      await reply(ui.card('✅', `Bought ${it.icon} ${it.name}`, [`_${shop.aboutOf(group, it.id)}_`, `*Paid:* ${ui.money(r.price)}`, `*Purse:* ${ui.money(A.balance(group, myJid))}`]));
    },
  }),

  // ---------------------------------------------------------------- realm (the realm itself)
  {
    name: 'realm',
    aliases: ['empire', 'fex'],
    category: 'economy',
    everyone: true,
    needs: [],
    weight: 'light',
    description: 'The Empire of Fex in this group: realm / realm guide / realm on / realm off (admins)',
    async run({ args, reply, jid, isGroup, isAdmin, isOwner, isRealOwner, prefix }) {
      let group = isGroup ? jid : isRealOwner ? god.selected() : null;
      const sub = (args[0] || '').toLowerCase();
      if (!group) return reply(isGroup || !isRealOwner ? ui.warn('The Empire works in groups.') : ui.card('☀️', 'Choose a realm first', [], [`\`${prefix}god realm 1\``]));
      if (sub === 'on' || sub === 'off') {
        if (!isAdmin && !isOwner && !isRealOwner) return reply(ui.warn('Only group admins can open or close the realm.'));
        if (sub === 'off') {
          S.setOn(group, false);
          return reply(ui.card('🔒', 'The realm is closed', ['Every command of the Empire, the paid chatting and the bets in games are stopped in this group. Nothing was deleted.'], [`\`${prefix}realm on\` opens it again`]));
        }
        S.setOn(group, true);
        return reply(ui.card('⚜️', 'The realm is open', ['The Empire of Fex works in this group again.'], [`\`${prefix}realm guide\` – how it works`, `\`${prefix}daily\` – your first gift`]));
      }
      const on = S.isOn(group);
      if (sub === 'guide' || sub === 'help' || sub === 'how') {
        return reply(
          ui.card(
            '📖',
            'How the Empire works',
            ['Every group is a *realm* with its own citizens, money and treasury. The money is *Aurum*.', '', '*Start here*', `\`${prefix}daily\` – a gift every day (more days in a row = bigger)`, `\`${prefix}purse\` • \`${prefix}profile\` • \`${prefix}wealth\``, `\`${prefix}deposit\` • \`${prefix}withdraw\` – the bank pays interest`, `\`${prefix}give @user 100\` • \`${prefix}shop\` • \`${prefix}buy\``, '', '*Earn and build*', `\`${prefix}career\` • \`${prefix}work\` • \`${prefix}weekly\` – a profession, pay and goods`, `\`${prefix}estates\` • \`${prefix}collect\` – buildings that make goods while you are away`, `\`${prefix}inventory\` • \`${prefix}craft\` • \`${prefix}sell\` • \`${prefix}use\` – the bag and the workbench`, '', '*Prices and people*', `\`${prefix}market\` • \`${prefix}market buy grain 10\` • \`${prefix}sell all\` – prices move with buying, selling and events`, `\`${prefix}herald\` – the market news (admins: \`${prefix}herald on\` posts it here)`, `\`${prefix}trade @user grain 20 150\` • \`${prefix}auction\` – trade with citizens`, '', '*Ranks*', 'Commoner → Citizen → Merchant → Noble → Lord. A higher rank pays more, opens careers and estates, and gives a bigger bag.', '', '_More is coming: the government, guilds and more._'],
            [],
            'Chatting earns a little Aurum too. God sets the limits of everything.'
          )
        );
      }
      const people = require('../core/realm/state').citizensOf(group).length;
      await reply(
        ui.card('⚜️', 'The Empire of Fex', [`*Realm:* ${on ? '✅ open' : '🔒 closed'}`, `*Citizens:* ${people}`, `*Treasury:* ${ui.money(A.treasury(group))}`, `*Currency:* ${ui.AURUM} ${ui.SIGN}`, `*Herald (market news):* ${require('../core/realm/market').heraldOn(group) ? '✅ posted here' : 'off'}`], [`\`${prefix}realm guide\` – how it works`, isAdmin || isOwner || isRealOwner ? `\`${prefix}realm off\` / \`${prefix}realm on\`` : null].filter(Boolean))
      );
    },
  },
];
