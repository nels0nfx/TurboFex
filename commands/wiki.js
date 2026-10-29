const { getJson } = require('../core/http');

module.exports = {
  name: 'wiki',
  aliases: ['wikipedia'],
  category: 'lookup',
  needs: [],
  weight: 'light',
  description: 'A short summary from Wikipedia: wiki <topic> (another language: wiki fr: Paris)',
  async run({ rest, reply, prefix, isOwner }) {
    let lang = 'en';
    let query = rest;
    const m = /^([a-z]{2,3}):\s*(.+)$/i.exec(rest);
    if (m) {
      lang = m[1].toLowerCase();
      query = m[2];
    }
    if (!query) return reply(`Write a topic after the command.\nExample: ${prefix}wiki Nigeria`);
    try {
      const found = await getJson(`https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query.slice(0, 100))}&limit=1`);
      const page = found.pages && found.pages[0];
      if (!page) return reply(`⚠️ Nothing found for *${query.slice(0, 40)}*.`);
      const s = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`);
      const extract = String(s.extract || '').slice(0, 800);
      if (!extract) return reply(`⚠️ Nothing found for *${query.slice(0, 40)}*.`);
      const link = s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page;
      return reply(`*${s.title}*${s.description ? `\n_${s.description}_` : ''}\n\n${extract}${extract.length >= 800 ? '…' : ''}${link ? `\n\n${link}` : ''}`);
    } catch (err) {
      return reply(`⚠️ Wikipedia is not answering right now.${isOwner ? `\nReason: ${err.message}` : ' Please try again later.'}`);
    }
  },
};
