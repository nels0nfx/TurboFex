'use strict';
// Maintenance tool for the TurboFex plugin store (the TurboFex-Registry repository). Run it on your own phone: the signing key
// never leaves it. Nothing here runs on a server and nothing needs GitHub Actions.
//   node tools/registry.js keygen                    make the signing key (once) and show the public key for the bot
//   node tools/registry.js backup <file>             save an encrypted copy of the key (keep it somewhere safe)
//   node tools/registry.js restore <file>            put the key back from a backup
//   node tools/registry.js init <registry-folder>    prepare an empty registry folder
//   node tools/registry.js add <plugin-folder> <registry-folder>   approve one plugin version (checks it, copies it, signs the index)
//   node tools/registry.js revoke <id> <version|all> <reason> <registry-folder>   withdraw a plugin (bots switch it off)
//   node tools/registry.js verify <registry-folder>  check that everything in the registry is intact and signed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const manifestLib = require('../core/plugins/manifest');

const keyDir = () => process.env.TFX_REGISTRY_KEYDIR || path.join(os.homedir(), '.turbofex-registry');
const keyFile = () => path.join(keyDir(), 'key.pem');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const semverCmp = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const privateKey = () => { if (!fs.existsSync(keyFile())) throw new Error('There is no signing key yet. Run: node tools/registry.js keygen'); return crypto.createPrivateKey(fs.readFileSync(keyFile())); };
const publicPem = () => crypto.createPublicKey(privateKey()).export({ type: 'spki', format: 'pem' });

function keygen() {
  if (fs.existsSync(keyFile())) throw new Error('A signing key already exists. Back it up with: node tools/registry.js backup <file>');
  fs.mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
  const { privateKey: k } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyFile(), k.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return publicPem();
}
function passphrase() { const p = process.env.TFX_PASSPHRASE; if (!p || p.length < 8) throw new Error('Set a passphrase of at least 8 characters first, for example: TFX_PASSPHRASE="your long secret" node tools/registry.js backup <file>'); return p; }
function backup(file) {
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(passphrase(), salt, 32), iv);
  const data = Buffer.concat([c.update(fs.readFileSync(keyFile())), c.final()]);
  fs.writeFileSync(file, JSON.stringify({ format: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
}
function restore(file) {
  if (fs.existsSync(keyFile())) throw new Error('A signing key already exists here, so nothing was changed.');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(passphrase(), Buffer.from(j.salt, 'base64'), 32), Buffer.from(j.iv, 'base64'));
  d.setAuthTag(Buffer.from(j.tag, 'base64'));
  let pem; try { pem = Buffer.concat([d.update(Buffer.from(j.data, 'base64')), d.final()]); } catch (e) { throw new Error('The passphrase is wrong or the file was changed.'); }
  fs.mkdirSync(keyDir(), { recursive: true, mode: 0o700 }); fs.writeFileSync(keyFile(), pem, { mode: 0o600 });
}

function init(reg) {
  fs.mkdirSync(path.join(reg, 'plugins'), { recursive: true });
  if (!fs.existsSync(path.join(reg, 'revoked.json'))) fs.writeFileSync(path.join(reg, 'revoked.json'), '[]\n');
  if (!fs.existsSync(path.join(reg, 'README.md'))) fs.writeFileSync(path.join(reg, 'README.md'), '# TurboFex Registry\n\nApproved plugins for TurboFex. Every plugin version here was reviewed and signed (`index.json.sig`). Bots only trust signed files. Do not edit files by hand.\n');
  build(reg);
}
const versionsOf = (reg) => { const out = []; const base = path.join(reg, 'plugins'); if (!fs.existsSync(base)) return out; for (const id of fs.readdirSync(base)) { const d = path.join(base, id); if (!fs.statSync(d).isDirectory()) continue; for (const v of fs.readdirSync(d)) if (fs.statSync(path.join(d, v)).isDirectory()) out.push({ id, version: v, dir: path.join(d, v) }); } return out; };

function build(reg) {
  const old = readJson(path.join(reg, 'index.json'), { plugins: {} });
  const plugins = {};
  for (const { id, version, dir } of versionsOf(reg)) {
    const v = manifestLib.validate(dir, {});
    if (!v.ok) throw new Error(`${id} ${version} is not a valid plugin: ${v.errors[0]}`);
    if (v.manifest.id !== id || v.manifest.version !== version) throw new Error(`${id}/${version}: the folder name must match the plugin id and version`);
    const manifestSha = sha(fs.readFileSync(path.join(dir, 'turbofex-plugin.json'))); const entrySha = sha(fs.readFileSync(path.join(dir, v.manifest.entry)));
    const before = old.plugins && old.plugins[id] && old.plugins[id].versions && old.plugins[id].versions[version];
    if (before && (before.manifestSha !== manifestSha || before.entrySha !== entrySha)) throw new Error(`${id} ${version} was changed after it was published. Published versions never change: publish a new version instead.`);
    const p = plugins[id] || (plugins[id] = { versions: {} });
    p.versions[version] = { manifestSha, entrySha, entry: v.manifest.entry, permissions: v.manifest.permissions, domains: v.manifest.network.domains, publishedAt: before ? before.publishedAt : new Date().toISOString() };
    const latest = Object.keys(p.versions).sort(semverCmp).pop();
    if (latest === version) { p.name = v.manifest.name; p.description = v.manifest.description; p.author = v.manifest.author.name; }
  }
  const index = { format: 1, updated: new Date().toISOString(), plugins: Object.fromEntries(Object.entries(plugins).sort()), revoked: readJson(path.join(reg, 'revoked.json'), []) };
  const bytes = Buffer.from(JSON.stringify(index, null, 1) + '\n');
  fs.writeFileSync(path.join(reg, 'index.json'), bytes);
  fs.writeFileSync(path.join(reg, 'index.json.sig'), crypto.sign(null, bytes, privateKey()).toString('base64') + '\n');
  return index;
}
function add(pluginFolder, reg) {
  const v = manifestLib.validate(pluginFolder, {});
  if (!v.ok) throw new Error('This plugin is not valid: ' + v.errors.join('; '));
  const to = path.join(reg, 'plugins', v.manifest.id, v.manifest.version);
  if (fs.existsSync(to)) throw new Error(`${v.manifest.id} ${v.manifest.version} is already published. Published versions never change: ask the developer for a new version number.`);
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(pluginFolder, 'turbofex-plugin.json'), path.join(to, 'turbofex-plugin.json'));
  fs.copyFileSync(path.join(pluginFolder, v.manifest.entry), path.join(to, v.manifest.entry));
  try { return build(reg); } catch (e) { fs.rmSync(to, { recursive: true, force: true }); throw e; }
}
function revoke(id, version, reason, reg) {
  const list = readJson(path.join(reg, 'revoked.json'), []);
  list.push({ id, version: version === 'all' ? null : version, reason: String(reason || '').slice(0, 200), at: new Date().toISOString() });
  fs.writeFileSync(path.join(reg, 'revoked.json'), JSON.stringify(list, null, 1) + '\n');
  return build(reg);
}
function verify(reg) {
  const bytes = fs.readFileSync(path.join(reg, 'index.json')); const sig = fs.readFileSync(path.join(reg, 'index.json.sig'), 'utf8').trim();
  if (!crypto.verify(null, bytes, crypto.createPublicKey(publicPem()), Buffer.from(sig, 'base64'))) throw new Error('The signature does not match the index.');
  const index = JSON.parse(bytes.toString('utf8')); let n = 0;
  for (const [id, p] of Object.entries(index.plugins)) for (const [ver, e] of Object.entries(p.versions)) {
    const dir = path.join(reg, 'plugins', id, ver);
    if (sha(fs.readFileSync(path.join(dir, 'turbofex-plugin.json'))) !== e.manifestSha || sha(fs.readFileSync(path.join(dir, e.entry))) !== e.entrySha) throw new Error(`${id} ${ver} does not match its fingerprint.`);
    n++;
  }
  return n;
}
module.exports = { keygen, backup, restore, init, add, revoke, build, verify, publicPem };

if (require.main === module) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  try {
    if (cmd === 'keygen') { console.log('✅ Signing key created in ' + keyDir() + '\nBack it up now:  TFX_PASSPHRASE="a long secret" node tools/registry.js backup ~/registry-key-backup.json\n\nPublic key (this goes into the bot):\n' + keygen()); }
    else if (cmd === 'backup' && a) { backup(a); console.log('✅ Encrypted backup saved to ' + a + '\nKeep it somewhere safe, away from this phone, and remember the passphrase.'); }
    else if (cmd === 'restore' && a) { restore(a); console.log('✅ Signing key restored.'); }
    else if (cmd === 'init' && a) { init(a); console.log('✅ Registry prepared in ' + a); }
    else if (cmd === 'add' && a && b) { const i = add(a, b); console.log('✅ Approved and signed. Plugins in the registry: ' + Object.keys(i.plugins).length + '\nNow push the registry folder to GitHub.'); }
    else if (cmd === 'revoke' && a && b && d) { revoke(a, b, c, d); console.log('✅ Withdrawn and signed. Push the registry folder to GitHub; bots switch the plugin off within a few hours.'); }
    else if (cmd === 'verify' && a) { console.log('✅ All good: signature valid, ' + verify(a) + ' plugin version(s) intact.'); }
    else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exitCode = 1; }
  } catch (e) { console.error('⚠️ ' + e.message); process.exitCode = 1; }
}
