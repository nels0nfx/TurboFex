// The owner's name for the menu header, taken from WhatsApp itself (nothing to type):
//  1) the bot runs on the owner's own number: the profile name of that WhatsApp account (sock.user.name, or the name that
//     comes with the owner's own messages);
//  2) the bot runs on another number: the name the owner uses on WhatsApp (his profile name, or the name saved in the phone).
// The last name found is saved, so the menu keeps showing it even when WhatsApp does not give it again right away.
// "ownername set <name>" (owner command) overrides it; "ownername auto" goes back to the detected name.
const config = require('../config');
const names = require('./names');
const { num } = require('./utils');
const jsonstore = require('../core/jsonstore');

const js = jsonstore.open('owner-name', {}); // { detected, custom }

const clean = (n) =>
  String(n || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
const usable = (n) => !!n && !/^[+\d\s-]+$/.test(n); // a name that is only a number says nothing

const botIsOwner = (sock) => !!config.ownerNumber && num(sock && sock.user && sock.user.id) === config.ownerNumber;

function save(name) {
  const n = clean(name);
  if (!usable(n) || js.data.detected === n) return;
  js.data.detected = n;
  js.touch();
}

// from a message the owner wrote himself on the phone (it carries his profile name)
function learn(sock, msg) {
  if (msg && msg.key && msg.key.fromMe && msg.pushName && botIsOwner(sock)) save(msg.pushName);
}

// the name to show ('' when WhatsApp has not told us yet)
function get(sock) {
  if (js.data.custom) return js.data.custom;
  let found = '';
  if (botIsOwner(sock)) found = clean(sock.user.name);
  if (!usable(found) && config.ownerNumber) found = clean(names.get(`${config.ownerNumber}@s.whatsapp.net`));
  if (usable(found)) save(found);
  return usable(found) ? found : js.data.detected || '';
}

function setCustom(name) {
  const n = clean(name);
  if (n) js.data.custom = n;
  else delete js.data.custom;
  js.touch();
  return n;
}

module.exports = { get, learn, setCustom, js };
