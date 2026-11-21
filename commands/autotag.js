const autotag = require('../whatsapp/autotag');
const groups = require('../whatsapp/groups');

// In a group:         autotag on / autotag off / autotag            (this group)
// In a private chat:  autotag on / autotag off / autotag            (ALL groups)
//                     autotag on 3 / autotag off 3 / autotag 3      (one group: a number from gjids, its id, or part of its name)
module.exports = {
  name: 'autotag',
  category: 'owner',
  description: 'Tag everyone silently when you write in a group: autotag on / off in the group, or in a private chat for ALL groups (autotag on 3 for one group) (owner only)',
  ownerOnly: true,
  noAgain: true,
  async run({ sock, jid, isGroup, args, rest, reply, prefix }) {
    const w = (args[0] || '').toLowerCase();
    const hasSwitch = w === 'on' || w === 'off';
    let target = jid;
    let label = 'this group';
    let every = false; // private chat, no group named: all groups

    if (!isGroup) {
      const arg = (hasSwitch ? rest.replace(/^\S+\s*/, '') : rest).trim().replace(/^"([^"]*)"$/, '$1');
      if (!arg) {
        every = true;
        label = 'ALL your groups';
      } else {
        const g = await groups.resolve(sock, arg);
        if (!g) return reply(`⚠️ I could not find the group "${arg}".\nSend ${prefix}gjids to see your groups and their numbers.`);
        target = g.jid;
        label = g.name;
      }
    }

    if (hasSwitch) {
      if (every) autotag.setAll(w === 'on');
      else autotag.set(target, w === 'on');
      return reply(w === 'on'
        ? `✅ *Auto tag is ON in ${label}.*\n▸ _When you write in ${every ? 'a group' : 'it'}, everyone is notified quietly through your own message. No extra message is sent._${every ? '\n▸ _It also works in groups you join later._' : ''}`
        : `✅ *Auto tag is OFF in ${label}.*\n▸ _Your messages no longer notify everyone._`);
    }

    if (every) {
      const s = autotag.state();
      const line = s.all ? `ON in ALL groups${s.except.length ? ` (except ${s.except.length})` : ''}` : s.groups.length ? `ON in ${s.groups.length} group${s.groups.length === 1 ? '' : 's'}` : 'OFF';
      return reply(`🔔 *Auto tag: ${line}*\n▸ \`${prefix}autotag on\` = all groups\n▸ \`${prefix}autotag on 3\` = one group (numbers from ${prefix}gjids)\n▸ \`${prefix}autotag off\` = all off`);
    }
    return reply(`🔔 *Auto tag in ${label}: ${autotag.isOn(target) ? 'ON' : 'OFF'}*\n▸ \`${prefix}autotag on\` / \`${prefix}autotag off\`${isGroup ? '' : ' + the group'}`);
  },
};
