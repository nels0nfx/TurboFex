// The menu comes with the TurboFex look. Chosen with "setmenu media video / card / off" (or MENU_MEDIA on the host):
//  - video (default): the TurboFex video (or your own picture or video) first, then the WHOLE menu, header and commands together,
//    as ONE message right under it.
//  - card: ONE message with a small picture on top and the whole menu in it. Not every phone shows it, so WhatsApp's answer is
//    checked and a menu it refuses is sent the normal way.
//  - off: plain text.
// (WhatsApp keeps media captions to about 1000 characters, so a menu this long cannot sit inside a picture or video caption.)
// Where the video or picture cannot be sent, the next one is tried, and at the end the menu is sent as plain text.
const fs = require('fs');
const { withTimeout } = require('./timeout');
const path = require('path');

const { DATA } = require('../core/paths');

const DIR = path.join(__dirname, '..', 'assets');
const CUSTOM = path.join(DATA, 'menu'); // the owner's own picture and video (they survive updates; the files in assets/ do not count as the owner's)
const NAMES = { video: 'menu.mp4', image: 'menu.jpg', thumb: 'menu-thumb.jpg' };
const FILES = { video: path.join(DIR, 'menu.mp4'), image: path.join(DIR, 'menu.jpg'), thumb: path.join(DIR, 'menu-thumb.jpg') };
const cache = {};

function load(kind) {
  if (cache[kind] !== undefined) return cache[kind];
  cache[kind] = null; // missing file: the next choice is used
  for (const file of [path.join(CUSTOM, NAMES[kind]), FILES[kind]]) { // the owner's own file first
    try {
      cache[kind] = fs.readFileSync(file);
      break;
    } catch (err) {
      // not there: the default is tried
    }
  }
  return cache[kind];
}

// which pictures are the owner's own right now
function custom() {
  const has = (n) => fs.existsSync(path.join(CUSTOM, NAMES[n]));
  return { image: has('image'), video: has('video') };
}

// the owner's own picture: one for the message (1000 px) and a small one for the card (320 px, about 12 KB: the menu text is
// already 10 to 13 KB and the whole message must stay far below WhatsApp's size limit)
async function setImage(buffer, sharp) {
  const full = await sharp(buffer).rotate().resize(1000, 1000, { fit: 'cover' }).jpeg({ quality: 84 }).toBuffer();
  const thumb = await sharp(buffer).rotate().resize(320, 320, { fit: 'cover' }).jpeg({ quality: 62 }).toBuffer();
  fs.mkdirSync(CUSTOM, { recursive: true });
  fs.writeFileSync(path.join(CUSTOM, NAMES.image), full);
  fs.writeFileSync(path.join(CUSTOM, NAMES.thumb), thumb);
  delete cache.image;
  delete cache.thumb;
}

// the owner's own video: made small and playable everywhere (max 15 seconds, no sound). Without ffmpeg a small file is kept as it is.
const MAX_VIDEO = 6 * 1024 * 1024;
async function setVideo(buffer, ffmpeg) {
  let out;
  try {
    out = await ffmpeg(buffer, 'mp4', (i, o) => ['-i', i, '-t', '15', '-an', '-vf', "scale='min(720,iw)':-2", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'veryfast', '-movflags', '+faststart', o]);
  } catch (err) {
    if (err.code !== 'NEED_FFMPEG' || buffer.length > MAX_VIDEO) throw err;
    out = buffer;
  }
  if (out.length > MAX_VIDEO) throw Object.assign(new Error('That video is too big for the menu (the limit is 6 MB). Try a shorter one.'), { code: 'TOO_BIG' });
  fs.mkdirSync(CUSTOM, { recursive: true });
  fs.writeFileSync(path.join(CUSTOM, NAMES.video), out);
  delete cache.video;
}

// back to the TurboFex picture and video
function resetCustom() {
  fs.rmSync(CUSTOM, { recursive: true, force: true });
  for (const k of Object.keys(cache)) delete cache[k];
}

function mode() {
  const env = String(process.env.MENU_MEDIA || '').toLowerCase();
  const chosen = env || String(((require('./store').getAuto('menu') || {}).media) || 'video').toLowerCase();
  if (/^(off|0|false|no|text)$/.test(chosen)) return 'off';
  return chosen === 'card' ? 'card' : 'video';
}

// ONE message: the picture on top, the whole text under it. Returns true when it was sent.
async function sendCard(sock, jid, text, quoted) {
  if (mode() !== 'card') return false;
  const thumbnail = load('thumb');
  if (!thumbnail) return false;
  let repo = 'nels0nfx/TurboFex';
  try {
    repo = require('../update.json').repo || repo;
  } catch (err) {
    // the default link is used
  }
  try {
    const sent = await withTimeout(sock.sendMessage(jid, {
      text,
      contextInfo: { externalAdReply: { title: require('../core/brand').botName, body: 'Command menu', thumbnail, mediaType: 1, renderLargerThumbnail: true, showAdAttribution: false, sourceUrl: `https://github.com/${repo}` } },
    }, quoted ? { quoted } : {}), 25000, 'the menu card took too long');
    // WhatsApp answers a refused message with an error: then the normal way is used (a phone that cannot show it never sees it)
    const verdict = await require('./delivery').expect(sent?.key?.id, 6000);
    if (verdict.result === 'refused') {
      console.log(`Menu card refused by WhatsApp (error ${verdict.error || 'unknown'}), the normal menu is sent instead.`);
      return false;
    }
    return true;
  } catch (err) {
    console.log('Menu card could not be sent, the video is used instead:', err.message);
    return false;
  }
}

// Sends the video (or the picture) with the caption. Returns true when one of them was sent.
async function send(sock, jid, caption, quoted) {
  if (mode() === 'off') return false;
  const options = quoted ? { quoted } : {};
  const own = custom();
  // the owner's own picture comes before the TurboFex video; the owner's own video comes first of all
  const order = own.image && !own.video ? ['image', 'video'] : ['video', 'image'];
  for (const kind of order) {
    const file = load(kind);
    if (!file) continue;
    const content = kind === 'video' ? { video: file, mimetype: 'video/mp4', gifPlayback: true } : { image: file, mimetype: 'image/jpeg' };
    if (caption) content.caption = caption;
    try {
      await withTimeout(sock.sendMessage(jid, content, options), 25000, 'the menu media took too long');
      return true;
    } catch (err) {
      console.log(`Menu ${kind} could not be sent, the next choice is used:`, err.message);
    }
  }
  return false;
}

module.exports = { send, sendCard, mode, setImage, setVideo, resetCustom, custom, FILES, CUSTOM };
