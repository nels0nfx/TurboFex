'use strict';
// Maintenance tool for the TurboFex plugin store (the TurboFex-Registry repository). Run it on your own phone: the signing key
// never leaves it. Nothing here runs on a server and nothing needs GitHub Actions.
//   node tools/registry.js keygen                    make the signing key (once) and show the public key for the bot
//   node tools/registry.js publickey                 show the public key of the signing key in use (to copy into the bot)
//   node tools/registry.js backup <file>             save an encrypted copy of the key (keep it somewhere safe)
//   node tools/registry.js restore <file>            put the key back from a backup
//   node tools/registry.js init <registry-folder>    prepare an empty registry folder
//   node tools/registry.js add <plugin-folder> <registry-folder>   approve one plugin version (checks it, copies it, signs the index)
//   node tools/registry.js revoke <id> <version|all> <reason> <registry-folder>   withdraw a plugin (bots switch it off)
//   node tools/registry.js verify <registry-folder>  check that everything in the registry is intact and signed
//   node tools/registry.js pull <registry-folder>    download the plugins you approved on the pair site, check them again, add and sign them
//                                                    (needs TFX_SITE_TOKEN; TFX_SITE_URL is optional)
//   node tools/registry.js sitebackup <file>         save a backup of everything the pair site's plugin store keeps (needs TFX_SITE_TOKEN); run it now and then
//   node tools/registry.js published                 after you pushed the registry: tell the pair site those plugins are now published (or withdrawn)
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

// optional documents of a plugin version: README.md and CHANGELOG.md, plain text up to 16 KB (shown on the Plugins page; never run)
const DOCS = { readme: 'README.md', changelog: 'CHANGELOG.md' };
const DOC_MAX = 16 * 1024;
const docOk = (buf) => buf.length > 0 && buf.length <= DOC_MAX && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(buf.toString('utf8')) && Buffer.from(buf.toString('utf8')).equals(buf);
function build(reg) {
  const old = readJson(path.join(reg, 'index.json'), { plugins: {} });
  const plugins = {};
  for (const { id, version, dir } of versionsOf(reg)) {
    const v = manifestLib.validate(dir, {});
    if (!v.ok) throw new Error(`${id} ${version} is not a valid plugin: ${v.errors[0]}`);
    if (v.manifest.id !== id || v.manifest.version !== version) throw new Error(`${id}/${version}: the folder name must match the plugin id and version`);
    const manifestSha = sha(fs.readFileSync(path.join(dir, 'turbofex-plugin.json'))); const entrySha = sha(fs.readFileSync(path.join(dir, v.manifest.entry)));
    const docSha = {};
    for (const [k, f] of Object.entries(DOCS)) { const fp = path.join(dir, f); if (fs.existsSync(fp)) { const b = fs.readFileSync(fp); if (!docOk(b)) throw new Error(`${id} ${version}: ${f} must be plain text up to 16 KB`); docSha[k + 'Sha'] = sha(b); } }
    const before = old.plugins && old.plugins[id] && old.plugins[id].versions && old.plugins[id].versions[version];
    if (before && (before.manifestSha !== manifestSha || before.entrySha !== entrySha || (before.readmeSha || null) !== (docSha.readmeSha || null) || (before.changelogSha || null) !== (docSha.changelogSha || null))) throw new Error(`${id} ${version} was changed after it was published. Published versions never change: publish a new version instead.`);
    const p = plugins[id] || (plugins[id] = { versions: {} });
    p.versions[version] = { manifestSha, entrySha, entry: v.manifest.entry, permissions: v.manifest.permissions, domains: v.manifest.network.domains, publishedAt: before ? before.publishedAt : new Date().toISOString(), ...docSha };
    const latest = Object.keys(p.versions).sort(semverCmp).pop();
    if (latest === version) { p.name = v.manifest.name; p.description = v.manifest.description; p.author = v.manifest.author.name; }
  }
  const index = { format: 1, updated: new Date().toISOString(), plugins: Object.fromEntries(Object.entries(plugins).sort()), revoked: readJson(path.join(reg, 'revoked.json'), []) };
  const bytes = Buffer.from(JSON.stringify(index, null, 1) + '\n');
  fs.writeFileSync(path.join(reg, 'index.json'), bytes);
  fs.writeFileSync(path.join(reg, 'index.json.sig'), crypto.sign(null, bytes, privateKey()).toString('base64') + '\n');
  return index;
}
const dropVersion = (to) => { fs.rmSync(to, { recursive: true, force: true }); try { fs.rmdirSync(path.dirname(to)); } catch (e) { /* other versions are still there */ } };
function add(pluginFolder, reg) {
  const v = manifestLib.validate(pluginFolder, {});
  if (!v.ok) throw new Error('This plugin is not valid: ' + v.errors.join('; '));
  const to = path.join(reg, 'plugins', v.manifest.id, v.manifest.version);
  if (fs.existsSync(to)) throw new Error(`${v.manifest.id} ${v.manifest.version} is already published. Published versions never change: ask the developer for a new version number.`);
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(pluginFolder, 'turbofex-plugin.json'), path.join(to, 'turbofex-plugin.json'));
  fs.copyFileSync(path.join(pluginFolder, v.manifest.entry), path.join(to, v.manifest.entry));
  for (const f of Object.values(DOCS)) {
    const fp = path.join(pluginFolder, f); if (!fs.existsSync(fp)) continue;
    const b = fs.readFileSync(fp); if (!docOk(b)) { dropVersion(to); throw new Error(`${f} must be plain text up to 16 KB`); }
    fs.copyFileSync(fp, path.join(to, f));
  }
  try { return build(reg); } catch (e) { dropVersion(to); throw e; }
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

// ---- the pair site's Developer Centre: approved plugins are collected here and signed on this phone ----
const pendingFile = () => path.join(keyDir(), 'pending-published.json');
const pendingRevFile = () => path.join(keyDir(), 'pending-revoked.json');
const siteUrl = () => String(process.env.TFX_SITE_URL || 'https://turbofex-pair.onrender.com').replace(/\/+$/, '');
async function siteCall(method, route, body, fetchImpl) {
  const token = process.env.TFX_SITE_TOKEN;
  if (!token || token.length < 24) throw new Error('Set TFX_SITE_TOKEN first (the same value as REGISTRY_PULL_TOKEN on the pair site).');
  const r = await (fetchImpl || fetch)(siteUrl() + route, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  if (r.status === 401) throw new Error('The pair site did not accept the token. Check TFX_SITE_TOKEN.');
  if (r.status === 404) throw new Error('The pair site has no download set up (REGISTRY_PULL_TOKEN is missing there).');
  if (!r.ok) throw new Error('The pair site answered ' + r.status);
  return r.json();
}
async function pull(reg, fetchImpl) {
  const out = { added: [], skipped: [], revoked: [] };
  const resp = await siteCall('GET', '/api/registry/approved', null, fetchImpl);
  const list = resp.plugins || [];
  const ownersFile = path.join(reg, 'owners.json'); const owners = readJson(ownersFile, {});
  const pending = readJson(pendingFile(), []);
  for (const p of list) {
    const tag = `${p.id} ${p.version}`; const skip = (why) => out.skipped.push({ id: p.id, version: p.version, reason: why });
    try {
      if (typeof p.manifestRaw !== 'string' || typeof p.entrySource !== 'string') { skip('incomplete download'); continue; }
      if (sha(Buffer.from(p.manifestRaw)) !== p.manifestSha || sha(Buffer.from(p.entrySource)) !== p.entrySha) { skip('the fingerprints do not match what the site announced'); continue; }
      if (owners[p.id] !== undefined && owners[p.id] !== p.githubId) { skip('this plugin id already belongs to another developer'); continue; }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-pull-'));
      try {
        fs.writeFileSync(path.join(tmp, 'turbofex-plugin.json'), p.manifestRaw);
        let m; try { m = JSON.parse(p.manifestRaw); } catch (e) { skip('the manifest is not valid JSON'); continue; }
        const entry = typeof m.entry === 'string' ? m.entry : 'index.js';
        if (!/^[\w.-]{1,80}$/.test(entry) || entry.includes('..')) { skip('bad entry name'); continue; }
        fs.writeFileSync(path.join(tmp, entry), p.entrySource);
        let docBad = null;
        for (const [k, f] of Object.entries(DOCS)) {
          const t = p[k]; if (t === undefined || t === null || t === '') { if (p[k + 'Sha']) docBad = f + ' is missing'; continue; }
          const b = typeof t === 'string' ? Buffer.from(t) : null;
          if (!b || !docOk(b) || sha(b) !== p[k + 'Sha']) { docBad = f + ' does not match what the site announced'; break; }
          fs.writeFileSync(path.join(tmp, f), b);
        }
        if (docBad) { skip(docBad); continue; }
        const v = manifestLib.validate(tmp, {});
        if (!v.ok) { skip('the bot\'s own check refused it: ' + v.errors[0]); continue; }
        if (v.manifest.id !== p.id || v.manifest.version !== p.version) { skip('id or version differs from what the site announced'); continue; }
        const there = path.join(reg, 'plugins', p.id, p.version);
        if (fs.existsSync(there)) {   // an earlier pull already added it (for example the push failed): only continue if it is the very same code
          if (sha(fs.readFileSync(path.join(there, 'turbofex-plugin.json'))) === p.manifestSha && sha(fs.readFileSync(path.join(there, v.manifest.entry))) === p.entrySha) { if (!pending.includes(p.submission)) pending.push(p.submission); out.added.push(tag + ' (already in the folder)'); } else skip('this version is already published with different code');
          continue;
        }
        add(tmp, reg);
        owners[p.id] = p.githubId; if (!pending.includes(p.submission)) pending.push(p.submission); out.added.push(tag);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    } catch (e) { skip(e.message); }
  }
  // plugins you withdrew in the admin dashboard
  const pendingRev = readJson(pendingRevFile(), []);
  for (const r of resp.revocations || []) {
    try {
      if (!/^[a-z0-9-]{3,32}$/.test(String(r.id)) || !/^\d+\.\d+\.\d+$/.test(String(r.version))) { out.skipped.push({ id: r.id, version: r.version, reason: 'bad withdrawal request' }); continue; }
      const already = readJson(path.join(reg, 'revoked.json'), []).some((x) => x && x.id === r.id && x.version === r.version);
      if (!already) {
        if (!fs.existsSync(path.join(reg, 'plugins', r.id, r.version))) { out.skipped.push({ id: r.id, version: r.version, reason: 'withdrawal asked for, but this version is not in your registry folder' }); continue; }
        revoke(r.id, r.version, r.reason, reg);
      }
      if (!pendingRev.includes(r.submission)) pendingRev.push(r.submission);
      out.revoked.push(r.id + ' ' + r.version + (already ? ' (already withdrawn)' : ''));
    } catch (e) { out.skipped.push({ id: r.id, version: r.version, reason: e.message }); }
  }
  fs.writeFileSync(ownersFile, JSON.stringify(owners, null, 1) + '\n');
  fs.mkdirSync(keyDir(), { recursive: true, mode: 0o700 }); fs.writeFileSync(pendingFile(), JSON.stringify(pending)); fs.writeFileSync(pendingRevFile(), JSON.stringify(pendingRev));
  return out;
}
async function markPublished(fetchImpl) {
  const ids = readJson(pendingFile(), []), revoked = readJson(pendingRevFile(), []);
  if (!ids.length && !revoked.length) return 0;
  const r = await siteCall('POST', '/api/registry/published', { ids, revoked }, fetchImpl);
  fs.writeFileSync(pendingFile(), '[]'); fs.writeFileSync(pendingRevFile(), '[]'); return (r.marked || 0) + (r.revoked || 0);
}
async function siteBackup(file, fetchImpl) {
  const j = await siteCall('GET', '/api/registry/backup', null, fetchImpl);
  if (!j || j.format !== 'turbofex-devcentre-backup-1') throw new Error('The pair site did not send a backup (is it updated to v2.46.0 or newer?).');
  fs.writeFileSync(file, JSON.stringify(j), { mode: 0o600 });
  return { submissions: (j.submissions || []).length, developers: (j.developers || []).length };
}
module.exports = { siteBackup, keygen, backup, restore, init, add, revoke, build, verify, publicPem, pull, markPublished };

if (require.main === module) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  try {
    if (cmd === 'keygen') { console.log('✅ Signing key created in ' + keyDir() + '\nBack it up now:  TFX_PASSPHRASE="a long secret" node tools/registry.js backup ~/registry-key-backup.json\n\nPublic key (this goes into the bot):\n' + keygen()); }
    else if (cmd === 'publickey') { console.log(publicPem()); }
    else if (cmd === 'backup' && a) { backup(a); console.log('✅ Encrypted backup saved to ' + a + '\nKeep it somewhere safe, away from this phone, and remember the passphrase.'); }
    else if (cmd === 'restore' && a) { restore(a); console.log('✅ Signing key restored.'); }
    else if (cmd === 'init' && a) { init(a); console.log('✅ Registry prepared in ' + a); }
    else if (cmd === 'add' && a && b) { const i = add(a, b); console.log('✅ Approved and signed. Plugins in the registry: ' + Object.keys(i.plugins).length + '\nNow push the registry folder to GitHub.'); }
    else if (cmd === 'revoke' && a && b && d) { revoke(a, b, c, d); console.log('✅ Withdrawn and signed. Push the registry folder to GitHub; bots switch the plugin off within a few hours.'); }
    else if (cmd === 'verify' && a) { console.log('✅ All good: signature valid, ' + verify(a) + ' plugin version(s) intact.'); }
    else if (cmd === 'pull' && a) {
      pull(a).then((o) => {
        console.log(o.added.length ? '✅ Added and signed:\n  ' + o.added.join('\n  ') : 'Nothing new to add.');
        if (o.revoked.length) console.log('✅ Withdrawn and signed:\n  ' + o.revoked.join('\n  '));
        if (o.added.length || o.revoked.length) console.log('Now push the registry folder to GitHub, then run:  node tools/registry.js published');
        if (o.skipped.length) console.log('⚠️ Skipped:\n  ' + o.skipped.map((x) => x.id + ' ' + x.version + ': ' + x.reason).join('\n  '));
      }).catch((e) => { console.error('⚠️ ' + e.message); process.exitCode = 1; });
    }
    else if (cmd === 'sitebackup' && a) { siteBackup(a).then((o) => console.log('✅ Backup saved to ' + a + ' (' + o.developers + ' developer(s), ' + o.submissions + ' submission(s)).\nKeep it private: it holds the plugin code and the developer list.')).catch((e) => { console.error('⚠️ ' + e.message); process.exitCode = 1; }); }
    else if (cmd === 'published') { markPublished().then((n) => console.log(n ? '✅ The pair site is up to date (' + n + ' plugin change(s) recorded).' : 'Nothing was waiting to be marked.')).catch((e) => { console.error('⚠️ ' + e.message); process.exitCode = 1; }); }
    else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exitCode = 1; }
  } catch (e) { console.error('⚠️ ' + e.message); process.exitCode = 1; }
}
