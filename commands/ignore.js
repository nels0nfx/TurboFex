const ignored = require('../whatsapp/ignored');
const groups = require('../whatsapp/groups');
const meta = require('../whatsapp/metadata');
const idmap = require('../whatsapp/idmap');
const { num } = require('../whatsapp/utils');

// ignore on / ignore off / ignore        -> this chat
// ignore on 3 / ignore off Football      -> a group (its number from gjids, its id, or part of its name)
// ignore on 27821234567                  -> the private chat with that number
// ignore list                            -> what is ignored
const nameOf = (key) => {
  if (key.endsWith('@g.us')) return (meta.peek(key) && meta.peek(key).subject) || key;
  return `+${num(key)}`;
};

module.exports = {
  name: 'ignore',
  aliases: ['ignorechat'],
  category: 'owner',
  description: 'Make the bot ignore a chat: ignore on / off in the chat, or ignore on 3 (a group number from gjids) or a phone number from anywhere; ignore list (owner only)',
  ownerOnly: true,
  noAgain: true,
  async run({ sock, jid, args, rest, reply, prefix }) {
    const w = (args[0] || '').toLowerCase();

    if (w === 'list') {
      const all = ignored.list();
      if (!all.length) return reply(`📵 *No chat is ignored.*\n▸ \`${prefix}ignore on\` in a chat makes me ignore it.`);
      return reply(`📵 *Ignored chats (${all.length})*\n${all.map((k) => `▸ ${nameOf(k)}`).join('\n')}\n_Switch one back with ${prefix}ignore off <number or name>_`);
    }

    const hasSwitch = w === 'on' || w === 'off';
    const arg = (hasSwitch ? rest.replace(/^\S+\s*/, '') : rest).trim().replace(/^"([^"]*)"$/, '$1');

    let target = jid;
    let label = 'this chat';
    if (arg) {
      const digits = arg.replace(/[^\d]/g, '');
      if (/^\+?[\d\s-]{8,20}$/.test(arg) && digits.length >= 8 && digits.length <= 15) {
        target = `${digits}@s.whatsapp.net`;
        label = `the chat with +${digits}`;
      } else {
        const g = await groups.resolve(sock, arg);
        if (!g) return reply(`⚠️ I could not find "${arg}".\nUse a number from ${prefix}gjids, part of a group name, or a phone number with its country code.`);
        target = g.jid;
        label = g.name;
      }
    }

    const now = ignored.isIgnored(target);
    if (!hasSwitch) {
      return reply(`📵 *${label === 'this chat' ? 'This chat' : label} is ${now ? 'IGNORED' : 'not ignored'}.*\n▸ \`${prefix}ignore on\` / \`${prefix}ignore off\`${arg ? ' ' + arg : ''}\n▸ \`${prefix}ignore list\` shows all of them`);
    }

    const want = w === 'on';
    if (now === want) return reply(`ℹ️ *${label === 'this chat' ? 'This chat' : label} is already ${want ? 'ignored' : 'not ignored'}.*\n▸ Nothing was changed.`);
    ignored.set(target, want);
    return reply(want
      ? `✅ *${label === 'this chat' ? 'This chat is' : label + ' is'} now ignored.*\n▸ _I do nothing there for anyone but you: no commands, no protections, no replies. Your own commands still work._\n▸ Switch it back with \`${prefix}ignore off${arg ? ' ' + arg : ''}\`.`
      : `✅ *${label === 'this chat' ? 'This chat is' : label + ' is'} no longer ignored.*\n▸ _I work there again._`);
  },
};
