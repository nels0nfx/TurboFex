// The view-once vault. WhatsApp deletes a view-once file from its servers as soon as the phone opens it, so a file that was
// not downloaded WHEN IT ARRIVED can never be fetched again. The vault keeps what arrived (the words of a view-once text, or
// the picture / video / voice note itself) in data/viewonce, so `vv` can open the same view-once again and again, also after
// it was opened on the phone and also after a restart. Old items are removed by age, by count and by total size.
const fs = require('fs');
const path = require('path');
const { DATA } = require('../core/paths');

const DIR = path.join(DATA, 'viewonce');
const KEEP_MS = 14 * 24 * 60 * 60 * 1000; // two weeks
const MAX_ITEMS = 150;
const MAX_TOTAL = 300 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;

const inflight = new Map(); // id -> promise of the file being downloaded (so a file is never downloaded twice)
let lastPrune = 0;

const safe = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
const where = (id) => ({ meta: path.join(DIR, `${safe(id)}.json`), bin: path.join(DIR, `${safe(id)}.bin`) });

function writeItem(id, meta, buffer) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const p = where(id);
    if (buffer) fs.writeFileSync(p.bin, buffer);
    fs.writeFileSync(p.meta, JSON.stringify({ ...meta, id, at: Date.now() })); // written last: an item without its details does not exist
    prune();
    return true;
  } catch (err) {
    console.error('Could not keep the view-once:', err.message);
    return false;
  }
}

// keeps the words of a view-once text (also used for the ones the bot sends itself)
function keepText(id, text, extra = {}) {
  if (!id || !text) return false;
  return writeItem(id, { kind: 'text', text: String(text), ...extra });
}

// a kept item: { kind, text | buffer, mime, caption, ptt, ... } or null
function get(id) {
  if (!id) return null;
  try {
    const p = where(id);
    const meta = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
    if (meta.kind !== 'text') meta.buffer = fs.readFileSync(p.bin);
    return meta;
  } catch (err) {
    return null;
  }
}

function has(id) {
  try {
    return !!id && fs.existsSync(where(id).meta);
  } catch (err) {
    return false;
  }
}

// The file of a view-once message: the kept copy, the download already running, or a new download that is then kept.
// `fetch(sock, msg)` is the bot's own downloader. A download that fails is not kept, so a later try can still work.
async function obtain(sock, msg, vo, fetch) {
  const id = msg.key?.id;
  if (id) {
    const kept = get(id);
    if (kept && kept.buffer) return kept.buffer;
    if (inflight.has(id)) return inflight.get(id);
  }
  const job = (async () => {
    const buffer = await fetch(sock, msg);
    if (id && buffer && buffer.length <= MAX_FILE) {
      const node = vo.node || {};
      writeItem(id, {
        kind: vo.kind,
        mime: node.mimetype || '',
        caption: node.caption || '',
        ptt: !!node.ptt,
        seconds: Number(node.seconds) || 0,
        width: Number(node.width) || 0,
        height: Number(node.height) || 0,
        jid: msg.key.remoteJid,
        sender: msg.key.participant || msg.key.remoteJid,
      }, buffer);
    }
    return buffer;
  })();
  if (id) {
    inflight.set(id, job);
    job.then(() => inflight.delete(id), () => inflight.delete(id));
  }
  return job;
}

// Called for every complete view-once that arrives, whether or not the auto view-once copy is on: the owner can always open it
// later with vv. Never throws and never waits.
function keep(sock, msg, vo, fetch) {
  try {
    const id = msg.key?.id;
    if (!id || !vo || vo.empty || has(id)) return;
    if (vo.kind === 'text') {
      keepText(id, vo.text, { jid: msg.key.remoteJid, sender: msg.key.participant || msg.key.remoteJid });
      return;
    }
    obtain(sock, msg, vo, fetch).catch((err) => console.log(`👁️ Could not keep the view-once file: ${String(err.message).slice(0, 80)}`));
  } catch (err) {
    // keeping a copy must never break message handling
  }
}

function prune(force = false) {
  const now = Date.now();
  if (!force && now - lastPrune < 60000) return;
  lastPrune = now;
  try {
    const items = [];
    for (const f of fs.readdirSync(DIR)) {
      if (!f.endsWith('.json')) continue;
      const base = f.slice(0, -5);
      const metaFile = path.join(DIR, f);
      const binFile = path.join(DIR, `${base}.bin`);
      let at = 0;
      let size = 0;
      try {
        at = JSON.parse(fs.readFileSync(metaFile, 'utf8')).at || 0;
        size = fs.statSync(metaFile).size + (fs.existsSync(binFile) ? fs.statSync(binFile).size : 0);
      } catch (err) {
        at = 0; // damaged: goes first
      }
      items.push({ base, at, size });
    }
    items.sort((a, b) => b.at - a.at); // newest first
    let total = 0;
    items.forEach((it, i) => {
      total += it.size;
      if (now - it.at > KEEP_MS || i >= MAX_ITEMS || total > MAX_TOTAL) {
        fs.rmSync(path.join(DIR, `${it.base}.json`), { force: true });
        fs.rmSync(path.join(DIR, `${it.base}.bin`), { force: true });
      }
    });
  } catch (err) {
    // nothing to clean
  }
}

module.exports = { keep, keepText, get, has, obtain, prune, DIR, MAX_FILE };
