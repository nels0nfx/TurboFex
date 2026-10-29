// Use your groups from anywhere (even a private chat, and without being admin): list ids, post a group status, send a message
const groups = require('../whatsapp/groups');
const media = require('../whatsapp/media');
const { postGroupStatus } = require('../whatsapp/groupstatus');

const PAGE = 25;

// "3 hello" | "Family hello"... the group is the first word (or "text in quotes")
function splitGroupArg(rest) {
  const q = /^"([^"]+)"\s*([\s\S]*)$/.exec(rest);
  if (q) return [q[1], q[2].trim()];
  const i = rest.search(/\s/);
  return i === -1 ? [rest, ''] : [rest.slice(0, i), rest.slice(i + 1).trim()];
}

async function pickGroup(ctx, usage) {
  const [arg, text] = splitGroupArg(ctx.rest);
  if (!arg) {
    await ctx.reply(usage);
    return null;
  }
  const g = await groups.resolve(ctx.sock, arg);
  if (!g) {
    await ctx.reply(`⚠️ I could not find the group "${arg}".\nSend ${ctx.prefix}gjids to see your groups and their numbers.`);
    return null;
  }
  return { ...g, text };
}

// text, or the picture / video / voice note that was replied to or sent with the command
async function buildContent(ctx, text) {
  const found = media.findMedia(ctx.msg, ctx.jid, ctx.botIds);
  if (found && ['image', 'video', 'audio'].includes(found.kind)) {
    const buffer = await media.download(ctx.sock, found.source);
    if (found.kind === 'image') return { image: buffer, caption: text };
    if (found.kind === 'video') return { video: buffer, caption: text };
    return { audio: buffer, mimetype: 'audio/mp4', ptt: false };
  }
  return text ? { text } : null;
}

module.exports = [
  {
    name: 'gjids',
    aliases: ['groups', 'mygroups'],
    category: 'status',
    ownerOnly: true,
    description: 'List ALL the groups this account is in with their ids: gjids (next pages: gjids 2)',
    async run({ sock, args, reply, prefix }) {
      const all = await groups.list(sock, true);
      if (!all.length) return reply('ℹ️ This account is not in any group.');
      const pages = Math.ceil(all.length / PAGE);
      const page = Math.min(pages, Math.max(1, parseInt(args[0], 10) || 1));
      const rows = all.slice((page - 1) * PAGE, page * PAGE).map((g, i) => `${(page - 1) * PAGE + i + 1}. ${g.name}\n    ${g.jid} • ${g.size} members`);
      await reply(
        `👥 *Your groups* (${all.length}) • page ${page}/${pages}\n\n${rows.join('\n')}\n\n` +
          `Use the number or the id, for example:\n${prefix}gstatus 3 Hello everyone\n${prefix}gsend 3 Meeting at 8` +
          (pages > 1 ? `\nNext page: ${prefix}gjids ${Math.min(pages, page + 1)}` : '')
      );
    },
  },
  {
    name: 'gstatus',
    category: 'status',
    slow: true,
    ownerOnly: true,
    description: 'Post a GROUP STATUS from anywhere, no admin needed: gstatus 3 Hello (or reply to a picture/video with gstatus 3 caption)',
    async run(ctx) {
      const pick = await pickGroup(ctx, `Say which group, then the text.\n${ctx.prefix}gstatus 3 Hello everyone\nReply to a picture or video to post it as the group status.\nGet the numbers with ${ctx.prefix}gjids`);
      if (!pick) return;
      let content;
      try {
        content = await buildContent(ctx, pick.text);
      } catch (err) {
        return ctx.reply(`⚠️ I could not read that file: ${String(err.message).slice(0, 100)}`);
      }
      if (!content) return ctx.reply(`Write the text, or reply to a picture or video.\nExample: ${ctx.prefix}gstatus ${splitGroupArg(ctx.rest)[0]} Hello everyone`);
      try {
        await postGroupStatus(ctx.sock, pick.jid, content);
      } catch (err) {
        if (err.code === 'NEED_LIB') return ctx.reply('⚠️ This WhatsApp library version cannot post group statuses. Run npm install so the newer library (7.0.0-rc14) is installed, then restart.');
        console.error('Group status failed:', err.message);
        return ctx.reply(`⚠️ WhatsApp refused the group status.\nReason: ${String(err.message).slice(0, 120)}`);
      }
      await ctx.reply(`✅ Group status posted in *${pick.name}*`);
    },
  },
  {
    name: 'gsend',
    category: 'status',
    slow: true,
    ownerOnly: true,
    description: 'Send a message to any of your groups from anywhere: gsend 3 Meeting at 8 (or reply to a picture/video)',
    async run(ctx) {
      const pick = await pickGroup(ctx, `Say which group, then the message.\n${ctx.prefix}gsend 3 Meeting at 8\nGet the numbers with ${ctx.prefix}gjids`);
      if (!pick) return;
      let content;
      try {
        content = await buildContent(ctx, pick.text);
      } catch (err) {
        return ctx.reply(`⚠️ I could not read that file: ${String(err.message).slice(0, 100)}`);
      }
      if (!content) return ctx.reply(`Write the message, or reply to a picture or video.\nExample: ${ctx.prefix}gsend ${splitGroupArg(ctx.rest)[0]} Meeting at 8`);
      try {
        await ctx.sock.sendMessage(pick.jid, content);
      } catch (err) {
        return ctx.reply(`⚠️ I could not send it.\nReason: ${String(err.message).slice(0, 120)}`);
      }
      await ctx.reply(`✅ Sent to *${pick.name}*`);
    },
  },
];
