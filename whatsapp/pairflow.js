// The part of `pair` that talks to the owner. The pairing SITE does the linking and sends the session ID to the person (core/pairsite.js); the
// owner only gets the pairing CODE to hand over, and is told how it goes. Everything goes to the owner's own PRIVATE chat, never to a group.
const pairsite = require('../core/pairsite');
const { ownerChat } = require('./owner');

const pretty = (number) => `+${number}`;
const active = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isActive = (number) => active.has(number);

// why the site refused to start, in plain words
function refusal(r, url) {
  if (r.network) return `I could not reach the pairing site (${pairsite.hostOf(url)}).\n▸ Check that it is online and that its address is right (PAIR_SITE_URL, or pairSiteUrl in config.js).`;
  if (r.error) return `The pairing site says: ${r.error}`;
  return `The pairing site did not accept it (error ${r.status || '?'}).`;
}

async function begin(sock, number, opts = {}) {
  const to = ownerChat(sock);
  const say = (text) => sock.sendMessage(to, { text }).catch(() => {});
  const site = { url: opts.url, fetchFn: opts.fetchFn };
  const interval = opts.intervalMs != null ? opts.intervalMs : 2000;
  const maxMs = opts.maxMs != null ? opts.maxMs : 7 * 60 * 1000;
  const dmWaitMs = opts.dmWaitMs != null ? opts.dmWaitMs : 60 * 1000;
  if (active.has(number)) return 'already';
  active.add(number);
  let job = '';
  let abandon = false; // only a pairing nobody finished is cancelled: a linked one may still be sending the session ID to the person
  try {
    const r = await pairsite.start(number, site);
    if (!r.ok) {
      await say(`⚠️ *Could not start the pairing for ${pretty(number)}.*\n▸ ${refusal(r, opts.url)}`);
      return 'refused';
    }
    job = r.job;

    const began = Date.now();
    let sentCode = '';
    let announcedLinking = false;
    let linkedAt = 0;
    let misses = 0;
    for (;;) {
      const p = await pairsite.progress(job, site);
      if (!p.ok) {
        misses += 1;
        if (p.status === 404 || misses >= 5) {
          abandon = true;
          await say(`⚠️ *I lost the pairing for ${pretty(number)}.*\n▸ ${p.network ? 'The pairing site could not be reached.' : 'The pairing site no longer knows it.'} Send \`.pair ${number}\` again.`);
          return 'lost';
        }
      } else {
        misses = 0;
        if (p.state === 'code' && p.code && p.code !== sentCode) {
          sentCode = p.code;
          await say(`🔗 *Pairing code for ${pretty(number)}*\n▸ Code: *${p.code}*\n▸ Give it to them: WhatsApp > Linked devices > Link a device > "Link with phone number instead", then type the code.\n▸ _When they have linked, the pairing site sends their session ID to THEIR OWN WhatsApp, not to you. They have about 5 minutes to put it in their bot._`);
        }
        if (p.state === 'linking' && !announcedLinking) {
          announcedLinking = true;
          await say(`⏳ *${pretty(number)} entered the code.* Linking now...`);
        }
        if (p.state === 'failed') {
          await say(`⚠️ *The pairing for ${pretty(number)} did not work.*\n▸ ${p.error || 'The pairing site could not link it.'}\n▸ Send \`.pair ${number}\` again for a new code.`);
          return 'failed';
        }
        if (p.state === 'linked') {
          if (!linkedAt) linkedAt = Date.now();
          if (p.dm === true) {
            await say(`📨 *${pretty(number)} is linked.*\n▸ The pairing site sent their session ID to their own WhatsApp ("Message yourself"). You do not see it.\n▸ _They put it in SESSION_ID on their own host within 5 minutes. Nothing runs for them on this server, and none of my settings were touched._`);
            return 'delivered';
          }
          if (p.dm === false || Date.now() - linkedAt > dmWaitMs) {
            await say(`⚠️ *${pretty(number)} is linked, but the pairing site could not message them their session ID.*\n▸ Ask them to remove the device (WhatsApp > Linked devices > Log out) and try again, here or on the pairing site themselves.`);
            return 'linked-no-dm';
          }
        }
      }
      if (!linkedAt && Date.now() - began > maxMs) {
        abandon = true;
        await say(`⌛ *${pretty(number)} is not linked.*\n▸ The code was not entered in time. Send \`.pair ${number}\` again for a new code.`);
        return 'timeout';
      }
      await sleep(interval);
    }
  } catch (err) {
    await say(`⚠️ *Something went wrong with the pairing for ${pretty(number)}.*\n▸ Send \`.pair ${number}\` again.`);
    return 'error';
  } finally {
    active.delete(number);
    if (job && abandon) pairsite.cancel(job, site).catch(() => {});
  }
}

module.exports = { begin, isActive };
