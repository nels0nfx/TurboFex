// More fun (v0.9.3): hug, slap, kiss, love, pickup, dadjoke, fortune, advice, bored, catfact, dogfact, cat, dog
// Facts and jokes come from free web services. Each one has a small saved list to fall back on, so it never stays silent.
const web = require('../core/web');
const crypto = require('crypto');
const { getTargets, num } = require('../whatsapp/utils');

const base = { category: 'fun', needs: [], weight: 'light' };
const pick = (list) => list[crypto.randomInt(0, list.length)];
const down = (what) => `⚠️ *${what} is not answering right now.* Please try again later.`;
const tag = (jid) => `@${num(jid)}`;

const HUGS = [
  '{a} gives {b} a big warm hug 🤗',
  '{a} wraps {b} in the tightest bear hug 🐻',
  '{a} runs up and hugs {b}. Aww! 💞',
  '{a} sends {b} a long, cosy hug 🫂',
];
const SLAPS = [
  '{a} slaps {b} with a wet fish 🐟 (just for fun!)',
  '{a} gives {b} a gentle slap with a pillow 🛏️',
  '{a} slaps {b} with a big rubber chicken 🐔',
  '{a} playfully slaps {b} and runs away 🏃',
];
const KISSES = [
  '{a} blows {b} a kiss 😘',
  '{a} gives {b} a kiss on the cheek 💋',
  '{a} sends {b} a big kiss 😚💕',
  '{a} kisses {b} on the forehead ❤️',
];
const PICKUPS = [
  'Are you Wi-Fi? Because I am feeling a connection. 📶',
  'Do you have a map? I keep getting lost in your eyes. 🗺️',
  'Are you a camera? Every time I look at you, I smile. 📸',
  'Is your name Google? Because you have everything I have been searching for. 🔍',
  'Do you believe in love at first sight, or should I walk past again? 🚶',
  'Are you a charger? Because I would die without you. 🔋',
  'If you were a vegetable, you would be a cute-cumber. 🥒',
  'Are you made of copper and tellurium? Because you are Cu-Te. 🧪',
  'Is it hot in here, or is it just you? 🔥',
  'Are you a loan? Because you have my interest. 🏦',
  'Do you like raisins? How about a date? 🍇',
  'Are you a time traveller? Because I can see you in my future. ⏳',
  'I am not a photographer, but I can picture us together. 📷',
  'Are you French? Because Eiffel for you. 🗼',
  'Do you have a Band-Aid? I just scraped my knee falling for you. 🩹',
];
const FORTUNES = [
  'A pleasant surprise is waiting for you before the week ends. ✨',
  'Someone you have not heard from in a while will reach out soon. 📱',
  'Your hard work is about to be noticed. Keep going. 💪',
  'A small risk you take today will pay off later. 🎲',
  'Good news is travelling towards you right now. 🚀',
  'You will soon learn something that changes how you see a problem. 💡',
  'Money comes to the patient. Do not rush the next deal. 💰',
  'A new friendship will begin in an unexpected place. 🤝',
  'The answer you are looking for is simpler than you think. 🧩',
  'Today is a good day to start the thing you keep postponing. 🌱',
  'Laughter will find you at the right moment. 😄',
  'You are closer to your goal than it feels. 🎯',
  'Be kind today. It comes back to you in a big way. 💛',
  'An old idea of yours deserves a second chance. 🔁',
  'Rest well. Big energy is coming your way. 🌙',
];
const DAD_JOKES = [
  'I only know 25 letters of the alphabet. I do not know y.',
  'What do you call a fake noodle? An impasta.',
  'Why did the scarecrow win an award? He was outstanding in his field.',
  'I used to hate facial hair, but then it grew on me.',
  'Why do not eggs tell jokes? They would crack each other up.',
  'What do you call cheese that is not yours? Nacho cheese.',
  'I told my wife she was drawing her eyebrows too high. She looked surprised.',
  'Why can you not trust stairs? They are always up to something.',
  'What did the ocean say to the beach? Nothing, it just waved.',
  'Did you hear about the claustrophobic astronaut? He just needed a bit of space.',
];
const BORED = [
  'Call a friend you have not spoken to in a while 📞',
  'Learn five words in a new language 🌍',
  'Clean out your phone gallery 🖼️',
  'Write down three things you are happy about today 📝',
  'Try a new recipe with what you have at home 🍳',
  'Do 20 push-ups right now 💪',
  'Go for a ten minute walk without your phone 🚶',
  'Draw something with your eyes closed 🎨',
  'Start a quiz game in the group with the games menu 🎮',
  'Organise your contacts and delete the ones you never use 📇',
  'Listen to an album from start to finish 🎧',
  'Plan your dream holiday, with a budget ✈️',
  'Write a short story in only six words 📖',
  'Learn a card trick 🃏',
  'Stretch for five minutes 🧘',
];
const CAT_FACTS = [
  'Cats sleep for about 12 to 16 hours a day.',
  'A group of cats is called a clowder.',
  'Cats have a third eyelid called the haw.',
  'A cat can jump up to six times its own body length.',
  'Cats cannot taste sweetness.',
  'The purr of a cat is felt as a gentle vibration of about 25 to 150 hertz.',
  'Cats walk by moving both legs on one side, then the other side, like camels and giraffes.',
  'A cat has about 32 muscles in each ear.',
];
const DOG_FACTS = [
  'A dog\'s nose print is unique, like a human fingerprint.',
  'Dogs can understand around 150 words or more.',
  'Puppies are born deaf and cannot hear for about the first three weeks.',
  'Dogs sweat mainly through the pads of their paws.',
  'A dog\'s sense of smell is thousands of times stronger than ours.',
  'Greyhounds can run at about 70 km/h.',
  'Dogs dream, just like people do.',
  'Dalmatian puppies are born pure white. Their spots come later.',
];

// the two people for hug, slap and kiss: the sender and the tagged (or replied-to) person
function pair(ctx) {
  const target = getTargets(ctx.msg)[0] || null;
  const from = ctx.myJid || ctx.msg.key.participant || ctx.msg.key.remoteJid;
  return { from, target };
}
function action(name, aliases, lines, description, selfLine) {
  return {
    ...base,
    name,
    aliases,
    description,
    async run(ctx) {
      const { from, target } = pair(ctx);
      if (!target) return ctx.reply(`Tag the person or reply to their message.\nExample: ${ctx.prefix}${name} @person`);
      const same = num(from) === num(target);
      const text = same ? selfLine.replace('{a}', tag(from)) : pick(lines).replace('{a}', tag(from)).replace('{b}', tag(target));
      return ctx.reply(text, { mentions: [from, target] });
    },
  };
}

// a number from 0 to 100 that is always the same for the same two names
function loveScore(a, b) {
  const key = [String(a).toLowerCase().trim(), String(b).toLowerCase().trim()].sort().join('|');
  const h = crypto.createHash('sha256').update(key).digest();
  return h.readUInt16BE(0) % 101;
}
const verdict = (p) =>
  p >= 90 ? 'A perfect match! 💍' : p >= 70 ? 'Very strong. Go for it! 😍' : p >= 50 ? 'There is something there. 😊' : p >= 30 ? 'Maybe as friends. 🙂' : 'Not this time. 😅';

async function pic(ctx, { url, pickUrl, label }) {
  const { sock, jid, msg, reply } = ctx;
  try {
    const found = await web.getJson(url, { timeout: 10000 });
    const link = pickUrl(found);
    if (!link || !/^https:\/\//i.test(link)) throw new Error('no picture');
    const buffer = await web.getBuffer(link, { timeout: 15000, max: 5 * 1024 * 1024 });
    return await sock.sendMessage(jid, { image: buffer, caption: label }, { quoted: msg });
  } catch (err) {
    return reply(down('The picture service'));
  }
}

module.exports = [
  action('hug', ['cuddle'], HUGS, 'Give someone a hug: hug @person', '{a} hugs themselves. Come here, you need one. 🤗'),
  action('slap', ['smack'], SLAPS, 'A playful slap: slap @person', '{a} slaps themselves. Why? 😂'),
  action('kiss', ['smooch'], KISSES, 'Blow someone a kiss: kiss @person', '{a} kisses their own hand. Smooth. 😘'),
  {
    ...base,
    name: 'love',
    aliases: ['lovemeter', 'match'],
    description: 'Love meter for fun: love @person (you and them) or love Ada & Tunde',
    async run(ctx) {
      const { msg, rest, reply, prefix } = ctx;
      const tagged = getTargets(msg);
      const me = ctx.myJid || msg.key.participant || msg.key.remoteJid;
      let a;
      let b;
      let score;
      let mentions = [];
      if (tagged.length >= 2) {
        a = tag(tagged[0]);
        b = tag(tagged[1]);
        mentions = [tagged[0], tagged[1]];
        score = loveScore(num(tagged[0]), num(tagged[1]));
      } else if (tagged.length === 1) {
        a = tag(me);
        b = tag(tagged[0]);
        mentions = [me, tagged[0]];
        score = loveScore(num(me), num(tagged[0]));
      } else {
        const text = rest.trim();
        const m = /^(.{1,30}?)\s*(?:&|\+|❤️)\s*(.{1,30})$/.exec(text) || /^(.{1,30}?)\s+(?:and|x)\s+(.{1,30})$/i.exec(text);
        if (!m) return reply(`Tag someone, or write two names.\nExample: ${prefix}love @person\nExample: ${prefix}love Ada & Tunde`);
        a = m[1].trim();
        b = m[2].trim();
        score = loveScore(a, b);
      }
      const filled = Math.round(score / 10);
      const bar = '❤️'.repeat(filled) + '🖤'.repeat(10 - filled);
      return reply(`💘 *Love meter*\n${a} ❤️ ${b}\n\n${bar}\n*${score}%*  ${verdict(score)}\n\n_Just for fun!_`, { mentions });
    },
  },
  {
    ...base,
    name: 'pickup',
    aliases: ['pickupline', 'flirt'],
    description: 'A cheesy pick-up line',
    async run({ reply }) {
      return reply(`😏 ${pick(PICKUPS)}`);
    },
  },
  {
    ...base,
    name: 'dadjoke',
    aliases: ['dad'],
    description: 'A groan-worthy dad joke',
    async run({ reply }) {
      try {
        const j = await web.getJson('https://icanhazdadjoke.com/', { timeout: 8000 });
        if (j && typeof j.joke === 'string' && j.joke.trim()) return reply(`👨 ${j.joke.trim().slice(0, 400)}`);
      } catch (err) {
        // use the saved list below
      }
      return reply(`👨 ${pick(DAD_JOKES)}`);
    },
  },
  {
    ...base,
    name: 'fortune',
    aliases: ['fortunecookie', 'cookie'],
    description: 'Open a fortune cookie',
    async run({ reply }) {
      return reply(`🥠 *Your fortune*\n\n_${pick(FORTUNES)}_\n\n🍀 Lucky number: *${crypto.randomInt(1, 100)}*`);
    },
  },
  {
    ...base,
    name: 'advice',
    aliases: ['tip4u', 'wisdom'],
    description: 'A random piece of advice',
    async run({ reply }) {
      try {
        const j = await web.getJson('https://api.adviceslip.com/advice', { timeout: 8000 });
        const t = j?.slip?.advice;
        if (typeof t === 'string' && t.trim()) return reply(`💡 *Advice*\n\n_${t.trim().slice(0, 400)}_`);
        throw new Error('empty');
      } catch (err) {
        return reply(down('The advice service'));
      }
    },
  },
  {
    ...base,
    name: 'bored',
    aliases: ['idea', 'activity'],
    description: 'Something to do when you are bored',
    async run({ reply }) {
      return reply(`🥱 *Bored? Try this:*\n\n${pick(BORED)}`);
    },
  },
  {
    ...base,
    name: 'catfact',
    aliases: ['catfacts'],
    description: 'A random cat fact',
    async run({ reply }) {
      try {
        const j = await web.getJson('https://catfact.ninja/fact', { timeout: 8000 });
        if (typeof j?.fact === 'string' && j.fact.trim()) return reply(`🐱 *Cat fact*\n\n${j.fact.trim().slice(0, 400)}`);
      } catch (err) {
        // use the saved list below
      }
      return reply(`🐱 *Cat fact*\n\n${pick(CAT_FACTS)}`);
    },
  },
  {
    ...base,
    name: 'dogfact',
    aliases: ['dogfacts'],
    description: 'A random dog fact',
    async run({ reply }) {
      try {
        const j = await web.getJson('https://dogapi.dog/api/v2/facts', { timeout: 8000 });
        const t = j?.data?.[0]?.attributes?.body;
        if (typeof t === 'string' && t.trim()) return reply(`🐶 *Dog fact*\n\n${t.trim().slice(0, 400)}`);
      } catch (err) {
        // use the saved list below
      }
      return reply(`🐶 *Dog fact*\n\n${pick(DOG_FACTS)}`);
    },
  },
  {
    ...base,
    name: 'cat',
    aliases: ['kitty', 'randomcat'],
    slow: true,
    description: 'A random cat picture',
    run: (ctx) => pic(ctx, { url: 'https://api.thecatapi.com/v1/images/search?mime_types=jpg,png', pickUrl: (j) => j?.[0]?.url, label: '🐱 Meow!' }),
  },
  {
    ...base,
    name: 'dog',
    aliases: ['puppy', 'randomdog'],
    slow: true,
    description: 'A random dog picture',
    run: (ctx) => pic(ctx, { url: 'https://dog.ceo/api/breeds/image/random', pickUrl: (j) => j?.message, label: '🐶 Woof!' }),
  },
];
