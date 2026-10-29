// Sound effects: reply to a voice note, audio or video with the effect name
const media = require('../whatsapp/media');

const EFFECTS = [
  { name: 'bass', description: 'Boost the bass', filter: 'bass=g=15' },
  { name: 'slow', description: 'Slow the sound down', filter: 'atempo=0.7' },
  { name: 'fast', description: 'Speed the sound up', filter: 'atempo=1.5' },
  { name: 'nightcore', description: 'Faster and higher, nightcore style', filter: 'aresample=44100,asetrate=55125,aresample=44100' },
  { name: 'deep', description: 'Make the voice deeper', filter: 'aresample=44100,asetrate=35280,aresample=44100,atempo=1.25' },
  { name: 'chipmunk', description: 'Make the voice high and squeaky', filter: 'aresample=44100,asetrate=66150,aresample=44100,atempo=0.6667' },
  { name: 'echo', description: 'Add an echo', filter: 'aecho=0.8:0.88:60:0.4' },
  { name: 'tremble', description: 'Make the sound tremble', filter: 'tremolo=f=6:d=0.8' },
  { name: 'rewind', description: 'Play the sound backwards', filter: 'areverse' },
];

module.exports = EFFECTS.map((e) => ({
  name: e.name,
  category: 'audio',
  slow: true,
  description: `${e.description}: reply to a voice note, audio or video with ${e.name}`,
  async run(ctx) {
    await media.handle(ctx, ['audio', 'video'], `Reply to a voice note, audio or video with ${ctx.prefix}${e.name}`, async (found, buffer) => {
      const out = await media.ffmpeg(buffer, 'mp3', (i, o) => ['-i', i, '-vn', '-t', '300', '-af', e.filter, '-acodec', 'libmp3lame', '-b:a', '128k', o]);
      await ctx.sock.sendMessage(ctx.jid, { audio: out, mimetype: 'audio/mpeg' }, { quoted: ctx.msg });
    });
  },
}));
