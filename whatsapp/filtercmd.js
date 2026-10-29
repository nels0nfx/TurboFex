// Shared code for the auto-reply commands (filter / gfilter / stop / gstop)
const MAX_FILTERS = 50;

async function addFilter({ rest, reply, prefix, cmdName }, set, persist) {
  const i = rest.indexOf('|');
  if (i === -1) return reply(`Write the word, then |, then the reply.\nExample: ${prefix}${cmdName} hello | Hi there! 👋`);

  const word = rest.slice(0, i).trim().toLowerCase();
  const answer = rest.slice(i + 1).trim();
  if (word.length < 1 || word.length > 30) return reply('⚠️ The trigger word must be 1 to 30 characters.');
  if (!answer || answer.length > 1000) return reply('⚠️ The reply must be 1 to 1000 characters.');
  if (!(word in set) && Object.keys(set).length >= MAX_FILTERS) return reply(`⚠️ The limit is ${MAX_FILTERS} auto-replies.`);

  set[word] = answer;
  persist();
  return reply(`✅ Done. When someone writes *${word}* I will reply with that message.`);
}

async function removeFilter({ rest, reply, prefix, cmdName }, set, persist) {
  const word = rest.trim().toLowerCase();
  if (!word) return reply(`Which word?\nExample: ${prefix}${cmdName} hello`);
  if (!(word in set)) return reply('ℹ️ I have no auto-reply for that word.');
  delete set[word];
  persist();
  return reply(`✅ Removed the auto-reply for *${word}*.`);
}

function listText(set, title) {
  const words = Object.keys(set);
  if (!words.length) return `💬 *${title}*\nNone yet.`;
  return `💬 *${title}* (${words.length})\n\n${words.map((w, i) => `${i + 1}. ${w}`).join('\n')}`;
}

module.exports = { addFilter, removeFilter, listText };
