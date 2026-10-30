// The Empire, phase 3 (people): trade offers between citizens, and auctions.
const trade = require('../core/realm/trade');
const auction = require('../core/realm/auction');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const stuff = require('../core/realm/stuff');
const ui = require('../core/realm/ui');
const { realmCommand } = require('../core/realm/cmd');
const { resolveTarget } = require('../whatsapp/utils');

// the numbers of a command, without a phone number or a mention written in it
const numbersOf = (args) => args.filter((a) => /^\d[\d,]*$/.test(a) && a.replace(/,/g, '').length < 11).map((a) => parseInt(a.replace(/,/g, ''), 10));
const nameOf = (args) => args.filter((a) => !/^\d[\d,]*$/.test(a) && !/^@/.test(a) && !/^(for|x|all)$/i.test(a)).join(' ');

module.exports = [
  // ---------------------------------------------------------------- trade
  realmCommand({
    name: 'trade',
    aliases: ['offer', 'deal'],
    feature: 'trade',
    description: 'Sell goods or items to a citizen: trade @user grain 20 150 / trade accept / trade decline / trade list',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const sub = (args[0] || '').toLowerCase();
      const id = numbersOf(args.slice(1))[0] || null;
      if (sub === 'accept' || sub === 'yes') {
        const r = trade.accept(group, myJid, id);
        if (!r.ok) {
          const m = {
            none: ui.info('Nobody has an offer waiting for you.'),
            gone: ui.warn('The seller does not have the goods any more. The offer is gone.'),
            poor: ui.warn(`You need ${ui.fmt(r.need || 0)} more Aurum.`),
            bag: ui.warn('Your bag has no room for that. Sell or use something first.'),
          }[r.why];
          return reply(m || ui.warn('That did not work.'));
        }
        const o = r.offer;
        return reply(ui.card('🤝', 'Trade done', [`${ui.tag(o.fromJid)} → ${ui.tag(myJid)}`, `${r.item.icon} *${r.item.name}* ×${o.qty}`, `*Price:* ${ui.money(o.price)}`, `*Seller got:* ${ui.money(r.got)} _(fee ${ui.fmt(r.fee)})_`]), { mentions: [o.fromJid, myJid] });
      }
      if (sub === 'decline' || sub === 'no') {
        const r = trade.remove(group, myJid, 'buyer', id);
        return reply(r.ok ? ui.card('🚫', 'Offer declined', [`${ui.tag(r.offer.fromJid)}: ${r.item.icon} ${r.item.name} ×${r.offer.qty} for ${ui.money(r.offer.price)}`]) : ui.info('Nobody has an offer waiting for you.'), r.ok ? { mentions: [r.offer.fromJid] } : {});
      }
      if (sub === 'cancel' || sub === 'withdraw') {
        const r = trade.remove(group, myJid, 'seller', id);
        return reply(r.ok ? ui.card('↩️', 'Offer taken back', [`${r.item.icon} ${r.item.name} ×${r.offer.qty} for ${ui.money(r.offer.price)}`]) : ui.info('You have no offer waiting.'));
      }
      if (sub === 'list' || sub === 'offers' || !args.length) {
        const inn = trade.forMe(group, myJid);
        const out = trade.fromMe(group, myJid);
        const rows = [];
        if (inn.length) rows.push('*For you*', ...inn.map((o) => `#${o.id} ${ui.tag(o.fromJid)} sells ${stuff.get(o.good).icon} ${stuff.get(o.good).name} ×${o.qty} for ${ui.money(o.price)}`), '');
        if (out.length) rows.push('*Your offers*', ...out.map((o) => `#${o.id} to ${ui.tag(o.toJid)}: ${stuff.get(o.good).icon} ${stuff.get(o.good).name} ×${o.qty} for ${ui.money(o.price)}`), '');
        if (!rows.length) rows.push('No offers waiting.', '');
        return reply(ui.card('🤝', 'Trading', rows.filter((x, i, a) => !(x === '' && i === a.length - 1)), [`\`${prefix}trade @user grain 20 150\` – offer 20 Grain for 150 Aurum`, `\`${prefix}trade accept\` • \`${prefix}trade decline\` • \`${prefix}trade cancel\``], 'The realm takes a small fee from the seller.'), { mentions: [...inn.map((o) => o.fromJid), ...out.map((o) => o.toJid)] });
      }
      // an offer: trade @user grain 20 150
      const to = resolveTarget(msg, args);
      const it = stuff.find(nameOf(args));
      const nums = numbersOf(args);
      if (!to || !it || nums.length < 2) return reply(ui.card('🤝', 'Make an offer', [], [`\`${prefix}trade @user grain 20 150\` – 20 Grain for 150 Aurum`, `\`${prefix}trade list\``]));
      const r = trade.offer(group, myJid, to, it.id, nums[0], nums[1]);
      if (!r.ok) {
        const m = { self: ui.warn('You cannot trade with yourself.'), unknown: ui.warn('You can trade goods and items, not tools.'), amount: ui.warn('Give a number of units and a price.'), few: ui.warn(`You only have ${r.have} ${it.name}.`), many: ui.warn(`You can have ${r.max} offers waiting at most.`) }[r.why];
        return reply(m || ui.warn('That did not work.'));
      }
      const o = r.offer;
      await reply(ui.card('🤝', 'Offer made', [`${ui.tag(myJid)} offers ${ui.tag(to)}`, `${it.icon} *${it.name}* ×${o.qty} for *${ui.money(o.price)}*`, `_It waits ${r.minutes} minutes._`], [`${ui.tag(to)} can send \`${prefix}trade accept\` or \`${prefix}trade decline\``]), { mentions: [myJid, to] });
    },
  }),

  // ---------------------------------------------------------------- auction
  realmCommand({
    name: 'auction',
    aliases: ['auctions', 'bid'],
    feature: 'auction',
    description: 'Auctions: auction / auction sell sword 1 200 / auction bid 3 250 / auction cancel 3',
    async run({ args, reply, myJid, prefix, cmdName }, { group }) {
      // auctions that are over are closed first, and the people are told
      const closed = auction.resolve(group);
      if (closed.length) {
        const m = auction.message(closed);
        await reply(m.text, { mentions: m.mentions });
      }
      let sub = (args[0] || '').toLowerCase();
      if (cmdName === 'bid') sub = 'bid';
      const rest = cmdName === 'bid' ? args : args.slice(1);
      const nums = numbersOf(rest);

      if (sub === 'sell' || sub === 'start' || sub === 'list-item') {
        const it = stuff.find(nameOf(rest));
        if (!it || nums.length < 2) return reply(ui.card('🔨', 'Start an auction', ['Put goods or items up for the best bid.'], [`\`${prefix}auction sell sword 1 200\` – 1 Sword, start at 200 Aurum`, `\`${prefix}auction sell grain 50 100 12\` – 50 Grain, 12 hours`]));
        const r = auction.create(group, myJid, it.id, nums[0], nums[1], nums[2] || null);
        if (!r.ok) {
          const m = { unknown: ui.warn('You can sell goods and items, not tools.'), amount: ui.warn('Give a number of units and a starting price.'), start: ui.warn(`The lowest starting price is ${ui.money(r.min || 0)}.`), few: ui.warn(`You only have ${r.have} ${it.name}.`), many: ui.warn(`You can have ${r.max} auctions running.`) }[r.why];
          return reply(m || ui.warn('That did not work.'));
        }
        const a = r.auction;
        return reply(ui.card('🔨', `Auction #${a.id}`, [`${r.item.icon} *${r.item.name}* ×${a.qty}`, `*Starts at:* ${ui.money(a.start)}`, `*Ends in:* ${ui.dur(a.ends - Date.now())}`], [`\`${prefix}auction bid ${a.id} ${a.start}\` – anybody can bid`, `\`${prefix}auction cancel ${a.id}\` – take it back while nobody bid`]), { mentions: [myJid] });
      }
      if (sub === 'bid') {
        if (nums.length < 2) return reply(ui.card('🔨', 'Bid', [], [`\`${prefix}auction bid 3 250\` – bid 250 Aurum on auction 3`, `\`${prefix}auction\` – see what is for sale`]));
        const r = auction.bid(group, myJid, nums[0], nums[1]);
        if (!r.ok) {
          const m = { none: ui.warn('There is no such auction (or it is over).'), seller: ui.warn('You cannot bid on your own auction.'), low: ui.warn(`The lowest bid now is ${ui.money(r.need || 0)}.`), poor: ui.warn(`You need ${ui.fmt(r.need || 0)} more Aurum.`) }[r.why];
          return reply(m || ui.warn('That did not work.'));
        }
        const a = r.auction;
        const mentions = [myJid, a.sellerJid, r.outbid].filter(Boolean);
        return reply(ui.card('🔨', `Bid on auction #${a.id}`, [`${r.item.icon} *${r.item.name}* ×${a.qty}`, `${ui.tag(myJid)} leads with *${ui.money(a.bid)}*`, r.outbid ? `${ui.tag(r.outbid)} was outbid and got the Aurum back.` : null, r.extended ? '_The auction was extended by a few minutes._' : null, `*Ends in:* ${ui.dur(Math.max(60000, a.ends - Date.now()))}`].filter(Boolean)), { mentions });
      }
      if (sub === 'cancel') {
        const r = auction.cancel(group, myJid, nums[0]);
        if (!r.ok) {
          const m = { none: ui.warn('There is no such auction.'), notyours: ui.warn('That auction is not yours.'), bids: ui.warn('Somebody already bid, so it cannot be taken back.') }[r.why];
          return reply(m || ui.warn('That did not work.'));
        }
        return reply(ui.card('↩️', 'Auction cancelled', [`${r.item.icon} ${r.item.name} ×${r.auction.qty} is back in your bag.`]));
      }
      if (sub === 'info' || sub === 'show') {
        const a = auction.find(group, nums[0]);
        if (!a || a.ends <= Date.now()) return reply(ui.warn('There is no such auction (or it is over).'));
        const it = stuff.get(a.item);
        return reply(ui.card('🔨', `Auction #${a.id}`, [`${it.icon} *${it.name}* ×${a.qty}`, `*Seller:* ${ui.tag(a.sellerJid)}`, a.bid ? `*Best bid:* ${ui.money(a.bid)} by ${ui.tag(a.bidderJid)}` : `*Starts at:* ${ui.money(a.start)} (no bids)`, `*Next bid at least:* ${ui.money(auction.minBid(group, a))}`, `*Ends in:* ${ui.dur(a.ends - Date.now())}`]), { mentions: [a.sellerJid, a.bidderJid].filter(Boolean) });
      }
      const list = auction.active(group);
      if (!list.length) return reply(ui.card('🔨', 'Auctions', ['Nothing is for sale right now.'], [`\`${prefix}auction sell sword 1 200\``]));
      const mentions = [];
      const rows = list.slice(0, 10).map((a) => {
        const it = stuff.get(a.item);
        mentions.push(a.sellerJid);
        return `*#${a.id}* ${it.icon} ${it.name} ×${a.qty} – ${a.bid ? `bid ${ui.fmt(a.bid)}` : `from ${ui.fmt(a.start)}`} • ${ui.dur(a.ends - Date.now())} • ${ui.tag(a.sellerJid)}`;
      });
      await reply(ui.card('🔨', 'Auctions', rows, [`\`${prefix}auction bid <number> <amount>\``, `\`${prefix}auction info <number>\` • \`${prefix}auction sell\``], `${list.length} running. The realm keeps ${require('../core/realm/settings').get('auction.cut', group)}% of the winning bid.`), { mentions });
    },
  }),
];
