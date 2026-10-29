const { getJson } = require('../core/http');
const { langCode, LANGS } = require('../core/lookup');
const { getQuoted, quotedText } = require('../whatsapp/utils');

async function translate(text, to) {
  try {
    const r = await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=Autodetect|${to}`);
    const out = r.responseData && r.responseData.translatedText;
    if (r.responseStatus === 200 && out && !/MYMEMORY WARNING/i.test(out)) return { text: out, from: (r.responseData.detectedLanguage || '').slice(0, 5) };
  } catch (err) {
    // the second service below
  }
  const g = await getJson(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`);
  const out = (g[0] || []).map((p) => p[0]).join('');
  if (!out) throw new Error('No translation came back.');
  return { text: out, from: g[2] || '' };
}

module.exports = {
  name: 'translate',
  aliases: ['tr', 'trt'],
  category: 'lookup',
  needs: [],
  weight: 'light',
  description: 'Translate text: translate fr good morning (or reply to a message with translate fr)',
  async run({ msg, args, rest, reply, prefix, isOwner }) {
    const to = langCode(args[0]);
    if (!to) return reply(`Start with the language, then the text.\nExample: ${prefix}translate fr good morning\n_Languages: ${Object.keys(LANGS).join(', ')}_`);
    const quoted = getQuoted(msg);
    const text = (rest.slice(args[0].length).trim() || (quoted ? quotedText(quoted) : '') || '').trim();
    if (!text) return reply(`Write the text after the language, or reply to a message.\nExample: ${prefix}translate ${to} good morning`);
    if (text.length > 450) return reply('⚠️ Please keep the text under 450 characters.');
    try {
      const r = await translate(text, to);
      return reply(`*Translation${r.from ? ` (${r.from} → ${to})` : ` (to ${LANGS[to]})`}*\n\n${r.text}`);
    } catch (err) {
      return reply(`⚠️ The translation service is not answering right now.${isOwner ? `\nReason: ${err.message}` : ' Please try again later.'}`);
    }
  },
};
