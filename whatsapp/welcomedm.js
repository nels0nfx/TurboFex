// The welcome message that new members get IN PRIVATE (the welcomedm command). Only when an admin switched it on.
// One message for each new member, at most 20 an hour for one group (see groupstats.dmAllowed), so a raid cannot make the bot spam.
const store = require('./store');
const meta = require('./metadata');
const stats = require('./groupstats');

const DEFAULT = '👋 Welcome to *{group}*!\n\n{rules}\nGlad to have you here.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settings = { gapMs: 1500 }; // a short pause between two private messages (tests make it 0)

function render(template, { group, rules }) {
  return String(template || DEFAULT)
    .replace(/\{group\}/gi, () => group)
    .replace(/\{rules\}/gi, () => (rules ? `*Group rules*\n${rules}\n` : ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function send(sock, group, ids) {
  const cfg = stats.welcomeDm(group);
  if (!cfg.on || !ids.length) return 0;
  let name = 'the group';
  try {
    name = (await meta.getMeta(sock, group))?.subject || name;
  } catch (err) {
    // the group name is not important
  }
  const rules = store.getGroup(group).rules || '';
  let sent = 0;
  for (const j of ids) {
    if (!/@(s\.whatsapp\.net|lid)$/.test(String(j))) continue;
    if (!stats.dmAllowed(group)) break;
    try {
      await sock.sendMessage(j, { text: render(cfg.text, { group: name, rules }) });
      sent += 1;
    } catch (err) {
      // the person cannot be written to: nothing to do
    }
    if (settings.gapMs) await sleep(settings.gapMs);
  }
  return sent;
}

module.exports = { send, render, DEFAULT, settings };
