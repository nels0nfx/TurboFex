// Display names. WhatsApp only shows a tag (@Name) as a name inside the group the person is in. In a private chat (for
// example the notices sent to the owner) a tag shows a bare number, and for hidden "LID" people a long number nobody knows.
// So the bot remembers the names people use on WhatsApp (their profile name, or the name in your contacts) and writes the
// NAME in those messages instead.
const jsonstore = require('../core/jsonstore');
const idmap = require('./idmap');
const { num } = require('./utils');

const js = jsonstore.open('names', {}); // { number: "Name" } (phone number or LID number)
const saved = jsonstore.open('saved-contacts', {}); // { number: 1 }: people who are in the owner's phone contacts
const MAX = 6000;

const clean = (n) =>
  String(n || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

function remember(jid, name) {
  const n = clean(name);
  if (!jid || !n || /^[+\d\s-]+$/.test(n)) return; // a name that is only a number says nothing
  const keys = new Set([num(jid)]);
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : null;
  const lid = idmap.isPn(jid) ? idmap.lidSync(jid) : null;
  if (pn) keys.add(num(pn));
  if (lid) keys.add(num(lid));
  let changed = false;
  for (const k of keys) {
    if (k && js.data[k] !== n) {
      js.data[k] = n;
      changed = true;
    }
  }
  if (!changed) return;
  const all = Object.keys(js.data);
  if (all.length > MAX) for (const k of all.slice(0, all.length - MAX)) delete js.data[k];
  js.touch();
}

// from a received message: msg.pushName is the name its sender chose
function learnMessage(msg) {
  const k = msg?.key;
  if (!k || k.fromMe || !msg.pushName) return;
  const isGroup = String(k.remoteJid || '').endsWith('@g.us');
  const ids = isGroup ? [k.participant, k.participantAlt, k.participantPn] : [k.remoteJid, k.remoteJidAlt];
  for (const id of ids.filter(Boolean)) remember(id, msg.pushName);
}

// from the contact list WhatsApp hands over (a name you saved wins over the profile name)
function learnContacts(list) {
  for (const c of list || []) {
    const name = c.name || c.verifiedName || c.notify;
    for (const id of [c.id, c.lid, c.phoneNumber, c.jid].filter(Boolean)) {
      remember(id, name);
      // "name" is the name the owner saved in the phone; "notify" is only the person's own profile name
      if (c.name && !saved.data[num(id)] && !String(id).endsWith('@g.us')) {
        saved.data[num(id)] = 1;
        saved.touch();
      }
    }
  }
}

// is this person in the owner's contacts?
const isSaved = (jid) => {
  if (!jid) return false;
  if (saved.data[num(jid)]) return true;
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : null;
  const lid = idmap.isPn(jid) ? idmap.lidSync(jid) : null;
  return !!((pn && saved.data[num(pn)]) || (lid && saved.data[num(lid)]));
};

function get(jid) {
  if (!jid) return null;
  const direct = js.data[num(jid)];
  if (direct) return direct;
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : null;
  const lid = idmap.isPn(jid) ? idmap.lidSync(jid) : null;
  return (pn && js.data[num(pn)]) || (lid && js.data[num(lid)]) || null;
}

// a readable phone number, only when we really know it (a LID number is NOT a phone number)
function phoneOf(jid) {
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : idmap.isPn(jid) ? jid : null;
  const n = pn ? num(pn) : '';
  return n.length >= 7 && n.length <= 15 ? `+${n}` : null;
}

module.exports = { remember, learnMessage, learnContacts, get, phoneOf, isSaved };
