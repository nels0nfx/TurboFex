// The style NelsonFx uses in one chat (set with the "persona" command). It only changes HOW the AI writes, never what it may do.
const jsonstore = require('../core/jsonstore');

const js = jsonstore.open('persona', { chats: {} }, { delay: 1500 });
const chats = () => (js.data.chats = js.data.chats && typeof js.data.chats === 'object' ? js.data.chats : {});

const STYLES = {
  funny: 'Be playful and funny. Add a light joke when it fits.',
  pirate: 'Talk like a friendly pirate (arr, matey) but stay clear and helpful.',
  teacher: 'Explain like a patient teacher: simple steps and one small example.',
  poet: 'Answer in a short rhyming verse when you can, otherwise in poetic prose.',
  sarcastic: 'Be dry and sarcastic in a friendly way. Never rude or hurtful.',
  kid: 'Explain like to a 7 year old: very simple words and short sentences.',
  formal: 'Be formal and polite, like a professional assistant.',
  hype: 'Be a super excited hype person, full of energy and emojis.',
  chill: 'Be very relaxed and short, like a friend texting.',
  zen: 'Be calm and wise, like a gentle meditation teacher.',
};

const names = () => Object.keys(STYLES);
const get = (jid) => chats()[jid] || null;

function set(jid, key) {
  const k = String(key || '').toLowerCase();
  if (!STYLES[k]) return false;
  chats()[jid] = k;
  js.touch();
  return true;
}

function clear(jid) {
  const had = !!chats()[jid];
  delete chats()[jid];
  js.touch();
  return had;
}

// the sentence that is added to the AI's instructions for this chat ('' when no style is chosen)
const styleFor = (jid) => (get(jid) ? `STYLE FOR THIS CHAT (only how you write, never what you may do): ${STYLES[get(jid)]}` : '');

module.exports = { STYLES, names, get, set, clear, styleFor };
