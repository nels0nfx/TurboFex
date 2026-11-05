// Reaction on the command message: ⏳ while the bot works, then ✅ (or ⚠️ / ❌ when something went wrong).
// The reaction is removed again a few seconds later. Turn it off with the "cmdreact" command. Reactions never slow a command down:
//  - they are sent in the background
//  - the ⏳ only appears when a command takes longer than a moment (quick commands go straight to ✅), so a reaction never competes with the reply
const store = require('./store');
const { withTimeout } = require('./timeout');

const LOADING = '⏳';
const DONE = '✅';
const WARN = '⚠️';
const FAIL = '❌';
const LOADING_AFTER_MS = 900;
// the reaction is taken off again a few seconds after the command is done (a problem stays a little longer so it is noticed)
const CLEAR_OK_MS = (Number(process.env.CMDREACT_CLEAR_SECONDS) || 5) * 1000;
const CLEAR_PROBLEM_MS = CLEAR_OK_MS + 4000;

function begin(sock, msg) {
  const mode = store.getCmdReact();
  if (mode === 'off' || !msg?.key?.id || !msg.key.remoteJid) return { finish() {} };

  let chain = Promise.resolve(); // reactions go one after the other so the last one always wins
  const send = (text) => {
    chain = chain
      .then(() => withTimeout(sock.sendMessage(msg.key.remoteJid, { react: { text, key: msg.key } }), 10000, 'reaction timed out'))
      .catch(() => {}); // a missing reaction must never break a command
    return chain;
  };
  const settle = (text, ms) => {
    const done = send(text);
    setTimeout(() => send(''), ms).unref(); // an empty reaction removes it; the chain keeps the order
    return done;
  };
  let loadingShown = false;
  const timer = setTimeout(() => {
    loadingShown = true;
    send(LOADING);
  }, LOADING_AFTER_MS);

  return {
    // outcome: 'ok' | 'warn' | 'fail'
    finish(outcome) {
      clearTimeout(timer);
      if (mode === 'smart' && !loadingShown && outcome === 'ok') return undefined; // quick command: no reaction at all
      if (outcome === 'fail') return settle(FAIL, CLEAR_PROBLEM_MS);
      if (outcome === 'warn') return settle(WARN, CLEAR_PROBLEM_MS);
      if (mode === 'clean') return loadingShown ? send('') : undefined; // nothing to remove if the ⏳ never appeared
      return settle(DONE, CLEAR_OK_MS);
    },
  };
}

module.exports = { begin, LOADING, DONE, WARN, FAIL };
