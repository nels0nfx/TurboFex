// Gives up waiting for something that takes too long (so one stuck request cannot freeze the bot)
function withTimeout(promise, ms, message = 'WhatsApp took too long to answer') {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
