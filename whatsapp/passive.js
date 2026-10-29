// Things the bot does on normal messages: games, AFK notices, auto-replies
const config = require('../config');
const store = require('./store');
const games = require('./play');
const clock = require('../core/clock');
const { num, whoIds, getTargets, hasPhrase } = require('./utils');

const cooldown = new Map();

function cooledDown(key, seconds) {
  const now = Date.now();
  if (now - (cooldown.get(key) || 0) < seconds * 1000) return true;
  cooldown.set(key, now);
  if (cooldown.size > 5000) cooldown.clear();
  return false;
}

// AFK: stays ON until the owner sends "afk off" (writing again does NOT switch it off).
// Everybody who mentions or messages the away person is told ONCE per AFK session, never again.
async function afk({ sock, msg, jid, isGroup, isCommand, botIds }) {
  if (msg.key.fromMe) return;
  const ids = whoIds(msg, botIds);
  const who = ids[0] || num(msg.key.participant || jid);

  // Someone mentioned or replied to an away person in a group
  if (isGroup) {
    for (const target of getTargets(msg)) {
      const record = store.afkGet([num(target)]);
      if (!record || ids.some((i) => record.ids.includes(i))) continue;
      if (store.afkWasTold(record, who)) continue;
      store.afkMarkTold(record, who);
      const why = record.reason ? `\n▸ *Reason:* ${record.reason}` : '';
      await sock.sendMessage(
        jid,
        { text: `*AFK*\n@${num(target)} is away right now.${why}\n▸ *Away for:* ${clock.duration(Date.now() - record.since)}`, mentions: [target] },
        { quoted: msg }
      );
    }
    return;
  }

  // Someone wrote privately to an away owner
  if (!isCommand) {
    const owner = store.afkGet([...botIds, config.ownerNumber].filter(Boolean));
    if (owner && !store.afkWasTold(owner, who)) {
      store.afkMarkTold(owner, who);
      const why = owner.reason ? `\n▸ *Reason:* ${owner.reason}` : '';
      await sock.sendMessage(
        jid,
        { text: `*AFK*\nI am away right now.${why}\n▸ *Away for:* ${clock.duration(Date.now() - owner.since)}\n_I will reply when I am back._` },
        { quoted: msg }
      );
    }
  }
}

async function filters({ sock, msg, jid, text, isGroup }) {
  const sets = [store.peekFilters(jid)]; // this chat only
  if (!isGroup) sets.push(store.getPrivateFilters()); // all private chats (!pfilter)
  sets.push(store.getGlobalFilters()); // every chat (!gfilter)
  for (const set of sets) {
    for (const [word, answer] of Object.entries(set)) {
      if (!hasPhrase(text, word)) continue;
      if (cooledDown(`filter|${jid}|${word}`, 10)) return;
      await sock.sendMessage(jid, { text: answer }, { quoted: msg });
      return; // one auto-reply per message
    }
  }
}

// first private message of the day: send the greeting set with !setgreet
async function greet({ sock, msg, jid, text, isGroup, isCommand, botIds }) {
  if (isGroup || isCommand || !text || msg.key.fromMe) return;
  const greeting = store.getGreet();
  if (!greeting || store.wasGreeted(jid, 24 * 3600 * 1000)) return;
  // an owner who is AFK already gets the AFK notice instead
  if (store.afkGet([...botIds, config.ownerNumber].filter(Boolean))) return;
  store.markGreeted(jid);
  const tag = `@${num(jid)}`;
  await sock.sendMessage(jid, { text: greeting.replace(/@user/gi, () => tag), mentions: [jid] }, { quoted: msg });
}

async function runPassive(ctx) {
  const { sock, msg, jid, text, isCommand, botIds } = ctx;
  try {
    if (!isCommand && text && games.get(jid)) await games.route({ sock, msg, jid, text, botIds });
    await afk(ctx);
    if (!isCommand && text) await filters(ctx);
    await greet(ctx);
  } catch (err) {
    console.error('Passive feature error:', err.message);
  }
}

module.exports = { runPassive };
