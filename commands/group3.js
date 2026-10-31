// More group tools (v0.9.3): listonline, newmembers, staff, nickname, kickall, kicklist
const store = require('../whatsapp/store');
const names = require('../whatsapp/names');
const nicks = require('../whatsapp/nicknames');
const joined = require('../whatsapp/joined');
const recent = require('../whatsapp/recent');
const meta = require('../whatsapp/metadata');
const clock = require('../core/clock');
const config = require('../config');
const { getTargets, num, participantIds } = require('../whatsapp/utils');

const base = { category: 'group', groupOnly: true, needs: [], weight: 'light' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A name for a person that does NOT tag them (so a long list does not send a notification to everybody)
const who = (group, jid) => nicks.get(group, jid) || names.get(jid) || names.phoneOf(jid) || 'A member';
const ago = (ms) => (ms < 60000 ? 'just now' : `${clock.duration(ms)} ago`);

// who the bulk commands must never remove: me, the bot owner, sudo users
function protectedNumbers(botIds) {
  const list = [...botIds, ...store.getSudo()];
  if (config.ownerNumber) list.push(String(config.ownerNumber).replace(/\D/g, ''));
  return list.filter(Boolean);
}
const isAdminP = (p) => p.admin === 'admin' || p.admin === 'superadmin';

// kickall waits for a "confirm" for 60 seconds. Kept in memory on purpose: a restart cancels it.
const pending = new Map(); // group -> { by: [numbers], at, targets: [jid] }
const CONFIRM_MS = 60 * 1000;
const MAX_BULK = 200;

async function removeInBatches(sock, jid, targets) {
  let done = 0;
  for (let i = 0; i < targets.length; i += 10) {
    const part = targets.slice(i, i + 10);
    try {
      const res = await sock.groupParticipantsUpdate(jid, part, 'remove');
      done += (Array.isArray(res) ? res : []).filter((r) => String(r.status) === '200').length;
    } catch (err) {
      // this batch failed: go on with the next one
    }
    if (i + 10 < targets.length) await sleep(1500); // WhatsApp does not like fast removals
  }
  meta.invalidate(jid);
  return done;
}

module.exports = [
  {
    ...base,
    name: 'listonline',
    aliases: ['whoisonline', 'activenow'],
    description: 'Who wrote in the group in the last few minutes: listonline or listonline 30 (minutes)',
    async run({ jid, args, reply }) {
      const mins = Math.min(120, Math.max(1, parseInt(args[0], 10) || 10));
      const list = recent.within(jid, mins);
      if (!list.length) {
        return reply(`😴 *Nobody has written in the last ${mins} minute${mins === 1 ? '' : 's'}* (that I saw).\n_WhatsApp does not tell bots who is online, so I go by who is chatting._`);
      }
      const now = Date.now();
      const shown = list.slice(0, 40);
      const lines = shown.map((x, i) => `${i + 1}. ${who(jid, x.id)} - ${ago(now - x.at)}`);
      const more = list.length > shown.length ? `\n...and ${list.length - shown.length} more` : '';
      return reply(`🟢 *Active in the last ${mins} min* (${list.length})\n\n${lines.join('\n')}${more}\n\n_WhatsApp does not tell bots who is online, so this shows who wrote a message. It starts empty after a restart._`);
    },
  },
  {
    ...base,
    name: 'newmembers',
    aliases: ['recentjoins', 'newjoins'],
    description: 'Who joined the group lately: newmembers or newmembers 14 (days)',
    async run({ jid, args, reply }) {
      const days = Math.min(60, Math.max(1, parseInt(args[0], 10) || 7));
      const list = joined.recent(jid, days);
      if (!list.length) {
        return reply(`🆕 *Nobody new in the last ${days} day${days === 1 ? '' : 's'}* (that I saw).\n_I only know about people who joined while I was in the group._`);
      }
      const now = Date.now();
      const shown = list.slice(0, 40);
      const lines = shown.map((x, i) => `${i + 1}. ${who(jid, x.id)} - joined ${ago(now - x.at)}`);
      const more = list.length > shown.length ? `\n...and ${list.length - shown.length} more` : '';
      return reply(`🆕 *New members, last ${days} day${days === 1 ? '' : 's'}* (${list.length})\n\n${lines.join('\n')}${more}\n\n_Only people who joined while I was in the group are listed._`);
    },
  },
  {
    ...base,
    name: 'staff',
    aliases: ['team', 'adminlist'],
    description: 'The people in charge: the bot owner, helpers (sudo) and the group admins',
    async run({ sock, jid, reply, groupMetadata }) {
      const info = (await meta.getMeta(sock, jid).catch(() => null)) || groupMetadata;
      const people = info?.participants || [];
      const find = (n) => people.find((p) => participantIds(p).includes(n));
      const lineFor = (n) => {
        const p = find(n);
        return p ? who(jid, p.id) : names.get(`${n}@s.whatsapp.net`) || `+${n}`;
      };
      const out = [];
      const owner = config.ownerNumber ? String(config.ownerNumber).replace(/\D/g, '') : '';
      if (owner) out.push(`👑 *Bot owner*\n${lineFor(owner)}`);
      const sudo = store.getSudo().filter((n) => n && n !== owner);
      if (sudo.length) out.push(`🛠️ *Helpers (sudo)*\n${sudo.slice(0, 20).map((n) => `▸ ${lineFor(n)}`).join('\n')}`);
      const admins = people.filter(isAdminP);
      if (admins.length) {
        const shown = admins.slice(0, 40);
        out.push(`🛡️ *Group admins* (${admins.length})\n${shown.map((p) => `▸ ${who(jid, p.id)}${p.admin === 'superadmin' ? ' (creator)' : ''}`).join('\n')}${admins.length > shown.length ? `\n...and ${admins.length - shown.length} more` : ''}`);
      }
      if (!out.length) return reply('⚠️ I could not find the admins of this group.');
      return reply(`⭐ *Staff*\n\n${out.join('\n\n')}`);
    },
  },
  {
    ...base,
    name: 'nickname',
    aliases: ['nick', 'setnick'],
    description: 'Choose a nickname for this group (shown in rank and top): nickname Boss, nickname reset, nickname list',
    async run({ jid, msg, args, rest, reply, prefix, isAdmin, isOwner, myJid }) {
      const myNumbers = [myJid].filter(Boolean);
      const target = resolveTargetFromTags(msg);
      // an admin can set or reset the nickname of somebody else: nickname @person Name / nickname @person reset
      const forOther = !!target && !myNumbers.some((m) => num(m) === num(target));
      if (forOther && !isAdmin && !isOwner) return; // not allowed: stay silent
      const who2 = forOther ? target : myJid;
      const words = rest.replace(/@\d{5,}/g, '').replace(/\s+/g, ' ').trim();

      if (!forOther && words.toLowerCase() === 'list') {
        const all = nicks.all(jid);
        if (!all.length) return reply(`📛 *No nicknames yet.*\nChoose yours: ${prefix}nickname Boss`);
        const lines = all.slice(0, 40).map(([, v], i) => `${i + 1}. ${v}`);
        return reply(`📛 *Nicknames in this group* (${all.length})\n\n${lines.join('\n')}${all.length > 40 ? `\n...and ${all.length - 40} more` : ''}`);
      }
      if (!words) {
        const mine = nicks.get(jid, who2);
        return reply(
          mine
            ? `📛 ${forOther ? 'Their' : 'Your'} nickname here is *${mine}*.\nChange it: ${prefix}nickname NewName\nRemove it: ${prefix}nickname reset`
            : `📛 *No nickname yet.*\nChoose one (up to ${nicks.MAX_LEN} letters): ${prefix}nickname Boss`
        );
      }
      if (['reset', 'remove', 'clear', 'off'].includes(words.toLowerCase())) {
        return reply(nicks.remove(jid, who2) ? `✅ Nickname removed.` : `📛 ${forOther ? 'They have' : 'You have'} no nickname to remove.`);
      }
      const cleaned = nicks.clean(words);
      if (!cleaned) return reply(`⚠️ That nickname cannot be used. Use letters, numbers or emojis.\nExample: ${prefix}nickname Boss`);
      if (words.length > nicks.MAX_LEN) return reply(`⚠️ That nickname is too long. Please use ${nicks.MAX_LEN} characters or fewer.`);
      if (nicks.taken(jid, who2, cleaned)) return reply('⚠️ Somebody here already uses that nickname. Please choose another one.');
      nicks.set(jid, who2, cleaned);
      return reply(`✅ ${forOther ? 'Nickname' : 'Your nickname'} is now *${cleaned}*.\n_It shows in rank and top._`);
    },
  },
  {
    ...base,
    name: 'kickall',
    aliases: ['removeall'],
    adminOnly: true,
    botAdminRequired: true,
    description: 'Remove every member who is not an admin (needs a confirm step): kickall, then kickall confirm',
    async run({ sock, jid, args, reply, prefix, myIds, botIds, groupMetadata }) {
      const word = (args[0] || '').toLowerCase();
      const mine = (myIds || []).map(String);

      if (word === 'cancel') {
        return reply(pending.delete(jid) ? '✅ Cancelled. Nobody was removed.' : 'There is nothing waiting to be confirmed.');
      }

      if (word === 'confirm') {
        const p = pending.get(jid);
        if (!p || Date.now() - p.at > CONFIRM_MS) {
          pending.delete(jid);
          return reply(`⌛ Nothing is waiting, or the 60 seconds are over.\nStart again with ${prefix}kickall`);
        }
        if (!p.by.some((n) => mine.includes(n))) return; // only the admin who asked can confirm: stay silent for others
        pending.delete(jid);
        // check again: somebody may have been promoted since
        const now = (await meta.getMeta(sock, jid).catch(() => null)) || groupMetadata;
        const keep = protectedNumbers(botIds);
        const targets = (now?.participants || [])
          .filter((x) => !isAdminP(x) && !participantIds(x).some((n) => keep.includes(n)))
          .map((x) => x.id)
          .slice(0, MAX_BULK);
        if (!targets.length) return reply('✅ There is nobody to remove.');
        await reply(`⏳ Removing ${targets.length} member${targets.length === 1 ? '' : 's'}... this takes a moment.`);
        const done = await removeInBatches(sock, jid, targets);
        if (done === targets.length) return reply(`✅ Removed *${done}* member${done === 1 ? '' : 's'}. Admins were not touched.`);
        if (done > 0) return reply(`⚠️ Removed *${done}* of ${targets.length}. Some could not be removed.`);
        return reply('⚠️ I could not remove anybody. Please check that I am still an admin.');
      }

      const keep = protectedNumbers(botIds);
      const targets = (groupMetadata?.participants || []).filter((x) => !isAdminP(x) && !participantIds(x).some((n) => keep.includes(n)));
      if (!targets.length) return reply('✅ There are no ordinary members to remove. Only admins are left.');
      pending.set(jid, { by: mine, at: Date.now() });
      const capped = targets.length > MAX_BULK ? `\n_(${MAX_BULK} at a time. Run it again for the rest.)_` : '';
      return reply(
        `⚠️ *This will remove ${Math.min(targets.length, MAX_BULK)} member${targets.length === 1 ? '' : 's'}* (everybody who is not an admin).${capped}\n\n` +
          `To go ahead within 60 seconds, send:\n*${prefix}kickall confirm*\nTo stop: ${prefix}kickall cancel`
      );
    },
  },
  {
    ...base,
    name: 'kicklist',
    aliases: ['kickmany', 'removemany'],
    adminOnly: true,
    botAdminRequired: true,
    description: 'Remove several people at once: kicklist @a @b @c (or phone numbers). Admins are skipped',
    async run({ sock, jid, msg, args, reply, prefix, botIds, groupMetadata }) {
      const tagged = getTargets(msg);
      const typed = args.map((a) => String(a).replace(/\D/g, '')).filter((d) => d.length >= 7 && d.length <= 15).map((d) => `${d}@s.whatsapp.net`);
      const wanted = [...new Set([...tagged, ...typed])];
      if (!wanted.length) {
        return reply(`Tag the people, or type their numbers.\nExample: ${prefix}kicklist @person1 @person2 @person3`);
      }
      const keep = protectedNumbers(botIds);
      const people = groupMetadata?.participants || [];
      const found = [];
      let skipped = 0;
      for (const w of wanted) {
        const p = people.find((x) => participantIds(x).includes(num(w)));
        if (!p) {
          skipped++;
          continue;
        }
        if (isAdminP(p) || participantIds(p).some((n) => keep.includes(n))) {
          skipped++;
          continue;
        }
        if (!found.includes(p.id)) found.push(p.id);
      }
      if (!found.length) return reply('⚠️ There is nobody I can remove from that list (admins, the owner, and people who are not in this group are skipped).');
      const targets = found.slice(0, 50);
      const done = await removeInBatches(sock, jid, targets);
      const note = skipped ? `\n_${skipped} skipped (admins, the owner, or not in this group)._` : '';
      if (done === targets.length) return reply(`✅ Removed *${done}* member${done === 1 ? '' : 's'}.${note}`);
      if (done > 0) return reply(`⚠️ Removed *${done}* of ${targets.length}. Some could not be removed.${note}`);
      return reply('⚠️ I could not remove anybody. The people may have left already, or I am not an admin.');
    },
  },
];

// the tagged person (or the person whose message was replied to), if any
function resolveTargetFromTags(msg) {
  return getTargets(msg)[0] || null;
}
