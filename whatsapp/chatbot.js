// Chatbot mode: NelsonFx answers messages in the chats where it is switched on (private chats by default).
// In a group it answers when it is tagged, when someone replies to one of its messages, or when a message starts with "NelsonFx".
const store = require('./store');
const ai = require('../core/ai');
const { num, getContextInfo } = require('./utils');

const SCOPES = ['all', 'groups', 'dms', 'selected'];
const memory = new Map(); // chat -> [{ role, content }] (kept in memory only)
const lastAt = new Map();
const MAX_TURNS = 10;
const GAP_MS = 3000;

const settings = () => ({ on: false, scope: 'dms', chats: [], ...(store.getAuto('chatbot') || {}) });
const save = (patch) => store.setAuto('chatbot', { ...settings(), ...patch });

function enabledFor(cfg, jid) {
  if (!cfg.on) return false;
  const isGroup = jid.endsWith('@g.us');
  if (cfg.scope === 'groups') return isGroup;
  if (cfg.scope === 'dms') return !isGroup;
  if (cfg.scope === 'selected') return cfg.chats.includes(jid);
  return true;
}

// is this group message meant for the bot?
function addressed(msg, text, botIds) {
  const ci = getContextInfo(msg);
  if ((ci.mentionedJid || []).some((j) => botIds.includes(num(j)))) return true;
  if (ci.participant && botIds.includes(num(ci.participant))) return true; // a reply to one of the bot's messages
  return new RegExp(`^(hey|hi|hello|ok|okay|yo)?[\\s,]*${ai.NAME}\\b`, 'i').test(text);
}

async function maybeReply({ sock, msg, jid, text, botIds }) {
  const cfg = settings();
  if (!enabledFor(cfg, jid) || msg.key.fromMe || !text || text.length > 800) return;
  const isGroup = jid.endsWith('@g.us');
  if (isGroup && !addressed(msg, text, botIds)) return;
  if (Date.now() - (lastAt.get(jid) || 0) < GAP_MS) return;
  lastAt.set(jid, Date.now());
  if (lastAt.size > 2000) lastAt.clear();

  // the question without the tag or the name
  const ask = text.replace(/@\d{6,}/g, '').replace(new RegExp(`^(hey|hi|hello|ok|okay|yo)?[\\s,]*${ai.NAME}[\\s,:!-]*`, 'i'), '').trim() || text;
  const history = memory.get(jid) || [];
  history.push({ role: 'user', content: isGroup ? `${msg.pushName || 'Someone'}: ${ask}` : ask });
  try {
    const answer = await ai.chat(history.slice(-MAX_TURNS));
    history.push({ role: 'assistant', content: answer });
    memory.set(jid, history.slice(-MAX_TURNS));
    if (memory.size > 500) memory.delete(memory.keys().next().value);
    await sock.sendMessage(jid, { text: answer }, { quoted: msg });
  } catch (err) {
    history.pop();
    console.log(`Chatbot failed: ${err.message}`);
  }
}

const forget = (jid) => memory.delete(jid);

module.exports = { maybeReply, settings, save, forget, enabledFor, addressed, SCOPES };
