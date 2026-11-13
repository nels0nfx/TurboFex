// v1.5.13: the Playground build tool keeps working with worker.js and broker.js
require('./_setup');
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
test('worker.js still has the line the Playground build replaces, and broker.js needs no Node modules', () => {
  assert.ok(fs.readFileSync(path.join(__dirname, '../core/plugins/worker.js'), 'utf8').includes("const { parentPort, workerData } = require('node:worker_threads');"));
  assert.ok(!/require\(/.test(fs.readFileSync(path.join(__dirname, '../core/plugins/broker.js'), 'utf8')), 'broker.js must stay free of require() so it can run in a browser');
});
test('the build produces both files (when esbuild is available)', (t) => {
  let have = true; try { require('esbuild'); } catch (e) { try { require('/opt/npm-tools/node_modules/esbuild'); } catch (e2) { have = false; } }
  if (!have) return t.skip('esbuild is not installed here');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pgb-'));
  execFileSync(process.execPath, [path.join(__dirname, '../tools/build-playground.js'), out], { stdio: 'pipe' });
  assert.ok(fs.statSync(path.join(out, 'playground-sandbox.js')).size > 200 * 1024);
  assert.match(fs.readFileSync(path.join(out, 'playground-broker.js'), 'utf8'), /TFXBroker/);
});
