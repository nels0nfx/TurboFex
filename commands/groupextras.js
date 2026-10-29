// More group tools: antibot, antitag, tagadmins, exportrank, silence, unsilence, mutelist
const store = require('../whatsapp/store');
const levels = require('../whatsapp/levels');
const names = require('../whatsapp/names');
const mentionsLib = require('../whatsapp/mentions');
const meta = require('../whatsapp/metadata');
const { setActionMode } = require('../whatsapp/actions');
const { getTargets, num } = require('../whatsapp/utils');

const base = { category: 'group', groupOnly: true, needs: [], weight: 'light' };

module.exports = [
  {
    ...base,
    name: 'antibot',
    adminOnly: true,
    description: 'Other bots writing in the group: antibot off / delete / warn / kick, add, remove, check (admins only)',
    async run(ctx) {
      const { jid, args, msg, reply, prefix, isBotAdmin } = ctx;
      const g = store.getGroup(jid);
      const w = (args[0] || '').toLowerCase();
      const { resolveTarget } = require('../whatsapp/utils');
      const { botVerdict } = require('../whatsapp/protect');

      if (['off', 'delete', 'warn', 'kick', 'on'].includes(w)) {
        const mode = w === 'on' ? 'warn' : w;
        store.update(jid, (x) => { x.antibotMode = mode; });
        await reply(`✅ *Anti-bot is now ${mode.toUpperCase()}.*${mode === 'off' ? '' : `\n_Messages from other bots are ${mode === 'delete' ? 'deleted' : mode === 'warn' ? `deleted and the bot is warned (removed after ${store.getLimit(jid)} warnings)` : 'deleted and the bot is removed'}. Admins are never affected._`}`);
        if (mode !== 'off' && !isBotAdmin) await reply('⚠️ *Note:* I must be a group admin to delete messages and remove bots.');
        return;
      }
      if (w === 'strict') {
        const on = (args[1] || '').toLowerCase();
        if (on !== 'on' && on !== 'off') return reply(`*Usage:* \`${prefix}antibot strict on\` or \`${prefix}antibot strict off\`\n_On also catches linked-device bots (message ids starting with 3EB0). WhatsApp Web users can look the same, so turn it off if a real person is caught._`);
        store.update(jid, (x) => { x.antibotStrict = on === 'on'; });
        return reply(`✅ *Strict detection is now ${on.toUpperCase()}.*`);
      }
      if (w === 'add' || w === 'remove') {
        const target = resolveTarget(msg, args.slice(1));
        if (!target) return reply(`*Usage:* \`${prefix}antibot ${w} @bot\` _(or a number, or reply to its message)_`);
        const key = levels.keyOf(target);
        store.update(jid, (x) => { x.botList = w === 'add' ? [...new Set([...x.botList, key])].slice(-100) : x.botList.filter((k) => k !== key); });
        return reply(`✅ *${w === 'add' ? 'Marked as a bot' : 'No longer marked as a bot'}:* @${num(target)}${w === 'add' && g.antibotMode === 'off' ? `\n_Anti-bot is OFF. Turn it on:_ \`${prefix}antibot warn\`` : ''}`, { mentions: [target] });
      }
      if (w === 'list') {
        if (!g.botList.length) return reply('🤖 *No bots are marked in this group.*');
        const who = await mentionsLib.describe(ctx.sock, jid, g.botList.map((k) => `${k}@s.whatsapp.net`));
        return reply(`🤖 *Marked bots*\n\n${who.map((x) => `▸ ${x.text}`).join('\n')}`, { mentions: who.map((x) => x.mention).filter(Boolean) });
      }
      if (w === 'check') {
        // reply to any message: shows its id and what anti-bot makes of it (handy to see why a bot was or was not caught)
        const ci = require('../whatsapp/utils').getContextInfo(msg);
        if (!ci.stanzaId) return reply(`Reply to a message with \`${prefix}antibot check\``);
        const v = botVerdict(ci.stanzaId, g.antibotStrict);
        return reply(`🔎 *Message check*\n*Id:* ${ci.stanzaId}\n*Length:* ${ci.stanzaId.length}\n*Looks like a bot:* ${v.bot ? 'YES' : 'no'}\n_${v.why}_\n\nNot caught? Mark it yourself: reply to its message with \`${prefix}antibot add\``);
      }
      await reply(
        `🤖 *Anti-bot*\n*Action:* ${g.antibotMode.toUpperCase()}\n*Strict detection:* ${g.antibotStrict ? 'ON' : 'OFF'}\n*Marked bots:* ${g.botList.length}\n\n` +
          `▸ \`${prefix}antibot warn\` _(off, delete, warn, kick)_\n▸ \`${prefix}antibot add\` – mark a bot yourself _(a tag, a number, or reply to its message)_\n` +
          `▸ \`${prefix}antibot remove\` / \`${prefix}antibot list\`\n▸ \`${prefix}antibot check\` – reply to a message to see how it is judged\n▸ \`${prefix}antibot strict off\`\n\n` +
          `_Bots are recognised by how their messages are built. Admins are never affected._`
      );
    },
  },
  {
    ...base,
    name: 'antitag',
    adminOnly: true,
    description: 'Mass tagging: antitag off / delete / warn / kick, antitag limit 8 (admins only)',
    async run(ctx) {
      const { jid, args, reply } = ctx;
      if ((args[0] || '').toLowerCase() === 'limit') {
        const n = parseInt(args[1], 10);
        if (!Number.isInteger(n) || n < 2 || n > 100) return reply('⚠️ *Choose a number from 2 to 100.* Example: `antitag limit 8`');
        store.update(jid, (g) => {
          g.antitagLimit = n;
        });
        return reply(`✅ *Anti-tag limit set to ${n}.* _A message that tags ${n} or more people counts as mass tagging._`);
      }
      await setActionMode(ctx, { key: 'antitagMode', label: `Anti-tag (limit ${store.getGroup(jid).antitagLimit} people)`, trigger: 'tags too many people in one message' });
    },
  },
  {
    ...base,
    name: 'tagadmins',
    aliases: ['admintag', 'calladmins'],
    description: 'Tag all the admins of the group (add a message if you like)',
    async run({ sock, jid, rest, reply }) {
      const info = await meta.getMeta(sock, jid);
      const admins = (info?.participants || []).filter((p) => p.admin).map((p) => p.id);
      if (!admins.length) return reply('⚠️ I could not find the admins of this group.');
      await sock.sendMessage(jid, { text: `📢 *Admins*${rest ? `\n_${rest.slice(0, 500)}_` : ''}\n\n${admins.map((a) => `@${num(a)}`).join(' ')}`, mentions: admins });
    },
  },
  {
    ...base,
    name: 'exportrank',
    aliases: ['rankfile'],
    adminOnly: true,
    description: 'Send the group ranking (level and XP of every member) as a spreadsheet file (admins only)',
    async run({ sock, jid, msg, reply, groupMetadata }) {
      const list = levels.board(jid);
      if (!list.length) return reply('📊 *Nobody has XP yet.* Turn ranks on with `rank on` and chat for a while.');
      const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
      const rows = list.map(([key, v], i) => {
        const jidOf = v.j || `${key}@s.whatsapp.net`;
        return [i + 1, q(names.get(jidOf) || ''), q(names.phoneOf(jidOf) || ''), v.x, levels.level(v.x)].join(',');
      });
      const csv = `Position,Name,Phone,XP,Level\n${rows.join('\n')}\n`;
      const file = `rank-${String(groupMetadata?.subject || 'group').replace(/[^\w-]+/g, '_').slice(0, 30)}.csv`;
      await sock.sendMessage(jid, { document: Buffer.from(`\ufeff${csv}`, 'utf8'), mimetype: 'text/csv', fileName: file, caption: `📊 Ranking of ${list.length} member(s)` }, { quoted: msg });
    },
  },
  {
    ...base,
    name: 'silence',
    aliases: ['mutemember'],
    adminOnly: true,
    botAdminRequired: true,
    description: 'Delete every message of a member until you unsilence them: silence @user (admins only)',
    async run({ msg, reply, botIds, prefix }) {
      const targets = getTargets(msg).filter((t) => !botIds.includes(num(t)));
      if (!targets.length) return reply(`*Usage:* \`${prefix}silence @person\` _(or reply to their message)_`);
      const keys = targets.map((t) => levels.keyOf(t));
      store.update(msg.key.remoteJid, (g) => {
        for (const k of keys) if (!g.silenced.includes(k)) g.silenced.push(k);
        g.silenceTold = g.silenceTold.filter((k) => !keys.includes(k)); // they are told again the first time they write
      });
      await reply(`🤫 *Silenced*\n*Members:* ${targets.map((t) => `@${num(t)}`).join(' ')}\n_Their messages are deleted. Admins are never affected._\nUndo it with \`${prefix}unsilence\``, { mentions: targets });
    },
  },
  {
    ...base,
    name: 'unsilence',
    aliases: ['unmutemember'],
    adminOnly: true,
    description: 'Let a silenced member write again: unsilence @user (admins only)',
    async run({ msg, reply, prefix }) {
      const targets = getTargets(msg);
      if (!targets.length) return reply(`*Usage:* \`${prefix}unsilence @person\` _(or reply to their message)_`);
      const keys = targets.map((t) => levels.keyOf(t));
      store.update(msg.key.remoteJid, (g) => {
        g.silenced = g.silenced.filter((k) => !keys.includes(k));
        g.silenceTold = g.silenceTold.filter((k) => !keys.includes(k));
      });
      await reply(`🔊 *They can write again*\n*Members:* ${targets.map((t) => `@${num(t)}`).join(' ')}`, { mentions: targets });
    },
  },
  {
    ...base,
    name: 'mutelist',
    aliases: ['silenced'],
    adminOnly: true,
    description: 'Who is silenced in this group (admins only)',
    async run({ sock, jid, reply }) {
      const g = store.getGroup(jid);
      if (!g.silenced.length) return reply('🔊 *Nobody is silenced in this group.*');
      const who = await mentionsLib.describe(sock, jid, g.silenced.map((k) => `${k}@s.whatsapp.net`));
      await reply(`🤫 *Silenced members* (${g.silenced.length})\n\n${who.map((w) => `▸ ${w.text}`).join('\n')}`, { mentions: who.map((w) => w.mention).filter(Boolean) });
    },
  },
];
