// A small HTTP client that only talks to PUBLIC internet addresses. The bot fetches addresses that people type
// (link previews, downloads...). Without this check someone could make it call addresses inside the server's own
// network (the host's private services, cloud metadata...). The address is checked at the moment of connecting, on the
// exact IP that is used, and again after every redirect.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

function isPrivateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v !== 6) return true;
  const s = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateV4(mapped[1]);
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff') || s.startsWith('64:ff9b:') || s.startsWith('2001:db8');
}

// used by the network layer: refuses to connect to a private address
function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') {
    cb = options;
    options = {};
  }
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => isPrivateIp(a.address));
    if (bad || !addrs.length) return cb(Object.assign(new Error('That address is not allowed.'), { code: 'BLOCKED' }));
    if (options && options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

// Throws when the address is not a public web address
async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch (err) {
    throw Object.assign(new Error('That is not a valid link.'), { code: 'BLOCKED' });
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Object.assign(new Error('That link is not allowed.'), { code: 'BLOCKED' });
  if (u.port && !['80', '443'].includes(u.port)) throw Object.assign(new Error('That link is not allowed.'), { code: 'BLOCKED' });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw Object.assign(new Error('That address is not allowed.'), { code: 'BLOCKED' });
    return u;
  }
  await new Promise((resolve, reject) => safeLookup(host, {}, (err) => (err ? reject(err) : resolve())));
  return u;
}

// GET a public address. Returns { status, headers, body, url }. The body is cut off at maxBytes (that is fine for a web
// page head or a picture limit); `truncated` says so.
function get(raw, { timeout = 4000, maxBytes = 512 * 1024, headers = {}, maxRedirects = 3, allowPrivate = false } = {}) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    const go = async (target) => {
      let u;
      try {
        u = allowPrivate ? new URL(target) : await assertPublicUrl(target);
      } catch (err) {
        return reject(err);
      }
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        u,
        { method: 'GET', timeout, lookup: allowPrivate ? undefined : safeLookup, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TurboFex/1.0)', 'Accept-Encoding': 'identity', ...headers } },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (++hops > maxRedirects) return reject(new Error('Too many redirects.'));
            return go(new URL(res.headers.location, u).href);
          }
          const chunks = [];
          let size = 0;
          let truncated = false;
          res.on('data', (d) => {
            size += d.length;
            if (size > maxBytes) {
              truncated = true;
              chunks.push(d.subarray(0, Math.max(0, d.length - (size - maxBytes))));
              res.destroy();
            } else {
              chunks.push(d);
            }
          });
          const done = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url: u.href, truncated });
          res.on('end', done);
          res.on('close', done);
          res.on('error', done);
        }
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error('The server took too long.'), { code: 'TIMEOUT' })));
      req.on('error', reject);
      req.end();
    };
    go(raw);
  });
}

module.exports = { get, assertPublicUrl, isPrivateIp, safeLookup };
