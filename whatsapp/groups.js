// The groups this WhatsApp account is in (for !gjids, !gstatus, !gsend and the destination settings)
const { withTimeout } = require('./timeout');

let cache = { at: 0, list: [] };
const TTL = 2 * 60 * 1000;

async function list(sock, fresh = false) {
  if (!fresh && cache.list.length && Date.now() - cache.at < TTL) return cache.list;
  const all = await withTimeout(sock.groupFetchAllParticipating(), 30000, 'WhatsApp took too long to send the group list');
  cache = {
    at: Date.now(),
    list: Object.values(all)
      .map((g) => ({ jid: g.id, name: g.subject || '(no name)', size: (g.participants || []).length }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  return cache.list;
}

// "3" (number from !gjids), a full group id, or part of the group name
async function resolve(sock, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (t.endsWith('@g.us')) return { jid: t, name: t };
  const groups = await list(sock);
  if (/^\d{1,4}$/.test(t)) {
    const g = groups[Number(t) - 1];
    return g ? { jid: g.jid, name: g.name } : null;
  }
  const hits = groups.filter((g) => g.name.toLowerCase().includes(t.toLowerCase()));
  return hits.length === 1 ? { jid: hits[0].jid, name: hits[0].name } : null;
}

module.exports = { list, resolve };
