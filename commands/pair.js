const pairflow = require('../whatsapp/pairflow');
const config = require('../config');

module.exports = {
  name: 'pair',
  category: 'owner',
  description: 'Link a number for somebody else through the pairing site: pair 27821234567 gives you the pairing code to give them; the site sends their session ID to their own WhatsApp (owner only)',
  ownerOnly: true,
  noAgain: true,
  async run({ sock, rest, reply, prefix }) {
    const raw = rest.trim();
    const digits = raw.replace(/\D/g, '');
    if (!/^\+?[\d\s-]{8,20}$/.test(raw) || digits.length < 8 || digits.length > 15) {
      return reply(`🔗 *Pair a number for somebody else*\n▸ \`${prefix}pair 27821234567\` (the country code first, digits only)\n▸ _It works like the pairing site: you get the pairing code and give it to that person (WhatsApp > Linked devices > Link a device > "Link with phone number instead")._\n▸ _When they have linked, the pairing site sends their session ID to THEIR OWN WhatsApp, not to you. They put it in SESSION_ID on their own host. Nothing runs for them on this server, and none of my settings are touched._`);
    }
    const mine = String((sock.user && sock.user.id) || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    if (digits === mine || digits === String(config.number || '')) return reply('⚠️ *That is this bot\'s own number.*\n▸ _It is already linked._');
    if (pairflow.isActive(digits)) return reply(`ℹ️ *+${digits} is already being linked.*\n▸ The pairing code is in your private chat. Wait for it to end (about 7 minutes at most) before you start again.`);

    pairflow.begin(sock, digits); // goes on by itself; the owner is told in his private chat
    return reply(`🔗 *Linking +${digits} on the pairing site*\n▸ The pairing code arrives in your private chat in a few seconds. Give it to them.\n▸ _When they have entered it, the pairing site sends their session ID to THEIR OWN WhatsApp, not to you. This bot is not changed._`);
  },
};
