const pkg = require('../package.json');
const clock = require('../core/clock');
const store = require('../whatsapp/store');
const health = require('../core/health');
const watchers = require('../whatsapp/watchers');
const baileys = require('../core/baileys');

module.exports = {
  name: 'status',
  category: 'owner',
  description: 'Health check: version, commands loaded, problems found (owner only)',
  ownerOnly: true,
  async run({ reply, commandList, diag, prefix }) {
    const s = diag.stats;
    const problems = diag.loadErrors.length ? diag.loadErrors.map((e) => `• ${e}`).join('\n') : 'None';
    await reply(
      `🩺 *Status*\n\n` +
        `📦 Version: v${pkg.version}\n` +
        `🟢 Node: ${process.versions.node}\n` +
        `⏱️ Uptime: ${clock.uptime()}\n` +
        `🧩 Commands loaded: ${commandList.length}\n` +
        `🔣 Prefix: ${prefix}\n` +
        `🔐 Mode: ${store.getMode()}\n` +
        `🔄 Auto-update: ${store.getAutoUpdate() ? 'on' : 'off'}\n` +
        `⏰ Scheduled messages: ${store.schedules().length}\n` +
        `📨 Messages handled: ${s.handled}\n` +
        `♻️ Old/duplicate messages skipped: ${s.replaysIgnored + s.duplicatesIgnored}\n` +
        `⏱️ Average answer time: ${diag.timing.n ? Math.round(diag.timing.total / diag.timing.n) : 0} ms (slowest ${diag.timing.max} ms)\n` +
        `${diag.timing.slow.length ? `🐢 Slow ones: ${diag.timing.slow.join('; ')}\n` : ''}` +
        `👁️ View-once seen/saved: ${watchers.stats.viewOnce}/${watchers.stats.viewOnceSaved} • Edits: ${watchers.stats.edited} (events seen ${watchers.stats.editEvents + watchers.stats.editSecret}, sealed ${watchers.stats.editSecret}, unreadable ${watchers.stats.editUnreadable}) • Deletes: ${watchers.stats.deleted}${watchers.stats.lastError ? ` (last problem: ${watchers.stats.lastError})` : ''}\n` +
        `📚 WhatsApp library: ${baileys.version()}\n` +
        `🔐 Decryption errors since start: ${health.stats().total} (if this keeps growing, send ${prefix}repair)\n\n` +
        `⚠️ Commands that failed to load:\n${problems}`
    );
  },
};
