const LABEL = { all: 'Everyone', contacts: 'My contacts', contact_blacklist: 'My contacts except...', none: 'Nobody', match_last_seen: 'Same as last seen', known: 'Known numbers' };

// name -> [library function, allowed values, key in the settings WhatsApp returns]
const SETTINGS = {
  lastseen: ['updateLastSeenPrivacy', ['all', 'contacts', 'contact_blacklist', 'none'], 'last'],
  online: ['updateOnlinePrivacy', ['all', 'match_last_seen'], 'online'],
  profile: ['updateProfilePicturePrivacy', ['all', 'contacts', 'contact_blacklist', 'none'], 'profile'],
  status: ['updateStatusPrivacy', ['all', 'contacts', 'contact_blacklist', 'none'], 'status'],
  readreceipts: ['updateReadReceiptsPrivacy', ['all', 'none'], 'readreceipts'],
  groups: ['updateGroupsAddPrivacy', ['all', 'contacts', 'contact_blacklist'], 'groupadd'],
  calls: ['updateCallPrivacy', ['all', 'known'], 'calladd'],
  messages: ['updateMessagesPrivacy', ['all', 'contacts'], 'messages'],
};

module.exports = {
  name: 'privacy',
  category: 'security',
  realOwnerOnly: true,
  noReact: true,
  needs: [],
  weight: 'light',
  description: 'See or change the bot account privacy: privacy lastseen contacts, privacy readreceipts none',
  async run({ sock, args, reply, prefix }) {
    const name = (args[0] || '').toLowerCase();
    const value = (args[1] || '').toLowerCase();
    const def = SETTINGS[name];

    if (def && value) {
      if (!def[1].includes(value)) return reply(`⚠️ For *${name}* choose: ${def[1].join(', ')}`);
      if (typeof sock[def[0]] !== 'function') return reply('⚠️ This version of the WhatsApp library cannot change that setting.');
      try {
        await sock[def[0]](value);
      } catch (err) {
        return reply(`⚠️ WhatsApp did not accept that change: ${String(err.message).slice(0, 100)}`);
      }
      return reply(`✅ *${name}* is now *${LABEL[value] || value}*.`);
    }

    let now = {};
    try {
      now = (await sock.fetchPrivacySettings(true)) || {};
    } catch (err) {
      now = {};
    }
    const rows = Object.entries(SETTINGS).map(([k, d]) => `▸ *${k}:* ${LABEL[now[d[2]]] || now[d[2]] || 'unknown'}\n│    _${d[1].join(' / ')}_`);
    return reply(`*Privacy of the bot account*\n${rows.join('\n')}\n\n▸ \`${prefix}privacy lastseen contacts\`\n▸ \`${prefix}privacy readreceipts none\``);
  },
};
