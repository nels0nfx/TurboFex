// Newer WhatsApp versions no longer send an edit as plain text. The new text is sealed inside a "secret" envelope that
// can only be opened with the secret key of the ORIGINAL message (every message carries one). The WhatsApp library
// version used here cannot open these envelopes, so anti-edit saw nothing. This opens them, the same way the
// library's own fix does: key = HKDF-SHA256(secret of the original message, "<original id><original sender><editor>Message Edit"),
// then AES-256-GCM. The sender's id can be in its phone-number or LID form, so both are tried.
const crypto = require('crypto');
const baileys = require('../core/baileys');
const idmap = require('./idmap');
const { num } = require('./utils');
const { WRAPPERS, textOf } = require('./unwrap');

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

const toBuf = (x) => {
  if (!x) return null;
  if (typeof x === 'string') return Buffer.from(x, 'base64');
  if (x.type === 'Buffer' && Array.isArray(x.data)) return Buffer.from(x.data);
  return Buffer.from(x);
};

// the secret of a saved message (it sits in messageContextInfo, possibly inside wrappers)
function findSecret(message) {
  let cur = message;
  for (let i = 0; i < 8 && cur; i++) {
    const s = toBuf(cur.messageContextInfo?.messageSecret);
    if (s && s.length) return s;
    let next = null;
    for (const w of WRAPPERS) if (cur[w]?.message) next = cur[w].message;
    cur = next;
  }
  return null;
}

// all the ways the editor can be written: phone number form and LID form
function identities(key) {
  const raw = [key.participant, key.participantAlt, key.participantPn, key.remoteJid, key.remoteJidAlt].filter((j) => j && !String(j).endsWith('@g.us') && !String(j).endsWith('@broadcast'));
  const out = new Set();
  for (const j of raw) {
    const n = num(j);
    if (String(j).endsWith('@lid')) {
      out.add(`${n}@lid`);
      const pn = idmap.pnSync(j);
      if (pn) out.add(`${num(pn)}@s.whatsapp.net`);
    } else {
      out.add(`${n}@s.whatsapp.net`);
      const lid = idmap.lidSync(j);
      if (lid) out.add(lid);
    }
  }
  return [...out];
}

function derive(secret, origId, origSender, editor) {
  const info = Buffer.concat([Buffer.from(origId), Buffer.from(origSender), Buffer.from(editor), Buffer.from('Message Edit'), Buffer.from([1])]);
  return hmac(hmac(Buffer.alloc(32), secret), info);
}

// returns the new text, or null when it could not be opened
function decryptEdit({ sec, key, secret }) {
  const origId = sec.targetMessageKey?.id;
  const payload = toBuf(sec.encPayload);
  const iv = toBuf(sec.encIv);
  if (!origId || !payload || !iv || payload.length < 17) return null;
  const ct = payload.subarray(0, -16);
  const tag = payload.subarray(-16);
  const ids = identities(key);
  for (const orig of ids) {
    for (const editor of ids) {
      const k = derive(secret, origId, orig, editor);
      for (const aad of [null, `${origId}\u0000${editor}`]) {
        try {
          const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
          d.setAuthTag(tag);
          if (aad) d.setAAD(Buffer.from(aad));
          const plain = Buffer.concat([d.update(ct), d.final()]);
          const decoded = baileys.get().proto.Message.decode(plain);
          const inner = decoded.protocolMessage?.editedMessage || decoded; // the new content, wrapped or bare
          return textOf(inner) || null;
        } catch (err) {
          // wrong combination: the authentication check rejects it, try the next
        }
      }
    }
  }
  return null;
}

// seal (used by the tests, and shows the exact format)
function seal({ secret, origId, origSender, editor, text, iv }) {
  const proto = baileys.get().proto;
  const plain = Buffer.from(proto.Message.encode(proto.Message.create({ protocolMessage: { type: 14, editedMessage: { conversation: text } } })).finish());
  const c = crypto.createCipheriv('aes-256-gcm', derive(secret, origId, origSender, editor), iv);
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

module.exports = { decryptEdit, findSecret, seal, identities };
