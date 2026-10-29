// When the bot reconnects, WhatsApp may re-deliver messages that arrived while it was offline.
// For a short time after connecting, messages older than 2 minutes are ignored.
const WINDOW_MS = 20000;
const STALE_SECONDS = 120;
let until = 0;

function open() {
  until = Date.now() + WINDOW_MS;
}

// true during the first seconds after connecting
const inWindow = () => Date.now() < until;

function timestampOf(msg) {
  const t = msg.messageTimestamp;
  if (t == null) return 0;
  if (typeof t === 'object') return Number(t.low ?? (t.toNumber ? t.toNumber() : 0)) || 0;
  return Number(t) || 0;
}

function isReplay(msg) {
  if (Date.now() >= until) return false;
  const ts = timestampOf(msg);
  return ts > 0 && Date.now() / 1000 - ts > STALE_SECONDS;
}

module.exports = { open, isReplay, inWindow, timestampOf };
