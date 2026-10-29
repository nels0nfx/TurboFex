const { getJson } = require('../core/http');
const { parseConvert, money } = require('../core/lookup');

const cache = new Map(); // base currency -> { at, rates }

async function ratesFor(base) {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < 3600000) return hit.rates;
  const data = await getJson(`https://open.er-api.com/v6/latest/${base}`);
  if (data.result !== 'success' || !data.rates) throw Object.assign(new Error('Unknown currency.'), { code: 'NOT_FOUND' });
  cache.set(base, { at: Date.now(), rates: data.rates });
  return data.rates;
}

module.exports = {
  name: 'currency',
  aliases: ['fx'],
  category: 'lookup',
  needs: [],
  weight: 'light',
  description: 'Exchange rates: currency 100 usd ngn (or currency usd eur)',
  async run({ rest, reply, prefix, isOwner }) {
    const q = parseConvert(rest);
    if (!q) return reply(`Write an amount and two currency codes.\nExample: ${prefix}currency 100 usd ngn`);
    try {
      const rates = await ratesFor(q.from);
      const rate = rates[q.to];
      if (!rate) return reply(`⚠️ I do not know the currency *${q.to}*.`);
      return reply(`💱 *${money(q.amount)} ${q.from} = ${money(q.amount * rate)} ${q.to}*\n▸ 1 ${q.from} = ${money(rate)} ${q.to}\n\n_Rates are updated daily. Source: exchangerate-api.com_`);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return reply(`⚠️ I do not know the currency *${q.from}*.`);
      return reply(`⚠️ I could not get the rates right now.${isOwner ? `\nReason: ${err.message}` : ' Please try again later.'}`);
    }
  },
};
