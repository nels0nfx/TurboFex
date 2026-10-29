const store = require('../whatsapp/store');
const clock = require('../core/clock');

const onOff = (v) => (v ? 'ON ✅' : 'OFF ❌');
const mode = (v) => (v === 'off' ? 'OFF ❌' : `${v.toUpperCase()} ✅`);

module.exports = {
  name: 'groupinfo',
  category: 'group',
  aliases: ['info'],
  description: 'Show group details and bot settings',
  groupOnly: true,
  async run({ jid, reply, groupMetadata: m }) {
    const g = store.getGroup(jid);
    const admins = m.participants.filter((p) => p.admin).length;
    const created = m.creation ? new Date(m.creation * 1000).toLocaleDateString('en-GB') : 'unknown';
    const desc = m.desc ? `\n\n📝 ${String(m.desc).slice(0, 300)}` : '';
    const fake = g.antifake.length ? `+${g.antifake.join(', +')} only ✅` : 'OFF ❌';
    const auto =
      g.autoMute.mute || g.autoMute.unmute
        ? `close ${g.autoMute.mute || '-'} / open ${g.autoMute.unmute || '-'} (${clock.zone()})`
        : 'OFF ❌';

    await reply(
      `ℹ️ *${m.subject}*\n\n` +
        `👥 Members: ${m.participants.length}\n` +
        `👑 Admins: ${admins}\n` +
        `📅 Created: ${created}\n` +
        `💬 Who can send: ${m.announce ? 'Admins only 🔒' : 'Everyone 🔓'}\n\n` +
        `🛡️ Anti-link: ${mode(g.antilinkMode)}\n` +
        `🤬 Anti-word: ${mode(g.antiwordMode)} (${g.badWords.length} words)\n` +
        `⚡ Anti-spam: ${g.antispamMode === 'off' ? 'OFF' : g.antispamMode.toUpperCase()}\n` +
        `📢 Anti group status: ${mode(g.antigstatusMode)}\n` +
        `🔔 Anti group mention: ${mode(g.antigmMode)}\n` +
        `🌍 Anti-fake: ${fake}\n` +
        `⚠️ Warn limit: ${store.getLimit(jid)}\n` +
        `👋 Welcome: ${onOff(g.welcome)}\n` +
        `🚪 Goodbye: ${onOff(g.goodbye)}\n` +
        `👑 Promote/demote notices: ${onOff(g.pdm)}\n` +
        `⏰ Auto open/close: ${auto}\n` +
        `💬 Auto-replies: ${Object.keys(g.filters).length}` +
        desc
    );
  },
};
