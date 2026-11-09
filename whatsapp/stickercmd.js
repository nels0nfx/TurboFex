// Sticker commands: the owner picks a sticker and a command; whenever the OWNER sends that sticker, the command runs.
// Example: reply to a sticker with "setstickercmd vv", then send that sticker as a reply to a view-once message.
const store = require('./store');
const { peel } = require('./unwrap');

// the identity of a sticker file (the same sticker always has the same value)
function keyOf(sticker) {
  const sha = sticker && sticker.fileSha256;
  if (!sha) return null;
  if (typeof sha === 'string') return sha;
  try {
    return Buffer.from(sha).toString('base64');
  } catch (err) {
    return null;
  }
}

// { key, cmd, args } when this message is a sticker that has a command, else null
function lookup(msg) {
  const sticker = peel(msg.message || {}).content.stickerMessage;
  if (!sticker) return null;
  const key = keyOf(sticker);
  if (!key) return null;
  const bound = store.getStickerCmds()[key];
  return bound && bound.cmd ? { key, cmd: bound.cmd, args: bound.args || '' } : null;
}

// the text the handler runs, as if the owner had typed it
const textFor = (bound, prefix) => `${prefix || ''}${bound.cmd}${bound.args ? ` ${bound.args}` : ''}`.trim();

module.exports = { keyOf, lookup, textFor };
