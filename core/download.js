// Reads a download but stops when it gets too big
async function readLimited(res, max) {
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw Object.assign(new Error('That file is bigger than 25 MB.'), { code: 'TOO_BIG' });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

module.exports = { readLimited };
