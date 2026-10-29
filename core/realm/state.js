// The saved data of the Empire: one record for every realm (a group) and one for every citizen of a realm.
const jsonstore = require('../jsonstore');
const levels = require('../../whatsapp/levels');
const settings = require('./settings');

const js = jsonstore.open('realm', { realms: {}, citizens: {}, god: {} });

const keyOf = (jid) => levels.keyOf(jid);
const slot = (group, key) => `${group}|${key}`;

const realmOf = (group) => js.data.realms[group] || (js.data.realms[group] = { off: false, treasury: 0, since: Date.now() });

// the realm works when nobody switched it off (an admin or God) and God has not closed the whole Empire part
const isOn = (group) => !!group && !realmOf(group).off && settings.featureOn('core', group);
function setOn(group, on) {
  realmOf(group).off = !on;
  js.touch();
}

// the citizen of a realm (made when needed)
function citizen(group, jid, make = true) {
  const key = keyOf(jid);
  const id = slot(group, key);
  let c = js.data.citizens[id];
  if (!c && make) {
    c = js.data.citizens[id] = { j: jid, coins: settings.get('core.startAurum', group), bank: 0, lastDaily: 0, streak: 0, cd: {}, items: {}, title: null, since: Date.now() };
    js.touch();
  }
  if (c && jid && String(jid).includes('@')) c.j = c.j || jid;
  return c || null;
}

// every citizen of a realm: [{ key, c }]
const citizensOf = (group) =>
  Object.entries(js.data.citizens)
    .filter(([id]) => id.startsWith(`${group}|`))
    .map(([id, c]) => ({ key: id.slice(group.length + 1), c }));

const jidOf = (key, c) => (c && c.j) || `${key}@s.whatsapp.net`;
const touch = () => js.touch();

module.exports = { js, keyOf, slot, realmOf, isOn, setOn, citizen, citizensOf, jidOf, touch };
