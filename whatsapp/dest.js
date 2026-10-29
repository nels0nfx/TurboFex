const groups = require('./groups');

// Understands: here | me (back to the default) | a number | a group id | a group number from !gjids | part of a group name
// returns { jid } (null = default owner chat) or { error }
async function parseDestination(sock, text, currentJid) {
  const t = String(text || '').trim();
  if (!t) return { error: 'empty' };
  const low = t.toLowerCase();
  if (low === 'here') return { jid: currentJid };
  if (['me', 'reset', 'default', 'owner'].includes(low)) return { jid: null };
  if (/@(g\.us|s\.whatsapp\.net|lid)$/.test(t)) return { jid: t };

  const digits = t.replace(/\D/g, '');
  if (/^\+?\d[\d\s-]{6,}$/.test(t) && digits.length >= 7 && digits.length <= 15) return { jid: `${digits}@s.whatsapp.net` };

  const g = await groups.resolve(sock, t);
  return g ? { jid: g.jid, name: g.name } : { error: 'not-found' };
}

module.exports = { parseDestination };
