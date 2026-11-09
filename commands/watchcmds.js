// Auto view-once, anti-delete, anti-edit: a mode each, and a destination chat each (owner only)
const store = require('../whatsapp/store');
const { parseDestination } = require('../whatsapp/dest');

const MODES = { all: 'everywhere', dm: 'private chats only', group: 'groups only' };

function modeCommand(name, aliases, key, label, description, note) {
  return {
    name, aliases, category: 'watch', ownerOnly: true, description,
    async run({ args, reply, prefix, sock }) {
      let c = (args[0] || '').toLowerCase();
      if (key === 'viewonce' && c === 'guess') {
        const on = (args[1] || '').toLowerCase() !== 'off';
        store.updateWatch('viewonce', (w) => {
          w.guess = on;
        });
        return reply(on ? '✅ *Hidden pictures and videos are kept.*\n▸ A file that arrives without its content and that your phone then sends is copied, labelled *Hidden*, because it may have been a view-once.' : '✅ *Only real view-once files are kept.*\n▸ A hidden file that your phone sends without the view-once flag is ignored.');
      }
      if (c === 'on') c = 'all';
      const cfg = store.watchCfg(key);
      if (!['off', ...Object.keys(MODES)].includes(c)) {
        return reply(
          `${label} is *${cfg.mode === 'off' ? 'OFF' : `ON (${MODES[cfg.mode]})`}*\nCopies go to: ${cfg.to === 'chat' ? 'the same chat where it happened' : cfg.to || 'your own chat'}\n\n` +
            `${prefix}${name} all - everywhere\n${prefix}${name} dm - private chats only\n${prefix}${name} group - groups only\n${prefix}${name} off - switch off`
        );
      }
      store.updateWatch(key, (w) => {
        w.mode = c;
      });
      await reply(c === 'off' ? `✅ ${label} is now *OFF*.` : `✅ ${label} is now *ON* (${MODES[c]}).\n${note}`);
      const warning = key === 'viewonce' && c !== 'off' ? require('../whatsapp/identity').viewOnceNote(sock, prefix) : '';
      if (warning) await reply(warning);
      return undefined;
    },
  };
}

function destCommand(name, key, label) {
  return {
    name, category: 'watch', ownerOnly: true,
    description: `Choose where the ${label} copies are sent: ${name} chat (the chat where it happened) / here / me / a number / a group (number from gjids)`,
    async run({ sock, jid, rest, reply, prefix }) {
      const cfg = store.watchCfg(key);
      if (!rest) {
        return reply(`📨 ${label} copies go to: ${cfg.to === 'chat' ? 'the same chat where it happened' : cfg.to || 'your own chat (default)'}\n\nChange it:\n${prefix}${name} chat  (the chat where it happened, so everybody there sees it)\n${prefix}${name} here  (this chat, always)\n${prefix}${name} me  (back to your own chat)\n${prefix}${name} 27821234567  (a person)\n${prefix}${name} 3  (group number from ${prefix}gjids)\n${prefix}${name} 1203630...@g.us  (a group id)`);
      }
      if (['chat', 'same', 'origin', 'source'].includes(rest.trim().toLowerCase())) {
        store.updateWatch(key, (w) => {
          w.to = 'chat';
        });
        return reply(`✅ ${label} copies will be sent to *the chat where it happened*.\n▸ Everybody in that chat will see the copy. Use \`${prefix}${name} me\` to get it back in your own chat.`);
      }
      const d = await parseDestination(sock, rest, jid);
      if (d.error) return reply('⚠️ I could not find that chat. Use chat, here, me, a phone number, a group id, or a group number from gjids.');
      store.updateWatch(key, (w) => {
        w.to = d.jid;
      });
      return reply(d.jid ? `✅ ${label} copies will be sent to ${d.name || d.jid}` : `✅ ${label} copies go to your own chat again.`);
    },
  };
}

module.exports = [
  modeCommand('autoviewonce', ['autovv'], 'viewonce', 'Auto view-once', 'Keep a copy of view-once pictures, videos and voice notes people send you: autoviewonce all / dm / group / off', 'Use it only for things that were sent to you. Choose where copies go with viewoncejid.'),
  modeCommand('antidelete', [], 'delete', 'Anti-delete', 'Show messages people delete (text, pictures, videos, voice notes, stickers): antidelete all / dm / group / off', 'I only know messages that arrive while this is ON. Choose where copies go with deletejid.'),
  modeCommand('antiedit', [], 'edit', 'Anti-edit', 'Show what a message said before it was edited: antiedit all / dm / group / off', 'I only know messages that arrive while this is ON. Choose where copies go with editjid.'),
  destCommand('viewoncejid', 'viewonce', 'View-once'),
  destCommand('deletejid', 'delete', 'Deleted-message'),
  destCommand('editjid', 'edit', 'Edited-message'),
];
