require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const baileys = require('../core/baileys');
const { DATA } = require('../core/paths');

baileys.setForTests({ generateMessageIDV2: () => 'ID' + Math.random().toString(36).slice(2, 10).toUpperCase() });
console.log = () => {};
console.error = () => {};

// ------------------------------------------------------------------ downloads
const STATE = path.join(DATA, 'ytdlp-state.json');
function fakeTool(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakedl179-'));
  const log = path.join(dir, 'calls.log');
  const bin = path.join(dir, 'yt-dlp');
  fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$1" = "--version" ]; then echo 2026.01.01; exit 0; fi\nif [ "$1" = "-U" ]; then exit 0; fi\n${script}\n`);
  fs.chmodSync(bin, 0o755);
  return { dir, log, bin };
}
const fresh = () => { delete require.cache[require.resolve('../core/ytdlp')]; return require('../core/ytdlp'); }; // like a restart: only the saved file is left
const calls = (t) => fs.readFileSync(t.log, 'utf8').trim().split('\n').filter(Boolean);
const downloads = (t) => calls(t).filter((l) => l.includes('--no-simulate'));
async function withTool(script, fn) {
  const t = fakeTool(script);
  const keep = process.env.YTDLP_PATH;
  process.env.YTDLP_PATH = t.bin;
  fs.rmSync(STATE, { force: true });
  try {
    await fn(t);
  } finally {
    if (keep === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = keep;
    delete require.cache[require.resolve('../core/ytdlp')];
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
}
// a fake downloader that only works with the android_vr way, and writes a small m4a
const ONLY_ANDROID = `case "$*" in *player_client=android_vr*) ;; *) echo "ERROR: this way fails" >&2; exit 1;; esac
out=""; prev=""
for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done
file=$(echo "$out" | sed "s/%(id)s/abc/; s/%(ext)s/m4a/")
head -c 3000 /dev/zero > "$file"
printf 'Title\\tSinger\\t3:00\\thttps://x/y\\t%s\\n' "$file"`;

test('v1.7.9 downloads: the way that worked is remembered across a restart', async () => {
  await withTool(ONLY_ANDROID, async (t) => {
    let dl = fresh();
    await dl.downloadAudio('song one'); // has to find the way that works
    assert.ok(downloads(t).length >= 2);
    fs.writeFileSync(t.log, '');
    dl = fresh(); // a restart: nothing in memory
    const a = await dl.downloadAudio('song two');
    assert.strictEqual(a.buffer.length, 3000);
    assert.strictEqual(downloads(t).length, 1, 'one download call only: no failed tries after the restart');
    assert.match(downloads(t)[0], /player_client=android_vr/);
    assert.strictEqual(JSON.parse(fs.readFileSync(STATE, 'utf8')).bin, t.bin, 'the saved state belongs to this tool');
  });
});

test('v1.7.9 downloads: the slow self-update is NOT run before the quick ways have been tried', async () => {
  await withTool(ONLY_ANDROID, async (t) => {
    await fresh().downloadAudio('song');
    assert.ok(!calls(t).some((l) => l.startsWith('-U')), 'a way worked, so no update was needed');
  });
});

test('v1.7.9 downloads: when no way works the update comes AFTER all ways, then they are tried once more', async () => {
  await withTool('echo "ERROR: something odd happened" >&2; exit 1', async (t) => {
    await assert.rejects(fresh().downloadAudio('song'));
    const all = calls(t);
    const firstUpdate = all.findIndex((l) => l.startsWith('-U'));
    const downloadsBefore = all.slice(0, firstUpdate).filter((l) => l.includes('--no-simulate')).length;
    assert.ok(firstUpdate > 0, 'the tool was updated');
    assert.strictEqual(downloadsBefore, 6, 'all six ways were tried before the update');
    assert.strictEqual(downloads(t).length, 12, 'and all six again after it');
    assert.strictEqual(all.filter((l) => l.startsWith('-U')).length, 1, 'updated once');
  });
});

test('v1.7.9 downloads: the 6-hour update limit also holds across a restart', async () => {
  await withTool('echo "ERROR: something odd happened" >&2; exit 1', async (t) => {
    await assert.rejects(fresh().downloadAudio('song'));
    fs.writeFileSync(t.log, '');
    await assert.rejects(fresh().downloadAudio('song again')); // "restarted": the update time was saved
    assert.ok(!calls(t).some((l) => l.startsWith('-U')), 'no second update within 6 hours');
    assert.strictEqual(downloads(t).length, 6, 'the six ways once');
  });
});

test('v1.7.9 downloads: a warm-up finds the tool and never fails', async () => {
  await withTool(ONLY_ANDROID, async (t) => {
    const dl = fresh();
    assert.strictEqual(typeof dl.warmUp, 'function');
    assert.strictEqual(await dl.warmUp(), t.bin);
    process.env.YTDLP_PATH = path.join(t.dir, 'does-not-exist');
    await dl.warmUp(); // nothing found: still no error
  });
});

// ------------------------------------------------------------------ play: the fast search goes first
function loadPlay(stubs) {
  const ytdlp = require('../core/ytdlp');
  const ytsearch = require('../core/ytsearch');
  const log = [];
  ytsearch.search = stubs.page(log);
  ytdlp.searchFlat = stubs.flat(log);
  ytdlp.downloadAudio = async (url) => { log.push(`download ${url}`); return { buffer: Buffer.from('x'), mimetype: 'audio/mp4', title: 'Calm Down', artist: 'Rema', duration: '3:59', url }; };
  delete require.cache[require.resolve('../commands/play')];
  return { play: require('../commands/play'), log };
}
const ctx = () => {
  const sent = [];
  return { sent, args: { sock: { sendMessage: async (j, c) => { sent.push(c); return { key: { id: 'K' } }; } }, jid: 'a@s.whatsapp.net', msg: { key: {} }, rest: 'rema calm down', reply: async () => {}, prefix: '.', isOwner: true } };
};
const RESULT = { id: 'abc12345678', title: 'Rema - Calm Down (Official Audio)', channel: 'Rema', duration: '3:59', url: 'https://www.youtube.com/watch?v=abc12345678' };

test('v1.7.9 play: a song name is searched on the YouTube page first, the downloader program is not started for the search', async () => {
  const { play, log } = loadPlay({ page: (l) => async () => { l.push('page search'); return [RESULT]; }, flat: (l) => async () => { l.push('downloader search'); return []; } });
  const c = ctx();
  await play.run(c.args);
  assert.deepStrictEqual(log, ['page search', `download ${RESULT.url}`]);
  assert.ok(c.sent.some((m) => m.audio), 'the audio was sent');
});

test('v1.7.9 play: when the search page does not work, the downloader search is the backup', async () => {
  const { play, log } = loadPlay({ page: (l) => async () => { l.push('page search'); throw new Error('could not read the search page'); }, flat: (l) => async () => { l.push('downloader search'); return [{ ...RESULT, duration: 239 }]; } });
  const c = ctx();
  await play.run(c.args);
  assert.deepStrictEqual(log, ['page search', 'downloader search', `download ${RESULT.url}`]);
  assert.ok(c.sent.some((m) => m.audio));
});

// ------------------------------------------------------------------ status like: no answer is not "done"
const status = require('../whatsapp/status');
status.settings.retryWaitMs = 0;
status.settings.ackWaitMs = 60; // the real wait is 4 seconds
const post = (id) => ({ key: { remoteJid: 'status@broadcast', id, participant: '222488650874994@lid', fromMe: false }, message: { imageMessage: {} }, messageTimestamp: Math.floor(Date.now() / 1000) });
function statusSock(answers) { // one answer per send: 'ok' | 'refuse' | 'silent'
  const ws = new EventEmitter();
  const sent = [];
  return {
    sent,
    sock: {
      ws, user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
      sendReceipt: async () => {}, readMessages: async () => {},
      sendMessage: async (to, c, o) => {
        const a = answers[sent.length] || 'ok';
        sent.push({ to, list: o.statusJidList });
        if (a !== 'silent') setTimeout(() => ws.emit(`CB:ack,id:${o.messageId}`, { attrs: { error: a === 'refuse' ? '479' : undefined } }), 5);
        return { key: { id: o.messageId } };
      },
    },
  };
}

test('v1.7.9 status like: when WhatsApp does not answer, another way is tried, and its answer counts', async () => {
  const { sock, sent } = statusSock(['silent', 'ok']);
  const confirmed = await status.likeStatus(sock, post('S1'), '222488650874994@lid', '❤️');
  assert.strictEqual(confirmed, true, 'the second way was answered: confirmed');
  assert.strictEqual(sent.length, 3, 'two list tries, then the like straight to the poster');
  assert.notDeepStrictEqual(sent[0].list, sent[1].list, 'another list, not the same again');
  assert.notStrictEqual(sent[2].to, 'status@broadcast', 'the last one goes straight to the poster');
});

test('v1.7.9 status like: no answer anywhere = sent, unconfirmed, after only two list tries and one direct (never a flood)', async () => {
  const { sock, sent } = statusSock(['silent', 'silent', 'silent', 'silent']);
  const confirmed = await status.likeStatus(sock, post('S2'), '222488650874994@lid', '❤️');
  assert.strictEqual(confirmed, false, 'unconfirmed');
  assert.strictEqual(sent.length, 3, 'three sends at most');
  assert.ok(sent.slice(0, 2).every((x) => x.to === 'status@broadcast'));
});

test('v1.7.9 status like: an answered like is sent on the list and once straight to the poster', async () => {
  const { sock, sent } = statusSock(['ok']);
  assert.strictEqual(await status.likeStatus(sock, post('S3'), '222488650874994@lid', '❤️'), true);
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0].to, 'status@broadcast');
  assert.notStrictEqual(sent[1].to, 'status@broadcast');
});

test('v1.7.9 status like: a refusal then silence still ends as sent-but-unconfirmed, not a failure', async () => {
  const { sock, sent } = statusSock(['refuse', 'silent', 'silent', 'silent']);
  const confirmed = await status.likeStatus(sock, post('S4'), '222488650874994@lid', '❤️');
  assert.strictEqual(confirmed, false);
  assert.ok(sent.length <= 4);
});
