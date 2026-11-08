const store = require('../whatsapp/store');
const media = require('../whatsapp/media');
const intro = require('../whatsapp/intro');

const get = (jid) => store.getGroup(jid).intro;

module.exports = {
  name: 'intro',
  aliases: ['introduction', 'setintro'],
  category: 'group',
  description: 'Introduction for new members: intro on / off, intro set <text>, intro image, intro time 24h (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run(ctx) {
    const { jid, args, rest, reply, prefix, sock, msg, botIds, myJid, groupMetadata } = ctx;
    const sub = (args[0] || '').toLowerCase();
    const g = store.getGroup(jid);
    const cfg = g.intro;
    const p = `${prefix}${ctx.cmdName || 'intro'}`;

    if (!sub) {
      const preview = (cfg.text || intro.DEFAULT_INTRO).slice(0, 300);
      return reply(
        `👋 *Introduction*\n` +
          `▸ *Status:* ${cfg.on ? 'ON' : 'OFF'}\n` +
          `▸ *Time limit:* ${cfg.timeMs ? intro.words(cfg.timeMs) : 'none'}\n` +
          `▸ *Picture:* ${intro.hasImage(jid) ? 'yes' : 'no'}\n` +
          `▸ *Welcome message:* ${g.welcome ? 'ON (the introduction follows it)' : 'OFF'}\n\n` +
          `*Message:*\n${preview}${(cfg.text || '').length > 300 ? '…' : ''}\n\n` +
          `▸ \`${p} on\` / \`${p} off\`\n` +
          `▸ \`${p} set your text here\`\n` +
          `▸ \`${p} image\` (send or reply to a picture)\n` +
          `▸ \`${p} time 24h\` or \`${p} time off\`\n` +
          `▸ \`${p} test\` shows it to you\n` +
          `▸ \`${p} reset\` goes back to the default\n\n` +
          `_You can use @user, {group}, {count} and {time} in the text._`
      );
    }

    if (sub === 'on' || sub === 'off') {
      store.update(jid, (grp) => {
        grp.intro.on = sub === 'on';
      });
      return reply(sub === 'on' ? `✅ *Introduction is ON.*\n▸ New members get it when they join.${cfg.text ? '' : '\n▸ No text saved yet: the default one is used. Change it with `' + p + ' set ...`'}` : '✅ *Introduction is OFF.*');
    }

    if (sub === 'set' || sub === 'text') {
      const text = rest.replace(/^\S+\s*/, '').trim();
      // a picture sent with this command (or replied to) is saved together with the text
      const found = media.findMedia(msg, jid, botIds);
      const withImage = found && found.kind === 'image';
      if (!text && !withImage) return reply(`✏️ *Introduction text*\n▸ \`${p} set Welcome! Please tell us your name, age and where you are from.\`\n▸ Attach a picture to the same message to add an example screenshot.\n_You can use @user, {group}, {count} and {time}._`);
      if (text.length > intro.MAX_TEXT) return reply(`⚠️ *That text is too long.*\n▸ Please keep it under ${intro.MAX_TEXT} characters.`);
      if (withImage) {
        try {
          await intro.saveImage(jid, await media.download(sock, found.source), (() => { try { return media.loadSharp(); } catch (e) { return null; } })());
        } catch (err) {
          return reply(err.code === 'TOO_BIG' ? `⚠️ *${err.message}*` : '⚠️ *I could not save that picture.*\n▸ Try another one.');
        }
      }
      if (text) {
        store.update(jid, (grp) => {
          grp.intro.text = text;
        });
      }
      return reply(`✅ *Introduction saved.*${withImage ? '\n▸ The picture is saved too.' : ''}${cfg.on ? '' : `\n▸ It is OFF. Turn it on with \`${p} on\`.`}`);
    }

    if (sub === 'image' || sub === 'picture' || sub === 'photo') {
      if (['off', 'remove', 'delete'].includes((args[1] || '').toLowerCase())) {
        intro.removeImage(jid);
        return reply('✅ *The introduction picture is removed.*');
      }
      return media.handle(ctx, ['image'], `🖼️ *Introduction picture*\n▸ Send a picture with \`${p} image\` as its caption, or reply to a picture with \`${p} image\`.\n▸ \`${p} image off\` removes it.`, async (found, buffer) => {
        let sharp = null;
        try {
          sharp = media.loadSharp();
        } catch (err) {
          sharp = null;
        }
        try {
          await intro.saveImage(jid, buffer, sharp);
        } catch (err) {
          return reply(err.code === 'TOO_BIG' ? `⚠️ *${err.message}*` : '⚠️ *I could not save that picture.*\n▸ Try another one.');
        }
        return reply(`✅ *Introduction picture saved.*${cfg.on ? '' : `\n▸ The introduction is OFF. Turn it on with \`${p} on\`.`}`);
      });
    }

    if (sub === 'time' || sub === 'limit') {
      const ms = intro.parseLimit(args.slice(1).join(''));
      if (ms === null) return reply(`⏳ *Time limit*\n▸ \`${p} time 24h\`, \`${p} time 2d\` or \`${p} time 90m\`\n▸ \`${p} time off\` removes it.\n_From 5 minutes to 30 days. New members are told how long they have to introduce themselves._`);
      store.update(jid, (grp) => {
        grp.intro.timeMs = ms;
      });
      return reply(ms ? `✅ *Time limit: ${intro.words(ms)}.*\n▸ New members are told they have ${intro.words(ms)} to introduce themselves.` : '✅ *No time limit.*');
    }

    if (sub === 'test' || sub === 'preview') {
      const name = groupMetadata?.subject || 'the group';
      const count = groupMetadata?.participants?.length;
      await intro.send(sock, jid, [myJid], name, count, cfg);
      return undefined;
    }

    if (sub === 'reset') {
      intro.removeImage(jid);
      store.update(jid, (grp) => {
        grp.intro = { on: false, text: null, timeMs: 0 };
      });
      return reply('✅ *Introduction reset.*\n▸ The text, the picture and the time limit are cleared, and it is OFF.');
    }

    return reply(`⚠️ *I did not understand that.*\n▸ Send \`${p}\` to see what you can do.`);
  },
};
