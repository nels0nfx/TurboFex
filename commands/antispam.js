const store = require('../whatsapp/store');

const MODES = ['off', 'delete', 'warn', 'kick'];
const int = (v, min, max) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

module.exports = {
  name: 'antispam',
  category: 'group',
  description: 'Stop members flooding the chat: antispam off / delete / warn / kick, limit, seconds, repeat (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run(ctx) {
    const { jid, args, reply, prefix, isBotAdmin } = ctx;
    const w = (args[0] || '').toLowerCase();
    const g = store.getGroup(jid);
    const set = (fn) => store.update(jid, fn);

    if (w === 'limit') {
      const n = int(args[1], 2, 30);
      if (!n) return reply(`⚠️ *Choose a number from 2 to 30.* Example: \`${prefix}antispam limit 6\``);
      set((x) => { x.antispamLimit = n; });
      return reply(`✅ *Anti-spam limit set.*\n*Trigger:* ${n} messages in ${g.antispamSeconds} seconds`);
    }
    if (w === 'seconds' || w === 'time' || w === 'window') {
      const n = int(args[1], 2, 120);
      if (!n) return reply(`⚠️ *Choose a number from 2 to 120.* Example: \`${prefix}antispam seconds 8\``);
      set((x) => { x.antispamSeconds = n; });
      return reply(`✅ *Anti-spam time set.*\n*Trigger:* ${g.antispamLimit} messages in ${n} seconds`);
    }
    if (w === 'repeat') {
      const off = /^(off|0|no)$/i.test(args[1] || '');
      const n = off ? 0 : int(args[1], 2, 10);
      if (n === null) return reply(`⚠️ *Choose 2 to 10, or off.* Example: \`${prefix}antispam repeat 4\` _(the same text 4 times in a row)_`);
      set((x) => { x.antispamRepeat = n; });
      return reply(n ? `✅ *Repeated text is now checked.*\n_The same message ${n} times within ${g.antispamSeconds} seconds counts as spam._` : '✅ *Repeated text is no longer checked.*');
    }
    if (w === 'reset') {
      set((x) => { x.antispamLimit = 6; x.antispamSeconds = 8; x.antispamRepeat = 0; });
      return reply('✅ *Anti-spam settings are back to the default:* 6 messages in 8 seconds.');
    }
    if (w === 'on' || MODES.includes(w)) {
      const mode = w === 'on' ? 'warn' : w;
      set((x) => { x.antispamMode = mode; x.antispam = mode !== 'off'; });
      await reply(`✅ *Anti-spam is now ${mode.toUpperCase()}.*${mode === 'warn' ? `\n_Flooders are warned, and removed after ${store.getLimit(jid)} warnings._` : mode === 'kick' ? '\n_Flooders are removed straight away._' : mode === 'delete' ? '\n_Only the flooding messages are deleted._' : ''}`);
      if (mode !== 'off' && !isBotAdmin) await reply('⚠️ *Note:* I must be a group admin to delete messages and remove people.');
      return;
    }

    await reply(
      `⚡ *Anti-spam*\n*Action:* ${g.antispamMode.toUpperCase()}\n*Trigger:* ${g.antispamLimit} messages in ${g.antispamSeconds} seconds\n` +
        `*Repeated text:* ${g.antispamRepeat ? `${g.antispamRepeat} times in a row` : 'not checked'}\n\n` +
        `*What happens to a flooder:*\n▸ \`${prefix}antispam delete\` – delete their messages\n▸ \`${prefix}antispam warn\` – delete and warn (removed after ${store.getLimit(jid)} warnings)\n▸ \`${prefix}antispam kick\` – delete and remove straight away\n▸ \`${prefix}antispam off\`\n\n` +
        `*How strict:*\n▸ \`${prefix}antispam limit 6\` – how many messages\n▸ \`${prefix}antispam seconds 8\` – within how many seconds\n▸ \`${prefix}antispam repeat 4\` – the same text this many times _(or off)_\n▸ \`${prefix}antispam reset\`\n\n` +
        `_Admins are never affected. Change the warning limit with_ \`${prefix}warnlimit\``
    );
  },
};
