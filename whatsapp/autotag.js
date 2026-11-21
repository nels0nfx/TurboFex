// Auto tag: in a group where the owner switched it on (command `autotag on`), EVERY message written there makes the bot
// tag everybody in the group silently: one message with an invisible text, so nobody sees a list of names, but everybody is
// notified. The bot does not react to, quote or answer the message that started it.
// It is OFF everywhere until the owner switches it on, and it is saved per group (data/autotag.json).
const jsonstore = require('../core/jsonstore');
const meta = require('./metadata');

const js = jsonstore.open('autotag', { groups: [] });
const INVISIBLE = '\u200E'; // a mark that cannot be seen: the message looks empty

const isOn = (jid) => js.data.groups.includes(jid);

// switches the tagging for one group; returns the new state
function set(jid, value) {
  const has = isOn(jid);
  if (value && !has) js.data.groups.push(jid);
  if (!value && has) js.data.groups = js.data.groups.filter((g) => g !== jid);
  js.touch();
  return isOn(jid);
}

// things that arrive as "messages" but are nobody writing: reactions, system notices, poll votes, edits
const NOT_WRITING = new Set(['reactionMessage', 'protocolMessage', 'pollUpdateMessage', 'keepInChatMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'editedMessage']);
function isWriting(msg) {
  const keys = Object.keys((msg && msg.message) || {}).filter((k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage');
  return keys.length > 0 && !keys.some((k) => NOT_WRITING.has(k));
}

// the owner's own "autotag" command must not tag everybody just because it was typed
function isSwitchCommand(text, prefix) {
  const t = String(text || '').trim();
  if (prefix && !t.startsWith(prefix)) return false;
  return (t.slice((prefix || '').length).trim().split(/\s+/)[0] || '').toLowerCase() === 'autotag';
}

// called for every message (handler -> passive.js). Never reacts, never quotes, never throws into the chat.
async function maybe({ sock, msg, jid, text, isGroup, prefix }) {
  if (!isGroup || msg.synthetic || !isOn(jid)) return false;
  if (!isWriting(msg) || isSwitchCommand(text, prefix)) return false;
  const group = await meta.getMeta(sock, jid);
  const ids = ((group && group.participants) || []).map((p) => p.id).filter(Boolean);
  if (!ids.length) return false;
  await sock.sendMessage(jid, { text: INVISIBLE, mentions: ids });
  return true;
}

module.exports = { maybe, set, isOn, isWriting, isSwitchCommand, INVISIBLE };
