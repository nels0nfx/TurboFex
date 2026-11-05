// Owner: leaveall, maintenance, setmenu, blocklist
const store = require('../whatsapp/store');
const names = require('../whatsapp/names');
const { num } = require('../whatsapp/utils');

const base = { category: 'owner', ownerOnly: true, needs: [], weight: 'light' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = [
  {
    ...base,
    name: 'leaveall',
    description: 'Leave every group except this chat: leaveall confirm (owner only)',
    async run({ sock, jid, args, reply, prefix }) {
      const all = Object.keys(await sock.groupFetchAllParticipating()).filter((g) => g !== jid);
      if ((args[0] || '').toLowerCase() !== 'confirm') {
        return reply(`🚪 *Leave all groups*\nThe bot is in *${all.length}* other group(s).\n⚠️ This leaves all of them, and cannot be undone.\n\nTo do it: \`${prefix}leaveall confirm\``);
      }
      let left = 0;
      for (const g of all) {
        try {
          await sock.groupLeave(g);
          left += 1;
        } catch (err) {
          // already gone
        }
        await sleep(1500); // slowly, so WhatsApp does not mind
      }
      await reply(`🚪 *Left ${left} group(s).*`);
    },
  },
  {
    ...base,
    name: 'maintenance',
    aliases: ['maint'],
    description: 'Only you can use the bot while you work on it: maintenance on / off (owner only)',
    async run({ args, reply, prefix }) {
      const w = (args[0] || '').toLowerCase();
      if (w !== 'on' && w !== 'off') return reply(`🛠️ *Maintenance*\n*Status:* ${store.getAuto('maintenance') ? 'ON' : 'OFF'}\n_While it is on, other people get a short notice and the bot ignores their commands._\n\n▸ \`${prefix}maintenance on\` / \`${prefix}maintenance off\``);
      store.setAuto('maintenance', w === 'on');
      await reply(`✅ *Maintenance is now ${w.toUpperCase()}.*`);
    },
  },
  {
    ...base,
    name: 'setmenu',
    description: 'Change the menu: setmenu title MY BOT / subtitle text / image / video / media card, video, off or default / reset (owner only)',
    async run(ctx) {
      const { args, rest, reply, prefix } = ctx;
      const cur = store.getAuto('menu') || {};
      const w = (args[0] || '').toLowerCase();
      const text = rest.slice(args[0]?.length || 0).trim().slice(0, 40);
      if (w === 'reset') {
        store.setAuto('menu', cur.media ? { media: cur.media } : {}); // the picture choice is kept
        return reply('✅ *The menu heading is back to the default.*');
      }
      const menumedia = require('../whatsapp/menumedia');
      const media = require('../whatsapp/media');
      if (w === 'image' || w === 'photo' || w === 'picture') {
        return media.handle(ctx, ['image'], `🖼️ *Menu picture*\n▸ Send a picture with \`${prefix}setmenu image\` as its caption, or reply to a picture with \`${prefix}setmenu image\`.`, async (found, buffer) => {
          await menumedia.setImage(buffer, media.loadSharp());
          store.setAuto('menu', { ...cur, media: 'card' });
          await reply(`✅ *Menu picture saved.*\n▸ The menu now shows your picture on top.\n_Open the menu to see it._`);
        });
      }
      if (w === 'video' || w === 'gif') {
        return media.handle(ctx, ['video'], `🎬 *Menu video*\n▸ Send a video or GIF with \`${prefix}setmenu video\` as its caption, or reply to one with \`${prefix}setmenu video\`.\n▸ Up to 15 seconds.`, async (found, buffer) => {
          await menumedia.setVideo(buffer, media.ffmpeg);
          store.setAuto('menu', { ...cur, media: 'video' });
          await reply(`✅ *Menu video saved.*\n▸ The menu now opens with your video, and the commands follow.\n▸ \`${prefix}setmenu media card\` goes back to one message with a picture.`);
        });
      }
      if (w === 'media') {
        const m = (args[1] || '').toLowerCase();
        if (m === 'default' || m === 'reset') {
          menumedia.resetCustom();
          store.setAuto('menu', { ...cur, media: 'card' });
          return reply('✅ *The TurboFex picture and video are back.*');
        }
        if (!['card', 'video', 'off'].includes(m)) return reply(`🎬 *Menu picture*\n▸ *Now:* ${cur.media || 'card'}${menumedia.custom().image ? ' (your own picture)' : ''}${menumedia.custom().video ? ' (your own video)' : ''}\n\n▸ \`${prefix}setmenu image\` - your own picture (send or reply to a picture)\n▸ \`${prefix}setmenu video\` - your own video or GIF\n▸ \`${prefix}setmenu media card\` - picture and menu in one message\n▸ \`${prefix}setmenu media video\` - video, then the menu\n▸ \`${prefix}setmenu media off\` - text only\n▸ \`${prefix}setmenu media default\` - the TurboFex picture and video again`);
        store.setAuto('menu', { ...cur, media: m });
        return reply(`✅ *Menu picture: ${m}.*\n_Open the menu to see it._`);
      }
      if ((w === 'title' || w === 'subtitle') && text) {
        store.setAuto('menu', { ...cur, [w]: text });
        return reply(`✅ *Menu ${w} saved:* ${text}\n_Open the menu to see it._`);
      }
      await reply(`🎨 *Menu heading*\n*Title:* ${cur.title || 'default'}\n*Subtitle:* ${cur.subtitle || 'none'}\n\n▸ \`${prefix}setmenu title NELSONFX BOT\`\n▸ \`${prefix}setmenu subtitle Your friendly assistant\`\n▸ \`${prefix}setmenu media card\` / \`video\` / \`off\`\n▸ \`${prefix}setmenu reset\``);
    },
  },
  {
    ...base,
    name: 'blocklist',
    aliases: ['blocked'],
    description: 'Who the bot account has blocked (owner only)',
    async run({ sock, reply }) {
      const list = await sock.fetchBlocklist();
      if (!list?.length) return reply('✅ *Nobody is blocked.*');
      const shown = list.slice(0, 40);
      await reply(`🚫 *Blocked* (${list.length})\n\n${shown.map((j, i) => `${i + 1}. @${num(j)}`).join('\n')}${list.length > 40 ? `\n_...and ${list.length - 40} more_` : ''}`, { mentions: shown });
    },
  },
];
