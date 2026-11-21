// A fatal error that nobody caught ("uncaughtException") used to be only logged, and the bot kept running, maybe half broken.
// One such error is survived (it is usually a one-off from a library). When it keeps happening (3 times in 10 minutes) the bot
// is not healthy any more, so it restarts cleanly: everything is saved first, and the login is kept.
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 3;
const times = [];

// records one crash; returns true when it is time to restart
function record(now = Date.now()) {
  times.push(now);
  while (times.length && now - times[0] > WINDOW_MS) times.shift();
  return times.length >= LIMIT;
}

const reset = () => { times.length = 0; };

module.exports = { record, reset, WINDOW_MS, LIMIT };
