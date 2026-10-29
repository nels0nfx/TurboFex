require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const cap = require('../core/capacity');

test('what a command needs is found from its code', () => {
  assert.deepStrictEqual(cap.describe({}, 'media.loadSharp()'), { needs: ['sharp'], weight: 'medium' });
  assert.deepStrictEqual(cap.describe({}, 'media.ffmpeg(x)'), { needs: ['ffmpeg'], weight: 'heavy' });
  assert.deepStrictEqual(cap.describe({}, 'nothing special'), { needs: [], weight: 'light' });
  assert.deepStrictEqual(cap.describe({ needs: [], weight: 'medium' }, 'loadSharp'), { needs: [], weight: 'medium' });
});
test('a heavy command is limited: one at a time and one per person every few seconds', async () => {
  const cmd = { capacity: { needs: [], weight: 'heavy' } };
  const first = await cap.enter(cmd, 'alice');
  assert.ok(first.ok);
  const second = await cap.enter(cmd, 'bob');
  assert.ok(!second.ok && second.why === 'busy');
  first.release();
  const again = await cap.enter(cmd, 'alice');
  assert.ok(!again.ok && again.why === 'cooldown');
});
test('refusals are short for people and detailed for the owner', () => {
  const r = { why: 'memory', detail: 'Only 10 MB free' };
  assert.ok(!cap.refusal(r, false).includes('10 MB'));
  assert.ok(cap.refusal(r, true).includes('10 MB'));
});
test('light commands always run', async () => {
  const r = await cap.enter({ capacity: { needs: [], weight: 'light' } }, 'x');
  assert.ok(r.ok);
});
