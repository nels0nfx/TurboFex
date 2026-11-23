const pairing = require('../core/pairing');
const pairflow = require('../whatsapp/pairflow');
const { ROOT, DATA } = require('../core/paths');
const config = require('../config');

module.exports = {
  name: 'pair',
  category: 'owner',
  description: 'Link a WhatsApp number for somebody else: pair 27821234567 gives you a pairing code to give to that person (owner only)',
  ownerOnly: true,
  noAgain: true,
  async run({ sock, rest, reply, prefix }) {
    if (process.env.ACCOUNT_NAME && process.env.ACCOUNT_NAME !== 'main') {
      return reply('⚠️ *Use this on the main bot.*\n▸ _Pairing for other people is done from the first bot of this server._');
    }
    const raw = rest.trim();
    const digits = raw.replace(/\D/g, '');
    if (!/^\+?[\d\s-]{8,20}$/.test(raw) || digits.length < 8 || digits.length > 15) {
      return reply(`🔗 *Pair a number for somebody else*\n▸ \`${prefix}pair 27821234567\` (the country code first, digits only)\n▸ _I send you a pairing code. Give it to that person: WhatsApp > Linked devices > Link a device > "Link with phone number instead"._\n▸ _The bot then runs for that number, and they own it._`);
    }

    const r = pairing.start(ROOT, digits, config.number);
    if (r.status === 'own') return reply('⚠️ *That is this bot\'s own number.*');
    if (r.status === 'broken') return reply('⚠️ *accounts.json is damaged, so I cannot add an account.*\n▸ _Fix or delete that file on the server, then try again._');
    if (r.status === 'linked') return reply(`ℹ️ *+${digits} is already linked.*\n▸ Their bot is already running as the account "${r.name}".`);

    // started (a new account) or waiting (it exists but is not linked yet): the code comes to the owner's private chat
    pairing.addPending(DATA, { name: r.name || pairing.nameFor(digits), number: digits });
    pairflow.begin(sock, r.name || pairing.nameFor(digits), digits);
    return reply(r.status === 'started'
      ? `🔗 *Linking +${digits} for them*\n▸ I am starting a bot for that number. The pairing code arrives in your private chat in about 10 to 40 seconds.${r.restartsOnce ? '\n▸ _The first time, I restart once (about 10 seconds) to run more than one bot. The code still comes._' : ''}`
      : `🔗 *+${digits} is waiting to be linked.*\n▸ The latest pairing code is sent to your private chat. If there is none yet, it comes in a few seconds.`);
  },
};
