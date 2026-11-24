// The part of `pair` that talks to the owner (see core/pairing.js for how it works). The owner gets the pairing CODE to give to the person, and
// is told how it goes. The SESSION ID is NOT sent here: the linked number sends it to ITSELF (core/pairdeliver.js), like the pairing site does.
// Everything for the owner goes to his own PRIVATE chat, never to a group.
const pairing = require('../core/pairing');
const { DATA, ROOT } = require('../core/paths');
const { ownerChat } = require('./owner');

const pretty = (number) => `+${number}`;

function begin(sock, number, opts = {}) {
  const to = ownerChat(sock);
  const say = (text) => sock.sendMessage(to, { text }).catch(() => {});
  const run = pairing.startLinker({ root: opts.root || ROOT, base: opts.base || DATA, number, spawnFn: opts.spawnFn });
  const stop = () => pairing.finish(run);
  const killOnExit = () => { try { run.child.kill('SIGKILL'); } catch (err) { /* gone */ } };
  process.once('exit', killOnExit); // never leave the temporary process behind

  return pairing.watch({
    folder: run.folder,
    number,
    intervalMs: opts.intervalMs,
    maxMs: opts.maxMs,
    deliverMs: opts.deliverMs,
    onCode: (code) => say(`🔗 *Pairing code for ${pretty(number)}*\n▸ Code: *${code}*\n▸ Give it to them: WhatsApp > Linked devices > Link a device > "Link with phone number instead", then type the code.\n▸ _It only works for about 2 minutes. When they have linked, their session ID is sent to THEIR OWN WhatsApp, not here._`),
    onLinked: () => say(`✅ *${pretty(number)} is linked.*\n▸ I am sending their session ID and the instructions to their own WhatsApp now (the chat with themselves).`),
    onDelivered: async () => {
      await stop();
      await say(`📨 *Delivered to ${pretty(number)}.*\n▸ They have their session ID and the steps in their own WhatsApp ("Message yourself").\n▸ _You never see the ID. Nothing runs for them on this server, and none of my settings were touched._`);
    },
    onFailed: async (_n, reason) => {
      await stop();
      await say(`⚠️ *${pretty(number)} is linked, but I could not send them their session ID${reason ? ` (${reason})` : ''}.*\n▸ Ask them to remove the device (WhatsApp > Linked devices > Log out), then send \`.pair ${number}\` again.`);
    },
    onRefused: async () => {
      await stop();
      await say(`⚠️ *WhatsApp refused the pairing code for ${pretty(number)}.*\n▸ Codes are refused at the moment. Try again later, or let them use the pairing site.`);
    },
    onTimeout: async (_n, linked) => {
      await stop();
      await say(linked
        ? `⌛ *${pretty(number)} is linked, but I could not confirm that their session ID arrived.*\n▸ Ask them to look in their own chat ("Message yourself"). If it is not there, they remove the device (WhatsApp > Linked devices > Log out) and you send \`.pair ${number}\` again.`
        : `⌛ *${pretty(number)} is not linked.*\n▸ The code was not entered in time. Send \`.pair ${number}\` again for a new code.`);
    },
  }).catch(async () => { await stop(); });
}

module.exports = { begin };
