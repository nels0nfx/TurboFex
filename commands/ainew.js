// New AI commands (v1.0.7): explain, rewrite, describe, solve, caption, story, poem, brainstorm, persona, quizme
const ai = require('../core/ai');
const persona = require('../whatsapp/persona');
const media = require('../whatsapp/media');
const { getQuoted, quotedText } = require('../whatsapp/utils');

const base = { category: 'ai', needs: [], weight: 'light' };
const replied = (msg) => quotedText(getQuoted(msg)) || '';

// one AI answer with a friendly message when the AI is not answering (the owner also gets the reason)
async function answer(ctx, head, messages, opts) {
  try {
    return await ctx.reply(`${head} ${await ai.chat(messages, opts)}`);
  } catch (err) {
    return failed(ctx, err);
  }
}
function failed(ctx, err) {
  console.error('AI command failed:', err.message);
  const { reply, isOwner, prefix } = ctx;
  if (err.noKey && /picture|Gemini or a Groq/i.test(err.message)) {
    return reply(isOwner ? `⚠️ *A picture needs an AI key.*\nSend \`${prefix}setapi gemini <key>\` (free at aistudio.google.com/apikey).` : `⚠️ *${ai.NAME} cannot look at pictures right now.* Please try again later.`);
  }
  return reply(`⚠️ *${ai.NAME} is not answering right now.* Please try again in a moment.${isOwner ? `\n*Reason:* ${String(err.message).slice(0, 300)}\n_Run_ \`${prefix}chatbot test\` _to check every AI service._` : ''}`);
}
const usage = (ctx, line, example) => ctx.reply(`🤖 *Usage:* \`${ctx.prefix}${line}\`\n*Example:* \`${ctx.prefix}${example}\``);

// a picture ready for the AI: smaller (sharp) when possible, never more than 4 MB
async function prepare(buffer) {
  try {
    const out = await media.loadSharp()(buffer).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { data: out, mime: 'image/jpeg' };
  } catch (err) {
    if (err.code !== 'NEED_SHARP') throw err;
  }
  if (buffer.length > 4 * 1024 * 1024) throw new Error('That picture is too big for me (the limit is 4 MB).');
  const mime = buffer.slice(0, 4).toString('hex') === '89504e47' ? 'image/png' : buffer.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/jpeg';
  return { data: buffer, mime };
}

// the commands that look at a picture: describe, solve and caption
async function withPicture(ctx, usageText, instruction) {
  return media.handle(ctx, ['image', 'sticker'], usageText, async (found, buffer) => {
    try {
      const pic = await prepare(buffer);
      const out = await ai.see(pic.data, pic.mime, instruction, { system: persona.styleFor(ctx.jid) });
      await ctx.reply(`${ctx.head || '🖼️'} ${out}`);
    } catch (err) {
      if (/too big/.test(err.message)) return ctx.reply(`⚠️ ${err.message}`);
      return failed(ctx, err);
    }
  });
}

const TONES = ['formal', 'friendly', 'short', 'polite', 'funny', 'confident', 'simple', 'angry', 'romantic'];
const POEMS = ['haiku', 'limerick', 'rap', 'love', 'funny', 'sad'];

const quizzes = new Map(); // chat -> { answers, at }
const QUIZ_TTL_MS = 30 * 60 * 1000;

module.exports = [
  {
    ...base,
    name: 'explain',
    aliases: ['eli5', 'simplify'],
    description: 'Explain something in very simple words: explain black holes (or reply to a message with explain)',
    async run(ctx) {
      const text = ctx.rest || replied(ctx.msg);
      if (!text) return usage(ctx, 'explain <anything>', 'explain how a vaccine works');
      return answer(ctx, '💡', [{ role: 'user', content: `Explain this in very simple words, as to a friend who has never heard of it. Use one short everyday example. Under 100 words.\n\n${text}` }], { system: persona.styleFor(ctx.jid) });
    },
  },

  {
    ...base,
    name: 'rewrite',
    aliases: ['reword', 'rephrase'],
    description: 'Rewrite a text in another tone: rewrite formal I need the money (tones: formal, friendly, short, polite, funny, confident, simple)',
    async run(ctx) {
      const { args, rest, msg, prefix } = ctx;
      const tone = TONES.includes((args[0] || '').toLowerCase()) ? args[0].toLowerCase() : null;
      const text = ((tone ? rest.slice(args[0].length).trim() : rest) || replied(msg)).trim();
      if (!text) return ctx.reply(`✍️ *Usage:* \`${prefix}rewrite <tone> <text>\` _(or reply to a message)_\n*Tones:* ${TONES.join(', ')}\n*Example:* \`${prefix}rewrite polite Send me the money now\``);
      return answer(ctx, '✍️', [{ role: 'user', content: `Rewrite this text ${tone ? `in a ${tone} tone` : 'so it is clearer and better written'}. Keep the meaning and the language. Give only the rewritten text.\n\n${text}` }]);
    },
  },

  {
    ...base,
    name: 'describe',
    aliases: ['whatisthis', 'lookat'],
    slow: true,
    weight: 'medium',
    description: 'NelsonFx describes a picture: reply to a picture with describe (or describe <your question about it>)',
    async run(ctx) {
      const q = ctx.rest.trim();
      ctx.head = '🖼️';
      return withPicture(ctx, `Reply to a picture with \`${ctx.prefix}describe\` (or send one with the command as its caption).\nYou can also ask: \`${ctx.prefix}describe what brand is this?\``, q || 'Describe this picture in 2 or 3 short sentences: what it shows and anything notable (text on it, the mood).');
    },
  },

  {
    ...base,
    name: 'solve',
    aliases: ['homework', 'answerthis'],
    slow: true,
    weight: 'medium',
    description: 'Solve a problem step by step: reply to a picture of it with solve (or solve 12 x 8 + 5)',
    async run(ctx) {
      const instruction = 'Solve this problem step by step. Show only the key steps, briefly, then give the final result on its own line that starts with "Answer:". If part of it is unreadable, say which part.';
      const text = ctx.rest || replied(ctx.msg);
      if (text) return answer(ctx, '🧮', [{ role: 'user', content: `${instruction}\n\n${text}` }], { system: persona.styleFor(ctx.jid) });
      ctx.head = '🧮';
      return withPicture(ctx, `Reply to a picture of the problem with \`${ctx.prefix}solve\`, or write it: \`${ctx.prefix}solve 12 x 8 + 5\``, instruction);
    },
  },

  {
    ...base,
    name: 'caption',
    aliases: ['captions', 'bio'],
    slow: true,
    description: 'Captions for a post: reply to a picture with caption, or caption <what it is about>',
    async run(ctx) {
      const instruction = 'Write 3 different short captions for a social media post. Number them 1 to 3. End each with 2 or 3 fitting hashtags. Match the language of any text given.';
      if (ctx.rest) return answer(ctx, '📝', [{ role: 'user', content: `${instruction}\n\nThe post is about: ${ctx.rest}` }]);
      ctx.head = '📝';
      return withPicture(ctx, `Reply to a picture with \`${ctx.prefix}caption\`, or write what it is about: \`${ctx.prefix}caption sunset at the beach\``, instruction);
    },
  },

  {
    ...base,
    name: 'story',
    aliases: ['shortstory', 'tellstory'],
    description: 'A short story from your idea: story a dragon who is afraid of fire',
    async run(ctx) {
      const idea = ctx.rest || replied(ctx.msg);
      if (!idea) return usage(ctx, 'story <idea>', 'story a taxi driver who finds a magic coin');
      return answer(ctx, '📖', [{ role: 'user', content: `Write a short story of about 150 words with a beginning, a twist and an ending. Idea: ${idea}` }], { system: persona.styleFor(ctx.jid) });
    },
  },

  {
    ...base,
    name: 'poem',
    aliases: ['poetry', 'poemgen'],
    description: 'A poem on any topic: poem my mother (kinds: haiku, limerick, rap, love, funny, sad)',
    async run(ctx) {
      const kind = POEMS.includes((ctx.args[0] || '').toLowerCase()) ? ctx.args[0].toLowerCase() : null;
      const topic = (kind ? ctx.rest.slice(ctx.args[0].length).trim() : ctx.rest) || replied(ctx.msg);
      if (!topic) return ctx.reply(`🎭 *Usage:* \`${ctx.prefix}poem <topic>\`\n*Kinds:* ${POEMS.join(', ')}\n*Example:* \`${ctx.prefix}poem haiku the ocean\``);
      return answer(ctx, '🎭', [{ role: 'user', content: `Write ${kind === 'haiku' ? 'a haiku' : kind === 'limerick' ? 'a limerick' : kind === 'rap' ? 'a short rap (8 lines)' : `a short ${kind ? `${kind} ` : ''}poem (8 lines at most)`} about: ${topic}. Give only the poem.` }]);
    },
  },

  {
    ...base,
    name: 'brainstorm',
    aliases: ['ideas', 'ideagen'],
    description: 'Eight fresh ideas for anything: brainstorm names for my bakery',
    async run(ctx) {
      const topic = ctx.rest || replied(ctx.msg);
      if (!topic) return usage(ctx, 'brainstorm <what you need ideas for>', 'brainstorm birthday party ideas for a 10 year old');
      return answer(ctx, '💭', [{ role: 'user', content: `Give 8 different, creative and practical ideas for: ${topic}. Number them 1 to 8, one short line each, no introduction.` }], { system: persona.styleFor(ctx.jid) });
    },
  },

  {
    ...base,
    name: 'persona',
    aliases: ['aistyle', 'aimood'],
    description: 'Change how NelsonFx talks in this chat: persona pirate / funny / teacher / off (admins in groups)',
    async run(ctx) {
      const { jid, isGroup, isAdmin, isOwner, args, reply, prefix } = ctx;
      const w = (args[0] || '').toLowerCase();
      const list = persona.names().join(', ');
      if (!w || w === 'list') {
        const now = persona.get(jid);
        return reply(`🎭 *NelsonFx style:* ${now || 'normal'}\n*Styles:* ${list}\n*Change:* \`${prefix}persona pirate\` _(or_ \`${prefix}persona off\`_)_`);
      }
      if (isGroup && !(isAdmin || isOwner)) return; // not allowed: stay silent
      if (w === 'off' || w === 'normal' || w === 'reset') {
        persona.clear(jid);
        return reply('🎭 *NelsonFx talks normally again.*');
      }
      if (!persona.set(jid, w)) return reply(`⚠️ *I do not know the style "${w.slice(0, 20)}".*\n*Styles:* ${list}`);
      return reply(`🎭 *NelsonFx now talks in the ${w} style* in this chat (in the ai command and the chatbot).\n_Back to normal:_ \`${prefix}persona off\``);
    },
  },

  {
    ...base,
    name: 'quizme',
    aliases: ['aiquiz', 'quiztopic'],
    description: 'A 5 question quiz on any topic made by AI: quizme volcanoes, then quizme answers',
    async run(ctx) {
      const { jid, args, rest, reply, prefix } = ctx;
      const now = Date.now();
      if ((args[0] || '').toLowerCase() === 'answers') {
        const q = quizzes.get(jid);
        if (!q || now - q.at > QUIZ_TTL_MS) return reply(`ℹ️ *There is no quiz to answer.* Start one with \`${prefix}quizme <topic>\``);
        quizzes.delete(jid);
        return reply(`✅ *Answers*\n${q.answers}`);
      }
      if (!rest) return usage(ctx, 'quizme <topic>', 'quizme the solar system');
      try {
        const text = await ai.chat([{ role: 'user', content: `Make a quiz of exactly 5 multiple-choice questions about: ${rest}. Use this exact format and nothing else:\nQ1. question\nA) option B) option C) option D) option\n(and so on up to Q5)\nANSWERS: 1B 2D 3A 4C 5A` }]);
        const at = text.search(/ANSWERS\s*:/i);
        const body = (at > 0 ? text.slice(0, at) : text).trim();
        if (at > 0) quizzes.set(jid, { answers: text.slice(at).replace(/ANSWERS\s*:/i, '').trim(), at: now });
        if (quizzes.size > 500) quizzes.clear();
        return reply(`🧠 *Quiz: ${rest.slice(0, 40)}*\n\n${body}${at > 0 ? `\n\n_Answer with the letters, then see_ \`${prefix}quizme answers\`` : ''}`);
      } catch (err) {
        return failed(ctx, err);
      }
    },
  },
];
