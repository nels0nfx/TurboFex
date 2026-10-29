// WhatsApp wraps messages in several "envelopes" (disappearing chats, view-once, edits, documents with captions...).
// peel() opens all of them and returns the real content.
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
  'botInvokeMessage',
];

function peel(message) {
  let cur = message || {};
  let viewOnce = false;
  for (let i = 0; i < 8; i++) {
    let next = null;
    for (const w of WRAPPERS) {
      if (cur && cur[w] && cur[w].message) {
        next = cur[w].message;
        if (w.startsWith('viewOnce')) viewOnce = true;
        break;
      }
    }
    if (!next) break;
    cur = next;
  }
  return { content: cur || {}, viewOnce };
}

// text of any message (also the caption of a picture, video or document)
function textOf(message) {
  const { content: m } = peel(message);
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

// finds a view-once picture, video or voice note: { kind: 'image'|'video'|'audio', node, empty }
function findViewOnce(message) {
  const { content, viewOnce } = peel(message);
  for (const key of ['imageMessage', 'videoMessage', 'audioMessage']) {
    const node = content[key];
    if (node && (viewOnce || node.viewOnce)) {
      // a view-once whose file details were not sent to this device
      const empty = !node.mediaKey && !node.url && !node.directPath;
      return { kind: key.replace('Message', ''), node, empty };
    }
  }
  return null;
}

// Finds an edit inside any shape WhatsApp uses: { id of the edited message, new text }
function editInfo(obj) {
  const { content } = peel(obj);
  const pm = content.protocolMessage;
  if (pm && (pm.type === 14 || pm.type === 'MESSAGE_EDIT' || pm.editedMessage)) {
    return { id: pm.key?.id || null, text: textOf(pm.editedMessage || {}) };
  }
  return { id: null, text: textOf(content) };
}

module.exports = { peel, textOf, findViewOnce, editInfo, WRAPPERS };
