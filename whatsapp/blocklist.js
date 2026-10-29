// Blocks / unblocks a person. WhatsApp changed how this works for accounts that use "LID" ids,
// so several request shapes are tried (with every id we can find) until one is accepted.
const idmap = require('./idmap');
const { isLid, isPn } = idmap;

async function pnFor(sock, lid) {
  const fromGroups = await idmap.pnFor(sock, lid);
  if (fromGroups) return fromGroups;
  try {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lid);
    return pn && isPn(pn) ? pn : null;
  } catch (err) {
    return null;
  }
}

async function lidFor(sock, pn) {
  const fromGroups = await idmap.lidFor(sock, pn);
  if (fromGroups) return fromGroups;
  try {
    const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(pn);
    if (lid && isLid(lid)) return lid;
  } catch (err) {
    // try the next way
  }
  try {
    const res = await sock.onWhatsApp(pn);
    const lid = res?.[0]?.lid;
    return lid && isLid(lid) ? lid : null;
  } catch (err) {
    return null;
  }
}

// ids = every jid we know for the person (phone form and/or LID form)
async function setBlock(sock, ids, action) {
  let lid = ids.find(isLid);
  let pn = ids.find(isPn);
  if (lid && !pn) pn = await pnFor(sock, lid);
  if (pn && !lid) lid = await lidFor(sock, pn);

  const iq = (attrs) => () =>
    sock.query({
      tag: 'iq',
      attrs: { xmlns: 'blocklist', to: 's.whatsapp.net', type: 'set' },
      content: [{ tag: 'item', attrs: { action, ...attrs } }],
    });

  const attempts = [];
  if (lid && pn) attempts.push(['LID + number', iq({ jid: lid, pn_jid: pn })]);
  if (lid && pn) attempts.push(['number + LID', iq({ jid: pn, lid })]);
  if (pn) attempts.push(['number', iq({ jid: pn })]);
  if (lid) attempts.push(['LID', iq({ jid: lid })]);
  for (const id of [pn, lid].filter(Boolean)) attempts.push([`library (${isLid(id) ? 'LID' : 'number'})`, () => sock.updateBlockStatus(id, action)]);

  const tried = [];
  let lastError = null;
  for (const [name, run] of attempts) {
    try {
      await run();
      return { ok: true, used: name, tried: [...tried, { name }], knownLid: !!lid, knownPn: !!pn };
    } catch (err) {
      tried.push({ name, error: String(err?.message || err).slice(0, 60) });
      lastError = err;
    }
  }
  return { ok: false, error: lastError, tried, knownLid: !!lid, knownPn: !!pn };
}

module.exports = { setBlock };
