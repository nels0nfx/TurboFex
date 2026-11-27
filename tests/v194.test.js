// v1.9.4: .repair and the automatic repair only clear the keys of the chats that really failed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TURBOFEX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-data-'));
const repair = require('../core/repair');

const stub = (chat, text, participant) => ({ key: { remoteJid: chat, participant, fromMe: false, id: 'X' + Math.random() }, messageStubType: 2, messageStubParameters: [text] });
const fill = (names) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-session-'));
  for (const n of names) fs.writeFileSync(path.join(dir, n), '{}');
  return dir;
};
const GROUP = '120363000000000001@g.us';

test('a group that fails: only its sender keys and the failing person are cleared', () => {
  const dir = fill([
    'creds.json',
    `sender-key-${GROUP}--2348011111111--0.json`,
    'sender-key-120363999999999999@g.us--2348011111111--0.json',
    'session-2348011111111.0.json',
    'session-2348022222222.0.json',
    'app-state-sync-key-AAA.json',
  ]);
  repair.noteMessage(stub(GROUP, 'Bad MAC', '2348011111111@s.whatsapp.net'));
  assert.ok(repair.failedChats().includes(GROUP));
  const n = repair.clearChat(dir, GROUP);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [
    'app-state-sync-key-AAA.json',
    'creds.json',
    'sender-key-120363999999999999@g.us--2348011111111--0.json',
    'session-2348022222222.0.json',
  ]);
  assert.ok(!repair.failedChats().includes(GROUP));
});

test('a one-to-one chat that fails: only that person sessions are cleared', () => {
  const dir = fill(['session-2348033333333.0.json', 'session-2348033333333_1.0.json', 'session-2348044444444.0.json', 'creds.json']);
  repair.noteMessage(stub('2348033333333@s.whatsapp.net', 'Bad MAC'));
  const r = repair.clearFailed(dir);
  assert.strictEqual(r.chats, 1);
  assert.strictEqual(r.files, 2);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['creds.json', 'session-2348044444444.0.json']);
});

test('nothing failed: nothing to repair, and normal or empty messages are not noted', () => {
  repair.noteMessage({ key: { remoteJid: '2348055555555@s.whatsapp.net' }, message: { conversation: 'hi' } });
  repair.noteMessage(stub('status@broadcast', 'Bad MAC'));
  assert.deepStrictEqual(repair.failedChats(), []);
});

test('the automatic repair starts for ONE chat after 5 real errors, and "No session found" never counts', () => {
  const seen = [];
  repair.onChatStorm((c) => seen.push(c));
  const chat = '2348066666666@s.whatsapp.net';
  for (let i = 0; i < 20; i++) repair.noteMessage(stub(chat, 'No session found to decrypt message'));
  assert.deepStrictEqual(seen, []);
  for (let i = 0; i < repair.CHAT_LIMIT - 1; i++) repair.noteMessage(stub(chat, 'Bad MAC'));
  assert.deepStrictEqual(seen, []);
  repair.noteMessage(stub(chat, 'Bad MAC'));
  assert.deepStrictEqual(seen, [chat]);
  const other = '2348077777777@s.whatsapp.net';
  for (let i = 0; i < repair.CHAT_LIMIT - 1; i++) repair.noteMessage(stub(other, 'Bad MAC'));
  assert.deepStrictEqual(seen, [chat], 'errors spread over different chats do not start a repair');
});
