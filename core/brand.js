// The bot's name and links. Changing them here changes them everywhere, and updates carry the change to everyone.
module.exports = Object.freeze({
  botName: 'TurboFex',
  creator: 'Nelson Fx',
  links: {
    telegramSupport: 'https://t.me/+7PwU2Vo9czE1NTRk',
    telegramChannel: 'https://t.me/+e89lCBU2wLpjNWNk',
    whatsappChannel: 'https://whatsapp.com/channel/0029VbDpuKM8qIzkoQscOE2w',
    github: 'https://github.com/nels0nfx/TurboFex',
  },
  // Added under the result of some commands once they SUCCEED (turn off or change it with the "watermark" command)
  watermark: {
    text: '⚡ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴛᴜʀʙᴏꜰᴇx',
    categories: ['media', 'audio', 'video', 'editor'],
    commands: ['qr', 'fancy', 'play', 'mp3', 'calc', 'password'],
  },
});
