'use strict';
// What the owner decided about plugins, saved in data/plugins.json. Nothing is created on disk while plugins were never used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jsonstore = require('../jsonstore');
const { DATA, ROOT } = require('../paths');

const DEFAULTS = { enabled: false, secret: '', max: 8, guardMb: 96, installed: {} };
let store = null;

const dir = () => path.join(DATA, 'plugins');
const used = () => store !== null || fs.existsSync(path.join(DATA, 'plugins.json'));
function open() {
  if (!store) {
    store = jsonstore.open('plugins', DEFAULTS);
    if (!store.data.secret) { store.data.secret = crypto.randomBytes(24).toString('hex'); store.touch(); }
  }
  return store;
}
const isEnabled = () => used() && open().data.enabled === true;
// each plugin has its own small saved file; one plugin can never read another one's data
const dataStore = (id) => jsonstore.open('plugin-data-' + id, { kv: {} });
// the plugin never sees real chat or phone ids: it gets a short code that is different for every plugin
const opaque = (id, value) => crypto.createHmac('sha256', open().data.secret).update(id + ':' + value).digest('hex').slice(0, 16);
const examplesDir = () => path.join(ROOT, 'examples');
const subfolders = (base) => { try { return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => path.join(base, d.name)).slice(0, 50); } catch (e) { return []; } };
// plugin folders in data/plugins come first; the samples that ship with the bot (examples/) are found too
const folders = () => [...subfolders(dir()), ...subfolders(examplesDir())];
module.exports = { open, used, isEnabled, dataStore, opaque, folders, dir, examplesDir };
