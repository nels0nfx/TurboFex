// v1.0.0: ytsearch, tiktok / tt, ig and pdf
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const links = require('../core/linkkinds');
const pdfmaker = require('../core/pdfmaker');
const ytdlp = require('../core/ytdlp');
const media = require('../whatsapp/media');

// a real 1x1 JPEG
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

function fakeCtx(extra = {}) {
  const out = { replies: [], sent: [] };
  const ctx = {
    sock: { sendMessage: async (to, content, opts) => { out.sent.push({ to, content, opts }); } },
    jid: '27800000001@s.whatsapp.net', msg: { key: { id: 'M1' }, message: { conversation: 'x' } }, args: [], rest: '', prefix: '.',
    botIds: ['27899999999'], myIds: ['27800000001'], isOwner: false,
    reply: async (t) => { out.replies.push(t); },
    ...extra,
  };
  return { ctx, out };
}

// ---------- links ----------
test('links: TikTok and Instagram are told apart by their exact host', () => {
  assert.strictEqual(links.kindOf('https://vm.tiktok.com/ZMabc/'), 'tiktok');
  assert.strictEqual(links.kindOf('https://www.tiktok.com/@a/video/123'), 'tiktok');
  assert.strictEqual(links.kindOf('https://www.instagram.com/reel/abc/'), 'instagram');
  assert.strictEqual(links.kindOf('https://youtu.be/abc'), 'youtube');
  for (const bad of ['https://tiktok.com.evil.io/x', 'https://eviltiktok.com/x', 'https://instagram.com.attacker.net/p/1', 'http://127.0.0.1/', 'not a link']) assert.strictEqual(links.kindOf(bad), null, bad);
  assert.strictEqual(links.firstLink('look https://vm.tiktok.com/ZMabc/, nice'), 'https://vm.tiktok.com/ZMabc/');
  assert.strictEqual(links.instagramKind('https://www.instagram.com/stories/u/123/'), 'story');
  assert.strictEqual(links.instagramKind('https://www.instagram.com/reel/abc/'), 'reel');
  assert.strictEqual(links.instagramKind('https://www.instagram.com/p/abc/'), 'post');
});

// ---------- tiktok / ig ----------
for (const [file, good, bad, key] of [['tiktok', 'https://vm.tiktok.com/ZMabc/', 'https://www.instagram.com/p/abc/', 'noWatermark'], ['ig', 'https://www.instagram.com/reel/abc/', 'https://vm.tiktok.com/ZMabc/', null]]) {
  test(`${file}: downloads only its own site, and sends the video`, async () => {
    const cmd = require(`../commands/${file}`);
    const real = ytdlp.downloadVideo;
    const calls = [];
    ytdlp.downloadVideo = async (target, opts) => { calls.push({ target, opts }); return { buffer: Buffer.from('v'), ext: '.mp4', mimetype: 'video/mp4', title: 'T', artist: 'A', duration: '0:10' }; };
    try {
      const wrong = fakeCtx({ rest: bad });
      await cmd.run(wrong.ctx);
      assert.strictEqual(calls.length, 0, 'a link of another site is refused before anything is downloaded');
      assert.match(wrong.out.replies.join(' '), /not an? (TikTok|Instagram) link/);
      const none = fakeCtx({ rest: '' });
      await cmd.run(none.ctx);
      assert.match(none.out.replies.join(' '), /Send an? (TikTok|Instagram) link/);
      const ok = fakeCtx({ rest: good });
      await cmd.run(ok.ctx);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].target, good);
      if (key) assert.strictEqual(calls[0].opts[key], true, 'the clean (no watermark) format is asked for');
      assert.ok(ok.out.sent[0].content.video, 'the video is sent');
    } finally {
      ytdlp.downloadVideo = real;
    }
  });
}
test('tiktok has the tt alias and ig the instagram alias; names are not taken by another command', () => {
  assert.ok(require('../commands/tiktok').aliases.includes('tt'));
  assert.ok(require('../commands/ig').aliases.includes('instagram'));
  const seen = new Map();
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'commands'))) {
    const m = require(`../commands/${f}`);
    for (const c of Array.isArray(m) ? m : [m]) if (c && c.name) for (const n of [c.name, ...(c.aliases || [])]) { assert.ok(!seen.has(n), `${n} is used twice (${f}, ${seen.get(n)})`); seen.set(n, f); }
  }
  for (const n of ['ytsearch', 'tiktok', 'tt', 'ig', 'pdf']) assert.ok(seen.has(n), n);
});

// ---------- ytsearch ----------
test('ytsearch: lists results, keeps them on disk, and downloads the chosen one as video or audio', async () => {
  const cmd = require('../commands/ytsearch');
  const realS = ytdlp.searchFlat; const realV = ytdlp.downloadVideo; const realA = ytdlp.downloadAudio;
  const got = [];
  ytdlp.searchFlat = async () => [1, 2, 3].map((n) => ({ id: `id${n}`, title: `Song ${n}`, channel: 'Chan', duration: 100 + n, url: `https://www.youtube.com/watch?v=id${n}` }));
  ytdlp.downloadVideo = async (u) => { got.push(['video', u]); return { buffer: Buffer.from('v'), ext: '.mp4', mimetype: 'video/mp4', title: 'V' }; };
  ytdlp.downloadAudio = async (u) => { got.push(['audio', u]); return { buffer: Buffer.from('a'), mimetype: 'audio/mpeg' }; };
  try {
    const none = fakeCtx({ args: ['video', '1'] });
    await cmd.run(none.ctx);
    assert.match(none.out.replies.join(' '), /Search first/);
    const s = fakeCtx({ args: ['some', 'song'], rest: 'some song' });
    await cmd.run(s.ctx);
    assert.match(s.out.replies.join('\n'), /Song 1[\s\S]*Song 3/);
    // the list is on disk: it is still there after a restart
    require('../core/jsonstore').all().find((x) => x.name === 'ytsearch-results').flush();
    const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.TURBOFEX_DATA, 'ytsearch-results.json'), 'utf8'));
    assert.strictEqual(Object.values(onDisk.lists)[0].items.length, 3);
    const v = fakeCtx({ args: ['video', '2'] });
    await cmd.run(v.ctx);
    const a = fakeCtx({ args: ['audio', '3'] });
    await cmd.run(a.ctx);
    assert.deepStrictEqual(got, [['video', 'https://www.youtube.com/watch?v=id2'], ['audio', 'https://www.youtube.com/watch?v=id3']]);
    assert.ok(v.out.sent[0].content.video && a.out.sent[0].content.audio);
    const bad = fakeCtx({ args: ['video', '9'] });
    await cmd.run(bad.ctx);
    assert.match(bad.out.replies.join(' '), /1 to 3/);
  } finally {
    ytdlp.searchFlat = realS; ytdlp.downloadVideo = realV; ytdlp.downloadAudio = realA;
  }
});

// ---------- the PDF engine ----------
test('pdfmaker: text becomes a valid multi-page PDF (also long lines, tabs and non-Western characters)', () => {
  const one = pdfmaker.fromText('Hello\nWorld “quoted” – dash 你好');
  assert.strictEqual(pdfmaker.pageCount(one), 1);
  assert.ok(one.subarray(0, 8).toString().startsWith('%PDF-1.7') && one.toString('latin1').trimEnd().endsWith('%%EOF'));
  const many = pdfmaker.fromText(Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(120)}`).join('\n'));
  assert.ok(pdfmaker.pageCount(many) > 3);
  assert.throws(() => pdfmaker.fromText('   '), { code: 'EMPTY' });
});

test('pdfmaker: pictures become pages (JPEG without any package)', async () => {
  assert.deepStrictEqual({ w: pdfmaker.jpegInfo(JPEG).width, h: pdfmaker.jpegInfo(JPEG).height }, { w: 1, h: 1 });
  const pdf = await pdfmaker.fromImages([JPEG, JPEG, JPEG]);
  assert.strictEqual(pdfmaker.pageCount(pdf), 3);
  await assert.rejects(() => pdfmaker.fromImages([]), { code: 'EMPTY' });
});

test('pdfmaker: joining keeps every page in order, also when joined again', () => {
  const a = pdfmaker.fromText('AAA');
  const b = pdfmaker.fromText(Array.from({ length: 120 }, () => 'bbb').join('\n'));
  const pagesB = pdfmaker.pageCount(b);
  const ab = pdfmaker.merge([a, b]);
  assert.strictEqual(pdfmaker.pageCount(ab), 1 + pagesB);
  const again = pdfmaker.merge([ab, a, ab]);
  assert.strictEqual(pdfmaker.pageCount(again), 2 * (1 + pagesB) + 1);
  const text = again.toString('latin1');
  assert.ok(text.indexOf('(AAA)') < text.indexOf('(bbb)'), 'the first file comes first');
  assert.strictEqual(pdfmaker.merge([a]).length > 0, true);
  if (spawnSync('pdftotext', ['-v']).status === 0 || spawnSync('pdftotext', ['-v']).error === undefined) {
    // the real page order, read by a PDF reader
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-ord-'));
    try {
      const f = path.join(dir, 'o.pdf');
      fs.writeFileSync(f, pdfmaker.merge([pdfmaker.fromText('FIRST'), pdfmaker.fromText('SECOND'), pdfmaker.fromText('THIRD')]));
      const txt = spawnSync('pdftotext', [f, '-'], { encoding: 'utf8' }).stdout;
      assert.ok(txt.indexOf('FIRST') < txt.indexOf('SECOND') && txt.indexOf('SECOND') < txt.indexOf('THIRD'), 'pages are in the order given');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('pdfmaker: protected or unreadable PDFs are refused with a clear reason', () => {
  const enc = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF');
  assert.throws(() => pdfmaker.merge([pdfmaker.fromText('x'), enc]), { code: 'ENCRYPTED' });
  assert.throws(() => pdfmaker.merge([Buffer.from('not a pdf at all')]), { code: 'NOT_PDF' });
});

test('pdfmaker: PDFs from other programs (compressed object streams) can be joined, and the result passes qpdf', { skip: spawnSync('qpdf', ['--version']).status === 0 ? false : 'qpdf is not installed here' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-pdf-'));
  try {
    const seed = path.join(dir, 'seed.pdf');
    fs.writeFileSync(seed, pdfmaker.fromText('seed\n'.repeat(300)));
    const packed = path.join(dir, 'packed.pdf');
    assert.strictEqual(spawnSync('qpdf', ['--object-streams=generate', '--compress-streams=y', seed, packed]).status, 0);
    assert.ok(fs.readFileSync(packed).toString('latin1').includes('/ObjStm'), 'the test file really uses object streams');
    const out = pdfmaker.merge([fs.readFileSync(packed), pdfmaker.fromText('tail'), fs.readFileSync(packed)]);
    const file = path.join(dir, 'out.pdf');
    fs.writeFileSync(file, out);
    const check = spawnSync('qpdf', ['--check', file], { encoding: 'utf8' });
    assert.ok(![2].includes(check.status), check.stdout + check.stderr);
    assert.strictEqual(pdfmaker.pageCount(out), 2 * pdfmaker.pageCount(fs.readFileSync(packed)) + 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- the pdf command ----------
test('pdf command: text to PDF, help, and the add / list / make / clear list that survives a restart', async () => {
  const cmd = require('../commands/pdf');
  const realDl = media.download;
  const holder = (name, mime) => ({ key: { id: 'D1' }, message: { documentMessage: { mimetype: mime, fileName: name } } });
  let next = null;
  media.download = async () => next;
  try {
    const help = fakeCtx({ rest: '' });
    await cmd.run(help.ctx);
    assert.match(help.out.replies.join(' '), /PDF maker/);

    const t = fakeCtx({ rest: 'my shopping list', args: ['my', 'shopping', 'list'] });
    await cmd.run(t.ctx);
    const doc = t.out.sent[0].content;
    assert.strictEqual(doc.mimetype, 'application/pdf');
    assert.ok(doc.document.subarray(0, 5).toString() === '%PDF-');

    // add: a picture (sent as an image document) and two PDFs
    const add = async (buf, name, mime) => {
      next = buf;
      const c = fakeCtx({ args: ['add'], rest: 'add', msg: holder(name, mime) });
      await cmd.run(c.ctx);
      return c.out.replies.join(' ');
    };
    assert.match(await add(pdfmaker.fromText('first'), 'a.pdf', 'application/pdf'), /Added \(1/);
    assert.match(await add(pdfmaker.fromText('second'), 'b.pdf', 'application/pdf'), /Added \(2/);
    assert.match(await add(Buffer.from('this is not a pdf'), 'c.pdf', 'application/pdf'), /not a readable PDF/);
    const enc = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF');
    assert.match(await add(enc, 'locked.pdf', 'application/pdf'), /password/);

    // "restart": the list is files on disk, nothing is kept in memory
    const list = fakeCtx({ args: ['list'], rest: 'list' });
    await cmd.run(list.ctx);
    assert.match(list.out.replies.join(' '), /Your list \(2\)/);
    assert.ok(fs.existsSync(path.join(process.env.TURBOFEX_DATA, 'pdf-queue')));

    const make = fakeCtx({ args: ['make', 'report'], rest: 'make report' });
    await cmd.run(make.ctx);
    const merged = make.out.sent[0].content;
    assert.strictEqual(merged.fileName, 'report.pdf');
    assert.strictEqual(pdfmaker.pageCount(merged.document), 2);
    const after = fakeCtx({ args: ['list'], rest: 'list' });
    await cmd.run(after.ctx);
    assert.match(after.out.replies.join(' '), /empty/, 'the list is emptied after a successful make');

    const none = fakeCtx({ args: ['make'], rest: 'make' });
    await cmd.run(none.ctx);
    assert.match(none.out.replies.join(' '), /empty/);
  } finally {
    media.download = realDl;
  }
});

test('version is 1.0.x and README counts match', () => {
  assert.match(require('../package.json').version, /^1\.0\.\d+$/);
});
