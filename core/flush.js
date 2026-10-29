// Things that keep data in memory and write it to disk a moment later register here, so the bot can
// write everything out before it stops or restarts.
const hooks = [];
function onFlush(fn) {
  hooks.push(fn);
}
async function flushAll() {
  await Promise.all(hooks.map((fn) => Promise.resolve().then(fn).catch(() => {})));
}
module.exports = { onFlush, flushAll };
