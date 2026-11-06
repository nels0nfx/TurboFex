// What WhatsApp answered to a message the bot sent: accepted, or refused (with its error code).
// Baileys reports it through "messages.update" (status 0 = refused, 2 and up = accepted). Used to
//  - fall back to a plain menu when WhatsApp refuses the picture card,
//  - show in the antigstatus report whether WhatsApp refused a delete.
const recent = new Map(); // id -> { status, error }
const waiting = new Map(); // id -> function
const last = { delete: 'nothing sent yet' };

function note(updates) {
  for (const u of updates || []) {
    const id = u?.key?.id;
    const status = u?.update?.status;
    if (!id || status === undefined || status === 1) continue; // 1 = still pending
    const info = { status, error: (u.update.messageStubParameters || [])[0] };
    recent.set(id, info);
    if (recent.size > 300) recent.delete(recent.keys().next().value);
    const w = waiting.get(id);
    if (w) w(info);
  }
}

const verdictOf = (info) => (info.status === 0 ? { result: 'refused', error: info.error } : { result: 'ok' });

// resolves with { result: 'ok' | 'refused' | 'unknown', error? } (unknown = no answer in time)
function expect(id, ms = 5000) {
  return new Promise((resolve) => {
    const known = id && recent.get(id);
    if (known) return resolve(verdictOf(known));
    if (!id) return resolve({ result: 'unknown' });
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve({ result: 'unknown' });
    }, process.env.TURBOFEX_FAST ? 5 : ms); // the tests do not wait seconds
    waiting.set(id, (info) => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve(verdictOf(info));
    });
    return undefined;
  });
}

const newId = () => `3EB0${require('crypto').randomBytes(14).toString('hex').toUpperCase()}`;

module.exports = { note, expect, newId, last };
