// Answers when the owner is tagged (@) in a group. c.mentionsOwner is set by the bot (needs TurboFex 1.6.5 or newer).
tfx.on('message', async (c) => {
  if (!c.mentionsOwner) return;
  if (c.sender.isOwner) return; // the owner tagging himself needs no answer
  await c.quote(String(c.settings.reply || 'The owner is busy right now.'));
});
