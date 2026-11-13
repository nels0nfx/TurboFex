'use strict';
// Builds the two browser files of the pair site's Playground from the bot's OWN sandbox code, so the Playground behaves like the bot:
//   playground-sandbox.js  the sandbox worker (QuickJS in WebAssembly + the same worker.js logic)
//   playground-broker.js   the same broker.js that decides what a plugin may do (plus tiny stand-ins for Buffer and timers)
// Run it again (and copy the two files into the site's public folder) whenever core/plugins/worker.js or broker.js change.
//   node tools/build-playground.js <output-folder>
// Needs `esbuild` (npm i --no-save esbuild) and the quickjs-emscripten package the bot already uses.
const fs = require('node:fs');
const path = require('node:path');
let esbuild; try { esbuild = require('esbuild'); } catch (e) { try { esbuild = require('/opt/npm-tools/node_modules/esbuild'); } catch (e2) { console.error('⚠️ esbuild is missing. Run: npm i --no-save esbuild'); process.exit(1); } }
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'playground-build'));
const { DEFAULT_LIMITS } = require('../core/plugins/host');

const BROKER_SHIMS = `
(function () {
  var st = globalThis.setTimeout;
  globalThis.setTimeout = function () { var id = st.apply(globalThis, arguments); return { unref: function () { return this; }, id: id }; };
  if (typeof globalThis.Buffer === 'undefined') {
    class B extends Uint8Array {
      static from(x, enc) {
        if (typeof x === 'string') {
          if (enc === 'base64') { var bin = atob(x), a = new B(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
          var u = new TextEncoder().encode(x), r = new B(u.length); r.set(u); return r;
        }
        var arr = new B(x.length); arr.set(x); return arr;
      }
      static alloc(n, fill) { var a = new B(n); if (fill) a.fill(fill); return a; }
      static isBuffer(x) { return x instanceof B; }
      toString(enc, s, e) {
        var v = this.subarray(s || 0, e === undefined ? this.length : e);
        if (enc === 'base64') { var t = ''; for (var i = 0; i < v.length; i++) t += String.fromCharCode(v[i]); return btoa(t); }
        if (enc === 'latin1') { var l = ''; for (var j = 0; j < v.length; j++) l += String.fromCharCode(v[j]); return l; }
        return new TextDecoder().decode(v);
      }
      readUInt32BE(o) { return ((this[o] << 24) | (this[o + 1] << 16) | (this[o + 2] << 8) | this[o + 3]) >>> 0; }
      equals(o) { if (this.length !== o.length) return false; for (var i = 0; i < this.length; i++) if (this[i] !== o[i]) return false; return true; }
    }
    globalThis.Buffer = B;
  }
})();
`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  let worker = fs.readFileSync(path.join(root, 'core/plugins/worker.js'), 'utf8');
  const needle = "const { parentPort, workerData } = require('node:worker_threads');";
  if (!worker.includes(needle)) throw new Error('worker.js changed: update tools/build-playground.js');
  worker = worker.replace(needle, `const parentPort = { postMessage: (m) => self.postMessage(m), on: (_n, f) => { self.onmessage = (e) => f(e.data); } };\nconst workerData = { limits: ${JSON.stringify({ memoryBytes: DEFAULT_LIMITS.memoryBytes, stackBytes: DEFAULT_LIMITS.stackBytes, cpuMs: DEFAULT_LIMITS.cpuMs })} };`);
  await esbuild.build({ stdin: { contents: worker, resolveDir: root, sourcefile: 'worker.js' }, bundle: true, platform: 'browser', format: 'iife', minify: true, target: 'es2020', external: ['fs', 'path', 'crypto'], outfile: path.join(out, 'playground-sandbox.js'), logLevel: 'error', legalComments: 'none' });
  const brokerEntry = BROKER_SHIMS + "\nconst { Broker, BrokerError } = require('./core/plugins/broker');\nglobalThis.TFXBroker = { Broker, BrokerError };\n";
  await esbuild.build({ stdin: { contents: brokerEntry, resolveDir: root, sourcefile: 'broker-entry.js' }, bundle: true, platform: 'browser', format: 'iife', minify: true, target: 'es2020', outfile: path.join(out, 'playground-broker.js'), logLevel: 'error', legalComments: 'none' });
  for (const f of ['playground-sandbox.js', 'playground-broker.js']) console.log('✅ ' + f + ' (' + Math.round(fs.statSync(path.join(out, f)).size / 1024) + ' KB)');
})().catch((e) => { console.error('⚠️ ' + e.message); process.exit(1); });
