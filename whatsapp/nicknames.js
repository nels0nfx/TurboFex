// Nicknames that members choose for themselves inside one group. They are shown in rank and top.
const jsonstore = require('../core/jsonstore');
const { num } = require('./utils');
const idmap = require('./idmap');

const js = jsonstore.open('nicknames', {}); // { group: { member: "Nick" } }
const MAX_LEN = 20;

// one person = one key (the phone number when it is known)
function keyOf(jid) {
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : null;
  return num(pn || jid);
}

// cleans a nickname: no tags, no line breaks, no control marks
function clean(text) {
  return String(text || '')
    .replace(/[\u0000-\u001f\u200e\u200f\u202a-\u202e\u2066-\u2069@*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}

function get(group, jid) {
  const g = js.data[group];
  return (g && g[keyOf(jid)]) || null;
}

function set(group, jid, text) {
  const n = clean(text);
  if (!n) return null;
  const g = js.data[group] || (js.data[group] = {});
  g[keyOf(jid)] = n;
  js.touch();
  return n;
}

function remove(group, jid) {
  const g = js.data[group];
  if (!g || !g[keyOf(jid)]) return false;
  delete g[keyOf(jid)];
  js.touch();
  return true;
}

// true when another member in this group already uses that nickname (ignoring capital letters)
function taken(group, jid, text) {
  const me = keyOf(jid);
  const want = clean(text).toLowerCase();
  return Object.entries(js.data[group] || {}).some(([k, v]) => k !== me && String(v).toLowerCase() === want);
}

// "Nick (@tag)" when there is a nickname, "@tag" when there is not
function label(group, jid) {
  const n = get(group, jid);
  return n ? `${n} (@${num(jid)})` : `@${num(jid)}`;
}

// every nickname saved in a group: [[key, nickname]]
const all = (group) => Object.entries(js.data[group] || {});

module.exports = { all, get, set, remove, taken, label, clean, MAX_LEN };
