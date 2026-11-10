// Example plugin: reacts to a member joining. Install it with: plugin install welcome-plugin
// Turn it off in a group where you do not want it: plugin groups welcome-plugin deny
tfx.on('member.join', async (c) => {
  await c.reply('👋 *Welcome to the group!*\n▸ _Glad to have you here._');
});
