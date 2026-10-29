const store = require('../whatsapp/store');
const clock = require('../core/clock');
const { num } = require('../whatsapp/utils');

module.exports = {
  name: 'afk',
  category: 'tools',
  description: 'Away mode: afk on <reason> / afk off (I answer people who mention or message you)',
  async run({ rest, args, reply, prefix, myIds, myJid, isGroup }) {
    if (!myIds.length) return reply('⚠️ I could not tell who you are.');
    const first = (args[0] || '').toLowerCase();
    const current = store.afkGet(myIds);

    if (first === 'off') {
      if (!current) return reply('_You were not AFK._');
      store.afkDel(myIds);
      return reply(`*AFK is OFF*\n▸ *You were away for:* ${clock.duration(Date.now() - current.since)}`);
    }

    // "afk" alone shows the status
    if (!first) {
      const status = current
        ? `*AFK is ON*${current.reason ? `\n▸ *Reason:* ${current.reason}` : ''}\n▸ *Away for:* ${clock.duration(Date.now() - current.since)}`
        : '*AFK is OFF*';
      return reply(`${status}\n\n▸ Turn on: \`${prefix}afk on gone for lunch\`\n▸ Turn off: \`${prefix}afk off\``);
    }

    // "afk on lunch" or just "afk lunch"
    const reason = (first === 'on' ? rest.slice(2) : rest).trim().slice(0, 100);
    store.afkSet(myIds, reason);
    const why = reason ? `\n▸ *Reason:* ${reason}` : '';
    const note = `▸ Everyone who mentions or messages you is told once.\n▸ It stays ON until you send \`${prefix}afk off\`.`;
    if (isGroup) return reply(`*AFK is ON* for @${num(myJid)}${why}\n${note}`, { mentions: [myJid] });
    return reply(`*AFK is ON*${why}\n${note}`);
  },
};
