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

const failedAt = new Map(); // chat -> when we last said "I could not answer" (so a broken service does not make the bot nag)
const NAG_GAP_MS = 2 * 60 * 1000;

async function maybeReply({ sock, msg, jid, text, botIds, isOwner }) {
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
  // "typing..." while the AI thinks (the person sees that something is happening; it is repeated because WhatsApp lets it fade)
  const typing = () => sock.sendPresenceUpdate?.('composing', jid)?.catch?.(() => {});
  typing();
  const typingTimer = setInterval(typing, 7000);
  try {
    const answer = await ai.chat(history.slice(-MAX_TURNS));
    history.push({ role: 'assistant', content: answer });
    memory.set(jid, history.slice(-MAX_TURNS));
    if (memory.size > 500) memory.delete(memory.keys().next().value);
    clearInterval(typingTimer);
    await sock.sendMessage(jid, { text: answer }, { quoted: msg });
    sock.sendPresenceUpdate?.('paused', jid)?.catch?.(() => {});
  } catch (err) {
    clearInterval(typingTimer);
    sock.sendPresenceUpdate?.('paused', jid)?.catch?.(() => {});
    history.pop();
    console.log(`Chatbot failed: ${err.message}`);
    // do not stay silent: tell the person (at most once every 2 minutes in a chat). Only the owner sees the reason.
    if (Date.now() - (failedAt.get(jid) || 0) < NAG_GAP_MS) return;
    failedAt.set(jid, Date.now());
    if (failedAt.size > 2000) failedAt.clear();
    let owner = false;
    try {
      owner = !!(isOwner && (await isOwner()));
    } catch (e) {
      owner = false;
    }
    const detail = owner
      ? `\n\n*Reason:* ${String(err.message).slice(0, 300)}\n*Fix:* send \`${store.effectivePrefix()}setapi gemini <key>\` (a free key from aistudio.google.com/apikey), then \`${store.effectivePrefix()}chatbot test\``
      : '';
    await sock.sendMessage(jid, { text: `😕 *I could not think of an answer just now.* Please try again in a moment.${detail}` }, { quoted: msg }).catch(() => {});
  }
}

const forget = (jid) => memory.delete(jid);

module.exports = { maybeReply, settings, save, forget, enabledFor, addressed, SCOPES };
