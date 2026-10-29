const crypto = require('crypto');
const baileys = require('../core/baileys');

// Does the installed WhatsApp library know the group status message types?
function libraryKnows(...names) {
  try {
    const { proto } = baileys.get();
    return names.every((n) => n in proto.Message.prototype);
  } catch (err) {
    return false;
  }
}

// Posts a group status (the "story" that appears inside a group). Works from any chat, no admin rights needed.
async function postGroupStatus(sock, groupJid, content) {
  if (!libraryKnows('groupStatusMessageV2')) {
    throw Object.assign(new Error('This WhatsApp library version does not support group status'), { code: 'NEED_LIB' });
  }
  const { generateWAMessageContent, generateWAMessageFromContent } = baileys.get();
  const inner = await generateWAMessageContent(content, { upload: sock.waUploadToServer });
  const secret = crypto.randomBytes(32);
  const full = generateWAMessageFromContent(
    groupJid,
    { messageContextInfo: { messageSecret: secret }, groupStatusMessageV2: { message: { ...inner, messageContextInfo: { messageSecret: secret } } } },
    { userJid: sock.user.id }
  );
  await sock.relayMessage(groupJid, full.message, { messageId: full.key.id });
  return full.key.id;
}

module.exports = { postGroupStatus, libraryKnows };
