const store = require('../whatsapp/store');

// on by default: a mistyped command gets a "Did you mean...?" answer
module.exports = {
  name: 'autocorrect',
  aliases: ['didyoumean'],
  category: 'owner',
  description: 'Offer a fix when a command is mistyped: autocorrect on / off (owner only)',
  ownerOnly: true,
  noAgain: true,
  async run({ args, reply, prefix }) {
    const w = (args[0] || '').toLowerCase();
    if (w === 'on' || w === 'off') {
      store.setAuto('autocorrect', w === 'on');
      return reply(w === 'on'
        ? '✅ *Autocorrect is on.*\n▸ _When a command is mistyped I say what I think was meant. You answer_ *yes* _or_ *no* _(no prefix)._'
        : '✅ *Autocorrect is off.*\n▸ _Mistyped commands get no answer._');
    }
    const on = store.getAuto('autocorrect', true) !== false;
    return reply(`🤔 *Autocorrect: ${on ? 'on' : 'off'}*\n▸ _When a command is mistyped I say what I think was meant. You answer_ *yes* _or_ *no*_, without the prefix._\n▸ ${prefix}autocorrect ${on ? 'off' : 'on'}`);
  },
};
