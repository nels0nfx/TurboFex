// Choose which command a sticker runs when the owner sends it (owner only)
const store = require('../whatsapp/store');
const stickercmd = require('../whatsapp/stickercmd');
const { getQuoted } = require('../whatsapp/utils');
const { peel } = require('../whatsapp/unwrap');

const quotedSticker = (msg) => {
  const q = getQuoted(msg);
  return q ? peel(q.message).content.stickerMessage || null : null;
};
const SELF = new Set(['setstickercmd', 'delstickercmd', 'stickercmds']);
const find = (list, name) => list.find((c) => c.name === name || (c.aliases || []).includes(name));

module.exports = [
  {
    name: 'setstickercmd',
    aliases: ['stickercmd', 'bindsticker'],
    category: 'owner',
    ownerOnly: true,
    description: 'Make a sticker run a command when you send it: reply to the sticker with setstickercmd vv (vv works silently)',
    async run({ msg, args, reply, prefix, commandList }) {
      const sticker = quotedSticker(msg);
      const name = (args[0] || '').toLowerCase().replace(/^[^a-z0-9]+/, '');
      if (!sticker || !name) {
        return reply(`🎯 *Sticker command*\n▸ Reply to a sticker with \`${prefix}setstickercmd <command>\`.\n▸ Example: \`${prefix}setstickercmd vv\`. From then on, when *you* send that sticker as a reply to a view-once message, I open it *silently* (no answer, no reaction) and send it to the view-once chat (\`${prefix}viewoncejid\`).\n▸ Any command can be used, for example \`${prefix}setstickercmd ping\` (those answer normally).\n▸ \`${prefix}stickercmds\` shows them, \`${prefix}delstickercmd\` removes one.`);
      }
      const cmd = find(commandList, name);
      if (!cmd || SELF.has(cmd.name)) return reply(`⚠️ I do not have a command called *${name}*. Use \`${prefix}list\` to see them.`);
      const key = stickercmd.keyOf(sticker);
      if (!key) return reply('⚠️ I could not read that sticker. Send it again and reply to the new one.');
      store.setStickerCmd(key, { cmd: cmd.name, args: args.slice(1).join(' ') });
      return reply(`✅ *Sticker saved.*\n▸ When you send this sticker, I run *${cmd.name}*${args.length > 1 ? ` ${args.slice(1).join(' ')}` : ''}.${cmd.silentOnSticker ? '\n▸ It works silently: no answer and no reaction in the chat. Copies go to the chat chosen with `' + prefix + 'viewoncejid`.' : ''}\n▸ Only you can use it.`);
    },
  },
  {
    name: 'delstickercmd',
    aliases: ['unbindsticker'],
    category: 'owner',
    ownerOnly: true,
    description: 'Remove a sticker command: reply to the sticker with delstickercmd, or delstickercmd <command> for all stickers of a command',
    async run({ msg, args, reply, prefix }) {
      const sticker = quotedSticker(msg);
      if (sticker) {
        const gone = store.delStickerCmd(stickercmd.keyOf(sticker));
        return reply(gone ? '✅ That sticker does not run a command any more.' : 'ℹ️ That sticker had no command.');
      }
      const name = (args[0] || '').toLowerCase();
      if (!name) return reply(`Reply to the sticker with \`${prefix}delstickercmd\`, or use \`${prefix}delstickercmd <command>\` to remove every sticker of that command.`);
      const all = store.getStickerCmds();
      const keys = Object.keys(all).filter((k) => all[k].cmd === name);
      keys.forEach((k) => store.delStickerCmd(k));
      return reply(keys.length ? `✅ Removed ${keys.length} sticker${keys.length === 1 ? '' : 's'} of *${name}*.` : `ℹ️ No sticker runs *${name}*.`);
    },
  },
  {
    name: 'stickercmds',
    category: 'owner',
    ownerOnly: true,
    description: 'List the stickers that run commands',
    async run({ reply, prefix }) {
      const all = Object.values(store.getStickerCmds());
      if (!all.length) return reply(`🎯 No sticker runs a command yet.\n▸ Reply to a sticker with \`${prefix}setstickercmd vv\`.`);
      const count = {};
      for (const b of all) count[b.cmd] = (count[b.cmd] || 0) + 1;
      return reply(`🎯 *Sticker commands*\n${Object.entries(count).map(([c, n]) => `▸ ${c}: ${n} sticker${n === 1 ? '' : 's'}`).join('\n')}\n\n_Remove one: reply to the sticker with ${prefix}delstickercmd_`);
    },
  },
];
