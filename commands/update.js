const { getLatest, applyUpdate, reasonText } = require('../core/updater');
const { restartBot } = require('../core/restart');
const brand = require('../core/brand');
const bootnote = require('../core/bootnote');

module.exports = {
  name: 'update',
  category: 'owner',
  description: 'Check for a new version, or install it with: update now (owner only)',
  ownerOnly: true,
  async run({ args, reply, prefix, jid }) {
    const install = (args[0] || '').toLowerCase() === 'now';

    let info;
    try {
      info = await getLatest();
    } catch (err) {
      return reply(`⚠️ Could not reach GitHub: ${err.message}`);
    }
    if (!info.ok) return reply(`⚠️ ${reasonText(info.reason)}`);

    if (!info.available) {
      return reply(`✅ You're up to date. ${brand.botName} v${info.current} is the newest version.`);
    }

    if (!install) {
      const notes = info.notes ? `\n\n📝 What's new:\n${info.notes.slice(0, 600)}` : '';
      return reply(
        `🆕 Update available: v${info.current} → v${info.latest}${notes}\n\nTo install it, send: ${prefix}update now`
      );
    }

    await reply(`⬇️ Installing v${info.latest}... please wait.`);
    try {
      const result = await applyUpdate(info);
      // when the new version is running it sends "update complete" to this chat
      bootnote.write({ type: 'update', chat: jid, from: info.current, to: result.version, notes: info.notes });
      await reply(`✅ Files updated to v${result.version} (${result.files} files). Restarting now. I will message you here as soon as the update is complete.`);
      restartBot();
    } catch (err) {
      await reply(`❌ Update failed: ${err.message}`);
    }
  },
};
