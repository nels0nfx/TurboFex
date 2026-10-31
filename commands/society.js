// The Empire, phase 5: society. season, festival, nobility (ennoble, disgrace), guild, dungeon.
// The rules live in core/realm/{season,festival,nobility,guild,dungeon}.js. Every number is a setting God can change.
const season = require('../core/realm/season');
const festival = require('../core/realm/festival');
const nobility = require('../core/realm/nobility');
const guild = require('../core/realm/guild');
const dungeon = require('../core/realm/dungeon');
const stuff = require('../core/realm/stuff');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const civic = require('../core/realm/civic');
const ui = require('../core/realm/ui');
const { realmCommand } = require('../core/realm/cmd');
const { resolveTarget } = require('../whatsapp/utils');

const num = (words) => {
  for (const w of words) {
    const t = String(w).replace(/,/g, '');
    if (/^\d{1,12}$/.test(t)) return Number(t);
  }
  return NaN;
};
const words = (args) => args.filter((a) => !/^@/.test(a) && !/^\+?\d{7,15}$/.test(a));
const MEDAL = ['🥇', '🥈', '🥉'];

module.exports = [
  // ---------------------------------------------------------------- seasons
  realmCommand({
    name: 'season',
    aliases: ['seasons', 'champions'],
    feature: 'season',
    description: 'The season: points leaderboard, prizes and the hall of champions (season hall)',
    async run({ args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const b = season.current(group, now);
      const th = season.themeOf(b.n);
      if ((args[0] || '').toLowerCase() === 'hall') {
        const rows = season.hall(group).slice(0, 6).map((h) => `*Season ${h.n}* (${season.themeOf(h.n).icon} ${season.themeOf(h.n).name}): ${h.won.length ? h.won.map((w) => `${MEDAL[w.place - 1]} ${ui.tag(w.jid)}`).join(' ') : '_no winners_'}`);
        return reply(ui.card('🏆', 'Hall of champions', rows.length ? rows : ['No season has ended yet.']), { mentions: season.hall(group).slice(0, 6).flatMap((h) => h.won.map((w) => w.jid)) });
      }
      const top = season.board(group, 10);
      const rows = top.map((r, i) => `${MEDAL[i] || `${i + 1}.`} ${ui.tag(r.jid)} – *${r.pts}* points`);
      const mine = season.pointsOf(group, myJid);
      await reply(
        ui.card(th.icon, `Season ${b.n}: ${th.name}`, [...(rows.length ? rows : ['_Nobody has points yet._']), '', `*You:* ${mine} points${mine ? ` (place ${season.placeOf(group, myJid)})` : ''}`, `*Ends in:* ${ui.dur(Math.max(0, b.end - now))}`, `*Prizes:* ${MEDAL.map((m, i) => `${m} ${ui.fmt(season.get(`prize${i + 1}`, group))}`).join(' ')} (at least ${season.get('minPoints', group)} points)`], [`Points come from \`${prefix}daily\`, \`${prefix}work\`, guild deposits and dungeons.`, `\`${prefix}season hall\` – past champions`]),
        { mentions: top.map((r) => r.jid) }
      );
    },
  }),

  // ---------------------------------------------------------------- festivals
  realmCommand({
    name: 'festival',
    aliases: ['festivals', 'feast'],
    feature: 'festival',
    description: 'The festival: when the next one comes and what is on now',
    async run({ reply }, { group }) {
      const now = Date.now();
      const a = festival.active(group, now);
      const laws = require('../core/realm/gov').activeLaws(group, now).filter((l) => l.kind === 'pay');
      const rows = [];
      if (a) rows.push(`🎉 *${a.name}* is on: *+${a.pct}%* pay, ${ui.dur(a.until - now)} left`);
      for (const l of laws) rows.push(`${l.icon} *${l.name}* (law): ${ui.dur(l.until - now)} left`);
      const next = festival.nextAt(group);
      const every = festival.get('everyDays', group);
      if (!a) rows.push(every > 0 ? (next ? `*The next festival:* in ${ui.dur(Math.max(0, next - now))}` : `*The next festival:* about ${every} days after the realm gets busy`) : 'Festivals do not start by themselves in this realm.');
      rows.push('', `*How it works:* every ${every || '–'} days, for ${festival.get('hours', group)} hours, everybody earns +${festival.get('payPct', group)}%.`);
      await reply(ui.card('🎉', 'Festivals', rows));
    },
  }),

  // ---------------------------------------------------------------- nobility
  realmCommand({
    name: 'nobility',
    aliases: ['nobles', 'titles', 'peerage'],
    feature: 'nobility',
    description: 'The nobles of the realm and what each title gives',
    async run({ reply, prefix }, { group }) {
      const now = Date.now();
      const list = nobility.list(group, now);
      const rows = list.map((n) => `${n.title.icon} *${n.title.name}* ${ui.tag(n.jid)} – ${ui.dur(n.until - now)} left`);
      const guide = nobility.TITLES.map((t) => `${t.icon} ${t.name}: +${nobility.perk(group, t.id)}% pay • ${nobility.holders(group, t.id, now).length}/${nobility.get(`seats_${t.id}`, group)} seats`);
      await reply(ui.card('⚜️', 'The nobility', [...(rows.length ? rows : ['_There are no nobles._']), '', '*The titles*', ...guide, '', `A title lasts ${nobility.get('days', group)} days.`], [`The Sovereign: \`${prefix}ennoble @user baron\` • \`${prefix}disgrace @user\``]), { mentions: list.map((n) => n.jid) });
    },
  }),
  realmCommand({
    name: 'ennoble',
    aliases: ['knight', 'noble'],
    feature: 'nobility',
    description: 'The Sovereign gives a noble title: ennoble @user knight / baron / count / duke',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const target = resolveTarget(msg, args);
      const t = words(args).map((w) => nobility.byId(w)).find(Boolean);
      if (!target || !t) return reply(ui.card('⚜️', 'Give a title', nobility.TITLES.map((x) => `${x.icon} *${x.name}* – costs the treasury ${ui.fmt(nobility.get(`cost_${x.id}`, group))}`), [`\`${prefix}ennoble @user baron\``], 'Only the Sovereign can give titles.'));
      const r = nobility.grant(group, myJid, target, t.id);
      if (!r.ok) {
        const m = { rights: ui.warn('Only the Sovereign can give titles.'), self: ui.warn('You cannot ennoble yourself.'), god: ui.warn('God needs no title.'), stranger: ui.warn('That person is not a citizen yet.'), full: ui.warn(`All ${r.seats} ${t.name} seats are taken.`), poor: ui.warn(`The treasury has ${ui.money(r.have || 0)}; the ${t.name} title costs ${ui.money(r.cost || 0)}.`) }[r.why];
        return reply(m || ui.warn('That did not work.'));
      }
      await reply(ui.card('⚜️', r.renewed ? 'Title renewed' : 'A new noble', [`${r.title.icon} ${ui.tag(target)} is now a *${r.title.name}*.`, `*Pay bonus:* +${nobility.perk(group, r.title.id)}% • *Lasts:* ${r.days} days`, r.cost ? `*Paid by the treasury:* ${ui.money(r.cost)}` : ''].filter(Boolean)), { mentions: [target] });
    },
  }),
  realmCommand({
    name: 'disgrace',
    aliases: ['unnoble'],
    feature: 'nobility',
    description: 'The Sovereign takes a noble title away: disgrace @user',
    async run({ msg, args, reply, myJid }, { group }) {
      const target = resolveTarget(msg, args);
      if (!target) return reply(ui.warn('Name the noble: disgrace @user'));
      const r = nobility.strip(group, myJid, target);
      if (!r.ok) return reply(r.why === 'rights' ? ui.warn('Only the Sovereign can take a title away.') : ui.info('That person has no title.'));
      await reply(ui.card('⚜️', 'Title taken', [`${ui.tag(target)} is no longer a ${r.title.name}.`]), { mentions: [target] });
    },
  }),

  // ---------------------------------------------------------------- guilds
  realmCommand({
    name: 'guild',
    aliases: ['guilds', 'clan'],
    feature: 'guild',
    description: 'Guilds: guild, guild create Name, guild invite @user, guild join Name, guild deposit 100, guild upgrade, guild leave, guild kick @user, guild top',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const sub = (args[0] || '').toLowerCase();
      const rest = args.slice(1);
      const wrong = (r, extra = {}) => ({
        member: ui.warn('You are in a guild already (`guild leave` first).'),
        name: ui.warn(`Choose a name of at least 3 letters: \`${prefix}guild create Iron Wolves\``),
        taken: ui.warn('There is a guild with that name.'),
        full: ui.warn(r.cap ? `That guild is full (${r.cap} members at its level).` : `The realm has ${r.max} guilds already.`),
        poor: ui.warn(r.cost ? `A guild costs ${ui.money(r.cost)}.` : 'You do not have enough.'),
        none: ui.info('You are not in a guild.'),
        rights: ui.warn('Only the guild leader can do that.'),
        stranger: ui.warn('That person is not a citizen yet.'),
        unknown: ui.warn(`I do not know that guild. See \`${prefix}guild top\`.`),
        invite: ui.warn(`${r.guild ? `*${r.guild.name}* has` : 'That guild has'} not invited you. Ask the leader to \`${prefix}guild invite @you\`.`),
        self: ui.warn('You cannot do that to yourself.'),
        amount: ui.warn(`Write an amount: \`${prefix}guild deposit 100\``),
        max: ui.info('The guild is at its highest level.'),
        ...extra,
      }[r.why] || ui.warn('That did not work.'));

      if (sub === 'create' || sub === 'found') {
        const r = guild.create(group, myJid, words(rest).join(' '));
        if (!r.ok) return reply(wrong(r));
        return reply(ui.card('🛡️', `Guild founded: ${r.guild.name}`, [`${ui.tag(myJid)} is the leader.`, r.cost ? `*Cost:* ${ui.money(r.cost)}` : '', `*Members:* up to ${guild.cap(group, r.guild)}`].filter(Boolean), [`\`${prefix}guild invite @user\` – invite someone`, `\`${prefix}guild deposit 100\` – fill the guild bank`]), { mentions: [myJid] });
      }
      if (sub === 'invite') {
        const target = resolveTarget(msg, rest);
        if (!target) return reply(ui.warn('Name the person: guild invite @user'));
        const r = guild.invite(group, myJid, target);
        if (!r.ok) return reply(wrong(r));
        return reply(ui.card('🛡️', 'Invitation sent', [`${ui.tag(target)} is invited to *${r.guild.name}* for 24 hours.`], [`They answer with \`${prefix}guild join ${r.guild.name}\``]), { mentions: [target] });
      }
      if (sub === 'join') {
        const r = guild.join(group, myJid, words(rest).join(' '));
        if (!r.ok) return reply(wrong(r));
        return reply(ui.card('🛡️', 'You joined', [`${ui.tag(myJid)} is now in *${r.guild.name}*.`, `*Members:* ${guild.sizeOf(r.guild)} / ${guild.cap(group, r.guild)} • *Pay bonus:* +${guild.bonusOf(group, r.guild)}%`]), { mentions: [myJid] });
      }
      if (sub === 'leave') {
        const r = guild.leave(group, myJid);
        if (!r.ok) return reply(wrong(r));
        return reply(ui.card('🛡️', r.disbanded ? 'The guild is gone' : 'You left', [r.disbanded ? `*${r.guild.name}* had no one left. The bank was paid out.` : `You left *${r.guild.name}*.`, r.newLeader ? `The new leader is ${ui.tag(r.newLeader)}.` : ''].filter(Boolean)), { mentions: r.newLeader ? [r.newLeader] : [] });
      }
      if (sub === 'kick') {
        const target = resolveTarget(msg, rest);
        if (!target) return reply(ui.warn('Name the member: guild kick @user'));
        const r = guild.kick(group, myJid, target);
        if (!r.ok) return reply(wrong(r, { none: ui.info('That person is not in your guild.') }));
        return reply(ui.card('🛡️', 'Removed', [`${ui.tag(target)} was removed from *${r.guild.name}*.`]), { mentions: [target] });
      }
      if (sub === 'deposit' || sub === 'bank') {
        const r = guild.deposit(group, myJid, num(rest));
        if (!r.ok) return reply(wrong(r));
        return reply(ui.card('🛡️', 'Deposited', [`*Into the guild bank:* ${ui.money(r.put)}${r.tax ? ` _(${ui.fmt(r.tax)} went to the treasury)_` : ''}`, `*Guild bank now:* ${ui.money(r.guild.bank)}`, `*Next level costs:* ${ui.money(guild.upgradeCost(group, r.guild))}`]));
      }
      if (sub === 'upgrade' || sub === 'levelup') {
        const r = guild.upgrade(group, myJid);
        if (!r.ok) return reply(wrong(r, { poor: ui.warn(`The guild bank has ${ui.money(r.have || 0)}; the next level costs ${ui.money(r.cost || 0)}.`) }));
        return reply(ui.card('🛡️', `${r.guild.name} is level ${r.guild.level}!`, [`*Pay bonus for every member:* +${guild.bonusOf(group, r.guild)}%`, `*Members up to:* ${guild.cap(group, r.guild)}`, `*Spent:* ${ui.money(r.cost)}`]));
      }
      if (sub === 'top' || sub === 'list') {
        const rows = guild.top(group, 10).map((g, i) => `${MEDAL[i] || `${i + 1}.`} *${g.name}* – level ${g.level} • ${guild.sizeOf(g)} members • bank ${ui.fmt(g.bank)}`);
        return reply(ui.card('🛡️', 'The guilds', rows.length ? rows : ['No guilds yet.'], [`\`${prefix}guild create Name\` – found one (${ui.money(guild.get('createCost', group))})`]));
      }
      // a guild: mine, or the one named
      const g = words(args).length ? guild.find(group, words(args).join(' ')) : guild.guildOf(group, myJid);
      if (!g) {
        return reply(ui.card('🛡️', words(args).length ? 'No such guild' : 'You are not in a guild', [], [`\`${prefix}guild top\` • \`${prefix}guild create Name\` (${ui.money(guild.get('createCost', group))})`]));
      }
      const members = Object.values(g.members).map((m) => m.jid);
      await reply(ui.card('🛡️', `${g.name}`, [`*Leader:* ${ui.tag(g.leader)}`, `*Level:* ${g.level} / ${guild.get('maxLevel', group)} • *Pay bonus:* +${guild.bonusOf(group, g)}%`, `*Members:* ${guild.sizeOf(g)} / ${guild.cap(group, g)}`, ...members.slice(0, 12).map((m) => `• ${ui.tag(m)}`), `*Bank:* ${ui.money(g.bank)}`, g.level < guild.get('maxLevel', group) ? `*Next level:* ${ui.money(guild.upgradeCost(group, g))}` : '*Highest level.*'], [`\`${prefix}guild deposit 100\` • \`${prefix}guild upgrade\` (leader)`]), { mentions: members.slice(0, 12) });
    },
  }),

  // ---------------------------------------------------------------- dungeons
  realmCommand({
    name: 'dungeon',
    aliases: ['dungeons', 'raid', 'expedition'],
    feature: 'dungeon',
    description: 'Dungeons: dungeon lists them, dungeon open crypt starts an expedition, dungeon join, dungeon leave',
    async run({ args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const sub = (args[0] || '').toLowerCase();
      const wrong = (r) => ({
        unknown: ui.warn(`Choose: ${dungeon.DUNGEONS.map((d) => d.id).join(', ')}`),
        busy: ui.info('You are in an expedition already.'),
        full: ui.warn(r.max ? `Only ${r.max} can go.` : 'That is full.'),
        rest: ui.wait('Your party is still resting.', r.waitMs || 0),
        poor: ui.warn(`The entry fee is ${ui.money(r.fee || 0)}.`),
        none: ui.info(`There is no open expedition. \`${prefix}dungeon open crypt\` starts one.`),
      }[r.why] || ui.warn('That did not work.'));

      if (sub === 'open' || sub === 'start') {
        const r = dungeon.openRun(group, myJid, args[1], now);
        if (!r.ok) return reply(wrong(r));
        return reply(ui.card(r.dungeon.icon, `Expedition #${r.run.id}: ${r.dungeon.name}`, [`${ui.tag(myJid)} is gathering a party.`, `*Entry fee:* ${ui.money(r.fee)} (each)`, `*Goes in:* ${ui.dur(r.run.goes - now)}`, `*Chance now:* ${dungeon.odds(group, r.run).toFixed(0)}% • *Needs at least:* ${dungeon.get(`min_${r.dungeon.id}`, group)} people`], [`\`${prefix}dungeon join\` – join the party`]), { mentions: [myJid] });
      }
      if (sub === 'join') {
        const r = dungeon.joinRun(group, myJid, parseInt(args[1], 10) || null, now);
        if (!r.ok) return reply(wrong(r));
        return reply(ui.card(r.dungeon.icon, 'You joined the party', [`${ui.tag(myJid)} joins expedition #${r.run.id} (${r.dungeon.name}).`, `*Party:* ${r.size} • *Chance now:* ${r.odds.toFixed(0)}%`, `*Fee paid:* ${ui.money(r.fee)}`]), { mentions: [myJid] });
      }
      if (sub === 'leave') {
        const r = dungeon.leaveRun(group, myJid);
        if (!r.ok) return reply(wrong(r));
        return reply(ui.card('🚪', 'You left the party', [r.back ? `*Fee back:* ${ui.money(r.back)}` : 'The fee was not paid back (the treasury is empty).']));
      }
      const rows = dungeon.DUNGEONS.map((d) => `${d.icon} *${d.name}* (\`${d.id}\`) – fee ${ui.fmt(dungeon.get(`fee_${d.id}`, group))} • ${dungeon.get(`odds_${d.id}`, group)}% • loot ${ui.fmt(dungeon.get(`loot_${d.id}`, group))} • party of ${dungeon.get(`min_${d.id}`, group)}+`);
      const openRuns = dungeon.open(group).map((r) => `*#${r.id}* ${dungeon.byId(r.dungeon).icon} ${dungeon.byId(r.dungeon).name} – ${Object.keys(r.party).length} in the party • goes in ${ui.dur(Math.max(0, r.goes - now))}`);
      const rest = A.cooldownLeft(group, myJid, 'dungeon', dungeon.get('restMinutes', group) * 60000, now);
      await reply(ui.card('🐉', 'Dungeons', [...rows, ...(openRuns.length ? ['', '*Open expeditions*', ...openRuns] : []), rest > 0 && !dungeon.runOf(group, myJid) ? `\n⏳ Your party rests for ${ui.dur(rest)}.` : ''].filter((x) => x !== ''), [`\`${prefix}dungeon open crypt\` • \`${prefix}dungeon join\` • \`${prefix}dungeon leave\``], 'A bigger party has a better chance. A loss costs the entry fee.'));
    },
  }),
];
