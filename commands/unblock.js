const store = require('../whatsapp/store');
const { resolveTarget, jidVariants, num } = require('../whatsapp/utils');
const { setBlock } = require('../whatsapp/blocklist');

module.exports = {
  name: 'unblock',
  category: 'owner',
  description: 'Unblock a person on WhatsApp and on my ban list (tag, reply or number) (owner only)',
  ownerOnly: true,
  async run({ sock, jid, msg, args, reply, isGroup, groupMetadata }) {
    const target = resolveTarget(msg, args) || (!isGroup ? jid : null);
    if (!target) return reply('Tag the person, reply to them, or type their number.');

    const wasBanned = store.removeBanned(target);
    const ids = [target];
    if (isGroup) ids.push(...jidVariants(groupMetadata, target));
    else ids.push(msg.key.remoteJidAlt);
    const res = await setBlock(sock, [...new Set(ids.filter(Boolean))], 'unblock');

    if (res.ok) return reply(`✅ Unblocked @${num(target)}`, { mentions: [target] });
    if (wasBanned) return reply(`✅ @${num(target)} is off my ban list. (WhatsApp itself did not report a block, so nothing else to undo.)`, { mentions: [target] });
    console.error('Unblock failed:', res.tried.map((t) => `${t.name}: ${t.error || 'ok'}`).join(' / '));
    return reply(`⚠️ WhatsApp would not accept that (${String(res.error?.message || res.error).slice(0, 80)}). If they are blocked, unblock them in WhatsApp settings > Privacy > Blocked.`);
  },
};
