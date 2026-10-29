require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const { fastKeys } = require('../core/fastkeys');
const { flushAll } = require('../core/flush');
const { makeCache } = require('../core/cache');

test('keys are kept in memory at once and written to disk in one batch', async () => {
  const disk = {};
  let writes = 0;
  const slow = {
    async get(t, ids) { const o = {}; for (const i of ids) if (disk[t + i] !== undefined) o[i] = disk[t + i]; return o; },
    async set(d) { await new Promise((r) => setTimeout(r, 50)); writes++; for (const t in d) for (const i in d[t]) { if (d[t][i] == null) delete disk[t + i]; else disk[t + i] = d[t][i]; } },
  };
  const k = fastKeys(slow);
  const t = Date.now();
  for (let i = 0; i < 10; i++) await k.set({ session: { ['a' + i]: i } });
  assert.ok(Date.now() - t < 40);
  assert.deepStrictEqual(await k.get('session', ['a3', 'zz']), { a3: 3 });
  await k.set({ session: { a3: null } });
  assert.deepStrictEqual(await k.get('session', ['a3']), {});
  await flushAll();
  assert.ok(disk.sessiona5 === 5 && disk.sessiona3 === undefined && writes <= 2);
});
test('the cache expires and has a size limit', async () => {
  const c = makeCache(30, 2);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.strictEqual(c.get('a'), undefined);
  assert.strictEqual(c.get('c'), 3);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(c.get('c'), undefined);
});
