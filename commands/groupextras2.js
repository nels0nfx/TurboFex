// Group tools 2: disable, enable, captcha, antiraid, autosticker, purge, pin, unpin
const store = require('../whatsapp/store');
const activity = require('../whatsapp/activity');
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
    description: 'New members must answer a sum or they are removed: captcha on / off / time 120 (admins only)',
    async run({ jid, args, reply, prefix, isBotAdmin }) {
      const g = store.getGroup(jid);
      const w = (args[0] || '').toLowerCase();
      if (w === 'on' || w === 'off') {
        store.update(jid, (x) => { x.captcha = w === 'on'; });
        await reply(`✅ *Verification is now ${state(w === 'on')}.*${w === 'on' ? `\n_Every new member gets a sum to answer within ${g.captchaSeconds} seconds, or is removed._` : ''}`);
        if (w === 'on' && !isBotAdmin) await reply('⚠️ *Note:* I must be a group admin to remove people who do not answer.');
        return;
      }
      if (w === 'time') {
        const n = parseInt(args[1], 10);
        if (!Number.isInteger(n) || n < 30 || n > 600) return reply(`⚠️ *Choose 30 to 600 seconds.* Example: \`${prefix}captcha time 120\``);
        store.update(jid, (x) => { x.captchaSeconds = n; });
        return reply(`✅ *New members have ${n} seconds to answer.*`);
      }
      await reply(`🔐 *Verification*\n*Status:* ${state(g.captcha)}\n*Time to answer:* ${g.captchaSeconds} seconds\n\n▸ \`${prefix}captcha on\` / \`${prefix}captcha off\`\n▸ \`${prefix}captcha time 120\``);
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
        if (w !== 'off' && !isBotAdmin) await reply('⚠️ *Note:* I must be a group admin to lock the group and remove people.');
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
    name: 'purge',
    botAdminRequired: true,
    description: 'Remove the members who never wrote a message: purge shows them, purge confirm removes them (admins only)',
    async run({ sock, jid, args, reply, prefix, groupMetadata, botIds }) {
      if (activity.total(jid) < 100) return reply('😴 *I have not counted enough messages yet* (at least 100) to know who is silent. Try again later.');
      const counts = activity.get(jid);
      const quiet = groupMetadata.participants.filter((p) => !p.admin && !participantIds(p).some((i) => counts[i] || botIds.includes(i)));
      if (!quiet.length) return reply('✅ *Everybody has written at least once.* Nobody to remove.');
      if ((args[0] || '').toLowerCase() !== 'confirm') {
        return reply(`🧹 *Purge*\n${quiet.length} member(s) never wrote a message since I started counting (admins are never listed).\n\n▸ \`${prefix}inactive\` – see who they are\n▸ \`${prefix}purge confirm\` – remove up to 25 of them now`, { mentions: [] });
      }
      const batch = quiet.slice(0, 25);
      let done = 0;
      for (const p of batch) {
        try {
          await sock.groupParticipantsUpdate(jid, [p.id], 'remove');
          done += 1;
        } catch (err) {
          break; // not an admin, or WhatsApp said stop
        }
        await sleep(1500); // slowly, so WhatsApp does not mind
      }
      await reply(`🧹 *Purge done:* ${done} member(s) removed.${quiet.length > done ? `\n_${quiet.length - done} still to go: run_ \`${prefix}purge confirm\` _again._` : ''}`);
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
        await reply('⚠️ *I could not pin that message.* I must be a group admin.');
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
