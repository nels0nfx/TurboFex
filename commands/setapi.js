// setapi: the owner sends an API key to the bot and the bot saves it (no editing of files or environment variables)
const store = require('../whatsapp/store');
const apikeys = require('../core/apikeys');

const WHERE = { gemini: 'aistudio.google.com/apikey (free, better answers for ai and chatbot)', removebg: 'remove.bg/api (free)', ocr: 'ocr.space/ocrapi/freekey (free)', musixmatch: 'developer.musixmatch.com (free plan)' };

module.exports = {
  name: 'setapi',
  aliases: ['apikey', 'setkey'],
  category: 'owner',
  ownerOnly: true,
  needs: [],
  weight: 'light',
  description: 'Give the bot an API key: setapi removebg <key> (owner only)',
  async run(ctx) {
    const { args, reply, prefix } = ctx;
    const name = (args[0] || '').toLowerCase();
    if (name === 'remove' || name === 'delete') {
      const which = (args[1] || '').toLowerCase();
      if (!store.apiKeyNames().includes(which)) return reply(`*Usage:* \`${prefix}setapi remove removebg\``);
      store.setApiKey(which, null);
      return reply(`✅ *${which} key removed.*`);
    }
    if (name && args[1]) return reply(await apikeys.save(ctx, name, args[1].trim()));
    const lines = store.apiKeyNames().map((n) => `▸ *${n}:* ${apikeys.mask(store.getApiKey(n))} – ${WHERE[n]}\n   \`${prefix}setapi ${n} <key>\``);
    await reply(`🔑 *API keys*\n\n${lines.join('\n')}\n\n_Send the key to the bot in a private chat. The bot checks it, saves it, and hides it._\nRemove one: \`${prefix}setapi remove <name>\``);
  },
};
