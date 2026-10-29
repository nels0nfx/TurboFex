// API keys the owner sends to the bot (setapi, or removebg <key>): checked, saved, and never shown in full
const store = require('../whatsapp/store');
const web = require('./web');

const LOOKS_LIKE_KEY = /^[A-Za-z0-9_-]{16,80}$/;
const mask = (k) => (!k ? 'not set' : k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-3)}`);

// asks the service if the key works. Network trouble does not block saving.
async function validate(name, key) {
  try {
    if (name === 'removebg') {
      const res = await fetch('https://api.remove.bg/v1.0/account', { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(10000) });
      if (res.status === 401 || res.status === 403) return { ok: false, why: 'remove.bg says this key is not valid.' };
    }
    if (name === 'musixmatch') {
      const j = await web.getJson(`https://api.musixmatch.com/ws/1.1/track.search?q=test&page_size=1&apikey=${encodeURIComponent(key)}`, { timeout: 10000 });
      const code = j?.message?.header?.status_code;
      if (code === 401 || code === 403) return { ok: false, why: 'Musixmatch says this key is not valid.' };
    }
  } catch (err) {
    return { ok: true, unchecked: true };
  }
  return { ok: true };
}

// saves a key; the message that held it is deleted when WhatsApp allows it. Returns the text to reply with.
async function save({ sock, jid, msg }, name, key) {
  if (!store.apiKeyNames().includes(name)) return `⚠️ *I do not know "${String(name).slice(0, 20)}".* Choose: ${store.apiKeyNames().join(', ')}`;
  const check = await validate(name, key);
  if (!check.ok) return `⚠️ *The key was not saved.* ${check.why}`;
  store.setApiKey(name, key);
  let deleted = false;
  try {
    await sock.sendMessage(jid, { delete: msg.key });
    deleted = true;
  } catch (err) {
    // only possible for your own messages or as a group admin
  }
  return `✅ *${name} key saved:* ${mask(key)}${check.unchecked ? '\n_I could not check it right now, so it was saved without a test._' : ''}\n${deleted ? '_I deleted your message with the key._' : '_Please delete your message with the key from the chat._'}`;
}

module.exports = { save, mask, LOOKS_LIKE_KEY, validate };
