// Some hosts (Render, Railway, Koyeb, Heroku and similar "web service" plans) hand the bot a PORT and stop the app if nothing
// answers on it. When PORT is set, this answers a tiny status page so such hosts keep the bot running. It shows no number, no
// chat and no setting: only that the bot is running. Without PORT nothing is opened.
const http = require('http');

function start({ port = process.env.PORT || process.env.HOST_PORT, info = () => ({}) } = {}) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
  const server = http.createServer((req, res) => {
    let extra = {};
    try {
      extra = info() || {};
    } catch (err) {
      extra = {};
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ status: 'running', ...extra }));
  });
  server.on('error', (err) => console.error(`Status port ${p} could not be opened (${err.code || err.message}). The bot works without it.`));
  server.listen(p, '0.0.0.0', () => console.log(`🌐 Status page on port ${p} (for hosts that need an open port).`));
  if (server.unref) server.unref();
  return server;
}

module.exports = { start };
