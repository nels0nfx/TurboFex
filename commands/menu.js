const os = require('os');
const pkg = require('../package.json');
const brand = require('../core/brand');
const clock = require('../core/clock');
const { smallcaps: sc } = require('../core/fonts');
const store = require('../whatsapp/store');
const { groupByCategory } = require('../whatsapp/categories');

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const RULE = '────────────────'; // short on purpose: long lines wrap on phones

// a block of aligned lines in WhatsApp monospace
const mono = (rows) => {
  const w = Math.max(...rows.map(([k]) => k.length)) + 2;
  return '```\n' + rows.map(([k, v]) => `${k.padEnd(w)}${v}`).join('\n') + '\n```';
};

// one category: a title and its commands, one per line
function block(section, lines) {
  return `┌─ *${section.meta.title}*\n${lines.map((l) => `│ ${section.meta.symbol} ${l}`).join('\n')}\n└──────`;
}

module.exports = {
  name: 'menu',
  category: 'general',
  description: 'Show the command menu (try: menu group, or menu kick for help with one command)',
  async run({ reply, commandList, prefix, args, isOwner, isAdmin }) {
    const sections = groupByCategory(commandList, isOwner);
    const all = sections.flatMap((s) => s.cmds);
    const query = (args[0] || '').toLowerCase().replace(/^[^a-z0-9]+/, '');

    // menu <category>: every command of it with its description
    const section = sections.find((s) => s.key === query);
    if (query && section) {
      const items = section.cmds.map((c) => `*${c.name}*\n│    _${c.description}_`);
      return reply(block(section, items));
    }

    // menu <command>: help for one command
    if (query) {
      const c = all.find((x) => x.name === query || (x.aliases || []).includes(query));
      if (!c) return reply(`No command found for *${query}*.\n> Send ${prefix}menu to see everything.`);
      const who = c.realOwnerOnly ? 'Main owner' : c.ownerOnly ? 'Owner' : c.adminOnly ? 'Group admins' : 'Everyone';
      const rows = [
        ['Use', `${prefix}${c.name}`],
        ['Who', who],
        ['Where', c.groupOnly ? 'Groups only' : 'Groups and private'],
      ];
      if ((c.aliases || []).length) rows.push(['Also', c.aliases.map((a) => prefix + a).join(', ')]);
      if (c.botAdminRequired) rows.push(['Needs', 'Bot as admin']);
      return reply(`*${c.name.toUpperCase()}*\n_${c.description}_\n${RULE}\n${mono(rows)}`);
    }

    // full menu
    const now = clock.parts();
    const rows = [
      ['User', isOwner ? 'Owner' : isAdmin ? 'Group admin' : 'Member'],
      ['Prefix', prefix],
      ['Mode', store.getMode() === 'private' ? 'Private' : 'Public'],
      ['Time', now.time],
      ['Date', `${String(now.day).slice(0, 3)}, ${now.date}`],
      ['Version', `v${pkg.version}`],
      ['Commands', String(all.length)],
      ['Uptime', clock.uptime()],
    ];
    if (isOwner) rows.push(['Memory', `${Math.round(process.memoryUsage().rss / 1048576)} MB`], ['System', `${os.type()}, Node ${process.versions.node.split('.')[0]}`]);

    const custom = store.getAuto('menu') || {};
    const head = `*${(custom.title || brand.botName).toUpperCase().split('').join(' ')}*\n_${custom.subtitle || 'WhatsApp Assistant'}_\n${RULE}\n${mono(rows)}`;
    const body = sections.map((s) => block(s, s.cmds.map((c) => sc(c.name)))).join('\n\n');
    const tips =
      `> ${prefix}menu <category>  details of a category\n` +
      `> ${prefix}menu <command>  help for one command\n` +
      `> ${prefix}list  every command with its description\n\n` +
      `${chunk(sections.map((s) => s.key), 5).map((r) => `_${r.join(' · ')}_`).join('\n')}\n` +
      `_${brand.botName} • v${pkg.version}_`;

    return reply(`${head}\n\n${body}\n\n${tips}`);
  },
};
