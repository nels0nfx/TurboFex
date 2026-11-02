// New group commands (v1.0.7): lockdown, votekick, groupstats, catchup, topwarned, swearjar, announce, quiettime, welcomedm, weeklyrecap
const store = require('../whatsapp/store');
const stats = require('../whatsapp/groupstats');
const welcomedm = require('../whatsapp/welcomedm');
const ai = require('../core/ai');
const clock = require('../core/clock');
const repeat = require('../core/repeat');
const { spark } = require('../core/realm/ui');
const levels = require('../whatsapp/levels');
const { num, participantIds, getTargets, quotedText, getQuoted } = require('../whatsapp/utils');
const { removeMember } = require('../whatsapp/actions');

const base = { category: 'group', groupOnly: true, needs: [], weight: 'light' };
const adminBase = { ...base, adminOnly: true };
const nf = (n) => Number(n).toLocaleString('en-US');
const mayAdmin = (ctx) => !!(ctx.isAdmin || ctx.isOwner);

// a member key (phone number) -> a jid that can be tagged
function jidFor(meta, key) {
  const p = (meta?.participants || []).find((x) => participantIds(x).includes(key));
  return p ? p.id : `${key}@s.whatsapp.net`;
}
const isAdminKey = (meta, key) => (meta?.participants || []).some((p) => p.admin && participantIds(p).includes(key));
const dayLabel = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00-${String((h + 1) % 24).padStart(2, '0')}:00`;
const medals = ['🥇', '🥈', '🥉'];

// ---- votekick: the state of the votes, in memory (a vote lasts 10 minutes)
const votes = new Map(); // group -> { target, targetKey, voters:Set, need, by, ends }
const lastStart = new Map(); // group|starter -> time
const VOTE_MS = 10 * 60 * 1000;
const START_GAP_MS = 30 * 60 * 1000;
const votesNeeded = (meta) => Math.min(10, Math.max(3, Math.ceil(((meta?.participants || []).length || 1) * 0.15)));

module.exports = [
  {
    ...adminBase,
    name: 'lockdown',
    aliases: ['panic'],
    botAdminRequired: true,
    description: 'Emergency lock: only admins can write, links and spam are deleted. lockdown off undoes it (admins only)',
    async run({ sock, jid, args, reply, prefix }) {
      const w = (args[0] || '').toLowerCase();
      const g = store.getGroup(jid);
      if (['off', 'end', 'stop', 'unlock'].includes(w)) {
        if (!g.lockdown) return reply('ℹ️ *No lockdown is on.*');
        const was = g.lockdown;
        await sock.groupSettingUpdate(jid, 'not_announcement');
        store.update(jid, (grp) => {
          grp.antilinkMode = was.link || 'off';
          grp.antispamMode = was.spam || 'off';
          delete grp.lockdown;
        });
        return reply('🔓 *Lockdown ended.* Everybody can write again and the protections are back to what they were.');
      }
      if (g.lockdown) return reply(`🔒 *Lockdown is already on.* End it with \`${prefix}lockdown off\``);
      await sock.groupSettingUpdate(jid, 'announcement');
      store.update(jid, (grp) => {
        grp.lockdown = { at: Date.now(), link: grp.antilinkMode, spam: grp.antispamMode };
        if (grp.antilinkMode === 'off') grp.antilinkMode = 'delete';
        if (grp.antispamMode === 'off') grp.antispamMode = 'delete';
      });
      return reply(`🔒 *LOCKDOWN*\nOnly admins can write now. Links and spam are deleted.\n_End it with_ \`${prefix}lockdown off\``);
    },
  },

  {
    ...base,
    name: 'votekick',
    aliases: ['vk'],
    description: 'Members vote to remove someone: votekick @user, then everybody sends votekick yes (votekick cancel stops it)',
    async run(ctx) {
      const { sock, jid, msg, args, reply, prefix, groupMetadata: meta, botIds, myJid, isBotAdmin } = ctx;
      const w = (args[0] || '').toLowerCase();
      const now = Date.now();
      let v = votes.get(jid);
      if (v && now > v.ends) {
        votes.delete(jid);
        v = null;
      }
      const me = levels.keyOf(myJid);

      if (w === 'cancel' || w === 'stop') {
        if (!v) return reply('ℹ️ *No vote is running.*');
        if (!(mayAdmin(ctx) || v.by === me)) return; // not allowed: stay silent
        votes.delete(jid);
        return reply('🛑 *The vote was cancelled.*');
      }

      const targets = getTargets(msg).filter((t) => !botIds.includes(num(t)));
      const voting = !!v && (w === 'yes' || w === 'vote' || w === 'y' || (!targets.length && !w));
      if (voting) {
        if (me === v.targetKey) return reply('😅 *You cannot vote on your own removal.*');
        if (v.voters.has(me)) return reply(`ℹ️ *You already voted.* ${v.voters.size}/${v.need}`);
        v.voters.add(me);
        if (v.voters.size < v.need) return reply(`🗳️ *Vote counted:* ${v.voters.size}/${v.need} to remove @${num(v.target)}`, { mentions: [v.target] });
        votes.delete(jid);
        if (!isBotAdmin) return reply(`🗳️ *Enough votes* (${v.need}), but I am not an admin, so I cannot remove @${num(v.target)}.`, { mentions: [v.target] });
        let removed = false;
        try {
          removed = await removeMember(sock, jid, v.target);
        } catch (err) {
          removed = false;
        }
        return reply(removed ? `🚪 *The group voted:* @${num(v.target)} was removed.` : `⚠️ *Enough votes*, but I could not remove @${num(v.target)}.`, { mentions: [v.target] });
      }

      if (v) return reply(`🗳️ *A vote is already running* for @${num(v.target)} (${v.voters.size}/${v.need}).\nVote with \`${prefix}votekick yes\``, { mentions: [v.target] });
      if (!targets.length) return reply(`🗳️ *Vote to remove a member*\n*Start:* \`${prefix}votekick @person\`\n*Vote:* \`${prefix}votekick yes\`\n_It needs about 15% of the group (3 to 10 votes) within 10 minutes. Admins cannot be voted out._`);

      const target = targets[0];
      const key = levels.keyOf(target);
      if (key === me) return reply('😅 *You cannot start a vote against yourself.*');
      if (isAdminKey(meta, key)) return reply('⛔ *Admins cannot be voted out.* Ask another admin.');
      if (!isBotAdmin) return reply('⚠️ *I must be a group admin* to remove people, so a vote would be useless.');
      const gap = `${jid}|${me}`;
      if (now - (lastStart.get(gap) || 0) < START_GAP_MS) return reply('⏳ *You started a vote a short while ago.* Please wait a little.');
      lastStart.set(gap, now);
      if (lastStart.size > 2000) lastStart.clear();
      const need = votesNeeded(meta);
      votes.set(jid, { target, targetKey: key, voters: new Set([me]), need, by: me, ends: now + VOTE_MS });
      return reply(`🗳️ *VOTE: remove @${num(target)}?*\nStarted by @${num(myJid)}. Votes: 1/${need}\nEveryone who agrees sends \`${prefix}votekick yes\` (10 minutes).`, { mentions: [target, myJid] });
    },
  },

  {
    ...base,
    name: 'groupstats',
    aliases: ['gstats', 'chatstats'],
    description: 'Messages, busiest hours and most active members of the last days: groupstats 7 (up to 30 days)',
    async run({ jid, args, reply, groupMetadata: meta }) {
      const days = Math.min(30, Math.max(1, parseInt(args.find((a) => /^\d+$/.test(a)), 10) || 7));
      const s = stats.summary(jid, days);
      if (!s.total) return reply('📊 *No messages counted yet.* I count from the moment this version started, so please check again later.');
      const lines = [`📊 *Group stats* _(last ${days} day${days > 1 ? 's' : ''})_`, '', `💬 *Messages:* ${nf(s.total)} (about ${nf(Math.round(s.total / days))} a day)`, `👥 *Active members:* ${nf(s.top.length)} of ${nf((meta?.participants || []).length)}`];
      lines.push('', '*Most active*', ...s.top.slice(0, 5).map((r, i) => `${medals[i] || '▫️'} @${num(jidFor(meta, r.key))} - ${nf(r.n)}`));
      if (s.peakHour !== null) lines.push('', `🕒 *Busiest hour:* ${hourLabel(s.peakHour)}`);
      if (s.bestDay) lines.push(`📅 *Busiest day:* ${dayLabel(s.bestDay.date)} (${nf(s.bestDay.n)})`);
      const chart = spark(s.perDay.map((d) => d.n), 14);
      if (chart) lines.push(`📈 ${chart}`);
      lines.push('', `_Counting since ${stats.since(jid)}_`);
      return reply(lines.join('\n'), { mentions: s.top.slice(0, 5).map((r) => jidFor(meta, r.key)) });
    },
  },

  {
    ...base,
    name: 'catchup',
    aliases: ['missed', 'whatimissed'],
    description: 'AI summary of what you missed: catchup (admins switch it on with catchup on; the messages stay in memory only)',
    async run(ctx) {
      const { jid, args, reply, prefix } = ctx;
      const w = (args[0] || '').toLowerCase();
      if (w === 'on' || w === 'off') {
        if (!mayAdmin(ctx)) return; // not allowed: stay silent
        stats.setCatchup(jid, w === 'on');
        return reply(w === 'on'
          ? `✅ *Catchup is ON.* From now on I keep the last ${stats.CATCHUP_MAX} messages of this group *in memory only* (never saved, gone after 12 hours or a restart). Anyone can then send \`${prefix}catchup\`.`
          : '✅ *Catchup is OFF* and the messages I kept were deleted.');
      }
      if (!stats.catchupOn(jid)) return reply(`ℹ️ *Catchup is off in this group.*\nAn admin can switch it on with \`${prefix}catchup on\`. I then keep the last messages in memory only (never saved to disk).`);
      const n = Math.min(stats.CATCHUP_MAX, Math.max(10, parseInt(args.find((a) => /^\d+$/.test(a)), 10) || 100));
      const list = stats.recent(jid, n);
      if (list.length < 5) return reply('📭 *There is not much to catch up on* (I have fewer than 5 messages in memory).');
      const log = list.map((m) => `[${clock.parts(new Date(m.at)).hhmm}] ${m.who}: ${m.text}`).join('\n').slice(-6000);
      try {
        const answer = await ai.chat([{ role: 'user', content: 'Summarize the chat log for someone who was away.' }], {
          system: `CHAT LOG of a WhatsApp group (oldest first). Write 4 to 6 short bullet points starting with "•": who said or decided what, plus any question still waiting for an answer. Use the names as written. No greeting, no opinions, under 150 words.\n\n${log}`,
        });
        return reply(`📰 *While you were away* _(last ${list.length} messages)_\n\n${answer}`);
      } catch (err) {
        console.error('catchup failed:', err.message);
        return reply(`⚠️ *${ai.NAME} is not answering right now.* Please try again in a moment.`);
      }
    },
  },

  {
    ...adminBase,
    name: 'topwarned',
    aliases: ['warnboard'],
    description: 'The members with the most warnings (admins only)',
    async run({ jid, reply, groupMetadata: meta }) {
      const list = store.allWarnings(jid).sort((a, b) => b.count - a.count).slice(0, 10);
      if (!list.length) return reply('✨ *Nobody has a warning.* A clean group!');
      const max = store.getLimit ? store.getLimit(jid) : 3;
      return reply(`⚠️ *Most warnings*\n\n${list.map((w, i) => `${medals[i] || '▫️'} @${num(w.jid)} - ${w.count}/${max}`).join('\n')}`, { mentions: list.map((w) => jidFor(meta, num(w.jid))) });
    },
  },

  {
    ...base,
    name: 'swearjar',
    aliases: ['jar'],
    description: 'A jar that counts rude words: swearjar (admins: swearjar on / off / reset)',
    async run(ctx) {
      const { jid, args, reply, prefix, groupMetadata: meta } = ctx;
      const w = (args[0] || '').toLowerCase();
      if (['on', 'off', 'reset'].includes(w)) {
        if (!mayAdmin(ctx)) return; // not allowed: stay silent
        if (w === 'reset') {
          stats.resetJar(jid);
          return reply('🫙 *The jar was emptied.*');
        }
        stats.setJar(jid, w === 'on');
        return reply(w === 'on' ? `🫙 *Swear jar is ON.* I count rude words from now on (the common ones plus this group's banned words). See it with \`${prefix}swearjar\`.` : '🫙 *Swear jar is OFF.*');
      }
      if (!stats.jarOn(jid)) return reply(`🫙 *The swear jar is off.*\nAn admin can switch it on with \`${prefix}swearjar on\`.`);
      const top = stats.jarTop(jid, 8);
      if (!top.length) return reply('🫙 *The jar is empty.* What a polite group!');
      return reply(`🫙 *Swear jar* _(${nf(stats.jarTotal(jid))} words so far)_\n\n${top.map((r, i) => `${medals[i] || '▫️'} @${num(jidFor(meta, r.key))} - ${nf(r.n)}`).join('\n')}\n\n_Rude words in messages only; I never save the messages._`, { mentions: top.map((r) => jidFor(meta, r.key)) });
    },
  },

  {
    ...adminBase,
    name: 'announce',
    aliases: ['announcement', 'broadcastgroup'],
    description: 'Post a clear announcement and quietly notify everybody: announce <text> (or reply to a message)',
    async run({ sock, jid, msg, rest, reply, prefix, myJid, groupMetadata: meta }) {
      const text = (rest || quotedText(getQuoted(msg))).trim();
      if (!text) return reply(`*Usage:* \`${prefix}announce Meeting tonight at 8pm\`\n_Everybody gets a notification, without a long list of names._`);
      if (text.length > 1000) return reply(`⚠️ *That is too long* (${text.length} characters, the limit is 1000).`);
      const everyone = (meta?.participants || []).map((p) => p.id);
      await sock.sendMessage(jid, { text: `📢 *ANNOUNCEMENT*\n\n${text}\n\n_- @${num(myJid)}_`, mentions: [...new Set([...everyone, myJid])] });
    },
  },

  {
    ...adminBase,
    name: 'quiettime',
    aliases: ['nightmode'],
    botAdminRequired: true,
    description: 'Close the group every night and open it again in the morning: quiettime 22:00 06:00 (quiettime off)',
    async run({ jid, args, reply, prefix }) {
      const w = (args[0] || '').toLowerCase();
      const g = store.getGroup(jid);
      if (w === 'off') {
        store.update(jid, (grp) => {
          grp.autoMute.mute = null;
          grp.autoMute.unmute = null;
        });
        return reply('✅ *Quiet time is OFF.* The group no longer closes by itself.');
      }
      const from = clock.parseHHMM(args[0]);
      const to = clock.parseHHMM(args[1]);
      if (!from || !to || from === to) {
        const now = g.autoMute.mute && g.autoMute.unmute ? `*ON:* closed from *${g.autoMute.mute}* to *${g.autoMute.unmute}*` : '*OFF*';
        return reply(`🌙 *Quiet time* is ${now} _(${clock.zone()} time)_\n*Set it:* \`${prefix}quiettime 22:00 06:00\`\n*Stop it:* \`${prefix}quiettime off\``);
      }
      store.update(jid, (grp) => {
        grp.autoMute.mute = from;
        grp.autoMute.unmute = to;
      });
      return reply(`🌙 *Quiet time is ON.* The group closes at *${from}* and opens at *${to}* every day _(${clock.zone()} time)_.`);
    },
  },

  {
    ...adminBase,
    name: 'welcomedm',
    aliases: ['dmwelcome'],
    description: 'Send new members a private welcome with the rules: welcomedm on / off / set <text> / test (admins only)',
    async run(ctx) {
      const { sock, jid, args, rest, reply, prefix, myJid } = ctx;
      const w = (args[0] || '').toLowerCase();
      const cfg = stats.welcomeDm(jid);
      if (w === 'on' || w === 'off') {
        stats.setWelcomeDm(jid, { on: w === 'on' });
        return reply(w === 'on'
          ? `✅ *Private welcome is ON.* Every new member gets one private message from me (at most 20 an hour).\n_Keep it short and friendly: too many private messages can get a number blocked._\n*Change the text:* \`${prefix}welcomedm set <text>\` _(use {group} and {rules})_`
          : '✅ *Private welcome is OFF.*');
      }
      if (w === 'set') {
        const text = rest.slice(3).trim();
        if (!text) return reply(`*Usage:* \`${prefix}welcomedm set Hi! Welcome to {group}. {rules}\`\n_{group} is the group name, {rules} the rules of the group (see_ \`${prefix}setrules\`_)._`);
        if (text.length > 600) return reply('⚠️ *That text is too long* (the limit is 600 characters).');
        stats.setWelcomeDm(jid, { text });
        return reply('✅ *The private welcome text was saved.* Try it with `' + prefix + 'welcomedm test`');
      }
      if (w === 'test') {
        const rules = store.getGroup(jid).rules || '';
        let name = 'this group';
        try {
          name = (await require('../whatsapp/metadata').getMeta(sock, jid))?.subject || name;
        } catch (err) {
          // the name is not important
        }
        await sock.sendMessage(myJid, { text: welcomedm.render(cfg.text, { group: name, rules }) });
        return reply('📨 *I sent you the private welcome as a test.* Check our private chat.');
      }
      return reply(`💌 *Private welcome:* ${cfg.on ? 'ON' : 'OFF'}\n*Text:* ${cfg.text ? cfg.text.slice(0, 200) : '_the standard text_'}\n\n\`${prefix}welcomedm on\` / \`off\`\n\`${prefix}welcomedm set <text>\`\n\`${prefix}welcomedm test\``);
    },
  },

  {
    ...base,
    name: 'weeklyrecap',
    aliases: ['recap', 'weekrecap'],
    description: 'A recap of the last 7 days: messages, top members, busiest day (admins: weeklyrecap on posts it every Sunday)',
    async run(ctx) {
      const { jid, args, reply, prefix, groupMetadata: meta } = ctx;
      const w = (args[0] || '').toLowerCase();
      if (w === 'on' || w === 'off') {
        if (!mayAdmin(ctx)) return; // not allowed: stay silent
        for (const s of store.schedules().filter((x) => x.jid === jid && x.cmd === 'weeklyrecap')) store.removeSchedule(s.id);
        if (w === 'off') return reply('✅ *The weekly recap is OFF.*');
        const parsed = repeat.parse('weekly sun 20:00 x');
        store.addSchedule({ jid, time: parsed.time, text: `${prefix}weeklyrecap`, repeat: parsed.repeat, cmd: 'weeklyrecap' });
        return reply(`✅ *The weekly recap is ON.* I post it every Sunday at 20:00 _(${clock.zone()} time)_. Stop it with \`${prefix}weeklyrecap off\``);
      }
      const now = stats.summary(jid, 7);
      if (!now.total) return reply('📊 *No messages counted yet.* Check again in a few days.');
      const before = stats.summary(jid, 7, 1);
      const change = before.total ? Math.round(((now.total - before.total) / before.total) * 100) : null;
      const lines = [`🗓️ *Weekly recap*`, '', `💬 *Messages:* ${nf(now.total)}${change === null ? '' : ` (${change >= 0 ? '+' : ''}${change}% on the week before)`}`, `👥 *Active members:* ${nf(now.top.length)}`];
      if (now.top.length) lines.push('', '*Stars of the week*', ...now.top.slice(0, 3).map((r, i) => `${medals[i]} @${num(jidFor(meta, r.key))} - ${nf(r.n)}`));
      if (now.bestDay) lines.push('', `📅 *Busiest day:* ${dayLabel(now.bestDay.date)} (${nf(now.bestDay.n)})`);
      if (now.peakHour !== null) lines.push(`🕒 *Busiest hour:* ${hourLabel(now.peakHour)}`);
      lines.push('', `_Full numbers: ${prefix}groupstats_`);
      return reply(lines.join('\n'), { mentions: now.top.slice(0, 3).map((r) => jidFor(meta, r.key)) });
    },
  },
];
