// The Divine Ledger: everything God changes is written here (who, when, where, what). God can read it with "god ledger".
const jsonstore = require('../jsonstore');

const js = jsonstore.open('realm-ledger', { rows: [] });
const KEEP = 500;

function log({ action, realm = null, target = null, detail = '' }) {
  js.data.rows.push({ at: Date.now(), action, realm, target, detail: String(detail).slice(0, 200) });
  if (js.data.rows.length > KEEP) js.data.rows.splice(0, js.data.rows.length - KEEP);
  js.touch();
}

// newest first. realm = only that realm (and the ones for all realms)
function recent(limit = 10, realm = null) {
  const rows = js.data.rows.filter((r) => !realm || !r.realm || r.realm === realm);
  return rows.slice(-limit).reverse();
}

const count = () => js.data.rows.length;

module.exports = { log, recent, count };
