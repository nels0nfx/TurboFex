const fs = require('fs');
const path = require('path');
const config = require('../config');
const idmap = require('./idmap');
const { num, selfJid } = require('./utils');
const { DATA } = require('../core/paths');

// WhatsApp can address the same person two ways: by phone number or by a hidden "LID". Many phones (iPhones
// especially) can only open messages sent to their LID; a message sent to the phone number shows
// "Waiting for this message" there. So the owner is addressed exactly the way WhatsApp showed him to us.
const file = path.join(DATA, 'owner-chat.json');
let remembered = null;
try {
  remembered = JSON.parse(fs.readFileSync(file, 'utf8')).jid || null;
} catch (err) {
  remembered = null;
}

// called when the owner writes to the bot in a private chat
function remember(jid) {
  if (!jid || jid === remembered) return;
  remembered = jid;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ jid }));
  } catch (err) {
    // not important
  }
}

// The owner's own chat: their DM when the bot runs on another number, otherwise the bot's own chat
function ownerChat(sock) {
  const owner = config.ownerNumber;
  const account = num(sock.user?.id);
  if (!owner || owner === account) return selfJid(sock);
  if (remembered) return remembered;
  return idmap.lidSync(`${owner}@s.whatsapp.net`) || `${owner}@s.whatsapp.net`;
}

// a chat id typed or saved as the owner's phone number becomes the owner's real chat
function normalize(sock, jid) {
  if (jid && String(jid).endsWith('@s.whatsapp.net') && config.ownerNumber && num(jid) === config.ownerNumber) return ownerChat(sock);
  return jid;
}

module.exports = { ownerChat, remember, normalize };
