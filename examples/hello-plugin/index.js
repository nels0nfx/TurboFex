// Example plugin. Copy this whole folder into data/plugins/ and use: plugin install hello-plugin
tfx.command('hello', async (c) => {
  const count = Number((await tfx.storage.get('count')) || 0) + 1;
  await tfx.storage.set('count', String(count));
  await c.reply('👋 *Hello ' + (c.sender.name || 'there') + '!*\n▸ *Times used:* ' + count);
});
