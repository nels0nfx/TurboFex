// Why the phone keeps showing "Finished syncing with WhatsApp on Google Chrome (Ubuntu)".
//
// Every time a linked device asks the phone to send a message again ("placeholder resend": what the library does after a
// message could not be decrypted, and what the view-once watcher does), WhatsApp shows that notice on the phone. A number with
// many groups and contacts gets a lot of messages that cannot be decrypted at once (missing or old chat sessions), so the phone
// shows the notice again and again. A small number does not. (Same report, with the same cause: WhiskeySockets/Baileys issue 2591.)
//
// The library keeps a cache of the messages it already asked for and does not ask twice for the same id. This cache says "already
// asked" for EVERY message, so the library's automatic requests never reach the phone. The normal repair (a retry receipt sent to
// the sender, who sends the message again) is not touched. Only the view-once watcher may ask the phone, with allow(), and only
// a few times per hour.
const PER_HOUR = Number(process.env.PHONE_ASKS_PER_HOUR) || 4;

const real = new Map(); // ids we really asked for
const allowed = new Set();
const asks = []; // when we asked (last hour)

const cache = {
  get: (id) => (allowed.has(id) ? real.get(id) : true), // true = "already asked": the library does nothing
  set: (id, value) => {
    if (allowed.has(id)) real.set(id, value === undefined ? true : value);
  },
  del: (id) => {
    real.delete(id);
    allowed.delete(id);
  },
  flushAll: () => {
    real.clear();
    allowed.clear();
  },
};

// the view-once watcher asks to send ONE request to the phone: true when the hourly limit still has room
function allow(id) {
  const now = Date.now();
  while (asks.length && now - asks[0] > 3600 * 1000) asks.shift();
  if (!id || asks.length >= PER_HOUR) return false;
  asks.push(now);
  allowed.add(id);
  const t = setTimeout(() => cache.del(id), 60000); // never keeps a request open for long
  if (t.unref) t.unref();
  return true;
}

module.exports = { cache, allow, PER_HOUR, used: () => asks.length };
