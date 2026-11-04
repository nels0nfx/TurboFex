// gpp = change a profile picture. One command for two jobs (setpp is its alias):
//   in a group:        gpp          -> the GROUP picture (admins)
//   anywhere:          gpp bot      -> the BOT's own picture (owner only); "setpp" and "gpp me" do the same
//   in a private chat: gpp          -> the bot's own picture (owner only)
const media = require('../whatsapp/media');
const { selfJid } = require('../whatsapp/utils');

const BOT_WORDS = ['bot', 'me', 'self', 'profile'];

module.exports = {
  name: 'gpp',
  aliases: ['setpp'],
  category: 'group',
  slow: true,
  description: 'Change a picture: reply to a picture with gpp (group picture, admins) or gpp bot / setpp (the bot\'s own picture, owner)',
  async run(ctx) {
    const { cmdName, args, isGroup, isAdmin, isOwner, prefix } = ctx;
    const forBot = cmdName === 'setpp' || BOT_WORDS.includes((args[0] || '').toLowerCase()) || !isGroup;

    // not allowed: stay silent (the owner's rule)
    if (forBot && !isOwner) return;
    if (!forBot && !(isAdmin || isOwner)) return;

    if (forBot) {
      return media.handle(ctx, ['image'], `🖼️ *Bot picture*\n_Reply to a picture with_ \`${prefix}gpp bot\``, async (found, buffer) => {
        try {
          await ctx.sock.updateProfilePicture(selfJid(ctx.sock), buffer);
        } catch (err) {
          console.error('Profile picture failed:', err.message);
          return ctx.reply('⚠️ *I could not change my profile picture.*');
        }
        await ctx.reply('✅ *My profile picture was changed.*');
      });
    }

    await media.handle(ctx, ['image'], `🖼️ *Group picture*\n_Reply to a picture with_ \`${prefix}gpp\`\n*Bot picture:* \`${prefix}gpp bot\` _(owner)_`, async (found, buffer) => {
      try {
        await ctx.sock.updateProfilePicture(ctx.jid, buffer);
      } catch (err) {
        console.error('Group picture failed:', err.message);
        return ctx.reply('⚠️ *I could not change the group picture.*\n_If only admins may edit the group, make me an admin first._');
      }
      await ctx.reply('✅ *Group picture changed.*');
    });
  },
};
