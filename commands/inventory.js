// The Empire, phase 2 (the bag): inventory, recipes, craft, sell, use.
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const ui = require('../core/realm/ui');
const stuff = require('../core/realm/stuff');
const craft = require('../core/realm/craft');
const careers = require('../core/realm/careers');
const settings = require('../core/realm/settings');
const { realmCommand } = require('../core/realm/cmd');

const line = (group, s, n) => `${s.icon} *${s.name}* ×${ui.fmt(n)} _(${ui.fmt(stuff.sellPrice(group, s.id))} each)_`;
const need = (needs) => Object.entries(needs).map(([id, n]) => `${n} ${stuff.get(id).name}`).join(' + ');
const amountOf = (words) => {
  for (const w of [...words].reverse()) {
    const t = String(w).toLowerCase();
    if (t === 'all') return -1;
    if (/^\d{1,9}$/.test(t)) return parseInt(t, 10);
  }
  return NaN;
};
const nameWords = (args) => args.filter((a) => !/^(all|\d+)$/i.test(a)).join(' ');

module.exports = [
  realmCommand({
    name: 'inventory',
    aliases: ['inv', 'bag', 'items'],
    feature: 'goods',
    description: 'What you carry: goods, items, tools and their value',
    async run({ reply, myJid, prefix }, { group }) {
      const c = S.citizen(group, myJid);
      const goods = Object.entries(stuff.bag(c)).map(([id, n]) => [stuff.get(id), n]).filter(([s]) => s);
      const rows = [];
      for (const kind of ['good', 'item']) {
        const part = goods.filter(([s]) => s.kind === kind);
        if (part.length) rows.push(`*${kind === 'good' ? 'Goods' : 'Items'}*`, ...part.map(([s, n]) => line(group, s, n)), '');
      }
      const tools = Object.entries(c.tools || {}).map(([id, uses]) => [careers.TOOLS.find((t) => t.id === id), uses]).filter(([t]) => t);
      if (tools.length) rows.push('*Tools*', ...tools.map(([t, u]) => `${t.icon} *${t.name}* – ${u} uses left`), '');
      const now = Date.now();
      const buffs = [];
      if ((c.meal || 0) > now) buffs.push(`🍞 meal (${ui.dur(c.meal - now)})`);
      if (c.tonic) buffs.push('🧪 tonic ready');
      if (buffs.length) rows.push(`*Active:* ${buffs.join(' • ')}`, '');
      if (!rows.length) rows.push('_Your bag is empty. Work, or collect from an estate._', '');
      const total = goods.reduce((t, [s, n]) => t + stuff.sellPrice(group, s.id) * n, 0);
      rows.push(`*Bag:* ${stuff.used(group, myJid)} / ${stuff.bagSize(group, myJid)} • *worth:* ${ui.money(total)}`);
      await reply(ui.card('🎒', 'Your bag', rows, [`\`${prefix}sell grain 10\` • \`${prefix}sell all\``, `\`${prefix}recipes\` • \`${prefix}craft bread\` • \`${prefix}use bread\``]));
    },
  }),
  realmCommand({
    name: 'recipes',
    aliases: ['recipe', 'workbench'],
    feature: 'crafting',
    description: 'What you can make at the workbench',
    async run({ reply, prefix }, { group }) {
      const rows = craft.RECIPES.filter((r) => craft.recipeOn(group, r)).map((r) => {
        const t = craft.nameOfRecipe(r);
        return `${t.icon} *${t.name}*${r.qty > 1 ? ` ×${r.qty}` : ''} ← ${need(r.needs)}\n   \`${prefix}craft ${r.id}\``;
      });
      await reply(ui.card('🧰', 'The workbench', rows, [`\`${prefix}craft bread 5\` – make five batches`], 'Tools made here cost goods instead of Aurum.'));
    },
  }),
  realmCommand({
    name: 'craft',
    aliases: ['make'],
    feature: 'crafting',
    description: 'Make an item or a tool from goods: craft bread / craft bread 5',
    async run({ args, reply, myJid, prefix }, { group }) {
      if (!args.length) return reply(ui.card('🧰', 'Craft', [], [`\`${prefix}recipes\` – see what you can make`, `\`${prefix}craft bread 3\``]));
      const times = amountOf(args);
      const r = craft.craft(group, myJid, nameWords(args), Number.isNaN(times) || times < 1 ? 1 : times);
      if (!r.ok) {
        const m = {
          unknown: ui.warn(`I do not know that recipe. See \`${prefix}recipes\`.`),
          off: ui.info('God has closed that recipe.'),
          rank: ui.warn(`Crafting needs the rank ${r.need ? r.need.name : 'higher'}.`),
          hastool: ui.info(`You have this tool already (${r.uses} uses left).`),
          bag: ui.warn('Your bag has no room for that.'),
          missing: ui.warn(`You are missing: ${(r.missing || []).map((x) => `${x.need - x.have} ${stuff.get(x.id).name}`).join(', ')}`),
        }[r.why];
        return reply(m || ui.warn('That did not work.'));
      }
      if (r.tool) return reply(ui.card('🔧', `You made a ${r.tool.icon} ${r.tool.name}`, [`It lasts ${r.uses} works.`], [`\`${prefix}work\``]));
      const hints = [r.item.use ? `\`${prefix}use ${r.item.id}\`` : null, `\`${prefix}sell ${r.item.id} all\``].filter(Boolean);
      await reply(ui.card('🧰', `You made ${r.item.icon} ${r.item.name} ×${r.made}`, [r.item.about ? `_${r.item.about}_` : null, `*Worth:* ${ui.money(stuff.sellPrice(group, r.item.id) * r.made)}`].filter(Boolean), hints));
    },
  }),
  realmCommand({
    name: 'sell',
    aliases: ['trade'],
    feature: 'goods',
    description: 'Sell goods or items to the realm: sell grain 10 / sell grain all / sell all',
    async run({ args, reply, myJid, prefix }, { group }) {
      const word = (args[0] || '').toLowerCase();
      if (!args.length) return reply(ui.card('💰', 'Sell', [`The realm buys at ${settings.get('goods.sellPct', group)}% of the value.`], [`\`${prefix}sell grain 10\` • \`${prefix}sell grain all\` • \`${prefix}sell all\``]));
      if (word === 'all' && args.length === 1) {
        const c = S.citizen(group, myJid);
        const rows = [];
        let total = 0;
        for (const s of stuff.list('good')) {
          const n = stuff.countOf(group, myJid, s.id);
          if (!n) continue;
          const r = stuff.sell(group, myJid, s.id, -1);
          if (r.ok) {
            total += r.total;
            rows.push(`${s.icon} ${s.name} ×${r.n} → ${ui.fmt(r.total)}`);
          }
        }
        return reply(rows.length ? ui.card('💰', 'Goods sold', [...rows, `*Total:* +${ui.money(total)}`, `*Purse:* ${ui.money(A.balance(group, myJid))}`], [], 'Items (bread, swords...) are sold one by one.') : ui.info('You have no goods to sell.'));
      }
      const it = stuff.find(nameWords(args));
      if (!it) return reply(ui.warn(`I do not know that. See \`${prefix}inventory\`.`));
      const amount = amountOf(args);
      const r = stuff.sell(group, myJid, it.id, Number.isNaN(amount) ? 1 : amount);
      if (!r.ok) return reply(r.why === 'few' ? ui.warn(`You only have ${r.have} ${it.name}.`) : ui.warn('That did not work.'));
      await reply(ui.card('💰', `Sold ${it.icon} ${it.name} ×${r.n}`, [`*Price:* ${ui.fmt(r.each)} each`, `*Got:* +${ui.money(r.total)}`, `*Purse:* ${ui.money(A.balance(group, myJid))}`]));
    },
  }),
  realmCommand({
    name: 'use',
    aliases: ['eat', 'drink'],
    feature: 'crafting',
    description: 'Use an item: use bread / use tonic',
    async run({ args, reply, myJid, prefix }, { group }) {
      const it = stuff.find(args.join(' '));
      if (!it) return reply(ui.card('🍞', 'Use', [], [`\`${prefix}use bread\` • \`${prefix}use tonic\``], 'See what you carry with the inventory.'));
      const r = craft.use(group, myJid, it.id);
      if (!r.ok) return reply(r.why === 'none' ? ui.warn(`You have no ${it.name}.`) : ui.info(`${it.name} cannot be used. Sell it or keep it.`));
      await reply(ui.card('✨', `You used ${it.icon} ${it.name}`, [`_${r.text}_`]));
    },
  }),
];
