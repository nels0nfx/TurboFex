const { getTargets, num } = require('./utils');
const store = require('./store');
const meta = require('./metadata');

// Remove one member. Returns true if it worked.
async function removeMember(sock, jid, id) {
  const res = await sock.groupParticipantsUpdate(jid, [id], 'remove');
  meta.invalidate(jid);
  return Array.isArray(res) && String(res[0]?.status) === '200';
}

// Shared code for kick / promote / demote
async function changeMembers(ctx, action, doneWord) {
  const { sock, jid, msg, reply, botIds, prefix, cmdName } = ctx;

  const targets = getTargets(msg).filter((t) => !botIds.includes(num(t)));
  if (!targets.length) {
    return reply(
      `Please tag the person or reply to their message.\nExample: ${prefix}${cmdName} @person`
    );
  }

  const results = await sock.groupParticipantsUpdate(jid, targets, action);
  meta.invalidate(jid);
  const list = Array.isArray(results) ? results : [];
  const okCount = list.filter((r) => String(r.status) === '200').length;

  if (okCount > 0 && okCount === targets.length) {
    const tags = targets.map((t) => `@${num(t)}`).join(' ');
    return reply(`✅ ${doneWord}: ${tags}`, { mentions: targets });
  }
  if (okCount > 0) {
    return reply(`⚠️ ${doneWord} ${okCount} of ${targets.length}. Some could not be changed.`);
  }
  return reply('⚠️ I could not do that. The person may be the group owner or not in this group.');
}

// Shared code for on/off settings (welcome, goodbye, antispam, pdm)
async function toggleSetting(ctx, key, label) {
  const { jid, args, reply, prefix, cmdName } = ctx;
  const choice = (args[0] || '').toLowerCase();
  const g = store.getGroup(jid);

  if (choice !== 'on' && choice !== 'off') {
    return reply(
      `${label} is currently *${g[key] ? 'ON' : 'OFF'}*.\nUse ${prefix}${cmdName} on  or  ${prefix}${cmdName} off`
    );
  }
  store.update(jid, (grp) => {
    grp[key] = choice === 'on';
  });
  return reply(`✅ ${label} is now *${choice.toUpperCase()}*.`);
}

// Shared code for !setwelcome and !setgoodbye
async function setMessage(ctx, { textKey, onKey, label, defaultText, toggleCmd }) {
  const { jid, rest, reply, prefix, cmdName } = ctx;
  const g = store.getGroup(jid);

  if (!rest) {
    return reply(
      `✏️ *Current ${label} message:*\n\n${g[textKey] || defaultText}\n\n` +
        `To change it, type:\n${prefix}${cmdName} your message here\n\n` +
        `You can use:\n@user = the person\n{group} = group name\n{count} = member count\n\n` +
        `To go back to the default: ${prefix}${cmdName} reset`
    );
  }

  if (rest.toLowerCase() === 'reset') {
    store.update(jid, (grp) => {
      grp[textKey] = null;
    });
    return reply(`✅ ${label[0].toUpperCase() + label.slice(1)} message reset to the default.`);
  }

  if (rest.length > 1000) return reply('⚠️ That message is too long. Please keep it under 1000 characters.');

  store.update(jid, (grp) => {
    grp[textKey] = rest;
  });
  const note = g[onKey] ? '' : `\n\n(It's currently OFF. Turn it on with ${prefix}${toggleCmd} on)`;
  return reply(`✅ ${label[0].toUpperCase() + label.slice(1)} message saved.${note}`);
}

// Shared code for "off / delete / warn / kick" settings (antilink, antiword)
async function setActionMode(ctx, { key, label, trigger }) {
  const { jid, args, reply, prefix, cmdName, isBotAdmin } = ctx;
  const g = store.getGroup(jid);
  let choice = (args[0] || '').toLowerCase();
  if (choice === 'on') choice = 'warn';

  if (!store.ANTILINK_MODES.includes(choice)) {
    return reply(
      `🛡️ ${label} is currently *${g[key].toUpperCase()}*.\n\n` +
        `Choose what happens when a member ${trigger}:\n` +
        `• ${prefix}${cmdName} delete - delete the message only\n` +
        `• ${prefix}${cmdName} warn - delete + warn (removed after ${store.getLimit(jid)} warnings)\n` +
        `• ${prefix}${cmdName} kick - delete + remove straight away\n` +
        `• ${prefix}${cmdName} off - switch off\n\n` +
        `Admins are never affected.`
    );
  }
  store.update(jid, (grp) => {
    grp[key] = choice;
  });
  await reply(`✅ ${label} is now *${choice.toUpperCase()}*.`);
  if (choice !== 'off' && !isBotAdmin) {
    await reply('⚠️ Note: I must be a group admin to delete messages and remove people.');
  }
}

module.exports = { changeMembers, toggleSetting, setMessage, setActionMode, removeMember };
