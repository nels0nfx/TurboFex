// Where the bot keeps its saved data. TURBOFEX_DATA can point somewhere else (the tests use a temporary folder).
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.TURBOFEX_DATA ? path.resolve(process.env.TURBOFEX_DATA) : path.join(ROOT, 'data');

module.exports = { ROOT, DATA };
