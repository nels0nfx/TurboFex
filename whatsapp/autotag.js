// Auto tag: in a group where it is switched on (command `autotag on`), the bot tags everybody in the group silently whenever the
// OWNER writes there. It does NOT send a second message: it EDITS the owner's own message, adding the tag (the text stays exactly
// the same, no names are listed, everybody is notified). WhatsApp only lets an account edit its own messages, so messages of other
// people are never changed and nothing is sent for them.
// It is OFF everywhere until the owner switches it on, and it is saved (data/autotag.json): for single groups, or for ALL groups.
const jsonstore = require('../core/jsonstore');
const meta = require('./metadata');

const js = jsonstore.open('autotag', { all: false, groups: [], except: [] });

// "all": every group, except the ones listed in "except". Otherwise only the groups listed in "groups".
const isOn = (jid) => (js.data.all ? !js.data.except.includes(jid) : js.data.groups.includes(jid));

// switches the tagging for one group; returns the new state
function set(jid, value) {
  const d = js.data;
  if (value) {
    d.except = d.except.filter((g) => g !== jid);
    if (!d.all && !d.groups.includes(jid)) d.groups.push(jid);
  } else {
    d.groups = d.groups.filter((g) => g !== jid);
    if (d.all && !d.except.includes(jid)) d.except.push(jid);
  }
  js.touch();
  return isOn(jid);
}

// switches the tagging for ALL groups (also the ones joined later). Switching it off clears every single choice too.
function setAll(value) {
  const d = js.data;
  d.all = !!value;
  d.groups = [];
  d.except = [];
  js.touch();
  return d.all;
}

// what is on right now: { all, groups, except }
const state = () => ({ all: js.data.all, groups: [...js.data.groups], except: [...js.data.except] });

// puts a saved state back (the settings undo)
function restore(saved) {
  const d = js.data;
  d.all = !!(saved && saved.all);
  d.groups = [...((saved && saved.groups) || [])];
  d.except = [...((saved && saved.except) || [])];
  js.touch();
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

// the text of a plain text message (the only kind that can be edited without sending the file again), or null
function editableText(message) {
  if (!message) return null;
  const body = typeof message.conversation === 'string' ? message.conversation : message.extendedTextMessage && message.extendedTextMessage.text;
  return typeof body === 'string' && body.trim() ? body : null;
}

const EDIT_WINDOW_MS = 14 * 60 * 1000; // WhatsApp only allows editing for 15 minutes
const done = new Set(); // messages that were already tagged (never twice)

// called for every message (handler -> passive.js). Never sends a new message, never throws into the chat.
async function maybe({ sock, msg, jid, isGroup, text, prefix }) {
  if (!isGroup || msg.synthetic || !msg.key || !msg.key.fromMe || !isOn(jid)) return false;
  if (!isWriting(msg) || isSwitchCommand(text, prefix)) return false;
  const body = editableText(msg.message);
  if (!body || done.has(msg.key.id)) return false;
  const ts = Number(msg.messageTimestamp && msg.messageTimestamp.low !== undefined ? msg.messageTimestamp.low : msg.messageTimestamp);
  if (ts && Date.now() - ts * 1000 > EDIT_WINDOW_MS) return false; // too old to edit
  const group = await meta.getMeta(sock, jid);
  const ids = ((group && group.participants) || []).map((p) => p.id).filter(Boolean);
  if (!ids.length) return false;

  done.add(msg.key.id);
  if (done.size > 200) done.delete(done.values().next().value);
  const content = { text: body, edit: msg.key, mentions: ids };
  const quoted = msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
  if (quoted && quoted.quotedMessage) {
    // a reply keeps the message it answers
    content.contextInfo = { stanzaId: quoted.stanzaId, participant: quoted.participant, quotedMessage: quoted.quotedMessage };
  }
  await sock.sendMessage(jid, content);
  return true;
}

module.exports = { maybe, set, setAll, restore, isOn, state, isWriting, isSwitchCommand, editableText };
