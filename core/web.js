// Small helpers for commands that call a public web service. Every call has a time limit and a size limit.
const { readLimited } = require('./download');

const UA = 'Mozilla/5.0 (compatible; TurboFex)';

async function getJson(url, { timeout = 10000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw Object.assign(new Error(`the service answered ${res.status}`), { code: 'HTTP' });
  return res.json();
}

async function getText(url, { timeout = 10000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw Object.assign(new Error(`the service answered ${res.status}`), { code: 'HTTP' });
  return res.text();
}

async function getBuffer(url, { timeout = 20000, max = 8 * 1024 * 1024, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw Object.assign(new Error(`the service answered ${res.status}`), { code: 'HTTP' });
  return readLimited(res, max);
}

const decode = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .trim();

module.exports = { getJson, getText, getBuffer, decode };
