'use strict';
// A private test install: a developer gets a one-time code on the pair site and the OWNER of a bot types `.plugin test <code>`.
// The plugin has NOT been reviewed and is NOT signed by the store, so it goes through the same permission screen as any install,
// is never updated or reported as a store plugin, and stays in the same sandbox. Only the code's holder can ask for it, once.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const state = require('./state');
const manifestLib = require('./manifest');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const siteUrl = () => String(process.env.TFX_SITE_URL || 'https://turbofex-pair.onrender.com').replace(/\/+$/, '');
const botVersion = () => { try { return require('../../package.json').version; } catch (e) { return '1.0.0'; } };

async function fetchTest(code, builtins, fetchImpl) {
  code = String(code || '').trim().toUpperCase();
  if (!/^TFX-[A-Z0-9]{8}$/.test(code)) return { ok: false, why: 'badcode' };
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null); if (!f) return { ok: false, why: 'unreachable' };
  let r, j;
  try { r = await f(siteUrl() + '/api/test-plugin?code=' + encodeURIComponent(code), { headers: { 'user-agent': 'TurboFex-Bot' }, signal: AbortSignal.timeout(10000) }); j = await r.json(); } catch (e) { return { ok: false, why: 'unreachable' }; }
  if (r.status === 404 || r.status === 410) return { ok: false, why: 'badcode' };
  if (!r.ok || !j || typeof j.manifestRaw !== 'string' || typeof j.entrySource !== 'string') return { ok: false, why: 'unreachable' };
  if (j.manifestRaw.length > 64 * 1024 || j.entrySource.length > 1024 * 1024) return { ok: false, why: 'tampered' };
  if (sha(Buffer.from(j.manifestRaw)) !== j.manifestSha || sha(Buffer.from(j.entrySource)) !== j.entrySha) return { ok: false, why: 'tampered' };
  const dir = state.dir(); const tmp = path.join(dir, '.tmp-' + crypto.randomBytes(4).toString('hex'));
  try {
    fs.mkdirSync(tmp, { recursive: true });
    let man; try { man = JSON.parse(j.manifestRaw); } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, why: 'tampered' }; }
    const entry = String(man.entry || 'index.js'); if (!/^[\w.-]{1,80}$/.test(entry)) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, why: 'tampered' }; }
    fs.writeFileSync(path.join(tmp, 'turbofex-plugin.json'), j.manifestRaw); fs.writeFileSync(path.join(tmp, entry), j.entrySource);
    const v = manifestLib.validate(tmp, { botVersion: botVersion(), taken: builtins });
    if (!v.ok) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, why: 'invalid', errors: v.errors }; }
    const id = v.manifest.id; const to = path.join(dir, id);
    if (fs.existsSync(to) && !fs.existsSync(path.join(to, '.from-test'))) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, why: 'conflict' }; }
    fs.writeFileSync(path.join(tmp, '.from-test'), String(j.developer || '').slice(0, 40) || 'unknown');
    fs.rmSync(to, { recursive: true, force: true }); fs.renameSync(tmp, to);
    return { ok: true, id, developer: String(j.developer || '').slice(0, 40) };
  } catch (e) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) { /* ignore */ } return { ok: false, why: 'unreachable' }; }
}
module.exports = { fetchTest };
