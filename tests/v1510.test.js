// v1.5.10: media.convert (picture -> sticker, audio -> mp3) done by the bot, with limits
const test = require('node:test');
const assert = require('node:assert');
const { make, CTX, stopAll } = require('./plugins-helpers');
test.after(stopAll);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]).toString('base64');
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40, 2)]).toString('base64');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20, 3)]).toString('base64');
const env = (log) => ({ toSticker: async (b) => { log.push(['sticker', b.length]); return Buffer.from(WEBP, 'base64'); }, toAudio: async (b) => { log.push(['audio', b.length]); return Buffer.from(MP3, 'base64'); } });

test('toSticker and toAudio convert, then the result can be sent', async () => {
  const log = [];
  const { host, env: e } = make(`tfx.command('c', async (c) => {
    const st = await tfx.media.toSticker('${PNG}'); await tfx.media.send({ kind: 'sticker', data: st });
    const au = await tfx.media.toAudio('${MP3}'); await tfx.media.send({ kind: 'audio', data: au });
  });`, { permissions: ['chat.send', 'media.send', 'media.convert'], env: env(log) });
  const media = []; await host.call('command', 'c', CTX, { send: async () => {}, sendMedia: async (m) => media.push([m.kind, m.mimetype]) });
  assert.deepStrictEqual(log.map((x) => x[0]), ['sticker', 'audio']);
  assert.deepStrictEqual(media, [['sticker', 'image/webp'], ['audio', 'audio/mpeg']]);
});
test('without the permission, with a wrong file type, or too many in one call: refused', async () => {
  const log = [];
  const a = make(`tfx.command('c', async () => { try { await tfx.media.toSticker('${PNG}'); } catch (e) { await tfx.log('no:' + e.message); } });`, { permissions: ['chat.send'], env: env(log) });
  await a.host.call('command', 'c', CTX, { send: async () => {} }); assert.strictEqual(log.length, 0); assert.ok(a.host.broker.violations.includes('not_declared'));
  const b = make(`tfx.command('c', async () => { for (const d of ['${MP3}', '${PNG}', '${PNG}', '${PNG}']) { try { await tfx.media.toSticker(d); } catch (e) { await tfx.log('err'); } } });`, { permissions: ['chat.send', 'media.convert'], env: env(log) });
  await b.host.call('command', 'c', CTX, { send: async () => {} });
  assert.strictEqual(log.filter((x) => x[0] === 'sticker').length, 2, 'only 2 per call; an audio file is not a picture');
});
test('a conversion that fails or runs too long does not crash the plugin', async () => {
  const slow = { toSticker: async () => new Promise((r) => setTimeout(r, 400)) };
  const { host } = make(`tfx.command('c', async () => { try { await tfx.media.toSticker('${PNG}'); } catch (e) { await tfx.log('failed'); } });`, { permissions: ['chat.send', 'media.convert'], env: slow, policy: { convertMs: 50 } });
  await host.call('command', 'c', CTX, { send: async () => {} });
});
