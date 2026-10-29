// Owner automation: autotyping, autorecording, alwaysonline, autoread, autobio, autoreact, pmblocker
const store = require('../whatsapp/store');
const presence = require('../whatsapp/presence');

const base = { category: 'owner', ownerOnly: true, needs: [], weight: 'light' };
const word = (args) => (args[0] || '').toLowerCase();
const state = (v) => (v ? 'ON' : 'OFF');

// the common on/off command
const toggle = (name, key, label, about, aliases = [], after = null) => ({
  ...base,
  name,
  aliases,
  description: `${about} (on / off)`,
  async run({ args, reply, prefix, sock, jid }) {
    const w = word(args);
    if (w === 'test' && (key === 'typing' || key === 'recording')) {
      const report = [];
      await presence.indicate(sock, jid, key === 'recording' ? 'recording' : 'composing', { hold: 3000, report });
      return reply(`🔬 *${label} test* (watch the other side of this chat for 5 seconds)\n${report.join('\n')}\n\n_A ❌ line shows what WhatsApp refused. Send it to me._`);
    }
    const placeText = { dms: 'private chats', groups: 'groups', all: 'private chats and groups' };
    if (w === 'where' && (key === 'typing' || key === 'recording')) {
      const to = { dms: 'dms', dm: 'dms', private: 'dms', groups: 'groups', group: 'groups', all: 'all' }[(args[1] || '').toLowerCase()];
      if (!to) return reply(`*Usage:* \`${prefix}${name} where dms\` _(dms, groups or all)_\nWhere the bot shows it when someone writes to it. Commands always show it.`);
      store.setAuto('presenceWhere', to);
      return reply(`✅ *${label} shows in ${placeText[to]}.*`);
    }
    if (w !== 'on' && w !== 'off') {
      const where = store.getAuto('presenceWhere', 'dms');
      return reply(`⚙️ *${label}*\n*Status:* ${state(store.getAuto(key))}${key === 'typing' || key === 'recording' ? `\n*Shows in:* ${placeText[where]}` : ''}\n_${about}_\n\n*Use:* \`${prefix}${name} on\` or \`${prefix}${name} off\`${key === 'typing' || key === 'recording' ? `\n\`${prefix}${name} where dms\` _(dms, groups, all)_` : ''}`);
    }
    store.setAuto(key, w === 'on');
    if (after) after(sock, w === 'on');
    await reply(`✅ *${label} is now ${state(w === 'on')}.*`);
  },
});

module.exports = [
  toggle('autotyping', 'typing', 'Auto typing', 'Shows "typing..." when someone writes to the bot and while it answers', ['typing'], (s, on) => on && store.setAuto('recording', false)),
  toggle('autorecording', 'recording', 'Auto recording', 'Shows "recording audio..." when someone writes to the bot and while it answers', ['recording'], (s, on) => on && store.setAuto('typing', false)),
  toggle('alwaysonline', 'online', 'Always online', 'Keeps the bot showing as online', ['online'], (sock, on) => {
    presence.apply(sock);
    if (!on) sock.sendPresenceUpdate('unavailable').catch(() => {});
  }),
  toggle('autoread', 'read', 'Auto read', 'Marks every message the bot receives as read (blue ticks)', ['read']),
  {
    ...base,
    name: 'autobio',
    description: 'Keep the bot bio updated with the time: autobio on / off / set <text with {time} {date}>',
    async run({ args, rest, reply, prefix, sock }) {
      const cfg = store.getAuto('bio') || { on: false, text: null };
      const w = word(args);
      if (w === 'set') {
        const text = rest.replace(/^set\s*/i, '').trim();
        if (!text) return reply(`*Usage:* \`${prefix}autobio set 🤖 Online • {time} • {date}\``);
        store.setAuto('bio', { ...cfg, text: text.slice(0, 139) });
        presence.apply(sock);
        return reply(`✅ *Bio text saved.*\n*It reads:* ${presence.fillBio(text)}${cfg.on ? '' : `\n_Turn it on with_ \`${prefix}autobio on\``}`);
      }
      if (w === 'on' || w === 'off') {
        store.setAuto('bio', { ...cfg, on: w === 'on' });
        presence.apply(sock);
        return reply(`✅ *Auto bio is now ${state(w === 'on')}.*${w === 'on' ? '\n_It updates every 10 minutes._' : ''}`);
      }
      await reply(`📝 *Auto bio*\n*Status:* ${state(cfg.on)}\n*Text:* ${cfg.text || presence.DEFAULT_BIO}\n\n▸ \`${prefix}autobio on\` / \`${prefix}autobio off\`\n▸ \`${prefix}autobio set <text>\` _(use {time}, {date}, {day})_`);
    },
  },
  {
    ...base,
    name: 'autoreact',
    description: 'React to messages with an emoji, in groups, private chats or chosen chats: autoreact on / where / add',
    async run({ args, jid, msg, reply, prefix, isGroup }) {
      const cfg = store.getAuto('react') || { on: false, emojis: [], scope: 'all', chats: [], people: [] };
      const save = (patch) => store.setAuto('react', { ...cfg, ...patch });
      const w = word(args);
      const names = require('../whatsapp/names');
      const { resolveTarget, num } = require('../whatsapp/utils');
      const levels = require('../whatsapp/levels');
      const scopeText = { all: 'everywhere (groups and private chats)', groups: 'in groups only', dms: 'in private chats only', selected: 'only in the chats and for the people you chose' };

      if (w === 'on' || w === 'off') {
        save({ on: w === 'on' });
        return reply(`✅ *Auto react is now ${state(w === 'on')}.*${w === 'on' ? `\n*Works:* ${scopeText[cfg.scope || 'all']}\n_At most one reaction every 20 seconds in each chat._` : ''}`);
      }
      if (w === 'where') {
        const to = { all: 'all', everywhere: 'all', groups: 'groups', group: 'groups', dms: 'dms', dm: 'dms', private: 'dms', selected: 'selected', chosen: 'selected', contacts: 'selected' }[(args[1] || '').toLowerCase()];
        if (!to) return reply(`*Usage:* \`${prefix}autoreact where groups\`\n▸ \`all\` – groups and private chats\n▸ \`groups\` – groups only\n▸ \`dms\` – private chats only\n▸ \`selected\` – only the chats and people you add with \`${prefix}autoreact add\``);
        save({ scope: to });
        return reply(`✅ *Auto react works ${scopeText[to]}.*${to === 'selected' && !(cfg.chats?.length || cfg.people?.length) ? `\n_Nothing is chosen yet. Add a chat or a person:_ \`${prefix}autoreact add\`` : ''}`);
      }
      if (w === 'add' || w === 'remove') {
        // "add" in a chat = this chat; "add 2348012345678" or a tag or a reply = that person
        const target = resolveTarget(msg, args.slice(1));
        const chats = new Set(cfg.chats || []);
        const people = new Set(cfg.people || []);
        let label;
        if (target) {
          const key = levels.keyOf(target);
          if (w === 'add') people.add(key); else people.delete(key);
          label = `the person @${num(target)}`;
        } else {
          if (w === 'add') chats.add(jid); else chats.delete(jid);
          label = `this ${isGroup ? 'group' : 'chat'}`;
        }
        save({ chats: [...chats].slice(-200), people: [...people].slice(-200) });
        return reply(`✅ *${w === 'add' ? 'Added' : 'Removed'}:* ${label}\n_Use_ \`${prefix}autoreact where selected\` _so it works only for the chosen ones._`, target ? { mentions: [target] } : {});
      }
      if (w === 'list') {
        const chats = (cfg.chats || []).map((c) => `▸ ${c.endsWith('@g.us') ? '👥 group' : '💬 chat'} ${c.split('@')[0].slice(-6)}`);
        const people = (cfg.people || []).map((k) => `▸ 👤 ${names.get(`${k}@s.whatsapp.net`) || `+${k}`}`);
        return reply(`📋 *Auto react list*\n${[...chats, ...people].join('\n') || '_Nobody and no chat added yet._'}`);
      }
      if (w === 'emojis') {
        const list = args.slice(1).filter((e) => e.length <= 8).slice(0, 12);
        if (!list.length) return reply(`*Usage:* \`${prefix}autoreact emojis ❤️ 😂 🔥\` _(or "reset")_`);
        save({ emojis: /^reset$/i.test(list[0]) ? [] : list });
        return reply(/^reset$/i.test(list[0]) ? '✅ *Back to the default emojis.*' : `✅ *Emojis saved:* ${list.join(' ')}`);
      }
      await reply(
        `😀 *Auto react*\n*Status:* ${state(cfg.on)}\n*Works:* ${scopeText[cfg.scope || 'all']}\n*Emojis:* ${(cfg.emojis?.length ? cfg.emojis : presence.DEFAULT_EMOJIS).join(' ')}\n` +
          `*Chosen:* ${(cfg.chats || []).length} chat(s), ${(cfg.people || []).length} person(s)\n\n` +
          `▸ \`${prefix}autoreact on\` / \`${prefix}autoreact off\`\n▸ \`${prefix}autoreact where groups\` _(all, groups, dms, selected)_\n` +
          `▸ \`${prefix}autoreact add\` – this chat _(or a number, a tag, a reply)_\n▸ \`${prefix}autoreact remove\`\n▸ \`${prefix}autoreact list\`\n▸ \`${prefix}autoreact emojis ❤️ 😂 🔥\``
      );
    },
  },
  {
    ...base,
    name: 'pmblocker',
    aliases: ['pmblock', 'antipm'],
    description: 'Strangers writing to the bot in private: pmblocker off / warn / block / allow',
    async run({ args, msg, jid, isGroup, reply, prefix }) {
      const w = word(args);
      const { resolveTarget, num } = require('../whatsapp/utils');
      const names = require('../whatsapp/names');
      if (w === 'allow' || w === 'deny') {
        const target = resolveTarget(msg, args.slice(1)) || (isGroup ? null : jid);
        if (!target) return reply(`*Usage:* \`${prefix}pmblocker ${w} 2348012345678\`\n_Or write it inside the private chat of that person._`);
        const changed = w === 'allow' ? presence.allow(target) : presence.deny(target);
        const who = `@${num(target)}`;
        return reply(w === 'allow' ? `✅ ${who} *is allowed to write to the bot in private.*${changed ? '' : '\n_They were already allowed._'}` : `✅ ${who} *is no longer on the allowed list.*${changed ? '' : '\n_They were not on it._'}`, { mentions: [target] });
      }
      if (w === 'list') {
        const list = presence.allowedList();
        return reply(`📋 *Allowed in private* (${list.length})\n${list.slice(-30).map((k) => `▸ ${names.get(`${k}@s.whatsapp.net`) || `+${k}`}`).join('\n') || '_Nobody yet._'}`);
      }
      if (!['off', 'warn', 'block'].includes(w)) {
        const cur = store.getAuto('pm', 'off');
        return reply(
          `🚫 *Private message blocker*\n*Status:* ${cur.toUpperCase()}\n\n` +
            `▸ \`${prefix}pmblocker warn\` – tell strangers the bot does not answer private messages (once a day)\n` +
            `▸ \`${prefix}pmblocker block\` – warn, and block them if they write again\n` +
            `▸ \`${prefix}pmblocker off\`\n▸ \`${prefix}pmblocker allow\` – let a person write to the bot _(a number, a tag, or inside their chat)_\n▸ \`${prefix}pmblocker deny\` / \`${prefix}pmblocker list\`\n\n` +
            `*Never treated as strangers:* you and your sudo users, people in your phone contacts, and anyone you have written to in a private chat. Groups are not affected.`
        );
      }
      store.setAuto('pm', w);
      await reply(`✅ *Private message blocker is now ${w.toUpperCase()}.*`);
    },
  },
];
