// Counts "Bad MAC" / decryption errors. A flood of them means the saved chat sessions are out of sync.
const STORM_COUNT = 15; // this many errors...
const STORM_WINDOW_MS = 60000; // ...within a minute is a flood

const events = [];
let total = 0;
let stormHandler = null;

function recordDecryptFailure() {
  total += 1;
  const now = Date.now();
  events.push(now);
  while (events.length && now - events[0] > STORM_WINDOW_MS) events.shift();
  if (events.length >= STORM_COUNT && stormHandler) {
    events.length = 0;
    stormHandler();
  }
}

const onStorm = (fn) => {
  stormHandler = fn;
};
const stats = () => ({ total, lastMinute: events.length });

module.exports = { recordDecryptFailure, onStorm, stats, STORM_COUNT };
