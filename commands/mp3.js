const media = require('../whatsapp/media');

module.exports = {
  name: 'mp3',
  category: 'media',
  slow: true,
  aliases: ['tomp3'],
  description: 'Get the sound of a video (or a voice note) as an MP3: reply to it with mp3',
  async run(ctx) {
    await media.handle(ctx, ['video', 'audio'], 'Reply to a video or voice note with this command.', async (found, buffer) => {
      const mp3 = await media.ffmpeg(buffer, 'mp3', (i, o) => ['-i', i, '-vn', '-t', '900', '-acodec', 'libmp3lame', '-b:a', '128k', o]);
      await ctx.sock.sendMessage(ctx.jid, { audio: mp3, mimetype: 'audio/mpeg' }, { quoted: ctx.msg });
    });
  },
};
