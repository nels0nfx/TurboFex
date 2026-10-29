const { getJson } = require('../core/http');

module.exports = {
  name: 'define',
  aliases: ['dictionary', 'meaning'],
  category: 'lookup',
  needs: [],
  weight: 'light',
  description: 'The meaning of an English word: define <word>',
  async run({ args, reply, prefix, isOwner }) {
    const word = (args[0] || '').toLowerCase().replace(/[^a-z'-]/g, '');
    if (!word) return reply(`Write a word after the command.\nExample: ${prefix}define resilient`);
    try {
      const data = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry) return reply(`⚠️ I could not find *${word}*.`);
      const phonetic = entry.phonetic || (entry.phonetics || []).map((p) => p.text).find(Boolean) || '';
      const parts = (entry.meanings || []).slice(0, 3).map((m) => {
        const d = (m.definitions || [])[0] || {};
        return `*${m.partOfSpeech}*\n${d.definition || ''}${d.example ? `\n_"${d.example}"_` : ''}`;
      });
      return reply(`*${entry.word}*${phonetic ? `  ${phonetic}` : ''}\n\n${parts.join('\n\n')}`);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return reply(`⚠️ I could not find *${word}*. Check the spelling.`);
      return reply(`⚠️ The dictionary is not answering right now.${isOwner ? `\nReason: ${err.message}` : ' Please try again later.'}`);
    }
  },
};
