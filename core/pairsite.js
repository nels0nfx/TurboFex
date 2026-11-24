// The pairing site (the project turbofex-pairsite) used as a remote control. `pair` asks the site to link a number exactly as a visitor of the
// site would: the site makes the pairing CODE, links the number when the person enters it, saves the login, makes the session ID (TFX-…) and
// sends that ID to the person's own WhatsApp. The bot only passes the code on to the owner and tells him how it goes.
//
// The site's progress report also contains the session ID while it is valid. It is removed the moment an answer is read (strip()) and never
// kept, shown or logged: the owner is not meant to see it, and the bot never uses it (it never calls /api/session/<id>, which would use it up).
const config = require('../config');

const baseOf = (url) => String(url || config.pairSiteUrl || '').trim().replace(/\/+$/, '');
const strip = (data) => {
  if (data && typeof data === 'object') {
    delete data.sessionId;
    delete data.idSecondsLeft;
  }
  return data;
};

async function call(method, url, body, fetchFn = globalThis.fetch, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchFn(url, {
      method,
      signal: ctl.signal,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = strip(await res.json());
    } catch (err) {
      data = null;
    }
    return { ok: !!res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, network: true };
  } finally {
    clearTimeout(timer);
  }
}

// asks the site to start a pairing with a code for this number (digits, country code first). { ok, job } or { ok: false, status, error, network }
async function start(number, { url, fetchFn } = {}) {
  const r = await call('POST', `${baseOf(url)}/api/pair`, { method: 'code', number: `+${String(number).replace(/\D/g, '')}` }, fetchFn);
  if (r.ok && r.data && r.data.job) return { ok: true, job: r.data.job };
  return { ok: false, status: r.status, network: !!r.network, error: (r.data && r.data.error) || '' };
}

// how it is going: { ok, state: starting|code|qr|linking|linked|failed, code, dm, error }. No session ID, ever.
async function progress(job, { url, fetchFn } = {}) {
  const r = await call('GET', `${baseOf(url)}/api/job/${encodeURIComponent(job)}`, null, fetchFn);
  if (!r.ok || !r.data) return { ok: false, status: r.status, network: !!r.network };
  const d = r.data;
  return { ok: true, state: String(d.state || ''), code: d.code ? String(d.code) : '', dm: d.dm === undefined ? null : d.dm, error: d.error ? String(d.error) : '' };
}

// stops a pairing nobody is going to finish
async function cancel(job, { url, fetchFn } = {}) {
  await call('POST', `${baseOf(url)}/api/cancel/${encodeURIComponent(job)}`, {}, fetchFn, 8000);
}

const hostOf = (url) => {
  try {
    return new URL(baseOf(url)).host;
  } catch (err) {
    return baseOf(url);
  }
};

module.exports = { start, progress, cancel, strip, baseOf, hostOf };
