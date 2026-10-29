// Video tools: reply to a video with the command
const media = require('../whatsapp/media');

const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

// "90" -> 90 seconds, "1:30" -> 90 seconds
function seconds(text) {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(text || ''));
  return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null;
}

const send = (ctx, buffer, caption, extra = {}) =>
  ctx.sock.sendMessage(ctx.jid, { video: buffer, mimetype: 'video/mp4', caption, ...extra }, { quoted: ctx.msg });

module.exports = [
  {
    name: 'trim',
    category: 'video',
    slow: true,
    description: 'Cut a video: reply to it with trim 5 20 (from second 5 to 20), or trim 15 (the first 15 seconds)',
    async run(ctx) {
      const a = seconds(ctx.args[0]);
      const b = ctx.args[1] != null ? seconds(ctx.args[1]) : null;
      const [start, end] = ctx.args[1] != null ? [a, b] : [0, a];
      if (a == null || (ctx.args[1] != null && b == null) || end <= start || end - start > 120) {
        return ctx.reply(`Say where to cut (a clip can be up to 2 minutes).\n${ctx.prefix}trim 5 20  → from second 5 to 20\n${ctx.prefix}trim 15  → the first 15 seconds\n${ctx.prefix}trim 1:10 1:40 → minutes:seconds also work`);
      }
      await media.handle(ctx, ['video'], `Reply to a video with ${ctx.prefix}trim 5 20`, async (found, buffer) => {
        const out = await media.ffmpeg(buffer, 'mp4', (i, o) => ['-ss', String(start), '-i', i, '-t', String(end - start), ...X264, '-crf', '28', '-c:a', 'aac', '-b:a', '96k', o]);
        await send(ctx, out, `✂️ ${start}s to ${end}s`);
      });
    },
  },
  {
    name: 'compress',
    category: 'video',
    slow: true,
    description: 'Make a video smaller (max width 640): reply to it with compress',
    async run(ctx) {
      await media.handle(ctx, ['video'], `Reply to a video with ${ctx.prefix}compress`, async (found, buffer) => {
        const out = await media.ffmpeg(buffer, 'mp4', (i, o) => ['-i', i, '-vf', 'scale=min(640\\,iw):-2', ...X264, '-crf', '32', '-c:a', 'aac', '-b:a', '64k', o]);
        await send(ctx, out, `🗜️ ${Math.round(buffer.length / 1024)} KB → ${Math.round(out.length / 1024)} KB`);
      });
    },
  },
  {
    name: 'mute',
    category: 'video',
    slow: true,
    description: 'Remove the sound from a video: reply to it with mute',
    async run(ctx) {
      await media.handle(ctx, ['video'], `Reply to a video with ${ctx.prefix}mute`, async (found, buffer) => {
        const out = await media.ffmpeg(buffer, 'mp4', (i, o) => ['-i', i, '-an', '-c:v', 'copy', o]);
        await send(ctx, out, '🔇 No sound');
      });
    },
  },
  {
    name: 'vreverse',
    category: 'video',
    slow: true,
    description: 'Play a video backwards (first 30 seconds): reply to it with vreverse',
    async run(ctx) {
      await media.handle(ctx, ['video'], `Reply to a video with ${ctx.prefix}vreverse`, async (found, buffer) => {
        let out;
        try {
          out = await media.ffmpeg(buffer, 'mp4', (i, o) => ['-i', i, '-t', '30', '-vf', 'reverse', '-af', 'areverse', ...X264, '-crf', '28', '-c:a', 'aac', o]);
        } catch (err) {
          if (err.code === 'NEED_FFMPEG') throw err;
          // probably a video without sound
          out = await media.ffmpeg(buffer, 'mp4', (i, o) => ['-i', i, '-t', '30', '-vf', 'reverse', '-an', ...X264, '-crf', '28', o]);
        }
        await send(ctx, out, '⏪ Backwards');
      });
    },
  },
  {
    name: 'gif',
    category: 'video',
    slow: true,
    description: 'Turn a video into a looping GIF (first 8 seconds): reply to it with gif',
    async run(ctx) {
      await media.handle(ctx, ['video'], `Reply to a video with ${ctx.prefix}gif`, async (found, buffer) => {
        const out = await media.ffmpeg(buffer, 'mp4', (i, o) => ['-i', i, '-t', '8', '-an', '-vf', 'scale=min(480\\,iw):-2', ...X264, '-crf', '30', o]);
        await send(ctx, out, '🎞️ GIF', { gifPlayback: true });
      });
    },
  },
];
