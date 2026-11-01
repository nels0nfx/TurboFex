// Counts messages per member in each group (used by !msgs and !inactive)
const { num } = require('./utils');
const jsonstore = require('../core/jsonstore');

// message counts per member (data/activity.json). Safe store: atomic writes, backup copy, written again on stop or restart.
const js = jsonstore.open('activity', {}, { delay: 1000 });
const db = js.data;

function saveNow() {
  js.flush();
}

function count(group, sender) {
  if (!sender) return;
  const g = db[group] || (db[group] = {});
  const k = num(sender);
  g[k] = (g[k] || 0) + 1;
  js.touch();
}

const get = (group) => db[group] || {};
const total = (group) => Object.values(get(group)).reduce((a, b) => a + b, 0);

module.exports = { count, get, total, saveNow };
