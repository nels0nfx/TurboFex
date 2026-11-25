// Ignored chats: the owner can tell the bot to ignore a chat (a group or a private chat) with `ignore on`. In an ignored chat the bot does
// nothing for what other people write: no commands, no protections, no games, no auto replies, no reactions. The owner's own commands
// still work there, so it can be switched off again. Saved in data/ignored.json.
const jsonstore = require('../core/jsonstore');
const idmap = require('./idmap');
const { num } = require('./utils');

const js = jsonstore.open('ignored', { chats: [] });

// one way to write a chat: a group stays as it is; a private chat is written with the phone number when it is known, so the two ways
// WhatsApp can address one person ("@lid" and "@s.whatsapp.net") are the same chat
function keyOf(jid) {
  const j = String(jid || '');
  if (!j) return '';
  if (j.endsWith('@g.us')) return j;
  const pn = idmap.isPn(j) ? j : idmap.pnSync(j);
  return pn ? `${num(pn)}@s.whatsapp.net` : `${num(j)}@${j.split('@')[1] || 's.whatsapp.net'}`;
}

const isIgnored = (jid) => js.data.chats.length > 0 && js.data.chats.includes(keyOf(jid));

// switches one chat; returns false when it was already like that (nothing is saved then)
function set(jid, value) {
  const key = keyOf(jid);
  if (!key) return false;
  const has = js.data.chats.includes(key);
  if (value === has) return false;
  js.data.chats = value ? [...js.data.chats, key] : js.data.chats.filter((c) => c !== key);
  js.touch();
  return true;
}

const list = () => [...js.data.chats];

// replaces the whole list (the settings reset and its undo)
function restore(chats) {
  js.data.chats = [...(chats || [])];
  js.touch();
}

module.exports = { isIgnored, set, list, restore, keyOf };
