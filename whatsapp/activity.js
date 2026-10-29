// Counts messages per member in each group (used by !msgs and !inactive)
const fs = require('fs');
const path = require('path');
const { num } = require('./utils');
const { DATA } = require('../core/paths');

const dir = DATA;
const file = path.join(dir, 'activity.json');

let db = {};
try {
  db = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  db = {};
}
let dirty = false;

function saveNow() {
  if (!dirty) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db));
    dirty = false;
  } catch (err) {
    console.error('Could not save activity:', err.message);
  }
}

setInterval(saveNow, 30000).unref();
process.on('exit', saveNow);

function count(group, sender) {
  if (!sender) return;
  const g = db[group] || (db[group] = {});
  const k = num(sender);
  g[k] = (g[k] || 0) + 1;
  dirty = true;
}

const get = (group) => db[group] || {};
const total = (group) => Object.values(get(group)).reduce((a, b) => a + b, 0);

module.exports = { count, get, total, saveNow };
