require('./_setup');
const http = require('http');
const test = require('node:test');
const assert = require('node:assert');
const safefetch = require('../core/safefetch');
const lp = require('../core/linkpreview');

test('private and special addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.ok(safefetch.isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.ok(!safefetch.isPrivateIp(ip), ip);
});
test('only public web addresses are accepted', async () => {
  for (const bad of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'https://example.com:8443/', 'ftp://example.com/', 'https://user:pw@example.com/', 'not a url']) {
    await assert.rejects(() => safefetch.assertPublicUrl(bad), (e) => e.code === 'BLOCKED', bad);
  }
});
test('links are found in text, without the punctuation after them', () => {
  assert.deepStrictEqual(lp.firstUrl('see https://example.com/a?b=1, ok'), { matched: 'https://example.com/a?b=1', url: 'https://example.com/a?b=1' });
  assert.strictEqual(lp.firstUrl('go to www.example.com.').url, 'https://www.example.com');
  assert.strictEqual(lp.firstUrl('no link here'), null);
});
test('page information is read from the Open Graph tags', () => {
  const m = lp.parseMeta(`<html><head><title>Fallback</title><meta property="og:title" content="Tom &amp; Jerry"><meta name='description' content='Plain description'><meta property="og:description" content="A &quot;cat&quot; and a mouse"><meta property="og:image" content="/pic.jpg"></head>`);
  assert.deepStrictEqual(m, { title: 'Tom & Jerry', description: 'A "cat" and a mouse', image: '/pic.jpg', canonical: '' });
  assert.strictEqual(lp.parseMeta('<title> Only a title </title>').title, 'Only a title');
});
test('a preview is made from a real page (local test server)', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500, 1)]);
  const server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.setHeader('content-type', 'text/html');
      return res.end('<head><meta property="og:title" content="Hello"><meta property="og:description" content="World"><meta property="og:image" content="/pic.jpg"></head>');
    }
    if (req.url === '/pic.jpg') {
      res.setHeader('content-type', 'image/jpeg');
      return res.end(jpeg);
    }
    if (req.url === '/json') {
      res.setHeader('content-type', 'application/json');
      return res.end('{}');
    }
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const info = await lp.getUrlInfo(`look ${base}/page now`, { allowPrivate: true });
    assert.strictEqual(info.title, 'Hello');
    assert.strictEqual(info.description, 'World');
    assert.strictEqual(info['matched-text'], `${base}/page`);
    assert.ok(Buffer.isBuffer(info.jpegThumbnail) || info.jpegThumbnail === undefined);
    assert.strictEqual(await lp.getUrlInfo(`${base}/missing`, { allowPrivate: true }), undefined);
    assert.strictEqual(await lp.getUrlInfo(`${base}/json`, { allowPrivate: true }), undefined);
    // without the test switch the same address is refused: the bot never fetches private addresses
    lp.cache.clear();
    assert.strictEqual(await lp.getUrlInfo(`${base}/page`), undefined);
  } finally {
    server.close();
  }
});
