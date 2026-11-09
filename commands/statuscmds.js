// WhatsApp Status settings (owner): auto view, auto like, auto save, emojis, delay and where saved statuses go
const store = require('../whatsapp/store');
const { parseDestination } = require('../whatsapp/dest');
const statusEngine = require('../whatsapp/status');
const clock = require('../core/clock');
const { DEFAULT_STATUS_EMOJIS, split: emojiList } = require('../whatsapp/statusemojis');

const base = { category: 'status', ownerOnly: true };

function toggle(name, aliases, key, label, description, note) {
  return {
    ...base, name, aliases, description,
    async run({ args, reply, prefix }) {
      const c = (args[0] || '').toLowerCase();
      if (c !== 'on' && c !== 'off') {
        return reply(`${label} is currently *${store.statusCfg()[key] ? 'ON' : 'OFF'}*.\nUse ${prefix}${name} on  or  ${prefix}${name} off`);
      }
      store.updateStatusCfg((s) => {
        s[key] = c === 'on';
      });
      return reply(`✅ ${label} is now *${c.toUpperCase()}*.${c === 'on' && note ? `\n${note}` : ''}`);
    },
  };
}


module.exports = [
  toggle('autoviewstatus', ['viewstatus'], 'view', 'Auto view status', 'Automatically view everybody\'s WhatsApp statuses: autoviewstatus on / off', 'Use ' + 'statusdelay to wait a little before viewing.'),
  toggle('autolikestatus', ['likestatus'], 'like', 'Auto like status', 'Automatically react to statuses with a heart or your own emojis: autolikestatus on / off', 'Choose the emojis with statusemoji.'),
  toggle('autosavestatus', ['savestatus'], 'save', 'Auto save status', 'Copy pictures, videos and texts of statuses to your chat (or another chat): autosavestatus on / off', 'They are sent to your own chat unless you set another with statusjid.'),
  {
    ...base,
    name: 'statusemoji',
    description: 'Emojis used for auto like: statusemoji ❤️ 🔥 😂 (any number, one is picked at random each time, reset = back to the default list)',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`💖 Auto-like emojis: ${store.statusCfg().emojis.join(' ')}\nChange them: ${prefix}statusemoji ❤️ 🔥 😂`);
      if (rest.toLowerCase() === 'reset') {
        store.updateStatusCfg((s) => {
          s.emojis = [...DEFAULT_STATUS_EMOJIS];
          s.emojisSet = false;
        });
        return reply(`✅ Back to the default list (${DEFAULT_STATUS_EMOJIS.length} emojis).`);
      }
      const list = emojiList(rest); // no limit on how many
      if (!list.length) return reply('⚠️ I could not find any emoji in that. Example: statusemoji ❤️ 🔥 😂');
      store.updateStatusCfg((s) => {
        s.emojis = list;
        s.emojisSet = true;
      });
      return reply(`✅ Auto-like emojis: ${list.join(' ')}`);
    },
  },
  {
    ...base,
    name: 'statuslimit',
    description: 'Most statuses the bot likes per day (it keeps viewing after that): statuslimit 200, statuslimit off',
    async run({ args, reply, prefix }) {
      const cfg = store.statusCfg();
      const a = (args[0] || '').toLowerCase();
      if (!a) return reply(`*Daily like limit:* ${cfg.dailyLikeLimit || 'none'}\n▸ Liked today: ${statusEngine.likeToday()}\n▸ Change it: \`${prefix}statuslimit 200\` or \`${prefix}statuslimit off\`\n_A limit protects the account: nobody likes hundreds of statuses a day._`);
      if (['off', '0', 'none'].includes(a)) {
        store.updateStatusCfg((s) => {
          s.dailyLikeLimit = 0;
        });
        return reply('*Daily like limit is OFF.*\n_Liking a very large number of statuses can get the account limited by WhatsApp._');
      }
      const n = parseInt(a, 10);
      if (!Number.isFinite(n) || n < 1 || n > 5000) return reply(`⚠️ Use a number between 1 and 5000, e.g. ${prefix}statuslimit 200`);
      store.updateStatusCfg((s) => {
        s.dailyLikeLimit = n;
      });
      return reply(`✅ The bot will like at most *${n}* statuses per day.`);
    },
  },
  {
    ...base,
    name: 'statusdelay',
    description: 'Wait before viewing/liking a status: statusdelay 5 (5 seconds), statusdelay 3 10 (random 3-10 s), statusdelay off',
    async run({ args, reply, prefix }) {
      const cfg = store.statusCfg();
      if (!args[0]) {
        const d = cfg.delayMax > cfg.delayMin ? `${cfg.delayMin}-${cfg.delayMax} seconds (random)` : cfg.delayMin ? `${cfg.delayMin} seconds` : 'none (instant)';
        return reply(`⏱️ Status delay: *${d}*\nChange it: ${prefix}statusdelay 5  or  ${prefix}statusdelay 3 10  or  ${prefix}statusdelay off`);
      }
      if (['off', '0', 'none'].includes(args[0].toLowerCase())) {
        store.updateStatusCfg((s) => {
          s.delayMin = 0;
          s.delayMax = 0;
        });
        return reply('✅ Statuses are handled instantly.');
      }
      const a = parseFloat(args[0]);
      const b = args[1] != null ? parseFloat(args[1]) : a;
      if (![a, b].every((n) => Number.isFinite(n) && n >= 0 && n <= 600)) return reply('⚠️ Use seconds between 0 and 600, e.g. statusdelay 5 or statusdelay 3 10');
      store.updateStatusCfg((s) => {
        s.delayMin = Math.min(a, b);
        s.delayMax = Math.max(a, b);
      });
      return reply(a === b ? `✅ I will wait ${a} seconds before handling a status.` : `✅ I will wait a random ${Math.min(a, b)}-${Math.max(a, b)} seconds.`);
    },
  },
  {
    ...base,
    name: 'statusreply',
    aliases: ['savereply', 'replysave'],
    description: 'Save a status when you reply to it: statusreply on / off (it goes to the chat from statusjid)',
    async run({ args, reply, prefix }) {
      const c = (args[0] || '').toLowerCase();
      const cfg = store.statusCfg();
      if (c !== 'on' && c !== 'off') {
        return reply(`📥 *Save a status when you reply to it:* ${cfg.saveReply ? 'ON' : 'OFF'}\n▸ When it is on, every status you reply to (from your phone) is saved and sent to ${cfg.saveTo || 'your own chat'}. Nothing is sent or reacted in the chat where you replied.\n▸ \`${prefix}statusreply on\` / \`${prefix}statusreply off\`\n▸ Choose where with \`${prefix}statusjid\``);
      }
      store.updateStatusCfg((s) => {
        s.saveReply = c === 'on';
      });
      return reply(c === 'on' ? `✅ *Replying to a status now saves it.*\n▸ Saved statuses go to ${cfg.saveTo || 'your own chat'} (change it with \`${prefix}statusjid\`).\n▸ WhatsApp only gives the bot the statuses of people saved as contacts.` : '✅ Replying to a status no longer saves it.');
    },
  },
  {
    ...base,
    name: 'statusjid',
    description: 'Where saved statuses are sent: statusjid here / me / a number / a group (number from gjids)',
    async run({ sock, jid, rest, reply, prefix }) {
      const cfg = store.statusCfg();
      if (!rest) return reply(`📥 Saved statuses go to: ${cfg.saveTo || 'your own chat (default)'}\nChange: ${prefix}statusjid here | me | 27821234567 | 3 (group number from ${prefix}gjids)`);
      const d = await parseDestination(sock, rest, jid);
      if (d.error) return reply('⚠️ I could not find that chat. Use here, me, a phone number, a group id, or a group number from gjids.');
      store.updateStatusCfg((s) => {
        s.saveTo = d.jid;
      });
      return reply(d.jid ? `✅ Saved statuses will go to ${d.name || d.jid}` : '✅ Saved statuses go to your own chat again.');
    },
  },
  {
    ...base,
    name: 'statusinfo',
    description: 'Show all status settings',
    async run({ reply }) {
      const s = store.statusCfg();
      const st = statusEngine.stats;
      const delay = s.delayMax > s.delayMin ? `${s.delayMin}-${s.delayMax}s random` : s.delayMin ? `${s.delayMin}s` : 'none';
      const on = (v) => (v ? 'ON' : 'OFF');
      await reply(
        `*Status settings*\n` +
          `▸ *Auto view:* ${on(s.view)}\n` +
          `▸ *Auto like:* ${on(s.like)} (${s.emojis.join(' ')})\n` +
          `▸ *Auto save:* ${on(s.save)}\n` +
          `▸ *Delay before liking:* ${delay}\n` +
          `▸ *Daily like limit:* ${s.dailyLikeLimit || 'none'}\n` +
          `▸ *Saved to:* ${s.saveTo || 'your own chat'}\n\n` +
          `*Since the bot started*\n` +
          `▸ *Received:* ${st.seen}${st.last ? ` (last ${clock.stamp(st.last)})` : ''}\n` +
          `▸ *Viewed:* ${st.viewed}  *Liked:* ${st.liked}  *Saved:* ${st.saved}\n` +
          `▸ *Likes today:* ${statusEngine.likeToday()}/${s.dailyLikeLimit || '∞'}\n` +
          `▸ *Refused by WhatsApp:* ${st.rejected}\n` +
          `▸ *Like route:* ${st.route}\n` +
          `▸ *Problems:* ${st.errors}${st.lastError ? ` (last: ${st.lastError})` : ''}` +
          `${st.viewMs != null ? `\n▸ *View took:* ${st.viewMs} ms` : ''}` +
          `${st.lagSec != null ? `\n▸ *Last status reached the bot:* ${st.lagSec}s after it was posted` : ''}` +
          (st.seen ? '' : `\n\n_No status has arrived yet. WhatsApp only sends the bot the statuses of people saved as contacts on the bot's phone._`)
      );
    },
  },
];
