// pm2 keeps the bot running and starts it again after a crash or a reboot:
//   npm install -g pm2 && pm2 start ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [{ name: 'turbofex', script: 'index.js', autorestart: true, restart_delay: 5000, max_restarts: 50, time: true }],
};
