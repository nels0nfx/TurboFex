// ============================================================
//  TURBOFEX SETTINGS  -  edit the values between the quotes
//  Numbers: country code + number, digits only, NO plus sign.
//  Example (South Africa): 27821234567
// ============================================================
const fs = require('fs');
const path = require('path');
const { DATA } = require('./core/paths');

// a prefix is 1 to 3 characters, no spaces, no slash (Termux's own PREFIX is /data/data/com.termux/files/usr)
const validPrefix = (v) => (/^[^\s/\\]{1,3}$/u.test(String(v || '')) ? String(v) : '');

const digits = (v) => String(v || '').replace(/\D/g, '');

// the number the owner typed when the bot was first started (see core/setup.js)
let saved = {};
try {
  saved = require('./core/safefile').load(path.join(DATA, 'setup.json'), 'setup.json').data || {};
} catch (err) {
  saved = {};
}

// ONE number: the WhatsApp number the bot is linked to, and also its owner.
// Leave it empty: it is taken from the login you get on the pairing site (the session ID).
const number = digits(process.env.NUMBER) || digits(process.env.PAIRING_NUMBER) || digits(saved.number);
// (Older setups that still set OWNER_NUMBER keep working: that number stays the owner.)
const legacyOwner = digits(process.env.OWNER_NUMBER);

module.exports = {
  // Symbol that starts every command, e.g. .ping
  // BOT_PREFIX or PREFIX. Termux sets its own PREFIX (a folder path): a value that is not a short symbol is ignored
  prefix: validPrefix(process.env.BOT_PREFIX) || validPrefix(process.env.PREFIX) || '.',

  // The bot's number = the owner's number (taken from the linked login; NUMBER can set it by hand)
  number,
  ownerNumber: legacyOwner || number,
  pairingNumber: number,
  legacyOwner: !!legacyOwner && legacyOwner !== number,

  // The normal way to link is the pairing site + SESSION_ID (below). The old way, where the console asks for the number
  // and shows a pairing code or QR, only runs when CONSOLE_LINK=1 is set (PAIR_METHOD=code|qr then picks the method).
  consoleLink: /^(1|true|yes|on)$/i.test(process.env.CONSOLE_LINK || ''),
  pairMethod: !/^(1|true|yes|on)$/i.test(process.env.CONSOLE_LINK || '') ? '' : /^(code|pairing|pair)$/i.test(process.env.PAIR_METHOD || '') ? 'code' : /^qr$/i.test(process.env.PAIR_METHOD || '') ? 'qr' : '',

  // Time zone used for the menu clock and auto open/close, e.g. 'Africa/Johannesburg' (.region changes it too)
  timezone: process.env.TIMEZONE || 'Africa/Johannesburg',

  // Linking with a session ID: link on the pairing site, copy the ID (TFX-XXXX-XXXX-XXXX) and paste it in the file
  // session_id.txt (the bot creates it and tells you when it needs it). The SESSION_ID variable of the host works too.
  pairSiteUrl: process.env.PAIR_SITE_URL || 'https://turbofex-pair.onrender.com',
  sessionId: process.env.SESSION_ID || '',
  sessionIdFile: process.env.SESSION_ID_FILE || path.join(__dirname, 'session_id.txt'), // one file per account when several accounts run (SESSION_ID_FILE)

  // Folder where the WhatsApp login is saved (do not delete it)
  sessionDir: process.env.SESSION_DIR || 'session', // one folder per account when several accounts run (SESSION_DIR)

  // Optional. How the bot shows up in WhatsApp > Linked devices when you link it. Leave it empty to keep the default.
  // 'android' lets the bot receive view-once pictures and videos (you must link the bot again after changing it).
  browser: process.env.BOT_BROWSER || 'android', // how the bot shows up in Linked devices. android receives view-once files; BOT_BROWSER=web gives the old browser identity
};
