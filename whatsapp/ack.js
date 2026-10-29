// WhatsApp answers every message we send with an "ack". The library hides the answer when WhatsApp REFUSES a message
// (error 479 on statuses, for example), so sendMessage looks successful although nothing was delivered.
// These helpers read the answer ourselves.
const baileys = require('../core/baileys');

function newId(sock) {
  try {
    const lib = baileys.get();
    if (lib.generateMessageIDV2) return lib.generateMessageIDV2(sock.user?.id);
    if (lib.generateMessageID) return lib.generateMessageID();
  } catch (err) {
    // fall through
  }
  return null;
}

// Starts listening for the answer to message `id`. Call BEFORE sending. Returns a function that gives
// { ok: true } | { ok: false, error: '479' } | { ok: null } (no answer / cannot be checked)
function listen(sock, id, ms = 6000) {
  const ws = sock.ws;
  if (!id || !ws || typeof ws.on !== 'function') return async () => ({ ok: null });
  let done;
  const result = new Promise((resolve) => {
    done = resolve;
  });
  const event = `CB:ack,id:${id}`;
  const handler = (node) => {
    const error = node?.attrs?.error;
    done(error ? { ok: false, error: String(error) } : { ok: true });
  };
  ws.on(event, handler);
  const timer = setTimeout(() => done({ ok: null }), ms);
  const stop = () => {
    clearTimeout(timer);
    try {
      (ws.off || ws.removeListener).call(ws, event, handler);
    } catch (err) {
      // nothing to clean
    }
  };
  return async () => {
    const r = await result;
    stop();
    return r;
  };
}

// Tells WhatsApp we received a <status> notice. rc14 does not do it, and WhatsApp then cuts the connection about every
// 50 minutes ("Stream Errored"). That cut was behind reconnects, "sleeping" and repeated "Finished syncing" notices.
function installStatusAck(sock) {
  const ws = sock.ws;
  if (!ws || typeof ws.on !== 'function' || typeof sock.sendNode !== 'function') return;
  ws.on('CB:status', (node) => {
    const a = node?.attrs || {};
    if (!a.id) return;
    const attrs = { id: a.id, to: a.from, class: 'status' };
    if (a.participant) attrs.participant = a.participant;
    if (a.recipient) attrs.recipient = a.recipient;
    if (a.type) attrs.type = a.type;
    sock.sendNode({ tag: 'ack', attrs }).catch(() => {});
  });
}

module.exports = { newId, listen, installStatusAck };
