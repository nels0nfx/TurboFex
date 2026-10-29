// AI: ai, chatbot, imagine, memegen, quotecard, summarize, grammar. The assistant's name is NelsonFx.
const store = require('../whatsapp/store');
const ai = require('../core/ai');
const chatbot = require('../whatsapp/chatbot');
const web = require('../core/web');
const media = require('../whatsapp/media');
const names = require('../whatsapp/names');
const { getQuoted, getContextInfo, quotedText, num } = require('../whatsapp/utils');

const base = { category: 'ai', needs: [], weight: 'light' };
const fail = (what) => `⚠️ *${what} is not answering right now.* Please try again in a moment.`;
const state = (v) => (v ? 'ON' : 'OFF');

// the text of the message that was replied to
const replied = (msg) => quotedText(getQuoted(msg)) || '';

// memegen.link: the characters that need a special spelling in the address
const memeText = (t) =>
  String(t || '_').trim().slice(0, 80)
    .replace(/_/g, '__').replace(/-/g, '--').replace(/ /g, '_').replace(/\?/g, '~q').replace(/&/g, '~a').replace(/%/g, '~p')
    .replace(/#/g, '~h').replace(/\//g, '~s').replace(/\\/g, '~b').replace(/</g, '~l').replace(/>/g, '~g').replace(/"/g, "''").replace(/\n/g, '~n') || '_';
const MEMES = ['drake', 'buzz', 'doge', 'fry', 'success', 'rollsafe', 'ds', 'gru', 'cmm', 'fine', 'spiderman', 'pooh', 'rollsafe', 'bad', 'blb', 'stonks', 'wonka', 'ugandanknuck'].filter((m, i, a) => a.indexOf(m) === i);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function wrap(text, width) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + word).trim().length > width) {
        if (line) lines.push(line);
        line = word.slice(0, width);
      } else line = (line + ' ' + word).trim();
    }
    lines.push(line);
  }
  return lines.slice(0, 14);
}

module.exports = [
  {
    ...base,
    name: 'ai',
    aliases: ['ask', 'nelsonfx', 'gpt'],
    description: 'Ask NelsonFx anything: ai what is the capital of Kenya (or reply to a message with ai)',
    async run({ rest, msg, reply, prefix }) {
      const question = rest || replied(msg);
      if (!question) return reply(`🤖 *${ai.NAME}*\n*Usage:* \`${prefix}ai <your question>\` _(or reply to a message with_ \`${prefix}ai\`_)_\n_Turn on a conversation with_ \`${prefix}chatbot on\``);
      try {
        const answer = await ai.chat([{ role: 'user', content: rest && replied(msg) ? `${replied(msg)}\n\n${rest}` : question }]);
        await reply(`🤖 ${answer}`);
      } catch (err) {
        console.error('ai failed:', err.message);
        await reply(fail(ai.NAME));
      }
    },
  },
  {
    ...base,
    name: 'chatbot',
    aliases: ['chat'],
    ownerOnly: true,
    description: 'Let NelsonFx chat with people: chatbot on / off / where / add / remove / clear (owner only)',
    async run({ args, jid, isGroup, reply, prefix }) {
      const cfg = chatbot.settings();
      const w = (args[0] || '').toLowerCase();
      const placeText = { all: 'private chats and groups', groups: 'groups', dms: 'private chats', selected: 'only the chats you added' };
      if (w === 'on' || w === 'off') {
        chatbot.save({ on: w === 'on' });
        return reply(`✅ *Chatbot is now ${state(w === 'on')}.*${w === 'on' ? `\n*Answers in:* ${placeText[cfg.scope]}\n_In a group it answers when tagged, when someone replies to it, or when a message starts with ${ai.NAME}._` : ''}`);
      }
      if (w === 'where') {
        const to = { all: 'all', groups: 'groups', group: 'groups', dms: 'dms', dm: 'dms', private: 'dms', selected: 'selected', chosen: 'selected' }[(args[1] || '').toLowerCase()];
        if (!to) return reply(`*Usage:* \`${prefix}chatbot where dms\`\n_dms, groups, all, or selected (only the chats you add with_ \`${prefix}chatbot add\`_)_`);
        chatbot.save({ scope: to });
        return reply(`✅ *The chatbot answers in ${placeText[to]}.*`);
      }
      if (w === 'add' || w === 'remove') {
        const chats = new Set(cfg.chats);
        if (w === 'add') chats.add(jid);
        else chats.delete(jid);
        chatbot.save({ chats: [...chats].slice(-200) });
        return reply(`✅ *${w === 'add' ? 'Added' : 'Removed'}:* this ${isGroup ? 'group' : 'chat'}\n_Use_ \`${prefix}chatbot where selected\` _to answer only in the added chats._`);
      }
      if (w === 'clear') {
        chatbot.forget(jid);
        return reply('✅ *I forgot this conversation.*');
      }
      await reply(
        `🤖 *Chatbot – ${ai.NAME}*\n*Status:* ${state(cfg.on)}\n*Answers in:* ${placeText[cfg.scope]}\n*Chosen chats:* ${cfg.chats.length}\n*Key:* ${store.getApiKey('gemini') ? 'Gemini' : 'free service'}\n\n` +
          `▸ \`${prefix}chatbot on\` / \`${prefix}chatbot off\`\n▸ \`${prefix}chatbot where dms\` _(dms, groups, all, selected)_\n▸ \`${prefix}chatbot add\` / \`${prefix}chatbot remove\` _(this chat)_\n▸ \`${prefix}chatbot clear\` _(forget this chat)_\n\n` +
          `_Better answers: get a free Gemini key at aistudio.google.com/apikey and send_ \`${prefix}setapi gemini <key>\``
      );
    },
  },
  {
    ...base,
    name: 'imagine',
    aliases: ['aiimage'],
    slow: true,
    description: 'Make a picture from words: imagine a red dragon over a city at night',
    async run({ sock, jid, msg, rest, reply, prefix }) {
      if (!rest) return reply(`🎨 *Usage:* \`${prefix}imagine <describe the picture>\`\n*Example:* \`${prefix}imagine a lion wearing a crown, oil painting\``);
      try {
        const seed = Math.floor(Math.random() * 1e6);
        const buffer = await web.getBuffer(`https://image.pollinations.ai/prompt/${encodeURIComponent(rest.slice(0, 400))}?width=1024&height=1024&nologo=true&seed=${seed}`, { timeout: 90000, max: 8 * 1024 * 1024 });
        await sock.sendMessage(jid, { image: buffer, caption: `🎨 *${rest.slice(0, 120)}*` }, { quoted: msg });
      } catch (err) {
        console.error('imagine failed:', err.message);
        await reply(fail('The picture maker'));
      }
    },
  },
  {
    ...base,
    name: 'memegen',
    aliases: ['memetext'],
    slow: true,
    description: 'Put your text on a meme: memegen drake top text | bottom text (memegen list shows the templates)',
    async run({ sock, jid, msg, args, rest, reply, prefix }) {
      const id = (args[0] || '').toLowerCase();
      if (!id || id === 'list') return reply(`😂 *Memegen*\n*Usage:* \`${prefix}memegen drake top text | bottom text\`\n*Templates:* ${MEMES.join(', ')}`);
      if (!MEMES.includes(id)) return reply(`⚠️ *I do not know the template "${id.slice(0, 20)}".*\n*Templates:* ${MEMES.join(', ')}`);
      const [top, bottom] = rest.slice(id.length).trim().split('|').map((s) => s.trim());
      if (!top && !bottom) return reply(`*Usage:* \`${prefix}memegen ${id} top text | bottom text\``);
      try {
        const buffer = await web.getBuffer(`https://api.memegen.link/images/${id}/${memeText(top)}/${memeText(bottom)}.png`, { timeout: 25000, max: 6 * 1024 * 1024 });
        await sock.sendMessage(jid, { image: buffer }, { quoted: msg });
      } catch (err) {
        await reply(fail('The meme maker'));
      }
    },
  },
  {
    ...base,
    name: 'quotecard',
    aliases: ['qc', 'quotepic'],
    slow: true,
    description: 'Turn a message into a quote picture: reply to it with quotecard',
    async run({ sock, jid, msg, reply, prefix }) {
      const text = replied(msg).trim();
      if (!text) return reply(`💬 *Reply to a text message* with \`${prefix}quotecard\``);
      const who = getContextInfo(msg).participant;
      const author = (who && names.get(who)) || (who ? `+${num(who)}` : '');
      const lines = wrap(text.slice(0, 500), 30);
      const h = 220 + lines.length * 46;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2027"/><stop offset="1" stop-color="#2c5364"/></linearGradient></defs>` +
        `<rect width="900" height="${h}" rx="36" fill="url(#g)"/><text x="60" y="110" font-size="110" fill="#ffffff55" font-family="DejaVu Serif, Georgia, serif">“</text>` +
        lines.map((l, i) => `<text x="70" y="${150 + i * 46}" font-size="34" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">${xml(l)}</text>`).join('') +
        `<text x="70" y="${h - 40}" font-size="26" fill="#9fd3e6" font-family="DejaVu Sans, Arial, sans-serif">${author ? `— ${xml(author.slice(0, 40))}` : ''}</text></svg>`;
      try {
        const png = await media.loadSharp()(Buffer.from(svg)).png().toBuffer();
        await sock.sendMessage(jid, { image: png }, { quoted: msg });
      } catch (err) {
        await reply(`💬 _"${text.slice(0, 500)}"_${author ? `\n— ${author}` : ''}`); // no picture tools here: sent as text
      }
    },
  },
  {
    ...base,
    name: 'summarize',
    aliases: ['tldr'],
    description: 'Make a long message short: reply to it with summarize',
    async run({ rest, msg, reply, prefix }) {
      const text = rest || replied(msg);
      if (text.length < 80) return reply(`📝 *Reply to a long message* with \`${prefix}summarize\` _(or write the text after the command)_`);
      try {
        await reply(`📝 *Summary*\n${await ai.task('Summarize this in 3 short bullet points (use the • symbol), in the same language as the text:', text)}`);
      } catch (err) {
        await reply(fail(ai.NAME));
      }
    },
  },
  {
    ...base,
    name: 'grammar',
    aliases: ['fixtext', 'correct'],
    description: 'Fix the spelling and grammar of a message: reply to it with grammar',
    async run({ rest, msg, reply, prefix }) {
      const text = rest || replied(msg);
      if (!text) return reply(`✍️ *Reply to a message* with \`${prefix}grammar\` _(or write the text after the command)_`);
      try {
        await reply(`✍️ *Corrected*\n${await ai.task('Fix the spelling and grammar of this text. Keep the meaning and the language. Reply with the corrected text only:', text)}`);
      } catch (err) {
        await reply(fail(ai.NAME));
      }
    },
  },
];
