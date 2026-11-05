// The menu opens with the TurboFex intro video. Where the video cannot be sent (the file is missing, WhatsApp refuses it),
// the TurboFex picture is sent instead, and when even that fails the menu is simply sent as text.
// Turn it off with MENU_MEDIA=off in the settings of the host.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets');
const FILES = { video: path.join(DIR, 'menu.mp4'), image: path.join(DIR, 'menu.jpg'), thumb: path.join(DIR, 'menu-thumb.jpg') };
const cache = {};

function load(kind) {
  if (cache[kind] !== undefined) return cache[kind];
  try {
    cache[kind] = fs.readFileSync(FILES[kind]);
  } catch (err) {
    cache[kind] = null; // missing file: the next choice is used
  }
  return cache[kind];
}

function mode() {
  const env = String(process.env.MENU_MEDIA || '').toLowerCase();
  const chosen = env || String(((require('./store').getAuto('menu') || {}).media) || 'card').toLowerCase();
  if (/^(off|0|false|no|text)$/.test(chosen)) return 'off';
  return chosen === 'video' ? 'video' : 'card';
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
    await sock.sendMessage(jid, {
      text,
      contextInfo: { externalAdReply: { title: require('../core/brand').botName, body: 'Command menu', thumbnail, mediaType: 1, renderLargerThumbnail: true, showAdAttribution: false, sourceUrl: `https://github.com/${repo}` } },
    }, quoted ? { quoted } : {});
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
  const video = load('video');
  if (video) {
    try {
      await sock.sendMessage(jid, { video, mimetype: 'video/mp4', gifPlayback: true, caption }, options);
      return true;
    } catch (err) {
      console.log('Menu video could not be sent, the picture is used instead:', err.message);
    }
  }
  const image = load('image');
  if (image) {
    try {
      await sock.sendMessage(jid, { image, mimetype: 'image/jpeg', caption }, options);
      return true;
    } catch (err) {
      console.log('Menu picture could not be sent, the text menu is used instead:', err.message);
    }
  }
  return false;
}

module.exports = { send, sendCard, mode, FILES };
