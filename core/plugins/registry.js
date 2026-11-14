'use strict';
// The plugin store. TurboFex-Registry is a public GitHub repository of plain files: an index (index.json) with a signature
// (index.json.sig) and, per plugin version, the plugin's two files. The bot only trusts what the owner of the registry signed:
// the index must carry a valid signature, every downloaded file must match the fingerprint in the index, and the manifest must
// show exactly the permissions the index announced. Nothing is sent about you or your bot: the bot only downloads public files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifestLib = require('./manifest');
const state = require('./state');

const BASE = (process.env.TURBOFEX_REGISTRY_URL || 'https://raw.githubusercontent.com/nels0nfx/TurboFex-Registry/main/').replace(/\/?$/, '/');
const CACHE_MS = 10 * 60 * 1000;
const MAX_INDEX = 1024 * 1024;
let cache = null;
let fetcher = null; // tests can replace the download function
let keyOverride = null;
let backupOverride = null;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const publicKeyPem = () => (keyOverride !== null ? keyOverride : (() => { try { return require('./registry-key.json').publicKey || ''; } catch (e) { return ''; } })());
const configured = () => !!publicKeyPem();
const download = async (rel, maxBytes) => {
  if (fetcher) return fetcher(BASE + rel, maxBytes);
  const r = await require('../safefetch').get(BASE + rel, { timeout: 8000, maxBytes });
  if (r.status !== 200) throw new Error('status ' + r.status);
  return r.body;
};

// Keys the bot trusts: the main one, plus optional spare keys (backupKeys in registry-key.json) so the store can keep going
// if the main signing key is ever lost or leaked (see KEY_ROTATION.md).
const trustedKeys = () => {
  const list = [publicKeyPem()];
  if (keyOverride === null) { try { const b = require('./registry-key.json').backupKeys; if (Array.isArray(b)) for (const k of b.slice(0, 3)) if (typeof k === 'string') list.push(k); } catch (e) { /* none */ } }
  else if (backupOverride) list.push(...backupOverride);
  return list.filter(Boolean);
};
function verifyIndex(bytes, sigB64) {
  const sig = Buffer.from(String(sigB64).trim(), 'base64');
  for (const k of trustedKeys()) { try { if (crypto.verify(null, bytes, crypto.createPublicKey(k), sig)) return true; } catch (e) { /* try the next key */ } }
  return false;
}
const semverCmp = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

async function getIndex(fresh) {
  if (!configured()) { const e = new Error('store not set up'); e.code = 'store_off'; throw e; }
  if (!fresh && cache && Date.now() - cache.t < CACHE_MS) return cache.index;
  let bytes; let sig;
  try { bytes = await download('index.json', MAX_INDEX); sig = (await download('index.json.sig', 4096)).toString('utf8'); } catch (e) { const x = new Error('store unreachable'); x.code = 'unreachable'; throw x; }
  if (!verifyIndex(bytes, sig)) { const e = new Error('bad signature'); e.code = 'tampered'; throw e; }
  let index;
  try { index = JSON.parse(bytes.toString('utf8')); } catch (e) { const x = new Error('bad index'); x.code = 'tampered'; throw x; }
  if (!index || index.format !== 1 || typeof index.plugins !== 'object' || !Array.isArray(index.revoked || [])) { const e = new Error('bad index'); e.code = 'tampered'; throw e; }
  cache = { t: Date.now(), index };
  return index;
}
// collections (curated sets of store plugins), signed inside the index. Anything with an odd shape is dropped.
const MAX_BUNDLE = 8, MAX_COLLECTIONS = 20;
function collectionsOf(index) {
  const out = [];
  for (const c of Array.isArray(index && index.collections) ? index.collections : []) {
    if (!c || typeof c !== 'object' || !/^[a-z0-9-]{3,32}$/.test(String(c.id)) || !Array.isArray(c.plugins)) continue;
    const ids = [...new Set(c.plugins.filter((x) => /^[a-z0-9-]{3,32}$/.test(String(x))).map(String))].slice(0, MAX_BUNDLE);
    if (!ids.length || out.some((x) => x.id === c.id)) continue;
    out.push({ id: String(c.id), name: String(c.name || c.id).slice(0, 40), description: String(c.description || '').slice(0, 200), plugins: ids });
  }
  return out.slice(0, MAX_COLLECTIONS);
}
const isRevoked = (index, id, version) => (index.revoked || []).some((r) => r.id === id && (!r.version || r.version === version));
const latestOf = (index, id) => {
  const p = index.plugins[id]; if (!p) return null;
  const vs = Object.keys(p.versions || {}).filter((v) => !isRevoked(index, id, v)).sort(semverCmp);
  return vs.length ? vs[vs.length - 1] : null;
};
function list(index, text) {
  const q = String(text || '').toLowerCase().trim();
  return Object.entries(index.plugins).filter(([id, p]) => latestOf(index, id) && (!q || id.includes(q) || String(p.name).toLowerCase().includes(q) || String(p.description).toLowerCase().includes(q)))
    .map(([id, p]) => ({ id, name: p.name, description: p.description, author: p.author, version: latestOf(index, id) })).sort((a, b) => a.name.localeCompare(b.name));
}

// Downloads one plugin version into data/plugins/<id> after checking everything. Returns { ok, version, folder } or { ok: false, why }.
async function fetchPlugin(id, wanted) {
  let index;
  try { index = await getIndex(); } catch (e) { return { ok: false, why: e.code || 'unreachable' }; }
  if (!index.plugins[id]) { try { index = await getIndex(true); } catch (e) { return { ok: false, why: e.code || 'unreachable' }; } } // a plugin published a moment ago
  const entry = index.plugins[id]; if (!entry) return { ok: false, why: 'unknown' };
  const version = wanted || latestOf(index, id);
  const v = version && entry.versions && entry.versions[version];
  if (!v) return { ok: false, why: 'unknown' };
  if (isRevoked(index, id, version)) return { ok: false, why: 'revoked' };
  let man; let src;
  try { man = await download(`plugins/${id}/${version}/turbofex-plugin.json`, 64 * 1024); src = await download(`plugins/${id}/${version}/${v.entry}`, 1024 * 1024 + 1); } catch (e) { return { ok: false, why: 'unreachable' }; }
  if (sha(man) !== v.manifestSha || sha(src) !== v.entrySha || !/^[\w.-]{1,80}$/.test(v.entry)) return { ok: false, why: 'tampered' };
  const dir = state.dir(); const to = path.join(dir, id); const tmp = path.join(dir, '.tmp-' + crypto.randomBytes(4).toString('hex'));
  try {
    if (fs.existsSync(to) && !fs.existsSync(path.join(to, '.from-store'))) return { ok: false, why: 'conflict' };
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'turbofex-plugin.json'), man); fs.writeFileSync(path.join(tmp, v.entry), src); fs.writeFileSync(path.join(tmp, '.from-store'), version);
    const chk = manifestLib.validate(tmp, {});
    const same = chk.ok && chk.manifest.id === id && chk.manifest.version === version && JSON.stringify([...chk.manifest.permissions].sort()) === JSON.stringify([...(v.permissions || [])].sort());
    if (!same) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, why: 'tampered' }; }
    try { // keep a copy of the version that is running now, so the owner can go back to it
      const rec = state.open().data.installed[id], active = rec && rec.store && rec.store.version;
      if (active && active !== version && fs.existsSync(to) && storeVersionOf(to) === active) {
        const keep = path.join(state.previousDir(id), active);
        if (!fs.existsSync(keep)) { fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.cpSync(to, keep, { recursive: true }); }
      }
    } catch (e) { /* no copy: no rollback for this update, the update itself still works */ }
    fs.rmSync(to, { recursive: true, force: true }); fs.renameSync(tmp, to);
  } catch (e) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) { /* ignore */ } return { ok: false, why: 'unreachable' }; }
  return { ok: true, version, folder: to };
}
const storeVersionOf = (folder) => { try { return fs.readFileSync(path.join(folder, '.from-store'), 'utf8').trim(); } catch (e) { return null; } };
module.exports = { collectionsOf, configured, getIndex, verifyIndex, list, latestOf, isRevoked, fetchPlugin, storeVersionOf, semverCmp, sha, BASE,
  _test: { setFetcher: (f) => { fetcher = f; cache = null; }, setKey: (k, backups) => { keyOverride = k; backupOverride = backups || null; cache = null; }, verifyIndex, reset: () => { cache = null; fetcher = null; keyOverride = null; backupOverride = null; } } };
