const store = require('../whatsapp/store');
const { resolveTarget, jidVariants, num } = require('../whatsapp/utils');
const { setBlock } = require('../whatsapp/blocklist');

module.exports = {
  name: 'block',
  category: 'owner',
  description: 'Block a person on WhatsApp (tag, reply, number, or use it in their private chat) (owner only)',
  ownerOnly: true,
  async run({ sock, jid, msg, args, reply, prefix, isGroup, botIds, config, groupMetadata }) {
    const target = resolveTarget(msg, args) || (!isGroup ? jid : null);
    if (!target) return reply('Tag the person, reply to them, type their number, or use this in their private chat.');

    if (botIds.includes(num(target)) || num(target) === config.ownerNumber) return reply('⚠️ I will not block that one.');
    if (!isGroup && !resolveTarget(msg, args) && botIds.includes(num(jid))) return reply('⚠️ This is your own chat. Use the command in the chat of the person you want to block.');

    const k = msg.key;
    const ids = [target];
    if (isGroup) ids.push(...jidVariants(groupMetadata, target));
    else ids.push(k.remoteJidAlt);
    const res = await setBlock(sock, [...new Set(ids.filter(Boolean))], 'block');

    if (res.ok) return reply(`🚫 Blocked @${num(target)}`, { mentions: [target] });

    // WhatsApp refused: make sure the bot at least ignores that person
    console.error('Block failed:', res.tried.map((t) => `${t.name}: ${t.error || 'ok'}`).join(' / '));
    store.addBanned(target);
    const known = res.knownPn ? 'I know their phone number' : "I could not find their phone number (WhatsApp hides it)";
    const hint = res.knownPn ? '' : `\n💡 Try again with their number: ${prefix}block 27821234567`;
    return reply(
      `⚠️ WhatsApp would not accept the block.\n${known}.\n` +
        `Tried: ${res.tried.map((t) => `${t.name} (${t.error || 'failed'})`).join(', ')}\n` +
        `🚷 Instead I put @${num(target)} on my ban list, so I ignore them completely.${hint}\n` +
        `To block them for real, open their chat in WhatsApp > Block.`,
      { mentions: [target] }
    );
  },
};
