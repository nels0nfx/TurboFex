// Every test file starts with this: the bot saves its data in a temporary folder, never in the real data folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turbofex-test-'));
process.env.TURBOFEX_DATA = dir;
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || '27800000001';
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

module.exports = { dir };

