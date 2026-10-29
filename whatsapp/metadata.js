// Remembers group details so a command never has to wait for WhatsApp.
//  - fresh (under 5 min): used straight away
//  - older: still used straight away, and refreshed in the background
//  - after a group change (promote, kick...): the next command waits a moment (250 ms) for the new info, then uses the old answer
const { withTimeout } = require('./timeout');

const cache = new Map(); // jid -> { t, meta, hard }
const versions = new WeakMap(); // meta -> number (changed when members or admins change)
const indexes = new WeakMap(); // meta -> { v, byId, admins }
const refreshing = new Map(); // jid -> promise
const FRESH = 5 * 60 * 1000;
const USABLE = 6 * 3600 * 1000; // an old answer is better than waiting
const SLOW = 250; // when a refresh is needed first, wait at most this long (ms) if we have an older answer; the refresh goes on in the background

function fetchFresh(sock, jid) {
  if (refreshing.has(jid)) return refreshing.get(jid);
  const p = withTimeout(Promise.resolve().then(() => sock.groupMetadata(jid)), 15000, 'WhatsApp took too long to send the group info')
    .then((meta) => {
      cache.set(jid, { t: Date.now(), meta, hard: false });
      return meta;
    })
    .finally(() => refreshing.delete(jid));
  refreshing.set(jid, p);
  p.catch(() => {}); // a failed background refresh is not an error
  return p;
}

async function getMeta(sock, jid) {
  const hit = cache.get(jid);
  const age = hit ? Date.now() - hit.t : Infinity;

  if (hit && !hit.hard && age < FRESH) return hit.meta;

  if (hit && !hit.hard && age < USABLE) {
    fetchFresh(sock, jid); // refresh quietly, answer now
    return hit.meta;
  }

  const pending = fetchFresh(sock, jid);
  if (hit) {
    // changed group: try to get the new info, but never keep the person waiting for long
    try {
      return await withTimeout(pending, SLOW, 'slow');
    } catch (err) {
      return hit.meta;
    }
  }
  return pending;
}

// the group changed: the next command asks WhatsApp again (the old answer is only a fallback)
function invalidate(jid) {
  const hit = cache.get(jid);
  if (hit) hit.hard = true;
}

// Someone joined, left, was promoted or demoted: the saved group info is changed directly instead of being thrown
// away and fetched again (that fetch is what made the first reply after every member change slow).
// Returns false when it cannot be applied, then the caller falls back to invalidate().
function applyParticipants(jid, action, list) {
  const hit = cache.get(jid);
  if (!hit || !hit.meta || !Array.isArray(hit.meta.participants)) return false;
  const parts = hit.meta.participants;
  const same = (p, id) => [p.id, p.lid, p.jid, p.phoneNumber].some((x) => x && x === id);
  for (const item of list || []) {
    const id = typeof item === 'string' ? item : item?.id;
    if (!id) continue;
    const at = parts.findIndex((p) => same(p, id));
    if (action === 'add') {
      if (at < 0) parts.push(typeof item === 'string' ? { id, admin: null } : { ...item, admin: item.admin || null });
    } else if (action === 'remove') {
      if (at >= 0) parts.splice(at, 1);
    } else if (action === 'promote' || action === 'demote') {
      if (at < 0) return false;
      parts[at].admin = action === 'promote' ? 'admin' : null;
    } else if (action !== 'modify') {
      return false;
    }
  }
  if ('size' in hit.meta) hit.meta.size = parts.length;
  versions.set(hit.meta, (versions.get(hit.meta) || 0) + 1); // the lookup table is rebuilt
  hit.hard = false;
  return true;
}

// name / description / settings of the group changed
function patch(jid, fields) {
  const hit = cache.get(jid);
  if (!hit || !hit.meta) return false;
  for (const k of ['subject', 'desc', 'announce', 'restrict', 'ephemeralDuration', 'joinApprovalMode', 'memberAddMode']) {
    if (k in fields) hit.meta[k] = fields[k];
  }
  hit.hard = false;
  return true;
}

// fill the cache from the list of all groups (done once after connecting)
function prime(all) {
  let n = 0;
  for (const g of Object.values(all || {})) {
    if (g && g.id && Array.isArray(g.participants)) {
      cache.set(g.id, { t: Date.now(), meta: g, hard: false });
      n += 1;
    }
  }
  return n;
}

const size = () => cache.size;

// A lookup table of a group: member id -> member, and the ids of the admins. Built once per group version, so checking
// who someone is costs the same in a group of 20 and a group of 2000 (before, every message walked the whole member list).
function indexOf(info) {
  const v = versions.get(info) || 0;
  const have = indexes.get(info);
  if (have && have.v === v && have.n === (info.participants || []).length) return have;
  const byId = new Map();
  const admins = new Set();
  for (const p of info.participants || []) {
    for (const id of [p.id, p.lid, p.jid, p.phoneNumber]) {
      if (!id) continue;
      const k = String(id).split('@')[0].split(':')[0];
      byId.set(k, p);
      if (p.admin === 'admin' || p.admin === 'superadmin') admins.add(k);
    }
  }
  const built = { v, n: (info.participants || []).length, byId, admins };
  indexes.set(info, built);
  return built;
}

module.exports = { getMeta, invalidate, applyParticipants, patch, prime, size, indexOf };
