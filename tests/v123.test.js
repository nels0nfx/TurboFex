// v1.2.3: lookups stay instant on a huge contact list and in huge groups.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const idmap = require('../whatsapp/idmap');
const names = require('../whatsapp/names');
const mentions = require('../whatsapp/mentions');
const meta = require('../whatsapp/metadata');

test('the version is 1.2.3', () => {
  assert.strictEqual(require('../package.json').version, '1.2.3');
});

test('idmap: 20,000 contacts are learned and found again quickly', () => {
  const t0 = Date.now();
  const list = [];
  for (let i = 0; i < 20000; i++) list.push({ id: `2348${String(10000000 + i)}@s.whatsapp.net`, lid: `9${String(100000000000 + i)}@lid`, name: `Person ${i}` });
  idmap.learnContacts(list);
  names.learnContacts(list);
  for (let i = 0; i < 20000; i += 7) assert.strictEqual(idmap.lidSync(list[i].id), list[i].lid);
  for (let i = 0; i < 20000; i += 7) assert.strictEqual(idmap.pnSync(list[i].lid), list[i].id);
  assert.strictEqual(names.get(list[123].id), 'Person 123');
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});

test('idmap: a changed pair replaces the old one in both directions', () => {
  idmap.learn('555000111@lid', '2347000000001@s.whatsapp.net');
  assert.strictEqual(idmap.lidSync('2347000000001@s.whatsapp.net'), '555000111@lid');
  idmap.learn('555000111@lid', '2347000000002@s.whatsapp.net');
  assert.strictEqual(idmap.lidSync('2347000000001@s.whatsapp.net'), null);
  assert.strictEqual(idmap.lidSync('2347000000002@s.whatsapp.net'), '555000111@lid');
});

test('tags in a group of 3,000 members are rewritten quickly and correctly', async () => {
  const G = '120363000000000130@g.us';
  const participants = [];
  for (let i = 0; i < 3000; i++) participants.push({ id: `7${String(10000000000 + i)}@lid`, phoneNumber: `2349${String(10000000 + i)}@s.whatsapp.net` });
  meta.prime({ [G]: { id: G, subject: 'Big', participants } });
  const sock = { groupMetadata: async () => ({ id: G, subject: 'Big', participants }) };
  const t0 = Date.now();
  const mentionList = participants.slice(0, 1500).map((p) => p.phoneNumber);
  const out = await mentions.fix(sock, G, { text: `@${mentionList[0].split('@')[0]} hi`, mentions: mentionList });
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  assert.strictEqual(out.mentions[0], participants[0].id, 'the tag uses the id the group uses');
  assert.strictEqual(out.mentions.length, 1500);
});
