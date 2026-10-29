// Link previews (the card with a picture, title and description under a link). The WhatsApp library only makes them when
// an optional package is installed, which is why no message ever showed one. This makes them itself: it reads the page's
// title, description and picture (Open Graph tags) from the public web, and shrinks the picture to a small thumbnail.
const safefetch = require('./safefetch');

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*)/i;
const BUDGET_MS = 3500; // a message is never held back longer than this for its page and picture
const UPLOAD_MS = 4000; // ...plus this long for sending the big picture to WhatsApp
const cache = new Map(); // url -> { at, value }

function firstUrl(text) {
  const m = URL_RE.exec(String(text || ''));
  if (!m) return null;
  const matched = m[0].replace(/[)\].,;:!?]+$/, '');
  return { matched, url: /^https?:/i.test(matched) ? matched : `https://${matched}` };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();

// the title, description and picture of a web page
function parseMeta(html) {
  const head = String(html).slice(0, 300000);
  const meta = {};
  for (const m of head.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const attrs = {};
    for (const a of m[1].matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? '';
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  return {
    title: decode(meta['og:title'] || meta['twitter:title'] || (t && t[1]) || ''),
    description: decode(meta['og:description'] || meta['twitter:description'] || meta.description || '').slice(0, 500),
    image: meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || '',
    canonical: meta['og:url'] || '',
  };
}

let sharpLib;
function loadSharp() {
  if (sharpLib === undefined) {
    try {
      sharpLib = require('sharp');
    } catch (err) {
      sharpLib = null;
    }
  }
  return sharpLib;
}

// The inline thumbnail. It used to be a 300 px square crop at low quality, which WhatsApp showed as a small blurry card.
// Now it keeps the whole picture (no crop) at a larger size; the FULL picture is sent separately (see largeImage).
async function thumbnail(buf) {
  const sharp = loadSharp();
  if (sharp) {
    try {
      for (const [width, quality] of [[640, 72], [480, 60], [320, 50]]) {
        const out = await sharp(buf, { failOn: 'none' }).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer();
        if (out.length <= 45000) return out; // an inline thumbnail must stay small
      }
      return null;
    } catch (err) {
      return null;
    }
  }
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 && buf.length <= 40000 ? buf : null; // without sharp only a small JPEG can be used as it is
}

// the picture for the big preview card (the full width card instead of the small one)
async function largeImage(buf) {
  const sharp = loadSharp();
  if (sharp) {
    try {
      return await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    } catch (err) {
      return null;
    }
  }
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 && buf.length <= 1.5 * 1024 * 1024 ? buf : null;
}

async function build(found, fetchOpts) {
  const page = await safefetch.get(found.url, { ...fetchOpts, timeout: 3000, maxBytes: 400 * 1024, headers: { Accept: 'text/html,application/xhtml+xml,image/*;q=0.8' } });
  if (page.status >= 400) return null;
  const type = String(page.headers['content-type'] || '').toLowerCase();
  if (type.startsWith('image/')) {
    const jpeg = await thumbnail(page.body);
    return jpeg ? { 'canonical-url': page.url, 'matched-text': found.matched, title: new URL(page.url).hostname, description: '', jpegThumbnail: jpeg, _full: await largeImage(page.body) } : null;
  }
  if (!/html|xml/.test(type)) return null;
  const meta = parseMeta(page.body.toString('utf8'));
  if (!meta.title && !meta.description) return null;
  let jpeg = null;
  let full = null;
  if (meta.image) {
    try {
      const img = await safefetch.get(new URL(meta.image, page.url).href, { ...fetchOpts, timeout: 3000, maxBytes: 2.5 * 1024 * 1024, headers: { Accept: 'image/*' } });
      if (img.status < 400 && /^image\//i.test(String(img.headers['content-type'] || 'image/'))) {
        jpeg = await thumbnail(img.body);
        full = await largeImage(img.body);
      }
    } catch (err) {
      jpeg = null; // a preview without a picture is still a preview
    }
  }
  return { 'canonical-url': meta.canonical || page.url, 'matched-text': found.matched, title: meta.title || new URL(page.url).hostname, description: meta.description, ...(jpeg ? { jpegThumbnail: jpeg } : {}), ...(full ? { _full: full } : {}) };
}

// text -> the preview information WhatsApp needs, or undefined (no link / no preview possible). Never throws.
// Sends the big picture to WhatsApp so the card is shown FULL (wide picture) instead of the small card.
// Needs the library's upload function. When anything fails, the card still works with the inline thumbnail.
async function addFullPicture(value, upload) {
  const full = value._full;
  delete value._full; // the big picture is not kept in memory
  if (!full || typeof upload !== 'function') return value;
  try {
    const lib = require('./baileys').get();
    const { imageMessage } = await Promise.race([
      lib.prepareWAMessageMedia({ image: full }, { upload, mediaTypeOverride: 'thumbnail-link' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('upload timed out')), UPLOAD_MS)),
    ]);
    if (imageMessage) value.highQualityThumbnail = imageMessage;
  } catch (err) {
    console.log(`ℹ️ Link preview: the full picture could not be sent (${err.message}); the normal card is used.`);
  }
  return value;
}

async function getUrlInfo(text, fetchOpts = {}, upload) {
  const found = firstUrl(text);
  if (!found) return undefined;
  const hit = cache.get(found.url);
  if (hit && Date.now() - hit.at < (hit.value ? 3600000 : 300000)) return hit.value ? { ...hit.value, 'matched-text': found.matched } : undefined;
  let value = null;
  try {
    value = await Promise.race([build(found, fetchOpts), new Promise((r) => setTimeout(() => r(null), BUDGET_MS))]);
  } catch (err) {
    value = null;
  }
  if (value) value = await addFullPicture(value, upload);
  if (cache.size > 300) cache.clear();
  cache.set(found.url, { at: Date.now(), value });
  return value || undefined;
}

module.exports = { getUrlInfo, firstUrl, parseMeta, decode, cache };
