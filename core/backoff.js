// How long to wait before trying to start the WhatsApp connection again after the START itself failed
// (a disk error, too many open files, the library failing to load). It grows with every failure up to one minute,
// and the caller keeps trying for as long as the bot runs, so a short problem never leaves the bot offline for good.
const MAX_MS = 60 * 1000;

function delayAfter(failures) {
  const n = Math.max(1, Number(failures) || 1);
  return Math.min(MAX_MS, 5000 * 2 ** Math.min(n - 1, 4));
}

module.exports = { delayAfter, MAX_MS };
