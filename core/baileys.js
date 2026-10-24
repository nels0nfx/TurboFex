// Loads the WhatsApp library. Works with BOTH the old version (6.x, CommonJS) and the new one
// (7.x, which can only be loaded with import()). Everything else in the bot asks THIS file for the
// library, so switching versions only means changing the number in package.json.
let lib = null;
let loading = null;

async function load() {
  if (lib) return lib;
  if (!loading) {
    loading = (async () => {
      let mod;
      try {
        mod = await import('@whiskeysockets/baileys');
      } catch (err) {
        try {
          mod = require('@whiskeysockets/baileys'); // very old setups
        } catch (err2) {
          throw err;
        }
      }
      const base = mod && typeof mod === 'object' ? mod : {};
      const def = base.default;
      const merged = { ...(def && typeof def === 'object' ? def : {}), ...base };
      merged.makeWASocket = base.makeWASocket || (typeof def === 'function' ? def : def && (def.makeWASocket || def.default));
      if (typeof merged.makeWASocket !== 'function') throw new Error('The WhatsApp library loaded, but it has no makeWASocket function.');
      lib = merged;
      return lib;
    })();
  }
  return loading;
}

// only use after load() finished (the connection code does that first)
function get() {
  if (!lib) throw new Error('The WhatsApp library is not loaded yet.');
  return lib;
}

const isLoaded = () => !!lib;

// for tests only: use a stand-in library
function setForTests(fake) {
  lib = fake;
}

function version() {
  try {
    return require('@whiskeysockets/baileys/package.json').version;
  } catch (err) {
    try {
      return require(require('path').join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'package.json')).version;
    } catch (err2) {
      return 'unknown';
    }
  }
}

module.exports = { load, get, isLoaded, version, setForTests };
