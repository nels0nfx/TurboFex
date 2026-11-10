// Example plugin: needs the group management permission, so the install screen shows it with a red mark.
// It only works where the bot is an admin, and only for admins.
tfx.command('lockgroup', async (c) => {
  try {
    await tfx.group.close();
    await c.reply('🔒 *The group is closed.*\n▸ _Only admins can write now._');
  } catch (e) {
    await c.reply('⚠️ *I could not close the group.*\n▸ _Make me a group admin and try again._');
  }
});
tfx.command('unlockgroup', async (c) => {
  try {
    await tfx.group.open();
    await c.reply('🔓 *The group is open.*\n▸ _Everybody can write again._');
  } catch (e) {
    await c.reply('⚠️ *I could not open the group.*\n▸ _Make me a group admin and try again._');
  }
});
