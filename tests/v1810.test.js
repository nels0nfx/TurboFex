require('./_setup');
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { dir } = require('./_setup');

test('v1.8.10 download: a way that saves no file is not a success, the next way is tried', { skip: process.platform === 'win32' }, async () => {
  const bin = path.join(dir, 'fake-ytdlp');
  // the first way "succeeds" and saves nothing; the Node way saves a file
  fs.writeFileSync(bin, `#!/bin/sh
[ "$1" = "--version" ] && { echo 1; exit 0; }
case "$*" in *--js-runtimes*) ;; *) exit 0;; esac
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$(dirname "$2"); shift; done
printf x > "$out/a.m4a"
printf 'Song\\tArtist\\t1:00\\thttps://youtu.be/a\\t%s\\n' "$out/a.m4a"
`, { mode: 0o755 });
  process.env.YTDLP_PATH = bin;
  const r = await require('../core/ytdlp').downloadAudio('some song');
  assert.strictEqual(r.title, 'Song');
  assert.strictEqual(r.buffer.toString(), 'x');
});
