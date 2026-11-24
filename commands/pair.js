const pairing = require('../core/pairing');
const pairflow = require('../whatsapp/pairflow');
const config = require('../config');

module.exports = {
  name: 'pair',
  category: 'owner',
  description: 'Link a number for somebody else, like the pairing site: pair 27821234567 gives you the pairing code to give them; their session ID is sent to THEIR OWN WhatsApp (owner only)',
  ownerOnly: true,
  noAgain: true,
  async run({ sock, rest, reply, prefix }) {
    const raw = rest.trim();
    const digits = raw.replace(/\D/g, '');
    if (!/^\+?[\d\s-]{8,20}$/.test(raw) || digits.length < 8 || digits.length > 15) {
      return reply(`🔗 *Pair a number for somebody else*\n▸ \`${prefix}pair 27821234567\` (the country code first, digits only)\n▸ _You get the pairing code, like on the pairing site. Give it to that person: WhatsApp > Linked devices > Link a device > "Link with phone number instead"._\n▸ _When they have linked, their session ID and the steps are sent to THEIR OWN WhatsApp, not to you. They put the ID in SESSION_ID on their own host. Nothing runs for them on this server, and none of my settings are touched._`);
    }
    if (digits === String(config.number || '')) return reply('⚠️ *That is this bot\'s own number.*');
    if (pairing.isWatching(digits)) return reply(`ℹ️ *+${digits} is already being linked.*\n▸ The pairing code is in your private chat. Wait for it to end (about 6 minutes at most) before you start again.`);

    pairflow.begin(sock, digits);
    return reply(`🔗 *Linking +${digits} for them*\n▸ The pairing code arrives in your private chat in about 10 to 40 seconds. Give it to them.\n▸ _When they have entered it, their session ID goes to THEIR OWN WhatsApp, not to you. This runs on its own and nothing of this bot is changed._`);
  },
};
