// Helpers that look at the SHAPE of a WhatsApp message (the names of its parts, never its content).
// - isGroupStatusPost: is this a status that a member posted inside a group?
// - shapeOf: the part names for the check reports (antigstatus debug, autoviewonce debug)

// WhatsApp changes the name of this message type between versions (V1, V2, ...): any key that says "group status" counts,
// at any depth, except the "mentioned this group" kind, which has its own switch (antigm).
const GROUP_POST_NAME = /^groupStatus(?!Mention)/i;

function isGroupStatusPost(obj, depth = 6) {
  if (!obj || typeof obj !== 'object' || depth < 0) return false;
  for (const k of Object.keys(obj)) {
    if (GROUP_POST_NAME.test(k) && obj[k]) return true;
    if (obj[k] && typeof obj[k] === 'object' && isGroupStatusPost(obj[k], depth - 1)) return true;
  }
  return false;
}

// the part names, short: no numbered entries, no raw bytes (a key distribution message has dozens of them)
function shapeOf(obj, depth = 3, pre = '') {
  if (!obj || typeof obj !== 'object' || depth < 0 || Buffer.isBuffer(obj) || obj instanceof Uint8Array || Array.isArray(obj)) return [];
  return Object.keys(obj)
    .filter((k) => !/^\d+$/.test(k))
    .flatMap((k) => [pre + k, ...shapeOf(obj[k], depth - 1, `${pre}${k}.`)])
    .slice(0, 30);
}

module.exports = { isGroupStatusPost, shapeOf };
