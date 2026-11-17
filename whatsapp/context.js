// Short-term memory of the conversation, kept only in memory (nothing is saved to disk, everything expires):
//  1) the last command each person ran in a chat, so ".again" can repeat it
//  2) a question the bot asked the owner ("Did you mean .menu?") that waits for a plain "yes" or "no"
const LAST_MS = 10 * 60 * 1000;
const ASK_MS = 60 * 1000;
const COOL_MS = 15 * 1000;
const MAX = 2000;

const last = new Map(); // chat|person -> { body, name, repeatable, failed, at }
const asks = new Map(); // chat|person -> { msg, body, name, at }
const cool = new Map(); // chat -> when the bot last offered a suggestion there

const key = (jid, who) => `${jid}|${who}`;
const trim = (m) => { if (m.size > MAX) m.clear(); };

function remember(jid, who, rec) { last.set(key(jid, who), { ...rec, at: Date.now() }); trim(last); }
function recall(jid, who) {
  const r = last.get(key(jid, who));
  if (!r) return null;
  if (Date.now() - r.at > LAST_MS) { last.delete(key(jid, who)); return null; }
  return r;
}
function markFailed(jid, who) { const r = last.get(key(jid, who)); if (r) r.failed = true; }

// one offer per chat every few seconds, so a person who types nonsense cannot make the bot talk a lot
function mayOffer(jid) {
  const now = Date.now();
  if (now - (cool.get(jid) || 0) < COOL_MS) return false;
  cool.set(jid, now); trim(cool);
  return true;
}

function ask(jid, who, rec) { asks.set(key(jid, who), { ...rec, at: Date.now() }); trim(asks); }
const alive = (a) => a && Date.now() - a.at <= ASK_MS;
function hasAsk(jid) {
  for (const [k, a] of asks) { if (!alive(a)) asks.delete(k); else if (k.startsWith(jid + '|')) return true; }
  return false;
}
const YES = /^(yes|y|yeah|yep|yup|ok|okay|sure|do it)[.!]*$/i;
const NO = /^(no|n|nope|nah|cancel|stop)[.!]*$/i;
// 'yes' / 'no' (and the waiting question) or null when the text is not an answer or nothing is waiting for this person
function answer(jid, who, text) {
  const k = key(jid, who); const a = asks.get(k);
  if (!alive(a)) { asks.delete(k); return null; }
  const t = String(text || '').trim();
  const v = YES.test(t) ? 'yes' : NO.test(t) ? 'no' : null;
  if (v) asks.delete(k);
  return v ? { answer: v, ask: a } : null;
}
function clearAsk(jid, who) { asks.delete(key(jid, who)); }

// a copy of the message with other text (keeps the reply-to and everything else), so a corrected command runs like a typed one
function withText(msg, text) {
  const m = msg.message || {};
  const out = { ...msg, key: { ...msg.key, id: `${msg.key.id}:fix` } };
  if (typeof m.conversation === 'string') out.message = { ...m, conversation: text };
  else if (m.extendedTextMessage) out.message = { ...m, extendedTextMessage: { ...m.extendedTextMessage, text } };
  else {
    const f = ['imageMessage', 'videoMessage', 'documentMessage'].find((x) => m[x]);
    out.message = f ? { ...m, [f]: { ...m[f], caption: text } } : { conversation: text };
  }
  return out;
}

function reset() { last.clear(); asks.clear(); cool.clear(); }
module.exports = { remember, recall, markFailed, mayOffer, ask, hasAsk, answer, clearAsk, withText, reset };
