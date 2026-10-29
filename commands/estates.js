// The Empire, phase 2 (estates): estates / estates buy farm / estates upgrade farm / estates sell farm / collect.
const A = require('../core/realm/aurum');
const ui = require('../core/realm/ui');
const stuff = require('../core/realm/stuff');
const estates = require('../core/realm/estates');
const settings = require('../core/realm/settings');
const { realmCommand } = require('../core/realm/cmd');

const named = (id) => `${stuff.get(id).icon} ${stuff.get(id).name}`;

module.exports = [
  realmCommand({
    name: 'estates',
    aliases: ['estate', 'lands', 'build'],
    feature: 'estates',
    description: 'Buildings that make goods for you: estates / estates buy farm / upgrade farm / sell farm',
    async run({ args, reply, myJid, prefix }, { group }) {
      const sub = (args[0] || '').toLowerCase();
      const e = estates.find(args.slice(1).join(' ') || (args[0] && !['buy', 'upgrade', 'sell'].includes(sub) ? args[0] : ''));
      if (sub === 'buy' || sub === 'upgrade' || sub === 'sell') {
        if (!e) return reply(ui.warn(`Name an estate: ${estates.ESTATES.map((x) => x.id).join(', ')}`));
        if (sub === 'buy') {
          const r = estates.buy(group, myJid, e.id);
          if (!r.ok) {
            const m = { owned: ui.info(`You own a ${e.name} already. Make it bigger with \`${prefix}estates upgrade ${e.id}\`.`), rank: ui.warn(`A ${e.name} needs the rank ${r.need ? r.need.name : 'higher'}.`), limit: ui.warn(`You can own ${r.max} estate${r.max === 1 ? '' : 's'} at your rank. A higher rank allows more.`), poor: ui.warn(`The ${e.name} costs ${ui.money(r.price || 0)}. You need ${ui.fmt(r.need || 0)} more.`) }[r.why];
            return reply(m || ui.warn('That did not work.'));
          }
          return reply(ui.card('✅', `You bought a ${e.icon} ${e.name}`, [`_${e.about}_`, `*Makes:* ${estates.outputOf(group, e, 1)} ${stuff.get(e.good).name} an hour`, `*Paid:* ${ui.money(r.price)}`], [`\`${prefix}collect\` – take what it made`], `It stores up to ${settings.get('estates.storageHours', group)} hours. The realm keeps ${settings.get('estates.tax', group)}% as tax.`));
        }
        if (sub === 'upgrade') {
          const r = estates.upgrade(group, myJid, e.id);
          if (!r.ok) {
            const m = { none: ui.warn(`You do not own a ${e.name}.`), max: ui.info(`Your ${e.name} is at the highest level.`), poor: ui.warn(`The upgrade costs ${ui.money(r.price || 0)}. You need ${ui.fmt(r.need || 0)} more.`) }[r.why];
            return reply(m || ui.warn('That did not work.'));
          }
          return reply(ui.card('⬆️', `${e.icon} ${e.name} is now level ${r.level}`, [`*Makes:* ${estates.outputOf(group, e, r.level)} ${stuff.get(e.good).name} an hour`, `*Paid:* ${ui.money(r.cost)}`]));
        }
        const r = estates.sell(group, myJid, e.id);
        return reply(r.ok ? ui.card('🏷️', `You sold the ${e.icon} ${e.name}`, [`*You got back:* ${ui.money(r.back)}`]) : ui.warn(`You do not own a ${e.name}.`));
      }
      if (e && !sub) {
        const view = estates.view(group, myJid).find((v) => v.estate.id === e.id);
        const rows = [`_${e.about}_`, `*Price:* ${ui.money(estates.priceOf(group, e))} • *Makes:* ${estates.outputOf(group, e, 1)} ${stuff.get(e.good).name} an hour`, `*Rank needed:* ${A.RANKS[estates.minRankOf(group, e)].name}`];
        if (view) rows.push(`*Yours:* level ${view.lv} • ${view.waiting} ${stuff.get(e.good).name} waiting${view.next ? ` • upgrade ${ui.money(view.next)}` : ' • highest level'}`);
        return reply(ui.card(e.icon, e.name, rows, [`\`${prefix}estates buy ${e.id}\``]));
      }
      const mine = estates.view(group, myJid);
      const max = estates.maxEstates(group, myJid);
      const rows = [];
      if (mine.length) {
        rows.push('*Your estates*', ...mine.map((v) => `${v.estate.icon} *${v.estate.name}* lv ${v.lv} – ${v.waiting} ${stuff.get(v.estate.good).name} waiting${v.full ? ' (full!)' : ''}`), '');
      }
      rows.push(`*For sale* _(you own ${mine.length} of ${max})_`);
      for (const x of estates.ESTATES) {
        if (mine.some((v) => v.estate.id === x.id)) continue;
        const need = estates.minRankOf(group, x);
        rows.push(`${x.icon} *${x.name}* – ${ui.money(estates.priceOf(group, x))}${A.rank(group, myJid).index < need ? ` 🔒 ${A.RANKS[need].name}` : ''}\n   _${x.about}: ${estates.outputOf(group, x, 1)} an hour_`);
      }
      await reply(ui.card('🏡', 'Estates', rows, [`\`${prefix}estates buy farm\` • \`${prefix}collect\``, `\`${prefix}estates upgrade farm\` • \`${prefix}estates sell farm\``]));
    },
  }),
  realmCommand({
    name: 'collect',
    aliases: ['harvest', 'gather'],
    feature: 'estates',
    description: 'Take the goods your estates made',
    async run({ reply, myJid, prefix }, { group }) {
      const r = estates.collect(group, myJid);
      if (!r.ok) return reply(ui.card('🏡', 'You have no estates', ['Buy one to produce goods while you are away.'], [`\`${prefix}estates\` – see what is for sale`]));
      const rows = r.rows.map((x) => {
        const used = x.used && x.used.n ? ` _(used ${x.used.n} ${stuff.get(x.used.id).name})_` : '';
        return `${x.estate.icon} *${x.estate.name}:* +${x.added} ${named(x.good)}${x.tax ? ` _(tax ${x.tax})_` : ''}${used}${x.lost ? ` ⚠️ ${x.lost} lost: the bag is full` : ''}${x.made === 0 && x.estate.needs ? ' _(needs Ore in the bag)_' : ''}`;
      });
      await reply(ui.card('🧺', 'Collected', rows, [`\`${prefix}sell all\` • \`${prefix}craft\``]));
    },
  }),
];
