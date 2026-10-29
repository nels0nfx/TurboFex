// The welcome message: sent once to whoever connects the bot (and again if a different number is linked)
const config = require('../config');
const brand = require('../core/brand');
const store = require('./store');
const { num, selfJid } = require('./utils');

const settings = { delayMs: 6000 }; // wait a few seconds after connecting so WhatsApp has settled
let sending = false;

function linksText() {
  const l = brand.links;
  return (
    `💬 Support group (Telegram): ${l.telegramSupport}\n` +
    `📣 Telegram channel: ${l.telegramChannel}\n` +
    `🟢 WhatsApp channel: ${l.whatsappChannel}\n` +
    `💻 GitHub (source and updates): ${l.github}`
  );
}

function welcomeText(prefix, ownerSet) {
  const tip = ownerSet ? '' : `\n\n⚙️ Tip: set *NUMBER* (your number) in config.js or the environment so only you control the bot.`;
  return (
    `🎉 *Welcome to ${brand.botName}!*\n` +
    `Your bot is connected and ready ⚡\n\n` +
    `*Quick start*\n` +
    `• Send *${prefix}menu* to see all commands\n` +
    `• Send *${prefix}ping* to test me\n` +
    `• Add me to a group, make me admin, then try *${prefix}tagall*\n` +
    `• *${prefix}status* checks that everything is healthy\n` +
    `• *${prefix}update* checks for new versions${tip}\n\n` +
    `*Stay connected*\n${linksText()}\n\n` +
    `Made with ❤️ by ${brand.creator}`
  );
}

// returns true if the welcome message was sent now
async function maybeSendWelcome(sock) {
  const account = num(sock.user?.id);
  if (!account || sending || store.getWelcomedFor() === account) return false;

  const owner = config.ownerNumber;
  const to = owner && owner !== account ? `${owner}@s.whatsapp.net` : selfJid(sock); // the owner's DM, or the bot's own chat
  const prefix = store.effectivePrefix();

  sending = true;
  try {
    await sock.sendMessage(to, { text: welcomeText(prefix, !!owner) });
    store.setWelcomedFor(account); // only remembered when it really was sent
    return true;
  } catch (err) {
    console.log('Could not send the welcome message yet (will try again next time):', err.message);
    return false;
  } finally {
    sending = false;
  }
}

module.exports = { maybeSendWelcome, welcomeText, linksText, settings };
