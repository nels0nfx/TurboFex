// Every test file starts with this: the bot saves its data in a temporary folder, never in the real data folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turbofex-test-'));
process.env.TURBOFEX_DATA = dir;
process.env.CONSOLE_CHAT = process.env.CONSOLE_CHAT || 'off'; // the tests do not print every message
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || '27800000001';
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

module.exports = { dir };
process.env.PHONE_ASKS_PER_HOUR = process.env.PHONE_ASKS_PER_HOUR || '1000'; // the hourly limit of phone requests would stop the many watcher tests
