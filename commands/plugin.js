const plugins = require('../core/plugins');

const NOT_ON = (p) => `ℹ️ *Plugins are off.*\n▸ *Turn them on:* \`${p}plugin on\``;
const mono = (p, s) => `\`${p}plugin ${s}\``;
const STORE_WHY = (p, why) => ({
  store_off: '▸ _The store is not open yet._',
  unreachable: '▸ _I could not reach the store. Check the internet connection and try again._',
  tampered: '▸ _The files from the store did not pass the safety check, so nothing was installed._',
  unknown: `▸ _I could not find that plugin. See what is there with_ ${mono(p, 'store')}`,
  revoked: '▸ _This plugin was withdrawn for safety and cannot be installed._',
  conflict: '▸ _A different plugin with that name is already in your plugins folder._',
}[why] || '▸ _Please try again in a moment._');
const showInstall = (p, r) => {
  const m = r.manifest; const cmds = m.commands.map((c) => `\`${p}${c.name}\``).join(', ') || 'none';
  return `🧩 *${r.update ? 'Update' : 'Install'} ${m.name} ${m.version}?*\n▸ *By:* ${m.author.name}\n▸ *About:* ${m.description}\n▸ *Commands:* ${cmds}\n*It asks to:*\n${r.lines.join('\n')}\n▸ *To continue:* \`${p}plugin confirm ${r.code}\`\n_This code works for 5 minutes._`;
};

module.exports = {
  name: 'plugin',
  category: 'owner',
  description: 'Add extra commands made by other developers: on/off, list, install, remove (owner only)',
  ownerOnly: true,
  async run({ args, rest, reply, prefix: p, jid, isGroup }) {
    const sub = (args[0] || '').toLowerCase();
    const id = (args[1] || '').toLowerCase();
    const o = plugins.overview();

    if (sub === 'on') {
      const s = await plugins.turnOn();
      if (s.state === 'ready') return reply(`✅ *Plugins are on.*\n▸ *See what is available:* ${mono(p, 'list')}`);
      return reply(`⚠️ *Plugins could not be turned on.*\n▸ ${s.reason || 'Please try again in a moment.'}\n_Everything else keeps working as usual._`);
    }
    if (sub === 'off') {
      plugins.turnOff();
      return reply(`✅ *Plugins are off.*\n▸ _Their commands are gone until you turn them on again._`);
    }

    if (sub === 'set') {
      const key = (args[1] || '').toLowerCase(); const n = parseInt(args[2], 10);
      if (!plugins.setOption(key, n)) {
        return reply(`🧩 *Plugin limits*\n▸ *Plugins running at once:* ${o.max === 0 ? 'no limit' : o.max}\n▸ *Memory guard per call:* ${o.guardMb} MB\n▸ *Change:* ${mono(p, 'set max 8')}  (0 = no limit)\n▸ *Change:* ${mono(p, 'set guard 96')}  (16 to 1024)`);
      }
      return reply(key === 'max' ? `✅ *Limit saved.*\n▸ *Plugins running at once:* ${n === 0 ? 'no limit' : n}` : `✅ *Limit saved.*\n▸ *Memory guard per call:* ${n} MB`);
    }

    if (!sub || sub === 'help') {
      return reply(
        `🧩 *Plugins*\n▸ *Status:* ${o.enabled ? (o.status.state === 'ready' ? 'on' : 'on, but not running') : 'off'}\n` +
          `▸ ${mono(p, 'on')} / ${mono(p, 'off')}\n▸ ${mono(p, 'list')}\n▸ ${mono(p, 'info <name>')}\n▸ ${mono(p, 'store')}  _(plugins from the TurboFex store)_\n▸ ${mono(p, 'install <name>')}\n▸ ${mono(p, 'updates')} / ${mono(p, 'update <name>')}\n▸ ${mono(p, 'stats on|off')}  _(anonymous statistics, off by default)_\n▸ ${mono(p, 'rate <name> <1-5>')}  _(rate a store plugin; needs stats on)_\n▸ ${mono(p, 'updatemode <name> notify|automatic|manual')}\n▸ ${mono(p, 'options <name>')} / ${mono(p, 'option <name> <option> <value>')}\n▸ ${mono(p, 'rollback <name>')}  _(go back to the version before the last update)_\n▸ ${mono(p, 'enable <name>')} / ${mono(p, 'disable <name>')}\n▸ ${mono(p, 'remove <name>')}\n▸ ${mono(p, 'groups <name> allow|deny|only|all')}  _(inside a group)_\n▸ ${mono(p, 'log <name>')}\n▸ ${mono(p, 'set max 8')} / ${mono(p, 'set guard 96')}\n_Copy a plugin folder into the bot's plugins folder, then install it._`
      );
    }

    if (!o.enabled) return reply(NOT_ON(p));
    if (!plugins.isRunning()) return reply(`⚠️ *Plugins are not running.*\n▸ ${o.status.reason || 'Please try again in a moment.'}\n_Use ${mono(p, 'on')} to try again._`);

    if (sub === 'list') {
      const lines = [];
      for (const f of o.folders) {
        if (!f.ok) { lines.push(`▸ ⚠️ *A folder is not a usable plugin:* ${f.errors[0]}`); continue; }
        const m = f.manifest; const rec = o.installed[m.id];
        const st = !rec ? 'not installed' : rec.enabled ? 'on' : `off${rec.reason ? ' (' + rec.reason + ')' : ''}`;
        lines.push(`▸ *${m.name}* ${m.version}  _${st}_  \`${m.id}\``);
      }
      for (const [pid, rec] of Object.entries(o.installed)) if (!o.folders.some((f) => f.ok && f.manifest.id === pid)) lines.push(`▸ *${pid}* ${rec.version}  _folder missing_`);
      if (!lines.length) return reply(`🧩 *No plugins yet.*\n▸ _Copy a plugin folder into the plugins folder of the bot, then use_ ${mono(p, 'list')}`);
      return reply(`🧩 *Plugins*\n${lines.join('\n')}\n_Install one with_ ${mono(p, 'install <name>')}`);
    }

    if (sub === 'store') {
      try {
        const d = id ? await plugins.storeInfo(id) : null; // an exact name shows its details, anything else is a search
        if (d) {
          const perms = d.permissions.length ? d.permissions.join(', ') : 'nothing special';
          return reply(`🧩 *${d.name} ${d.version}*\n▸ *By:* ${d.author}\n▸ *About:* ${d.description}\n▸ *Asks for:* ${perms}\n▸ *Install:* ${mono(p, 'install ' + d.id)}`);
        }
        const list = (await plugins.storeList(rest.replace(/^store\s*/i, ''))).slice(0, 15);
        if (!list.length) return reply(`🧩 *Nothing in the store matches.*\n▸ _Try a different word, or just_ ${mono(p, 'store')}`);
        return reply(`🧩 *Plugin store*\n${list.map((x) => `▸ *${x.name}* ${x.version}  \`${x.id}\`\n   _${x.description}_`).join('\n')}\n_See details with_ ${mono(p, 'store <name>')}`);
      } catch (e) {
        return reply(`⚠️ *The store is not available.*\n${STORE_WHY(p, e.code)}`);
      }
    }
    if (sub === 'rate') {
      const stars = Number(args[2]);
      if (!id || !Number.isInteger(stars) || stars < 1 || stars > 5) return reply(`⭐ *Rate a store plugin*\n▸ ${mono(p, 'rate <name> <1-5>')}\n▸ _Needs_ ${mono(p, 'stats on')} _and the plugin installed from the store. Your rating is shown on the store page as "rated by bot owners". It is sent with your anonymous bot number only._`);
      const r = await plugins.ratePlugin(id, stars);
      if (r.ok) return reply(`✅ *Thank you!* You gave *${id}* ${'⭐'.repeat(stars)}.`);
      const why = { unknown: `That plugin is not installed from the store. See ${mono(p, 'list')}.`, off: `Turn on anonymous statistics first: ${mono(p, 'stats on')}.`, notyet: 'The bot has not sent its first statistics report yet. Try again tomorrow, or later today.', stars: 'Use a number from 1 to 5.', site: 'The store site could not be reached. Try again later.' }[r.why] || 'Not possible right now.';
      return reply(`⚠️ ${why}`);
    }
    if (sub === 'stats') {
      const a = (args[1] || '').toLowerCase();
      if (a === 'on') { await plugins.setStats(true); return reply(`✅ *Anonymous statistics are on.*\n▸ _Once a day the bot tells the plugin store which store plugins are installed and how often they failed, so developers can see how many bots use their plugin._\n▸ _Never sent: messages, numbers, group names or your session. Turn off with_ ${mono(p, 'stats off')}`); }
      if (a === 'off') { await plugins.setStats(false); return reply(`✅ *Anonymous statistics are off.*\n▸ _Nothing is sent, and the site was asked to delete what it had for this bot._`); }
      const st = plugins.statsStatus();
      return reply(`📊 *Anonymous statistics: ${st.on ? 'on' : 'off'}*\n${st.on ? `▸ *Last sent:* ${st.last ? new Date(st.last).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'not yet'}\n` : ''}▸ _Sent once a day when on: a random bot id and which store plugins are installed (with version and failure counts). Never messages, numbers, group names or your session._\n▸ ${mono(p, 'stats on')} / ${mono(p, 'stats off')}`);
    }
    if (sub === 'updates') {
      try {
        const u = await plugins.updatesAvailable();
        if (!u.length) return reply('✅ *Your store plugins are up to date.*');
        return reply(`🧩 *Updates available*\n${u.map((x) => `▸ *${x.id}* ${x.from} → ${x.to}`).join('\n')}\n_Update one with_ ${mono(p, 'update <name>')}`);
      } catch (e) {
        return reply(`⚠️ *I could not check for updates.*\n${STORE_WHY(p, e.code)}`);
      }
    }
    if (sub === 'install' || sub === 'update') {
      if (!id) return reply(`ℹ️ *Which plugin?*\n▸ ${mono(p, sub + ' <name>')}\n_See the names with_ ${mono(p, 'list')} or ${mono(p, 'store')}`);
      if (sub === 'update' && !(o.installed[id] && o.installed[id].store)) return reply(`ℹ️ *Only plugins from the store can be updated this way.*\n▸ _For your own plugin, replace its files and use_ ${mono(p, 'install ' + id)}`);
      let r = sub === 'update' ? { ok: false, why: 'missing' } : plugins.prepare(id);
      if (!r.ok && r.why === 'missing') r = await plugins.prepareStore(id);
      if (!r.ok && ['same'].includes(r.why)) return reply(`ℹ️ *That plugin is already installed and up to date.*`);
      if (!r.ok && r.why === 'invalid') return reply(`⚠️ *This plugin cannot be installed.*\n▸ ${r.errors[0]}\n_Ask its developer to fix this._`);
      if (!r.ok && r.why === 'missing') return reply(`⚠️ *I could not find that plugin.*\n▸ _Check the name with_ ${mono(p, 'list')} or ${mono(p, 'store')}`);
      if (!r.ok) return reply(`⚠️ *I could not install that plugin.*\n${STORE_WHY(p, r.why)}`);
      return reply(showInstall(p, r));
    }
    if (sub === 'confirm') {
      const r = plugins.confirm(args[1]);
      if (!r.ok) return reply(`⚠️ *That code did not work.*\n▸ _Start again with_ ${mono(p, 'install <name>')}`);
      return reply(`✅ *${r.manifest.name} is ready.*\n▸ *Commands:* ${r.manifest.commands.map((c) => `\`${p}${c.name}\``).join(', ') || 'none'}`);
    }

    const rec = o.installed[id];
    if (['enable', 'disable', 'remove', 'groups', 'log', 'info', 'rollback', 'updatemode', 'options', 'option'].includes(sub)) {
      if (!id) return reply(`ℹ️ *Which plugin?*\n▸ ${mono(p, sub + ' <name>')}\n_See the names with_ ${mono(p, 'list')}`);
      if (!rec) return reply(`⚠️ *That plugin is not installed.*\n▸ _See the names with_ ${mono(p, 'list')}`);
    }
    const fmtVal = (t, v) => (t.type === 'toggle' ? (v ? 'on' : 'off') : String(v));
    const hint = (t) => (t.type === 'toggle' ? 'on or off' : t.type === 'number' ? `a number from ${t.min} to ${t.max}` : t.type === 'choice' ? t.options.join(' / ') : `text, up to ${t.maxLength} characters`);
    if (sub === 'options') {
      const l = plugins.settingsList(id, isGroup ? jid : null);
      if (!l.length) return reply(`ℹ️ *${id} has no options.*`);
      return reply(`⚙️ *Options of ${id}*${isGroup ? '\n_(this group)_' : ''}\n${l.map((t) => `▸ *${t.key}:* ${fmtVal(t, t.value)}  _(${t.label}${t.perGroup ? ', can differ per group' : ''}; ${hint(t)})_`).join('\n')}\n_Change one with_ ${mono(p, `option ${id} <option> <value>`)}${l.some((t) => t.perGroup) ? '\n_Per-group options: use the command inside the group to change only that group._' : ''}`);
    }
    if (sub === 'option') {
      if (!args[2]) return reply(`ℹ️ *Which option?*\n▸ ${mono(p, `options ${id}`)} _(shows them)_\n▸ ${mono(p, `option ${id} <option> <value>`)}`);
      const r = plugins.setSetting(id, args[2], args.slice(3).join(' '), jid, isGroup);
      if (r.ok) return reply(`✅ *Saved.*\n▸ *${r.t.label}:* ${r.reset ? 'back to the default (' + fmtVal(r.t, r.value) + ')' : fmtVal(r.t, r.value)}${r.group ? '\n▸ _Only in this group._' : ''}`);
      if (r.why === 'nokey') return reply(`ℹ️ *That option does not exist.*\n▸ _See them with_ ${mono(p, `options ${id}`)}`);
      return reply(`⚠️ *That value does not fit.*\n▸ *${r.t.label}:* ${hint(r.t)}\n_Or use_ ${mono(p, `option ${id} ${r.t.key} reset`)}`);
    }
    if (sub === 'rollback') {
      const r = plugins.rollback(id);
      if (r.ok) return reply(`✅ *${r.name} is back on version ${r.to}.*\n▸ *Was:* ${r.from}\n▸ _This version will not be updated automatically again._`);
      return reply(r.why === 'none' ? `ℹ️ *There is no earlier version to go back to.*\n▸ _Only plugins from the store that were updated can go back, one version._` : `⚠️ *I could not go back.*\n▸ _The saved copy is missing or changed. Install it again with_ ${mono(p, 'install ' + id)}`);
    }
    if (sub === 'updatemode') {
      const m = (args[2] || '').toLowerCase(); const r = plugins.setUpdateMode(id, m);
      if (r.ok) return reply(`✅ *Saved.*\n▸ *Plugin:* ${id}\n▸ *Updates:* ${m === 'automatic' ? 'automatic (only when it asks for the same permissions and websites)' : m === 'manual' ? 'manual (I will not tell you)' : 'notify (I tell you, you decide)'}`);
      if (r.why === 'nostore') return reply(`ℹ️ *Only plugins from the store have update modes.*`);
      return reply(`ℹ️ *Choose how updates work.*\n▸ ${mono(p, `updatemode ${id} notify`)}  _(I tell you, you decide)_\n▸ ${mono(p, `updatemode ${id} automatic`)}  _(only when nothing new is asked)_\n▸ ${mono(p, `updatemode ${id} manual`)}  _(I stay quiet)_`);
    }
    if (sub === 'enable') {
      const r = plugins.setEnabled(id, true);
      return reply(r.ok ? `✅ *${id} is on.*` : `⚠️ *I could not turn it on.*\n▸ ${r.reason ? 'Reason: ' + r.reason + '.' : ''}\n_Install it again with_ ${mono(p, 'install ' + id)}`);
    }
    if (sub === 'disable') { plugins.setEnabled(id, false); return reply(`✅ *${id} is off.*\n▸ _Turn it on again with_ ${mono(p, 'enable ' + id)}`); }
    if (sub === 'remove') { plugins.remove(id); return reply(`✅ *${id} was removed.*\n▸ _Its saved notes are kept for 30 days in case you install it again, then erased. The plugin folder can be deleted._`); }
    if (sub === 'groups') {
      const mode = (args[2] || '').toLowerCase();
      if (!isGroup) return reply(`ℹ️ *Use this inside the group you mean.*`);
      if (!plugins.groupRule(id, jid, mode)) return reply(`ℹ️ *Choose what to do in this group.*\n▸ ${mono(p, `groups ${id} allow`)}\n▸ ${mono(p, `groups ${id} deny`)}\n▸ ${mono(p, `groups ${id} only`)}  _(only the groups where you used it)_\n▸ ${mono(p, `groups ${id} all`)}  _(every group)_`);
      return reply(`✅ *Saved for this group.*\n▸ *Plugin:* ${id}\n▸ *Choice:* ${mode}`);
    }
    if (sub === 'log') {
      const l = plugins.logOf(id).slice(-15);
      return reply(l.length ? `📜 *${id}*\n${l.map((x) => '▸ ' + x).join('\n')}` : `📜 *Nothing to show for ${id} yet.*`);
    }
    if (sub === 'info') {
      const l = o.loaded.get(id); const g = rec.allowOnly ? `${rec.allowOnly.length} group(s) only` : 'every group';
      return reply(`🧩 *${l ? l.manifest.name : id}*\n▸ *Version:* ${rec.version}\n▸ *Status:* ${rec.enabled ? 'on' : 'off' + (rec.reason ? ' (' + rec.reason + ')' : '')}\n${(plugins.settingsList(id, null) || []).length ? `▸ *Options:* ${mono(p, 'options ' + id)}\n` : ''}${rec.store ? `▸ *Updates:* ${rec.updateMode || 'notify'}${rec.previous ? ' (can go back to ' + rec.previous.version + ')' : ''}\n` : ''}▸ *Works in:* ${g}${rec.blocked && rec.blocked.length ? `, ${rec.blocked.length} blocked` : ''}\n▸ *Allowed to:* ${rec.grants.length ? rec.grants.join(', ') : 'nothing special'}`);
    }
    return reply(`ℹ️ *I did not understand that.*\n▸ _See what you can do with_ ${mono(p, 'help')}`);
  },
};
