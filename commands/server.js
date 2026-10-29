// Shows what the server can handle and switches the protection for heavy commands on or off.
const os = require('os');
const store = require('../whatsapp/store');
const capacity = require('../core/capacity');
const { smallcaps: sc } = require('../core/fonts');

module.exports = {
  name: 'server',
  aliases: ['capacity', 'guard'],
  category: 'owner',
  ownerOnly: true,
  description: 'Server health and the protection that blocks heavy commands when the server cannot cope: server / server guard on / off',
  async run({ args, reply, prefix, commandList }) {
    const a = (args[0] || '').toLowerCase();
    const b = (args[1] || '').toLowerCase();
    if (a === 'guard' && (b === 'on' || b === 'off')) {
      store.setGuard(b === 'on');
      return reply(`✅ Server protection is now *${b.toUpperCase()}*.${b === 'off' ? '\n⚠️ Heavy commands will run even when the server is struggling.' : ''}`);
    }

    const snap = capacity.snapshot();
    const tools = {};
    for (const t of ['sharp', 'ffmpeg', 'qrcode']) tools[t] = await capacity.checkTool(t);
    const blocked = commandList.filter((c) => c.capacity?.needs.some((n) => tools[n] === false)).map((c) => c.name);
    const m = snap.memory;
    const l = snap.load;
    await reply(
      `╭───❮ 🖥️ *${sc('server')}* ❯\n` +
        `│ 🛡️ ${sc('protection')} : ${store.getGuard() ? 'ON' : 'OFF'}\n` +
        `│ 💾 ${sc('memory')} : ${m.usedMB} / ${m.limitMB} MB (${m.freeMB} MB free)\n` +
        `│ ⚙️ ${sc('cpu')} : ${l.cpus} core(s), load ${l.load1}, delay ${l.lagMs} ms\n` +
        `│ 🏃 ${sc('running now')} : ${snap.active.heavy} heavy, ${snap.active.medium} medium\n` +
        `│ 🧰 ${sc('tools')} : ${Object.entries(tools).map(([k, v]) => `${k} ${v ? '✅' : '❌'}`).join(', ')}\n` +
        `│ 🖥️ ${sc('system')} : ${os.type()} • Node ${process.versions.node}\n` +
        `╰──────────────\n` +
        (blocked.length ? `\n🚫 Blocked because a tool is missing: ${blocked.join(', ')}\n` : '') +
        `\n${prefix}server guard off - never block heavy commands\n${prefix}server guard on - block them when the server cannot cope`
    );
  },
};
