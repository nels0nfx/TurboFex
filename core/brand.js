const NAME = 'TurboFex';
const VERSION = require('../package.json').version;

function enforce() {
  // The bot name is hard-coded so it cannot be changed from a panel or env.
  // Editing this file or the package name stops the bot from starting.
  if (NAME !== 'TurboFex') {
    console.error('Bot name was changed. Refusing to start.');
    process.exit(43);
  }
}

module.exports = { NAME, VERSION, enforce };
