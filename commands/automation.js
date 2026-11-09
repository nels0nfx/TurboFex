// Owner automation: autotyping, autorecording, alwaysonline, autoread, autobio, autoreact, pmblocker
const store = require('../whatsapp/store');
const presence = require('../whatsapp/presence');
const cleanup = require('../whatsapp/cmdcleanup');

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
  {
    ...base,
    name: 'phonepush',
    aliases: ['notifications', 'pushfix'],
    description: 'Why the phone gets no message notifications, and fix it: phonepush / phonepush fix',
    async run({ args, reply, prefix, sock }) {
      const culprits = [
        ['alwaysonline', 'online', 'Always online', 'WhatsApp sends no notifications to the phone while a linked device is online'],
        ['autoread', 'read', 'Auto read', 'the bot marks every message as read, so the phone shows it as already read and gives no notification'],
      ];
      if (word(args) === 'fix') {
        for (const [, key] of culprits) store.setAuto(key, false);
        presence.apply(sock);
        return reply('✅ *Done.* Always online and Auto read are OFF, and the bot shows as offline.\n▸ Notifications on the phone should come back within a few minutes.\n_Auto typing stays as you set it: it goes online only for a few seconds, then offline again._');
      }
      const lines = culprits.map(([name, key, label, why]) => `${store.getAuto(key) ? '🔴' : '🟢'} *${label}:* ${state(store.getAuto(key))}${store.getAuto(key) ? `\n   _${why}_` : ''}`);
      const typing = store.getAuto('typing') || store.getAuto('recording');
      return reply(`🔔 *Phone notifications*\n${lines.join('\n')}\n${typing ? '🟡 *Auto typing / recording:* ON\n   _goes online for a few seconds each time, then offline_\n' : ''}\n▸ \`${prefix}phonepush fix\` turns off Always online and Auto read.\n▸ Also check on the iPhone: Settings > Notifications > WhatsApp (allow notifications, Lock Screen, Banners), Focus modes, and in WhatsApp: Settings > Notifications.`);
    },
  },
  {
    ...base,
    name: 'delcmd',
    aliases: ['autodelcmd', 'cleancmd'],
    description: 'Cleans up SETTINGS commands in groups (not menu, games and the like): delcmd own / all / off, reply on / off, time 1s, list / add / remove <command>',
    async run({ args, reply, prefix, commandList }) {
      const w = word(args);
      const text = { own: 'the commands typed on the bot account (yours) and the answers to them', all: 'every command, also the ones of members (the bot must be a group admin, to delete their messages), and the answers', off: 'nothing is deleted' };
      const secs = cleanup.seconds();
      const secText = (n) => `${n} ${n === 1 ? 'second' : 'seconds'}`;
      const show = () => `🧹 *Clean up groups after SETTINGS commands*\n_Only commands that change a setting (antilink on, setrules, welcome set, captcha time...) are cleaned. Menu, ping, rules, rank, tagall, downloads, stickers and every game stay._\n*Commands:* ${cleanup.mode().toUpperCase()}: ${text[cleanup.mode()]}\n*Bot answers:* ${cleanup.replyOn() ? `deleted ${secs === 1 ? 'as soon as they are sent (1 second)' : `${secText(secs)} after they are sent`}` : 'kept'}\n\n▸ \`${prefix}delcmd own\` / \`${prefix}delcmd all\` / \`${prefix}delcmd off\`\n▸ \`${prefix}delcmd reply on\` / \`${prefix}delcmd reply off\`\n▸ \`${prefix}delcmd time 30s\` (1 second to 1 hour, also 2m or 1h)\n▸ \`${prefix}delcmd list\` shows what is cleaned, \`${prefix}delcmd add menu\` / \`${prefix}delcmd remove captcha\` change it`;
      if (w === 'list') {
        const names = (set) => [...set].sort().map((n) => `${prefix}${n}`).join(', ');
        return reply(`🧹 *Cleaned in groups*\n*Settings (when something is written after them):*\n${names(cleanup.SETTINGS_WITH_ARGS)}\n\n*Switches (always):* ${names(cleanup.SETTINGS_ALWAYS)}\n${cleanup.extra().length ? `\n*Added by you (always):* ${cleanup.extra().map((n) => prefix + n).join(', ')}\n` : ''}${cleanup.skipped().length ? `\n*Left alone by you:* ${cleanup.skipped().map((n) => prefix + n).join(', ')}\n` : ''}\n_Games are never cleaned._`);
      }
      if (w === 'add' || w === 'remove') {
        const q = (args[1] || '').toLowerCase().replace(/^[^a-z0-9]+/, '');
        const found = (commandList || []).find((c) => c.name === q || (c.aliases || []).includes(q));
        if (!found) return reply(`*Usage:* \`${prefix}delcmd ${w} <command>\`, for example \`${prefix}delcmd ${w} ${w === 'add' ? 'tagall' : 'captcha'}\``);
        if (cleanup.isGame(found)) return reply('⚠️ *Games are never cleaned up.*');
        const add = new Set(cleanup.extra());
        const skip = new Set(cleanup.skipped());
        if (w === 'add') {
          add.add(found.name);
          skip.delete(found.name);
        } else {
          add.delete(found.name);
          skip.add(found.name);
        }
        store.setAuto('delcmdAdd', [...add]);
        store.setAuto('delcmdSkip', [...skip]);
        return reply(w === 'add' ? `✅ *${prefix}${found.name} is cleaned up from now on.*` : `✅ *${prefix}${found.name} is left alone from now on.*`);
      }
      if (w === 'reply' || w === 'replies' || w === 'answer') {
        const v = (args[1] || '').toLowerCase();
        if (v !== 'on' && v !== 'off') return reply(show());
        store.setAuto('delcmdReply', v === 'on');
        return reply(`✅ *Bot answers are ${v === 'on' ? `deleted ${secs === 1 ? 'right away (1 second)' : `after ${secText(secs)}`}` : 'kept'}.*`);
      }
      if (w === 'time' || w === 'delay') {
        const n = cleanup.parseTime(args.slice(1).join(''));
        if (n === null) return reply(`⏳ *How long the answer stays*\n▸ \`${prefix}delcmd time 30\` (seconds), \`${prefix}delcmd time 2m\` or \`${prefix}delcmd time 1h\`\n_From 1 second to 1 hour. The default is 1 second: right after the answer._`);
        store.setAuto('delcmdTime', n);
        return reply(`✅ *Bot answers are deleted ${n === 1 ? 'right away (1 second after they are sent)' : `${secText(n)} after they are sent`}.*`);
      }
      if (!text[w]) return reply(show());
      store.setAuto('delcmd', w);
      if (w !== 'off') store.setAuto('delcmdReply', true); // turning the clean-up on also turns the deleting of answers on
      return reply(`✅ *Clean up:* ${w.toUpperCase()}\n_${text[w]}_${w !== 'off' ? `\n_The bot's answers are deleted too (\`${prefix}delcmd reply off\` keeps them)._` : ''}`);
    },
  },
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
