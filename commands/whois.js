const store = require('../whatsapp/store');
const activity = require('../whatsapp/activity');
const { resolveTarget, participantIds, num } = require('../whatsapp/utils');

module.exports = {
  name: 'whois',
  category: 'tools',
  description: 'Show what is known about a person: whois @user (or reply, or no name for yourself)',
  async run({ sock, jid, msg, args, reply, myJid, isGroup, groupMetadata }) {
    const target = resolveTarget(msg, args) || myJid;
    const n = num(target);
    const lines = [`👤 *@${n}*`];
    lines.push(String(target).endsWith('@lid') ? '📞 Number: hidden by WhatsApp' : `📞 Number: +${n}`);

    try {
      const res = await sock.fetchStatus(target);
      const first = Array.isArray(res) ? res[0] : res;
      const about = first?.status?.status ?? (typeof first?.status === 'string' ? first.status : first?.text);
      if (about) lines.push(`💬 About: ${String(about).slice(0, 150)}`);
    } catch (err) {
      // about text is hidden or not available
    }

    if (isGroup && groupMetadata) {
      const p = groupMetadata.participants.find((x) => participantIds(x).includes(n));
      if (p) {
        lines.push(`🛡️ Role: ${p.admin ? 'Admin' : 'Member'}`);
        const counts = activity.get(jid);
        const c = Math.max(0, ...participantIds(p).map((i) => counts[i] || 0));
        lines.push(`📊 Messages counted here: ${c}`);
        lines.push(`⚠️ Warnings here: ${store.getWarnings(jid, p.id)}/${store.getLimit(jid)}`);
      }
    }
    const text = lines.join('\n');
    try {
      const url = await sock.profilePictureUrl(target, 'image');
      return sock.sendMessage(jid, { image: { url }, caption: text, mentions: [target] }, { quoted: msg });
    } catch (err) {
      return reply(text, { mentions: [target] });
    }
  },
};
