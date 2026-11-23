// The part of `pair` that talks to the owner (see core/pairing.js for how it works): the code, "linked", and the problems. All of it goes to the
// owner's own private chat, never to a group, because a pairing code must not be seen by others.
const pairing = require('../core/pairing');
const { DATA, ROOT } = require('../core/paths');
const { ownerChat } = require('./owner');

const pretty = (number) => `+${number}`;

function begin(sock, name, number, opts = {}) {
  const to = ownerChat(sock);
  const say = (text) => sock.sendMessage(to, { text }).catch(() => {});
  const done = () => pairing.clearPending(DATA, name);
  return pairing.watch({
    root: opts.root || ROOT,
    name,
    number,
    intervalMs: opts.intervalMs,
    maxMs: opts.maxMs,
    onCode: (code) => say(`🔗 *Pairing code for ${pretty(number)}*\n▸ Code: *${code}*\n▸ Tell them: WhatsApp > Linked devices > Link a device > "Link with phone number instead", then type the code.\n▸ _It only works for about 2 minutes. Send_ \`.pair ${number}\` _again for a new one._`),
    onLinked: async () => { done(); await say(`✅ *${pretty(number)} is linked.*\n▸ Their bot is starting now, and they are its owner.`); },
    onRefused: async () => { done(); await say(`⚠️ *WhatsApp refused the pairing code for ${pretty(number)}.*\n▸ Codes are refused at the moment. Try again later, or let them use the pairing site.`); },
    onTimeout: async () => { done(); await say(`⌛ *${pretty(number)} is not linked yet.*\n▸ The code was not entered in time. Send \`.pair ${number}\` again for a new code.`); },
  }).catch(() => {});
}

// after a start (the bot restarts once the first time it becomes several accounts): pairings that were waiting go on
function resume(sock) {
  try {
    for (const p of pairing.pending(DATA)) begin(sock, p.name, p.number);
  } catch (err) {
    // only a convenience
  }
}

module.exports = { begin, resume };
