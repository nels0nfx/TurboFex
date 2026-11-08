// How the bot is linked to WhatsApp. WhatsApp does NOT send view-once pictures, videos or voice notes to a device that is linked
// like WhatsApp Web (browser, desktop): those arrive as an empty message. A device linked like the Android app (BOT_BROWSER=android
// at the moment of linking) does get them. The identity is fixed when the bot is linked, so it cannot be changed without linking again.
function platformOf(sock) {
  return String(sock?.authState?.creds?.platform || '').toLowerCase();
}

// true = linked like a phone app; false = linked like a web/desktop device; null = unknown
function phoneClass(sock) {
  const p = platformOf(sock);
  if (!p) return null;
  return /android|iphone|ios|smba|smbi|phone/.test(p);
}

// the owner's note about view-once, or '' when everything is fine
function viewOnceNote(sock, prefix = '.') {
  if (phoneClass(sock) !== false) return '';
  return `⚠️ *This bot is linked like WhatsApp Web, so WhatsApp does not send it view-once files.*\n▸ They arrive empty, so they cannot be copied. This is WhatsApp's rule, not a setting of the bot.\n▸ *Fix:* link the bot again as an Android device. Set \`BOT_BROWSER=android\` on the host, then link with a new pairing code or session id (the pairing site must use the same Android identity).\n▸ Until then, reply to the view-once message with \`${prefix}vv\` to open it.`;
}

module.exports = { platformOf, phoneClass, viewOnceNote };
