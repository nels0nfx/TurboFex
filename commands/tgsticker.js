// Telegram sticker packs -> WhatsApp stickers
const tg = require('../core/telegram');
const store = require('../whatsapp/store');

const MAX_PER_REQUEST = 50;
const DEFAULT_COUNT = 10;
const GAP_MS = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "all", "20" (the first 20), "11-30" (from 11 to 30) -> [from, to] (1-based, inclusive)
function parseRange(word, total) {
  const w = String(word || '').toLowerCase();
  if (!w) return [1, Math.min(DEFAULT_COUNT, total)];
  if (w === 'all') return [1, Math.min(MAX_PER_REQUEST, total)];
  const range = /^(\d+)-(\d+)$/.exec(w);
  if (range) {
    const a = Math.max(1, +range[1]);
    return [a, Math.min(total, +range[2], a + MAX_PER_REQUEST - 1)];
  }
  if (/^\d+$/.test(w)) return [1, Math.min(total, +w, MAX_PER_REQUEST)];
  return null;
}

module.exports = {
  name: 'tgsticker',
  aliases: ['tgs', 'telegramsticker', 'tgpack'],
  category: 'download',
  slow: true,
  needs: ['sharp'],
  weight: 'medium',
  description: 'Get a Telegram sticker pack as WhatsApp stickers: tgsticker https://t.me/addstickers/Name (or add 11-30, 20 or all)',
  async run({ sock, jid, msg, rest, args, reply, prefix, isOwner }) {
    const usage = `*Usage:* \`${prefix}tgsticker https://t.me/addstickers/PackName\`\n▸ the first ${DEFAULT_COUNT} stickers are sent\n▸ more: \`${prefix}tgsticker <link> 11-30\`, \`${prefix}tgsticker <link> 20\` or \`${prefix}tgsticker <link> all\` (up to ${MAX_PER_REQUEST} at a time)`;
    const name = tg.packName(args[0]);
    if (!name) return reply(usage);
    if (!store.getApiKey('telegram')) {
      return reply(isOwner
        ? `🔑 *A Telegram bot token is needed once* (free).\n1. Open Telegram, talk to @BotFather, send /newbot.\n2. Copy the token it gives you.\n3. Send me: \`${prefix}setapi telegram <token>\``
        : '⚠️ This is not set up yet. The owner has to add a Telegram bot token first.');
    }
    let set;
    try {
      set = await tg.getSet(name);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return reply(`⚠️ I could not find a Telegram sticker pack called *${name}*. Check the link.`);
      if (err.code === 'BAD_TOKEN') return reply(isOwner ? `⚠️ Telegram refused the token. Send a new one: \`${prefix}setapi telegram <token>\`` : '⚠️ This is not working right now. Tell the owner.');
      return reply(`⚠️ Telegram did not answer: ${String(err.message).slice(0, 100)}. Try again in a moment.`);
    }
    const all = set.stickers || [];
    const range = parseRange(args[1], all.length);
    if (!range || !all.length) return reply(usage);
    const [from, to] = range;
    const animated = all.slice(from - 1, to).filter((s) => s.is_animated).length;
    await reply(`📦 *${set.title}* (${all.length} stickers)\nSending ${from} to ${to}...${animated ? `\n_${animated} animated Telegram stickers (.tgs) can not be converted and are skipped._` : ''}`);
    let sent = 0;
    let failed = 0;
    for (const sticker of all.slice(from - 1, to)) {
      try {
        const webp = await tg.toWhatsApp(sticker);
        if (!webp) continue;
        await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
        sent += 1;
        await sleep(GAP_MS); // a short pause between stickers keeps the account safe
      } catch (err) {
        failed += 1;
        if (err.code === 'NEED_FFMPEG' || /sharp/.test(String(err.message))) return reply('⚠️ This server cannot convert stickers right now (sharp or ffmpeg is missing).');
        if (failed >= 5) break;
      }
    }
    const more = to < all.length ? `\n▸ Next: \`${prefix}tgsticker ${name} ${to + 1}-${Math.min(all.length, to + MAX_PER_REQUEST)}\`` : '';
    return reply(`✅ Sent ${sent} sticker${sent === 1 ? '' : 's'}.${failed ? ` (${failed} failed)` : ''}${more}`);
  },
};
