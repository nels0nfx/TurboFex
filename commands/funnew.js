// New fun and games (v1.0.7): neverhaveiever, twotruths, hotseat, wordchain, storychain, spinwheel, memorygame, pet, fish, battleship
const games = require('../whatsapp/play');
const jsonstore = require('../core/jsonstore');
const levels = require('../whatsapp/levels');
const { realmCommand } = require('../core/realm/cmd');
const A = require('../core/realm/aurum');
const civic = require('../core/realm/civic');
const settings = require('../core/realm/settings');
const ui = require('../core/realm/ui');
const { num } = require('../whatsapp/utils');

const fun = { category: 'fun', needs: [], weight: 'light' };
const gameBase = { category: 'games', adminOnly: true, needs: [], weight: 'light' };
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = (ms) => (process.env.TURBOFEX_FAST ? Promise.resolve() : sleep(ms));
const mayAdmin = (ctx) => !!(ctx.isAdmin || ctx.isOwner);

// ---------------------------------------------------------------- never have I ever
const NEVER = [
  'sent a message to the wrong person', 'fallen asleep in a class or a meeting', 'laughed so hard that I cried', 'pretended to be sick to stay home', 'sung loudly in the car with the windows open',
  'forgotten the name of someone right after meeting them', 'eaten food that fell on the floor', 'walked into a glass door', 'taken a selfie and deleted it ten times', 'stayed awake the whole night watching a series',
  'talked to myself out loud', 'gotten lost in a place I know well', 'waved back at someone who was not waving at me', 'forgotten my own phone number', 'cried at a movie',
  'tried to open a door by pushing when I had to pull', 'laughed at the wrong moment', 'left my phone at home and went back for it', 'eaten a whole pizza alone', 'danced when nobody was watching',
  'missed my bus or train by a minute', 'said "you too" when the waiter said enjoy your meal', 'been late to my own event', 'kept a gift I did not like and said I loved it', 'texted someone the moment I woke up',
  'worn my shirt inside out all day', 'locked myself out of my house', 'forgotten why I walked into a room', 'googled my own name', 'sent a voice note that was way too long',
  'turned my phone on silent and missed ten calls', 'pretended I did not see someone to avoid talking', 'burned water', 'eaten ice cream for breakfast', 'fallen asleep with my phone on my face',
  'laughed at my own joke before the end', 'been scared of a shadow', 'learned a song only for one line I liked', 'cooked something and then ordered food anyway', 'taken the wrong bag from a table',
  'called a teacher "mum" or "dad"', 'tried to pay with a card that was not mine', 'forgotten a birthday I should have remembered', 'sworn I would wake up early and slept until noon', 'spent more than an hour choosing what to watch',
  'sung in the shower like I was on stage', 'got a song stuck in my head for a week', 'walked out of a shop without what I came for', 'been caught talking about someone who walked in', 'read the last page of a book first',
];
const recentNever = new Map();

// ---------------------------------------------------------------- hot seat
const HOT = [
  'What is the best thing that happened to you this year?', 'What is your most useless talent?', 'Which app do you use the most, and why?', 'What would you do with a free day and a full wallet?',
  'What is a food you will never eat again?', 'Which famous person would you invite to dinner?', 'What is your funniest memory from school?', 'What is the best advice you ever got?',
  'If you could live in any country, which one?', 'What song makes you feel like a hero?', 'What is the silliest thing you are afraid of?', 'Which skill would you love to learn in one day?',
  'What is your dream job (not the one you have)?', 'What was your first phone?', 'What is the nicest thing someone did for you?', 'What do you always do first when you wake up?',
  'Which movie can you watch again and again?', 'What is the worst haircut you ever had?', 'What is something small that makes your day better?', 'If you could talk to animals, which one first?',
];

// ---------------------------------------------------------------- two truths and a lie (state in memory)
const rounds = new Map(); // chat -> { by, statements, lie, votes: Map(voterKey -> n), at }
const ROUND_TTL = 30 * 60 * 1000;

// ---------------------------------------------------------------- story chain (state in memory)
const stories = new Map(); // chat -> { by, lines: [{ who, text }], at }
const STORY_TTL = 24 * 3600 * 1000;

// ---------------------------------------------------------------- virtual pet (saved)
const pets = jsonstore.open('pets', { users: {} }, { delay: 2000 });
const PET_ICONS = ['🐶', '🐱', '🐰', '🦊', '🐼', '🐸', '🐵', '🦄', '🐯', '🐧'];
const H = 3600 * 1000;
const clamp = (n) => Math.max(0, Math.min(100, n));
const bar = (n) => `${'▰'.repeat(Math.round(n / 10))}${'▱'.repeat(10 - Math.round(n / 10))} ${Math.round(n)}%`;
const petsOf = () => (pets.data.users = pets.data.users || {});

// the pet gets hungry, bored and tired while you are away (at most 72 hours are counted)
function tick(p, now = Date.now()) {
  const hours = Math.min(72, Math.max(0, (now - p.t) / H));
  const before = p.hunger;
  p.hunger = clamp(before - 3 * hours);
  p.fun = clamp(p.fun - 2.5 * hours);
  p.energy = clamp(p.energy - 1.5 * hours);
  // only the hours with an empty stomach count (it took a while to get there)
  if (p.hunger <= 0) p.starving = (p.starving || 0) + Math.max(0, hours - before / 3);
  else p.starving = 0;
  p.t = now;
  if (p.starving >= 24) p.gone = true; // it left because it was hungry for a whole day
  return p;
}
const moodOf = (p) => {
  const low = Math.min(p.hunger, p.fun, p.energy);
  return low >= 60 ? '😄 happy' : low >= 30 ? '🙂 fine' : low >= 10 ? '😟 needs you' : '😭 miserable';
};
const petCard = (p) => `${p.icon} *${p.name}*  _(${Math.max(1, Math.floor((p.t - p.born) / (24 * H)) + 1)} day${Math.floor((p.t - p.born) / (24 * H)) ? 's' : ''} old)_\n*Mood:* ${moodOf(p)}\n🍖 Food   ${bar(p.hunger)}\n🎾 Fun    ${bar(p.fun)}\n⚡ Energy ${bar(p.energy)}`;

// ---------------------------------------------------------------- fishing
const CATCHES = [
  { upto: 12, icon: '🥾', name: 'an old boot', factor: 0 },
  { upto: 62, icon: '🐟', name: 'a small fish', factor: [0.4, 0.8] },
  { upto: 87, icon: '🐠', name: 'a nice fish', factor: [0.9, 1.4] },
  { upto: 96, icon: '🐡', name: 'a big fish', factor: [1.5, 2.4] },
  { upto: 99, icon: '🦑', name: 'a rare squid', factor: [2.8, 4] },
  { upto: 100, icon: '💰', name: 'a treasure chest', factor: [5, 7] },
];
const between = ([a, b]) => a + Math.random() * (b - a);

module.exports = [
  {
    ...fun,
    name: 'neverhaveiever',
    aliases: ['nhie', 'ihaveneverever'],
    description: 'A "never have I ever" for the group: everybody who did it reacts or answers',
    async run({ jid, reply }) {
      const recent = recentNever.get(jid) || [];
      const pool = NEVER.filter((s) => !recent.includes(s));
      const pick = pickOne(pool.length ? pool : NEVER);
      recentNever.set(jid, [...recent, pick].slice(-(NEVER.length - 5))); // no repeat until the list is almost used up
      if (recentNever.size > 500) recentNever.clear();
      return reply(`🙈 *Never have I ever...*\n\n_...${pick}._\n\nIf you *have*, react with 🙋 or tell us! 😄`);
    },
  },

  {
    ...fun,
    name: 'twotruths',
    aliases: ['2truths', 'truthsandlie'],
    groupOnly: true,
    description: 'Two truths and a lie: twotruths <truth> | <truth> | <lie> (lie last). Then everybody votes with twotruths 1, 2 or 3',
    async run(ctx) {
      const { sock, jid, msg, rest, args, reply, prefix, myJid, isBotAdmin } = ctx;
      const me = levels.keyOf(myJid);
      const now = Date.now();
      let game = rounds.get(jid);
      if (game && now - game.at > ROUND_TTL) {
        rounds.delete(jid);
        game = null;
      }
      const w = (args[0] || '').toLowerCase();

      if (/^[123]$/.test(w) && game) {
        if (game.by === me) return reply('😅 *You wrote it, so you cannot vote.*');
        game.votes.set(me, Number(w));
        return reply(`🗳️ *Vote counted.* ${game.votes.size} vote${game.votes.size === 1 ? '' : 's'} so far.`);
      }
      if (w === 'reveal' || w === 'end') {
        if (!game) return reply(`ℹ️ *There is no round.* Start one with \`${prefix}twotruths <truth> | <truth> | <lie>\``);
        if (!(game.by === me || mayAdmin(ctx))) return; // not allowed: stay silent
        rounds.delete(jid);
        const right = [...game.votes.values()].filter((v) => v === game.lieAt).length;
        const total = game.votes.size;
        return reply(`🎭 *The lie was number ${game.lieAt}:*\n_${game.statements[game.lieAt - 1]}_\n\n${total ? `🗳️ ${right} of ${total} guessed right (${Math.round((right / total) * 100)}%).` : 'Nobody voted.'}\n${right < total / 2 ? '😎 *You fooled most of them!*' : '🕵️ *Sharp eyes in this group!*'}`);
      }
      if (game) return reply(`🎭 *A round is running.* Vote with \`${prefix}twotruths 1\`, \`2\` or \`3\`. The writer ends it with \`${prefix}twotruths reveal\`.`);

      const parts = rest.split('|').map((x) => x.trim()).filter(Boolean);
      if (parts.length !== 3 || parts.some((x) => x.length > 150)) {
        return reply(`🎭 *Two truths and a lie*\n*Write:* \`${prefix}twotruths I can swim | I have a twin | I have been to Mars\`\n_Two true things, then the lie LAST (max 150 characters each). I mix them up and hide your message, so I must be a group admin._`);
      }
      if (!isBotAdmin) return reply('⚠️ *I must be a group admin* to hide your message, or everybody would see which one is the lie. Make me admin and try again.');
      try {
        await sock.sendMessage(jid, { delete: msg.key });
      } catch (err) {
        return reply('⚠️ *I could not hide your message,* so the round is cancelled (everybody could see the lie).');
      }
      const order = [0, 1, 2].sort(() => Math.random() - 0.5);
      const statements = order.map((i) => parts[i]);
      const lieAt = order.indexOf(2) + 1;
      rounds.set(jid, { by: me, statements, lieAt, votes: new Map(), at: now });
      if (rounds.size > 500) rounds.clear();
      return sock.sendMessage(jid, { text: `🎭 *Two truths and a lie*\nBy @${num(myJid)}. One of these is a lie:\n\n*1.* ${statements[0]}\n*2.* ${statements[1]}\n*3.* ${statements[2]}\n\n🗳️ Vote with \`${prefix}twotruths 1\`, \`2\` or \`3\`.`, mentions: [myJid] });
    },
  },

  {
    ...fun,
    name: 'hotseat',
    aliases: ['hot', 'hotseatgame'],
    groupOnly: true,
    description: 'Put somebody in the hot seat: the group asks them anything. hotseat (random member) or hotseat @person',
    async run({ msg, reply, jid, botIds, groupMetadata: meta }) {
      const { getTargets } = require('../whatsapp/utils');
      const tagged = getTargets(msg).filter((t) => !botIds.includes(num(t)));
      const pool = (meta?.participants || []).map((p) => p.id).filter((j) => !botIds.includes(num(j)));
      const seat = tagged[0] || pickOne(pool);
      if (!seat) return reply('⚠️ *I cannot see the members of this group right now.* Try again in a moment.');
      return reply(`🔥 *HOT SEAT*\n\n@${num(seat)} is in the hot seat!\nEverybody asks them questions and they must answer *honestly*.\n\n💬 *To get started:* ${pickOne(HOT)}`, { mentions: [seat] });
    },
  },

  { ...gameBase, name: 'wordchain', aliases: ['chainwords', 'wchain'], description: 'Take turns: every word starts with the last letter of the one before. Too slow and you are out (2 to 10 players)', run: (ctx) => games.fromCommand(ctx, 'wordchain', { defaultRounds: 1 }) },

  {
    ...fun,
    name: 'storychain',
    aliases: ['storytime', 'buildstory'],
    groupOnly: true,
    description: 'Write a story together, one sentence each: storychain start <first line>, storychain <your sentence>, storychain end',
    async run(ctx) {
      const { jid, args, rest, reply, prefix, myJid } = ctx;
      const me = levels.keyOf(myJid);
      const now = Date.now();
      let s = stories.get(jid);
      if (s && now - s.at > STORY_TTL) {
        stories.delete(jid);
        s = null;
      }
      const w = (args[0] || '').toLowerCase();
      const show = (head) => `${head}\n\n${s.lines.map((l) => l.text).join(' ')}`;

      if (w === 'start' || w === 'new') {
        if (s) return reply(`📖 *A story is already running* (${s.lines.length} sentence${s.lines.length === 1 ? '' : 's'}). Add to it with \`${prefix}storychain <sentence>\` or finish it with \`${prefix}storychain end\`.`);
        const first = rest.slice(w.length).trim().slice(0, 200);
        if (!first) return reply(`📖 *Write the first line:* \`${prefix}storychain start One night, a taxi stopped at an empty road...\``);
        stories.set(jid, { by: me, lines: [{ who: me, text: first }], at: now });
        if (stories.size > 500) stories.clear();
        return reply(`📖 *A new story begins!*\n\n_${first}_\n\n✍️ Everybody adds one sentence: \`${prefix}storychain <your sentence>\`\n_You cannot add two sentences in a row. Finish it with_ \`${prefix}storychain end\``);
      }
      if (!s) return reply(`📖 *No story is running.*\nStart one: \`${prefix}storychain start <first line>\``);
      if (w === 'read' || w === 'show' || !w) return reply(show(`📖 *The story so far* _(${s.lines.length} sentences)_`));
      if (w === 'end' || w === 'finish') {
        if (!(s.by === me || mayAdmin(ctx))) return; // not allowed: stay silent
        stories.delete(jid);
        return reply(show(`📕 *THE END* _(${s.lines.length} sentences by ${new Set(s.lines.map((l) => l.who)).size} writers)_`));
      }
      const text = rest.trim().slice(0, 200);
      if (s.lines[s.lines.length - 1].who === me) return reply('⏳ *Let somebody else add the next sentence.*');
      if (s.lines.length >= 40) return reply(`📖 *The story is long enough!* Finish it with \`${prefix}storychain end\``);
      s.lines.push({ who: me, text });
      s.at = now;
      return reply(`✅ *Added* (sentence ${s.lines.length}).\n_...${text}_`);
    },
  },

  {
    ...fun,
    name: 'spinwheel',
    aliases: ['wheel', 'spinthewheel'],
    description: 'Spin a wheel to choose: spinwheel pizza, burgers, sushi',
    async run({ sock, jid, msg, rest, reply, prefix }) {
      const items = rest.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
      if (items.length < 2) return reply(`🎡 *Usage:* \`${prefix}spinwheel pizza, burgers, sushi\`\n_Separate the choices with commas._`);
      if (items.length > 20) return reply('⚠️ *The wheel can hold 20 choices.*');
      const winner = pickOne(items);
      const first = await sock.sendMessage(jid, { text: '🎡 *Spinning...*' }, { quoted: msg });
      for (const frame of [pickOne(items), pickOne(items), pickOne(items)]) {
        await pause(700);
        try {
          await sock.sendMessage(jid, { text: `🎡 *Spinning...*\n➡️ ${frame}`, edit: first?.key });
        } catch (err) {
          break; // the message cannot be edited: only the result is sent
        }
      }
      await pause(700);
      try {
        return await sock.sendMessage(jid, { text: `🎡 *The wheel stopped!*\n\n🎉 *${winner}*`, edit: first?.key });
      } catch (err) {
        return reply(`🎡 *The wheel stopped!*\n\n🎉 *${winner}*`);
      }
    },
  },

  { ...gameBase, name: 'memorygame', aliases: ['memory', 'emojimemory'], description: 'Watch a row of emojis, then type it back: the first to get it wins (memorygame 6 = 6 rounds)', run: (ctx) => games.fromCommand(ctx, 'memorygame', { defaultRounds: 6 }) },

  {
    ...fun,
    name: 'pet',
    aliases: ['mypet', 'tamagotchi'],
    description: 'Your own virtual pet: pet adopt <name>, then pet feed / pet play / pet sleep and pet to check on it',
    async run({ args, rest, reply, prefix, myJid }) {
      const key = levels.keyOf(myJid);
      const all = petsOf();
      const now = Date.now();
      let p = all[key];
      const w = (args[0] || '').toLowerCase();
      if (p && !p.gone) tick(p, now);

      if (w === 'adopt') {
        if (p && !p.gone) return reply(`🐾 *You already have ${p.name}!* Take care of it with \`${prefix}pet feed\`.`);
        const name = rest.slice(5).trim().replace(/[*_~`]/g, '').slice(0, 20);
        if (!name) return reply(`🐾 *Name your pet:* \`${prefix}pet adopt Bruno\``);
        p = all[key] = { name, icon: pickOne(PET_ICONS), born: now, t: now, hunger: 80, fun: 80, energy: 80, starving: 0, gone: false, cd: {}, fed: 0, played: 0 };
        pets.touch();
        return reply(`🎉 *Welcome ${p.icon} ${p.name}!*\n\n${petCard(p)}\n\nFeed it with \`${prefix}pet feed\`, play with \`${prefix}pet play\`, let it rest with \`${prefix}pet sleep\`.`);
      }
      if (!p) return reply(`🐾 *You have no pet yet.*\nAdopt one: \`${prefix}pet adopt <name>\``);
      if (p.gone) {
        delete all[key];
        pets.touch();
        return reply(`😢 *${p.name} left.* It was hungry for a whole day and went to find food.\nYou can adopt a new friend: \`${prefix}pet adopt <name>\`\n_Feed your next pet at least once a day!_`);
      }
      p.cd = p.cd || {};
      const wait = (what, ms) => {
        const left = ms - (now - (p.cd[what] || 0));
        return left > 0 ? `⏳ *${p.name} needs a moment.* Try again in ${Math.ceil(left / 60000)} minute${Math.ceil(left / 60000) === 1 ? '' : 's'}.` : null;
      };
      if (w === 'feed' || w === 'play' || w === 'sleep' || w === 'rest') {
        const kind = w === 'rest' ? 'sleep' : w;
        const busy = wait(kind, kind === 'sleep' ? 60 * 60000 : 20 * 60000);
        if (busy) return reply(busy);
        if (kind === 'feed') {
          if (p.hunger >= 95) return reply(`😋 *${p.name} is full!* Come back later.`);
          p.hunger = clamp(p.hunger + 30);
          p.fed += 1;
        } else if (kind === 'play') {
          if (p.energy < 10) return reply(`😴 *${p.name} is too tired to play.* Let it sleep: \`${prefix}pet sleep\``);
          p.fun = clamp(p.fun + 25);
          p.energy = clamp(p.energy - 10);
          p.hunger = clamp(p.hunger - 5);
          p.played += 1;
        } else {
          p.energy = clamp(p.energy + 40);
        }
        p.cd[kind] = now;
        pets.touch();
        return reply(`${kind === 'feed' ? '🍖 *Yum!*' : kind === 'play' ? '🎾 *Woof, what fun!*' : '😴 *Zzz... good nap!*'}\n\n${petCard(p)}`);
      }
      pets.touch();
      return reply(`${petCard(p)}\n\n\`${prefix}pet feed\` · \`${prefix}pet play\` · \`${prefix}pet sleep\`${p.hunger < 25 ? `\n\n⚠️ *${p.name} is very hungry!*` : ''}`);
    },
  },

  realmCommand({
    name: 'fish',
    aliases: ['fishing', 'castline'],
    description: 'Go fishing for Aurum in the Empire of Fex (every 25 minutes)',
    async run({ reply, myJid }, { group }) {
      const cd = A.cooldown(group, myJid, 'fish', 25 * 60000);
      if (!cd.ok) return reply(ui.wait('The fish are hiding.', cd.waitMs));
      const roll = Math.random() * 100;
      const c = CATCHES.find((x) => roll < x.upto) || CATCHES[1];
      const base = Number(settings.get('careers.payBase', group)) || 100;
      const gross = c.factor ? Math.round(base * between(c.factor) * A.earnMult(group, myJid)) : 0;
      const tax = gross ? civic.tax(group, gross) : 0;
      const pay = gross - tax;
      if (pay > 0) A.add(group, myJid, pay);
      return reply(ui.card('🎣', 'You went fishing', [`*You caught:* ${c.icon} ${c.name}`, pay > 0 ? `*Sold for:* +${ui.money(pay)}${tax ? ` _(tax ${ui.money(tax)})_` : ''}` : '*Sold for:* nothing. Better luck next time!', `*Purse:* ${ui.money(A.balance(group, myJid))}`], [], 'Come back in 25 minutes. Rare catches pay a lot!'));
    },
  }),

  { ...gameBase, name: 'battleship', aliases: ['seabattle', 'sinkships'], description: 'Sink a hidden fleet together before the 20 shots run out: type a square like B4', run: (ctx) => games.fromCommand(ctx, 'battleship', { defaultRounds: 1 }) },
];
