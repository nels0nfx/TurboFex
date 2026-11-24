// Inside the temporary process of `pair`: once the person's number is linked, the person's own login is turned into a session ID and sent from
// their account to THEIR OWN chat ("Message yourself"), like the pairing site does. The owner never receives it. See core/pairing.js.
const path = require('path');
const pairing = require('./pairing');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const started = new Set(); // a second "online" (a short network problem) must not send the session ID twice
const numberOf = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

// sock: the connected socket of the temporary process. Never throws; tells the owner's side the result through pairing-status.json.
async function deliver({ sock, sessionDir, dataDir, settleMs = 5000, tries = 6, gapMs = 1500 }) {
  if (started.has(dataDir)) return;
  started.add(dataDir);
  try {
    await wait(settleMs); // after "online" the login file is still being completed
    let out = { error: 'no login was saved' };
    for (let i = 0; i < tries; i++) {
      out = pairing.exportSession(sessionDir);
      if (out.id) break;
      await wait(gapMs);
    }
    if (!out.id) return pairing.note(dataDir, 'failed', { reason: out.error });

    const me = numberOf(sock.user && sock.user.id) || numberOf(out.jid);
    if (!me) return pairing.note(dataDir, 'failed', { reason: 'I do not know the number that was linked' });
    const to = `${me}@s.whatsapp.net`; // their own chat
    for (const text of pairing.userMessages(out.id)) {
      await sock.sendMessage(to, { text });
      await wait(400); // one after the other, in order
    }
    pairing.note(dataDir, 'delivered', { number: me });
  } catch (err) {
    pairing.note(dataDir, 'failed', { reason: String(err && err.message || err).slice(0, 120) });
  }
}

module.exports = { deliver };
