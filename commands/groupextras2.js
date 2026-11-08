// Group tools 2: disable, enable, captcha, antiraid, autosticker, pin, unpin (purge is now part of inactive)
const store = require('../whatsapp/store');
const activity = require('../whatsapp/activity');
const captcha = require('../whatsapp/captcha');
const { getContextInfo, num, participantIds } = require('../whatsapp/utils');

const base = { category: 'group', groupOnly: true, adminOnly: true, needs: [], weight: 'light' };
const state = (v) => (v ? 'ON' : 'OFF');
const KEEP = ['disable', 'enable', 'menu', 'help']; // these can never be switched off
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const handler = () => require('../whatsapp/handler'); // loaded late: the handler loads this file

module.exports = [
  {
    ...base,
    name: 'disable',
    aliases: ['cmdoff'],
    description: 'Turn a command off in this group: disable rob (admins only)',
    async run({ jid, args, reply, prefix }) {
      const g = store.getGroup(jid);
      const word = (args[0] || '').toLowerCase();
      if (!word || word === 'list') return reply(`🚫 *Commands turned off here*\n${g.disabled.length ? g.disabled.map((c) => `▸ ${c}`).join('\n') : '_None._'}\n\n*Usage:* \`${prefix}disable <command>\` · \`${prefix}enable <command>\``);
      const cmd = handler().resolveCommand(word);
      if (!cmd) return reply(`⚠️ *I do not know the command "${word.slice(0, 20)}".*`);
      if (KEEP.includes(cmd.name)) return reply(`⚠️ *The command ${cmd.name} cannot be turned off.*`);
      store.update(jid, (x) => { x.disabled = [...new Set([...x.disabled, cmd.name])]; });
      await reply(`✅ *${cmd.name} is now turned off in this group.*\n_Members get a notice when they try it. Turn it on again with_ \`${prefix}enable ${cmd.name}\``);
    },
  },
  {
    ...base,
    name: 'enable',
    aliases: ['cmdon'],
    description: 'Turn a command on again in this group: enable rob / enable all (admins only)',
    async run({ jid, args, reply, prefix }) {
      const word = (args[0] || '').toLowerCase();
      if (!word) return reply(`*Usage:* \`${prefix}enable <command>\` or \`${prefix}enable all\``);
      if (word === 'all') {
        store.update(jid, (x) => { x.disabled = []; });
        return reply('✅ *All commands are on again in this group.*');
      }
      const cmd = handler().resolveCommand(word);
      const name = cmd ? cmd.name : word;
      store.update(jid, (x) => { x.disabled = x.disabled.filter((c) => c !== name); });
      await reply(`✅ *${name} is on again in this group.*`);
    },
  },
  {
    ...base,
    name: 'captcha',
    aliases: ['verify'],
    botAdminRequired: true,
    description: 'New members must answer a sum or they are removed: captcha on / off / time 90s, 5m / message <text> (admins only)',
    async run({ jid, args, rest, reply, prefix, isBotAdmin }) {
      const g = store.getGroup(jid);
      const w = (args[0] || '').toLowerCase();
      if (w === 'on' || w === 'off') {
        store.update(jid, (x) => { x.captcha = w === 'on'; });
        await reply(`✅ *Verification is now ${state(w === 'on')}.*${w === 'on' ? `\n_Every new member gets a sum to answer within ${captcha.words(g.captchaSeconds)}, or is removed._${g.intro && g.intro.on ? '\n▸ The introduction is sent once the new member has answered correctly.' : ''}` : ''}`);
        if (w === 'on' && !isBotAdmin) await reply('⚠️ *I need admin rights for this to work.*\n▸ Make me a group admin so I can remove people who do not answer.');
        return;
      }
      if (w === 'message' || w === 'verified' || w === 'welcome') {
        const text = rest.replace(/^\S+\s*/, '').trim();
        const cmdName = `${prefix}captcha message`;
        if (!text) {
          const now = g.captchaVerified;
          return reply(`💬 *Message after a right answer*\n▸ *Now:* ${now ? now.slice(0, 300) + (now.length > 300 ? '…' : '') : 'the default one'}\n\n▸ \`${cmdName} Well done @user! Welcome to the family 🎉\` saves your own\n▸ \`${cmdName} reset\` goes back to the default\n_Write @user where the new member should be tagged._`);
        }
        if (['reset', 'default', 'off'].includes(text.toLowerCase())) {
          store.update(jid, (x) => { x.captchaVerified = null; });
          return reply('✅ *The default message is back.*');
        }
        store.update(jid, (x) => { x.captchaVerified = text; });
        return reply(`✅ *Message saved.*\n▸ New members see it right after they solve the puzzle.\n▸ Preview:\n${captcha.verifiedText(jid, '27800000000@s.whatsapp.net').replace(/@27800000000/g, '@newmember')}`);
      }
      if (w === 'time') {
        const n = captcha.parseSeconds(args.slice(1).join(''));
        if (n === null) return reply(`⏳ *Time to answer*\n▸ \`${prefix}captcha time 90\` (seconds), \`${prefix}captcha time 5m\` or \`${prefix}captcha time 1h\`\n_From 30 seconds to 1 hour. New members are removed if they do not answer in time._`);
        store.update(jid, (x) => { x.captchaSeconds = n; });
        return reply(`✅ *New members have ${captcha.words(n)} to answer.*`);
      }
      await reply(`🔐 *Verification*\n*Status:* ${state(g.captcha)}\n*Time to answer:* ${captcha.words(g.captchaSeconds)}\n*Message after a right answer:* ${g.captchaVerified ? 'your own' : 'default'}\n\n▸ \`${prefix}captcha on\` / \`${prefix}captcha off\`\n▸ \`${prefix}captcha time 90s\`, \`${prefix}captcha time 5m\`\n▸ \`${prefix}captcha message Well done @user!\` (your own message after a right answer)`);
    },
  },
  {
    ...base,
    name: 'antiraid',
    description: 'Many people joining at once: antiraid off / lock / kick, joins 8, seconds 60 (admins only)',
    async run({ jid, args, reply, prefix, isBotAdmin }) {
      const g = store.getGroup(jid);
      const w = (args[0] || '').toLowerCase();
      if (['off', 'lock', 'kick'].includes(w)) {
        store.update(jid, (x) => { x.antiraid = w; });
        await reply(`✅ *Raid protection is now ${w.toUpperCase()}.*${w === 'lock' ? '\n_A burst of joins locks the group (only admins can write)._' : w === 'kick' ? '\n_A burst of joins locks the group and removes the new members._' : ''}`);
        if (w !== 'off' && !isBotAdmin) await reply('⚠️ *I need admin rights for this to work.*\n▸ Make me a group admin so I can lock the group and remove people.');
        return;
      }
      if (w === 'joins' || w === 'seconds') {
        const n = parseInt(args[1], 10);
        const [min, max, field] = w === 'joins' ? [3, 100, 'antiraidJoins'] : [10, 600, 'antiraidSeconds'];
        if (!Number.isInteger(n) || n < min || n > max) return reply(`⚠️ *Choose ${min} to ${max}.* Example: \`${prefix}antiraid ${w} ${w === 'joins' ? 8 : 60}\``);
        store.update(jid, (x) => { x[field] = n; });
        const now = store.getGroup(jid);
        return reply(`✅ *Trigger:* ${now.antiraidJoins} joins within ${now.antiraidSeconds} seconds`);
      }
      await reply(`🚨 *Raid protection*\n*Action:* ${g.antiraid.toUpperCase()}\n*Trigger:* ${g.antiraidJoins} joins within ${g.antiraidSeconds} seconds\n\n▸ \`${prefix}antiraid lock\` – lock the group\n▸ \`${prefix}antiraid kick\` – lock it and remove the new members\n▸ \`${prefix}antiraid off\`\n▸ \`${prefix}antiraid joins 8\` · \`${prefix}antiraid seconds 60\``);
    },
  },
  {
    ...base,
    name: 'autosticker',
    description: 'Pictures and videos sent in the group become stickers: autosticker on / off (admins only)',
    async run({ jid, args, reply, prefix }) {
      const w = (args[0] || '').toLowerCase();
      if (w !== 'on' && w !== 'off') return reply(`🖼️ *Autosticker*\n*Status:* ${state(store.getGroup(jid).autosticker)}\n_Every picture or short video sent here is also sent as a sticker._\n\n▸ \`${prefix}autosticker on\` / \`${prefix}autosticker off\``);
      store.update(jid, (x) => { x.autosticker = w === 'on'; });
      await reply(`✅ *Autosticker is now ${state(w === 'on')}.*`);
    },
  },
  {
    ...base,
    name: 'pin',
    botAdminRequired: true,
    description: 'Pin the message you reply to: pin (24h), pin 7d, pin 30d (admins only)',
    async run({ sock, jid, msg, args, reply, prefix, botIds }) {
      const ci = getContextInfo(msg);
      if (!ci.stanzaId) return reply(`📌 *Reply to a message* with \`${prefix}pin\` _(or \`${prefix}pin 7d\`, \`${prefix}pin 30d\`)_`);
      const time = { '24h': 86400, '1d': 86400, '7d': 604800, '30d': 2592000 }[(args[0] || '24h').toLowerCase()] || 86400;
      const key = { remoteJid: jid, id: ci.stanzaId, participant: ci.participant, fromMe: botIds.includes(num(ci.participant)) };
      try {
        await sock.sendMessage(jid, { pin: key, type: 1, time });
        await reply(`📌 *Pinned for ${time === 86400 ? '24 hours' : time === 604800 ? '7 days' : '30 days'}.*`);
      } catch (err) {
        await reply('⚠️ *I could not pin that message.*\n▸ Make me a group admin and try again.');
      }
    },
  },
  {
    ...base,
    name: 'unpin',
    botAdminRequired: true,
    description: 'Unpin the message you reply to (admins only)',
    async run({ sock, jid, msg, reply, prefix, botIds }) {
      const ci = getContextInfo(msg);
      if (!ci.stanzaId) return reply(`📌 *Reply to the pinned message* with \`${prefix}unpin\``);
      const key = { remoteJid: jid, id: ci.stanzaId, participant: ci.participant, fromMe: botIds.includes(num(ci.participant)) };
      try {
        await sock.sendMessage(jid, { pin: key, type: 2 });
        await reply('📌 *Unpinned.*');
      } catch (err) {
        await reply('⚠️ *I could not unpin that message.*');
      }
    },
  },
];
