// Helpers for commands that work on pictures, stickers, videos and audio.
// The heavy tools are OPTIONAL: "sharp" (pictures) and ffmpeg (video/audio) are loaded only when needed,
// so the bot keeps working even where they cannot be installed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const baileys = require('../core/baileys');
const { getQuoted, num } = require('./utils');
const { peel } = require('./unwrap');

const MAX_BYTES = 20 * 1024 * 1024;
const silent = { level: 'silent', info() {}, error() {}, warn() {}, debug() {}, trace() {}, fatal() {}, child() { return silent; } };

const unwrap = (m) => peel(m).content;

function kindOf(message) {
  if (!message) return null;
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.stickerMessage) return 'sticker';
  if (message.audioMessage) return 'audio';
  const doc = message.documentMessage?.mimetype || '';
  if (doc.startsWith('image/')) return 'image';
  if (doc.startsWith('video/')) return 'video';
  return null;
}

// the media in the command message itself, or in the message it replies to
function findMedia(msg, jid, botIds) {
  const own = unwrap(msg.message);
  if (kindOf(own)) return { kind: kindOf(own), source: msg, animated: false };

  const q = getQuoted(msg);
  if (!q) return null;
  const inner = unwrap(q.message);
  const kind = kindOf(inner);
  if (!kind) return null;
  return {
    kind,
    animated: !!inner.stickerMessage?.isAnimated,
    source: { key: { remoteJid: jid, id: q.id, participant: q.participant, fromMe: botIds.includes(num(q.participant)) }, message: q.message },
  };
}

async function download(sock, source) {
  const { downloadMediaMessage } = baileys.get();
  const buffer = await downloadMediaMessage(source, 'buffer', {}, { logger: silent, reuploadRequest: sock.updateMediaMessage });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('That file is too big (the limit is 20 MB).'), { code: 'TOO_BIG' });
  return buffer;
}

function loadSharp() {
  try {
    return require('sharp');
  } catch (err) {
    throw Object.assign(new Error('sharp is not installed'), { code: 'NEED_SHARP' });
  }
}

function ffmpegBinary() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch (err) {
    return 'ffmpeg';
  }
}

// runs ffmpeg on a buffer and returns the result
async function ffmpeg(input, outExt, makeArgs) {
  const id = crypto.randomBytes(6).toString('hex');
  const inFile = path.join(os.tmpdir(), `tfx-${id}-in`);
  const outFile = path.join(os.tmpdir(), `tfx-${id}-out.${outExt}`);
  fs.writeFileSync(inFile, input);
  try {
    await new Promise((resolve, reject) => {
      execFile(ffmpegBinary(), ['-y', '-hide_banner', '-loglevel', 'error', ...makeArgs(inFile, outFile)], { timeout: 90000 }, (err, _out, stderr) => {
        if (err) {
          const code = err.code === 'ENOENT' ? 'NEED_FFMPEG' : 'FFMPEG_FAILED';
          return reject(Object.assign(new Error(String(stderr || err.message).slice(0, 200)), { code }));
        }
        resolve();
      });
    });
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(inFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}

const NOT_HERE = '⚠️ This feature is not available on this server right now. Please try something else.';
const NEED_SHARP = '⚠️ This needs the "sharp" package, which is not installed on this server. Restart the bot with npm install enabled.';
const NEED_FFMPEG = '⚠️ This needs ffmpeg, which is not installed on this server. Restart the bot with npm install enabled.';

// shared flow: find the media, download it, run the work, explain problems clearly
// (people who are not the owner get a simple message; the owner also gets the technical reason)
// A picture, GIF or video becomes a WhatsApp sticker (webp, under 1 MB). Stickers are returned as they are.
async function toSticker(kind, buffer) {
  if (kind === 'sticker') return buffer;
  if (kind === 'video') {
    // animated sticker: up to 8 seconds, kept under WhatsApp's 1 MB limit
    const make = (fps, q) => ffmpeg(buffer, 'webp', (i, o) => [
      '-i', i, '-t', '8', '-an', '-vsync', '0',
      '-vf', `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
      '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(q), '-loop', '0', '-preset', 'default', o,
    ]);
    let webp = await make(12, 50);
    if (webp.length > 1000 * 1024) webp = await make(8, 30);
    if (webp.length > 1000 * 1024) throw new Error('The result is too big for a sticker. Try a shorter video.');
    return webp;
  }
  return loadSharp()(buffer)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 80 })
    .toBuffer();
}

async function handle(ctx, kinds, usage, worker) {
  const { sock, msg, jid, reply, botIds, isOwner } = ctx;
  const found = findMedia(msg, jid, botIds);
  if (!found || !kinds.includes(found.kind)) return reply(usage);
  try {
    if (found.kind === 'video' || found.kind === 'audio') await reply('⏳ Working on it, this can take a few seconds...');
    const buffer = await download(sock, found.source);
    await worker(found, buffer);
  } catch (err) {
    if (err.code === 'NEED_SHARP') return reply(isOwner ? NEED_SHARP : NOT_HERE);
    if (err.code === 'NEED_FFMPEG') return reply(isOwner ? NEED_FFMPEG : NOT_HERE);
    if (err.code === 'TOO_BIG') return reply(`⚠️ ${err.message}`);
    console.error('Media command failed:', err.message);
    return reply(`⚠️ I could not do that with this file.${isOwner ? `\nReason: ${String(err.message).slice(0, 120)}` : ' Try another file.'}`);
  }
}

module.exports = { handle, toSticker, download, kindOf, findMedia, unwrap, loadSharp, ffmpeg, ffmpegBinary, MAX_BYTES, NOT_HERE };
