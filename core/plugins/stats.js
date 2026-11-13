'use strict';
// Anonymous statistics (OFF until the owner turns them on with `.plugin stats on`).
// What is sent: a random bot id, the bot version, and for each plugin from the store: its id, version, on/off and how many times it was switched off for failing.
// Never sent: chat text, phone numbers, group names or sizes, the session, the owner's number.
const state = require('./state');
const siteUrl = () => String(process.env.TFX_SITE_URL || 'https://turbofex-pair.onrender.com').replace(/\/+$/, '');
const S = () => { const d = state.open().data; return d.stats || (d.stats = { on: false, botId: '', secret: '', last: 0, errors: {} }); };

async function call(path, body, auth, fetchImpl) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null); if (!f) return { ok: false, status: 0 };
  try {
    const r = await f(siteUrl() + path, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'TurboFex-Bot', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined });
    let j = {}; try { j = await r.json(); } catch (e) { /* no body */ }
    return { ok: !!r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0 }; }
}
const status = () => { const s = S(); return { on: !!s.on, registered: !!s.botId, last: s.last || 0 }; };
function bumpError(id) { const s = S(); s.errors[id] = Math.min(1000, (s.errors[id] || 0) + 1); state.open().touch(); }
function setOn(on) { const s = S(); s.on = !!on; state.open().touch(); return status(); }
// turning statistics off also asks the site to delete what it holds for this bot (best effort) and forgets the id
async function forget(fetchImpl) {
  const s = S(); const had = s.botId && s.secret ? s.botId + '.' + s.secret : '';
  s.botId = ''; s.secret = ''; s.last = 0; s.errors = {}; state.open().touch();
  if (had) await call('/bot/forget', {}, had, fetchImpl);
}
// one report. `list` = [{ id, version, enabled }] for plugins that came from the store.
async function report(list, botVersion, fetchImpl) {
  const s = S(); if (!s.on) return { ok: false, why: 'off' };
  if (!s.botId) {
    const r = await call('/bot/register', {}, '', fetchImpl);
    if (!r.ok || !r.json || !/^[0-9a-f]{16}$/.test(String(r.json.botId)) || !/^[0-9a-f]{32}$/.test(String(r.json.secret))) return { ok: false, why: 'register' };
    s.botId = r.json.botId; s.secret = r.json.secret; state.open().touch();
  }
  const body = { v: String(botVersion || '').slice(0, 20), plugins: list.slice(0, 50).map((p) => ({ id: p.id, version: p.version, enabled: !!p.enabled, errors: s.errors[p.id] || 0 })) };
  const r = await call('/bot/heartbeat', body, s.botId + '.' + s.secret, fetchImpl);
  if (r.status === 401) { s.botId = ''; s.secret = ''; state.open().touch(); return { ok: false, why: 'auth' }; }   // the site forgot us: register again next time
  if (!r.ok) return { ok: false, why: 'site' };
  s.errors = {}; s.last = Date.now(); state.open().touch(); return { ok: true, sent: body.plugins.length };
}
// the owner's own 1-5 rating of an installed store plugin (needs statistics on and at least one report already sent)
async function rate(id, stars, fetchImpl) {
  const s = S(); if (!s.on) return { ok: false, why: 'off' };
  if (!s.botId || !s.last) return { ok: false, why: 'notyet' };
  const r = await call('/bot/rate', { plugin: id, stars }, s.botId + '.' + s.secret, fetchImpl);
  if (r.status === 401) { s.botId = ''; s.secret = ''; state.open().touch(); return { ok: false, why: 'notyet' }; }
  if (!r.ok) return { ok: false, why: r.status === 400 ? 'notyet' : 'site' };
  return { ok: true };
}
module.exports = { status, setOn, forget, report, bumpError, rate };
