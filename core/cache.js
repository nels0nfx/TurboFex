const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const CACHE_DIR = path.join(paths.data, 'cache');

function ensure() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function get(key) {
  try {
    const file = path.join(CACHE_DIR, key.replace(/[^a-z0-9_-]/gi, '_') + '.json');
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.expires && Date.now() > data.expires) {
      fs.unlinkSync(file);
      return null;
    }
    return data.value;
  } catch {
    return null;
  }
}

function set(key, value, ttlMs = 0) {
  try {
    ensure();
    const file = path.join(CACHE_DIR, key.replace(/[^a-z0-9_-]/gi, '_') + '.json');
    const data = { value, expires: ttlMs ? Date.now() + ttlMs : 0 };
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {}
}

module.exports = { get, set };
