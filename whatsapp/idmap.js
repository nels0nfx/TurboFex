// WhatsApp hides phone numbers behind "LID" ids in many chats. Pairs are learned from messages,
// contacts and the member lists of your groups, and kept on disk.
const { withTimeout } = require('./timeout');
const { num } = require('./utils');
const jsonstore = require('../core/jsonstore');

const isLid = (j) => String(j).endsWith('@lid');
const isPn = (j) => String(j).endsWith('@s.whatsapp.net');
const TTL = 10 * 60 * 1000;
const MAX = 50000; // a big contact list must not push people out of the table again and again

// data/idmap.json: the safe store (atomic writes, backup copy, written again on stop or restart)
const js = jsonstore.open('idmap', {}, { delay: 2000 });
const known = js.data; // lid number -> phone jid
// The other way round (phone number -> lid number), kept up to date by learn(): looking a person up used to walk through the
// whole table every time (every message, every reply, every contact), which froze big accounts for seconds.
const reverse = new Map();
let count = 0;
for (const k of Object.keys(known)) {
  reverse.set(num(known[k]), k);
  count += 1;
}

function flush() {
  js.flush();
}

function learn(lid, pn) {
  if (!lid || !pn || !isLid(lid) || !isPn(pn)) return;
  const k = num(lid);
  const clean = `${num(pn)}@s.whatsapp.net`;
  if (known[k] === clean) return;
  if (k in known) reverse.delete(num(known[k]));
  else count += 1;
  known[k] = clean;
  reverse.set(num(clean), k);
  if (count > MAX) {
    for (const first in known) { // the oldest pair goes
      reverse.delete(num(known[first]));
      delete known[first];
      count -= 1;
      break;
    }
  }
  js.touch();
}

// every message carries both forms of the sender in the key (when WhatsApp knows them)
function learnKey(key) {
  if (!key) return;
  for (const [a, b] of [[key.remoteJid, key.remoteJidAlt], [key.participant, key.participantAlt], [key.participant, key.participantPn]]) {
    if (!a || !b) continue;
    learn(isLid(a) ? a : b, isPn(a) ? a : b);
  }
}

function learnContacts(list) {
  for (const c of list || []) learn(c.lid || (isLid(c.id) ? c.id : null), isPn(c.id) ? c.id : c.phoneNumber || c.jid);
}

let groupCache = { at: 0 };
async function load(sock) {
  if (Date.now() - groupCache.at < TTL) return;
  groupCache = { at: Date.now() };
  try {
    const all = await withTimeout(sock.groupFetchAllParticipating(), 30000, 'group list timed out');
    for (const g of Object.values(all)) {
      for (const p of g.participants || []) {
        const ids = [p.id, p.lid, p.jid, p.phoneNumber].filter(Boolean);
        learn(ids.find(isLid), ids.find(isPn));
      }
    }
  } catch (err) {
    groupCache.at = Date.now() - TTL + 30000; // try again in 30 seconds
  }
}

async function pnFor(sock, lid) {
  if (known[num(lid)]) return known[num(lid)];
  await load(sock);
  return known[num(lid)] || null;
}

async function lidFor(sock, pn) {
  const find = () => {
    const k = reverse.get(num(pn));
    return k ? `${k}@lid` : null;
  };
  return find() || (await load(sock), find());
}

// instant lookups (only what is already known, nothing is asked from WhatsApp)
const pnSync = (lid) => known[num(lid)] || null;
const lidSync = (pn) => {
  const k = reverse.get(num(pn));
  return k ? `${k}@lid` : null;
};

module.exports = { pnSync, lidSync, pnFor, lidFor, learn, learnKey, learnContacts, isLid, isPn, flush };
