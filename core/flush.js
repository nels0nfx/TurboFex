// Things that keep data in memory and write it to disk a moment later register here, so the bot can
// write everything out before it stops or restarts.
//   onFlushSync(fn)  a saver that finishes at once (a JSON file). It also runs when the process exits for ANY reason
//                    (exit, restart, SIGTERM from the panel, Ctrl+C, closing the console).
//   onFlush(fn)      a saver that may need a moment (the encryption keys).
const syncHooks = [];
const hooks = [];

function onFlushSync(fn) {
  syncHooks.push(fn);
}
function onFlush(fn) {
  hooks.push(fn);
}

// writes every JSON file that has unsaved changes. Never throws.
function flushAllSync() {
  for (const fn of syncHooks) {
    try {
      fn();
    } catch (err) {
      console.error('Could not save:', err.message);
    }
  }
}

async function flushAll() {
  flushAllSync();
  await Promise.all(hooks.map((fn) => Promise.resolve().then(fn).catch(() => {})));
}

let installed = false;
let leaving = false;

// Called once at start. A panel stops the bot with SIGTERM (and a hard kill a few seconds later), so the files are
// written the moment the signal arrives, BEFORE anything slow is waited for.
function installSignals() {
  if (installed) return;
  installed = true;
  process.on('exit', flushAllSync);
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    try {
      process.on(sig, () => {
        if (leaving) return;
        leaving = true;
        flushAllSync();
        const stop = setTimeout(() => process.exit(0), 4000);
        if (stop.unref) stop.unref();
        flushAll().finally(() => process.exit(0));
      });
    } catch (err) {
      // a signal that does not exist on this system
    }
  }
}

module.exports = { onFlush, onFlushSync, flushAll, flushAllSync, installSignals };
