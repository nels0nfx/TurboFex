// Sends one message to all groups the bot is in. Slow and capped on purpose: sending the same text to many groups quickly
// is exactly what gets a number banned. Two steps (preview, then confirm).
const crypto = require('crypto');

const MAX_GROUPS = 100;
let pending = null;
let running = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  name: 'broadcast',
  aliases: ['bc'],
  category: 'owner',
  realOwnerOnly: true,
  noReact: true,
  needs: [],
  weight: 'light',
  description: 'Send a message to all groups, slowly and safely: broadcast <text>, then broadcast confirm (broadcast stop)',
  async run({ sock, rest, args, reply, prefix }) {
    const a = (args[0] || '').toLowerCase();

    if (a === 'stop') {
      if (!running) return reply('_No broadcast is running._');
      running.stop = true;
      return reply('🛑 Stopping after the current group.');
    }
    if (running) return reply(`⏳ A broadcast is running: ${running.sent}/${running.total} sent. Send *${prefix}broadcast stop* to stop it.`);

    if (a === 'confirm') {
      if (!pending || Date.now() - pending.at > 10 * 60 * 1000) return reply(`⚠️ Nothing is waiting. Start with ${prefix}broadcast <text>.`);
      const job = { total: pending.jids.length, sent: 0, failed: 0, stop: false };
      const { jids, text } = pending;
      pending = null;
      running = job;
      await reply(`📢 Sending to *${job.total}* groups, one every few seconds. You will get a message when it is done.`);
      (async () => {
        for (const jid of jids) {
          if (job.stop) break;
          try {
            await sock.sendMessage(jid, { text });
            job.sent += 1;
          } catch (err) {
            job.failed += 1;
          }
          await sleep(5000 + crypto.randomInt(0, 5000)); // 5-10 seconds between groups
        }
        running = null;
        await reply(`*Broadcast ${job.stop ? 'stopped' : 'finished'}*\n▸ *Sent:* ${job.sent}\n▸ *Failed:* ${job.failed}`).catch(() => {});
      })();
      return undefined;
    }

    if (!rest) return reply(`Write the message after the command.\nExample: ${prefix}broadcast Maintenance tonight at 22:00`);
    if (rest.length > 1500) return reply('⚠️ Keep the message under 1500 characters.');
    let all;
    try {
      all = await sock.groupFetchAllParticipating();
    } catch (err) {
      return reply('⚠️ I could not read my group list right now. Try again in a moment.');
    }
    const jids = Object.keys(all || {}).slice(0, MAX_GROUPS);
    if (!jids.length) return reply('⚠️ I am not in any group.');
    pending = { jids, at: Date.now(), text: `📢 *Announcement*\n\n${rest}` };
    return reply(`*Broadcast ready*\n▸ *Groups:* ${jids.length}${Object.keys(all).length > MAX_GROUPS ? ` (the first ${MAX_GROUPS})` : ''}\n▸ *Takes about:* ${Math.ceil((jids.length * 7.5) / 60)} minutes\n\n${pending.text}\n\nSend *${prefix}broadcast confirm* within 10 minutes to send it.`);
  },
};
