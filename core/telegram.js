// Reads a Telegram sticker pack with the free Telegram Bot API (needs a bot token: setapi telegram <token>) and turns the
// stickers into WhatsApp stickers. Nothing is stored on disk.
const store = require('../whatsapp/store');
const media = require('../whatsapp/media');

const API = 'https://api.telegram.org';
const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/;

// "https://t.me/addstickers/Name", "t.me/addstickers/Name" or just "Name"
function packName(text) {
  const t = String(text || '').trim();
  const m = /(?:t(?:elegram)?\.me\/addstickers\/)([A-Za-z0-9_]{3,64})/i.exec(t) || /^([A-Za-z0-9_]{3,64})$/.exec(t);
  return m ? m[1] : null;
}

async function call(method, params) {
  const token = store.getApiKey('telegram');
  if (!token) throw Object.assign(new Error('no telegram token'), { code: 'NO_TOKEN' });
  const res = await fetch(`${API}/bot${token}/${method}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description || `Telegram answered ${res.status}`), { code: res.status === 401 ? 'BAD_TOKEN' : res.status === 400 ? 'NOT_FOUND' : 'FAILED' });
  return j.result;
}

const getSet = (name) => call('getStickerSet', { name });

async function fileBuffer(fileId) {
  const f = await call('getFile', { file_id: fileId });
  const token = store.getApiKey('telegram');
  const res = await fetch(`${API}/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return { buffer: Buffer.from(await res.arrayBuffer()), path: f.file_path };
}

// one Telegram sticker -> WhatsApp sticker (webp). Animated .tgs (Lottie) can not be converted: returns null for those.
async function toWhatsApp(sticker) {
  if (sticker.is_animated) return null;
  const { buffer, path } = await fileBuffer(sticker.file_id);
  // the pack name / author is added by the bot when it sends the sticker (see stickerpack)
  return media.toSticker(sticker.is_video || /\.webm$/i.test(path) ? 'video' : 'image', buffer);
}

module.exports = { packName, getSet, toWhatsApp, TOKEN_RE };
