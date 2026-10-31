// The words around God's acts in government and society (see godplus.js). handle() returns true when it dealt with the command.
const P = require('./godplus');
const ui = require('./ui');
const A = require('./aurum');
const S = require('./state');
const gov = require('./gov');
const court = require('./court');
const season = require('./season');
const nobility = require('./nobility');
const guild = require('./guild');
const dungeon = require('./dungeon');
const { resolveTarget } = require('../../whatsapp/utils');

const SUBS = ['crown', 'dethrone', 'officer', 'election', 'law', 'jail', 'pardon', 'treasury', 'tax', 'court', 'title', 'festival', 'season', 'guild', 'dungeon', 'clearstate'];
const isNum = (t) => /^@?\+?\d{7,15}$/.test(t);
const nums = (args) => args.filter((a) => /^-?\d+(\.\d+)?$/.test(String(a).replace(/,/g, '')) && !isNum(a)).map((a) => Number(String(a).replace(/,/g, '')));
const lc = (a) => String(a || '').toLowerCase();

const HELP = (p) => [
  '*Government* (God never rules, but can fix anything)',
  `\`${p}god crown @user\` • \`${p}god dethrone\` • \`${p}god officer treasurer @user\` (or \`none\`)`,
  `\`${p}god election start|end|cancel\` • \`${p}god law festival on|off\``,
  `\`${p}god jail @user 30\` • \`${p}god pardon @user|all\``,
  `\`${p}god treasury set|add|take 1000\` • \`${p}god tax 5\``,
  `\`${p}god court list|end 3|overturn 3|clear @user\``,
  '*Society*',
  `\`${p}god title @user baron\` (or \`none\`) • \`${p}god festival start|stop\``,
  `\`${p}god season end|days 10|points @user 50\``,
  `\`${p}god guild list|disband 2|level 2 5|bank 2 1000|kick 2 @user|leader 2 @user\``,
  `\`${p}god dungeon list|call 3\``,
  `\`${p}god clearstate government|court|season|festival|nobility|guild|dungeon confirm\` – clear a feature's state`,
];

async function handle(ctx, env) {
  const { msg, args, reply, prefix } = ctx;
  const { sub, group, announce, needRealm, nameOf } = env;
  if (!SUBS.includes(sub)) return false;
  if (!group) {
    await needRealm();
    return true;
  }
  const rest = args.slice(1);
  const target = resolveTarget(msg, rest);
  const who = target ? { mentions: [target] } : {};
  const tagLine = (t) => ui.tag(t);
  const fail = (text) => reply(ui.warn(text));
  const WHY = { stranger: 'That person is not a citizen of this realm yet.', god: 'God cannot be given or taken this.', busy: 'That person holds another office.', office: 'Offices: treasurer, marshal, steward.', unknown: 'I do not know that one.', minutes: 'Minutes must be 1 or more.' };

  if (sub === 'crown') {
    if (!target) return fail(`Name the citizen: \`${prefix}god crown @user\``), true;
    const r = P.crown(group, target);
    if (!r.ok) return fail(WHY[r.why] || 'That did not work.'), true;
    await announce(ctx, group, `👑 ${tagLine(target)} is crowned *Sovereign*.`, [target]);
    return reply(ui.card('👑', 'Crowned', [`${tagLine(target)} is the Sovereign (a new full term).`]), who), true;
  }
  if (sub === 'dethrone') {
    const r = P.dethrone(group);
    if (!r.ok) return reply(ui.info('There is no Sovereign.')), true;
    await announce(ctx, group, `👑 The Sovereign ${tagLine(r.was.jid)} was removed. The seat is vacant.`, [r.was.jid]);
    return reply(ui.card('👑', 'Dethroned', [`${tagLine(r.was.jid)} is no longer the Sovereign. The officers were dismissed.`], [`\`${prefix}god election start\` – open an election`]), { mentions: [r.was.jid] }), true;
  }
  if (sub === 'officer') {
    const office = gov.OFFICES.find((o) => lc(o.id) === lc(rest[0]));
    if (!office) return fail('Choose: treasurer, marshal or steward.'), true;
    const none = lc(rest[1]) === 'none';
    if (!none && !target) return fail(`\`${prefix}god officer ${office.id} @user\` or \`none\``), true;
    const r = P.officer(group, office.id, none ? null : target);
    if (!r.ok) return fail(WHY[r.why] || 'That did not work.'), true;
    if (!none) await announce(ctx, group, `${office.icon} ${tagLine(target)} is the new *${office.name}*.`, [target]);
    return reply(ui.card(office.icon, office.name, [none ? 'The office is empty.' : `${tagLine(target)} is the ${office.name}.`]), who), true;
  }
  if (sub === 'election') {
    const how = lc(rest[0]);
    if (!['start', 'end', 'cancel'].includes(how)) return reply(ui.card('🗳️', 'Election', [], [`\`${prefix}god election start\` • \`end\` (count now) • \`cancel\``])), true;
    const r = P.election(group, how);
    if (!r.ok) return reply(ui.info(r.why === 'running' ? 'An election is open already.' : 'There is no election.')), true;
    if (how === 'start') await announce(ctx, group, `🗳️ An election is open. \`election\` shows it.`);
    if (how === 'end' && r.result && r.result.winner) await announce(ctx, group, `👑 ${tagLine(r.result.winner.jid)} won the election.`, [r.result.winner.jid]);
    return reply(ui.card('🗳️', how === 'start' ? 'Election opened' : how === 'end' ? 'Election counted' : 'Election cancelled', [how === 'end' ? (r.result && r.result.winner ? `Winner: ${tagLine(r.result.winner.jid)}` : 'Nobody won. The seat is vacant.') : ' '].filter((x) => x.trim()))), true;
  }
  if (sub === 'law') {
    const base = gov.lawById(rest.filter((a) => !/^(on|off)$/i.test(a)).join(' '));
    if (!base) return reply(ui.card('📜', 'Laws', gov.LAWS.map((l) => `${l.icon} *${l.id}* – ${l.name}`), [`\`${prefix}god law festival on\` (free) • \`${prefix}god law festival off\``])), true;
    const on = lc(rest[rest.length - 1]) !== 'off';
    const r = P.law(group, base.id, on);
    if (!on) return reply(r.ok ? ui.card('📜', 'Law repealed', [`${base.icon} ${base.name} is no longer in force.`]) : ui.info('That law is not in force.')), true;
    if (!r.ok) return fail(r.why === 'active' ? 'That law is in force already.' : WHY[r.why] || 'That did not work.'), true;
    await announce(ctx, group, `📜 ${base.icon} *${base.name}* is now law.`);
    return reply(ui.card('📜', 'Law enacted', [`${base.icon} *${base.name}* (no cost to the treasury)`, base.id === 'levy' ? `*Collected:* ${ui.money(r.collected || 0)}` : '', base.id === 'amnesty' ? `*Freed:* ${r.freed}` : ''].filter(Boolean))), true;
  }
  if (sub === 'jail') {
    if (!target) return fail(`\`${prefix}god jail @user 30\``), true;
    const r = P.jail(group, target, nums(rest)[0] || 30);
    if (!r.ok) return fail(WHY[r.why] || 'That did not work.'), true;
    await announce(ctx, group, `⛓️ ${tagLine(target)} was jailed.`, [target]);
    return reply(ui.card('⛓️', 'Jailed', [`${tagLine(target)} for ${nums(rest)[0] || 30} minutes.`]), who), true;
  }
  if (sub === 'pardon') {
    const all = lc(rest[0]) === 'all';
    if (!all && !target) return fail(`\`${prefix}god pardon @user\` or \`all\``), true;
    const r = P.pardon(group, all ? 'all' : target);
    if (!r.ok && !r.count) return reply(ui.info('Nobody to free.')), true;
    await announce(ctx, group, all ? '🕊️ Every prisoner is free.' : `🕊️ ${tagLine(target)} is free.`, all ? [] : [target]);
    return reply(ui.card('🕊️', 'Freed', [all ? `${r.count} prisoners.` : tagLine(target)]), who), true;
  }
  if (sub === 'treasury') {
    const how = lc(rest[0]);
    const n = nums(rest.slice(1))[0];
    if (!['set', 'add', 'take'].includes(how) || n === undefined) return reply(ui.card('🏺', 'Treasury', [`*Now:* ${ui.money(A.treasury(group))}`], [`\`${prefix}god treasury set|add|take 1000\``])), true;
    const r = P.treasury(group, how, n);
    if (!r.ok) return fail('The amount must be 0 or more.'), true;
    return reply(ui.card('🏺', 'Treasury changed', [`${ui.money(r.before)} → *${ui.money(r.now)}*`])), true;
  }
  if (sub === 'tax') {
    const n = nums(rest)[0];
    if (n === undefined) return reply(ui.card('🧾', 'Income tax', [`*Now:* ${require('./civic').taxRate(group)}%`], [`\`${prefix}god tax 5\` (this ignores the cap the Treasurer has)`])), true;
    const r = P.tax(group, n);
    if (!r.ok) return fail('The tax is 0 to 100%.'), true;
    await announce(ctx, group, `🧾 The income tax is now ${r.now}%.`);
    return reply(ui.card('🧾', 'Tax set', [`${r.before}% → *${r.now}%*`])), true;
  }
  if (sub === 'court') {
    const how = lc(rest[0]);
    const id = nums(rest.slice(1))[0];
    if (how === 'end' && id) {
      const r = P.courtEnd(group, id);
      if (!r.ok) return fail('There is no open case with that number.'), true;
      return reply(ui.card('⚖️', `Case #${id} closed`, [`Verdict: *${r.result.verdict}*`])), true;
    }
    if (how === 'overturn' && id) {
      const r = P.courtOverturn(group, id);
      if (!r.ok) return fail('That case has no guilty verdict to overturn.'), true;
      await announce(ctx, group, `⚖️ The verdict of case #${id} was overturned.`, [r.case.defendant]);
      return reply(ui.card('⚖️', 'Verdict overturned', [`Case #${id}: the fine (${ui.fmt(r.returned)}) is back, the jail is over.`]), { mentions: [r.case.defendant] }), true;
    }
    if (how === 'clear' && target) {
      const r = P.courtClear(group, target);
      return reply(ui.card('⚖️', 'Record cleared', [`${tagLine(target)}: ${r.cases} case${r.cases === 1 ? '' : 's'} removed, jail ended.`]), who), true;
    }
    const open = court.open(group).map((c) => `*#${c.id}* ${ui.tag(c.plaintiff)} v ${ui.tag(c.defendant)} – _${c.reason}_`);
    return reply(ui.card('⚖️', 'The court', open.length ? open : ['No open cases.'], [`\`${prefix}god court end 3\` • \`overturn 3\` • \`clear @user\``]), { mentions: court.open(group).flatMap((c) => [c.plaintiff, c.defendant]) }), true;
  }
  if (sub === 'title') {
    if (!target) return reply(ui.card('⚜️', 'Titles', nobility.TITLES.map((t) => `${t.icon} ${t.name}`), [`\`${prefix}god title @user baron\` (God ignores the seats and the cost) • \`none\` takes it`])), true;
    const none = lc(rest.find((a) => !/^@/.test(a) && !isNum(a))) === 'none';
    const t = rest.map((w) => nobility.byId(w)).find(Boolean);
    if (!none && !t) return fail('Choose: knight, baron, count, duke or none.'), true;
    const r = P.title(group, target, none ? null : t.id);
    if (!r.ok) return fail(r.why === 'none' ? 'That person has no title.' : WHY[r.why] || 'That did not work.'), true;
    await announce(ctx, group, none ? `⚜️ ${tagLine(target)} lost the title ${r.title.name}.` : `⚜️ ${tagLine(target)} is now a *${r.title.name}*.`, [target]);
    return reply(ui.card('⚜️', none ? 'Title taken' : 'Title given', [`${tagLine(target)}: ${none ? r.title.name : `${r.title.icon} ${r.title.name}`}`]), who), true;
  }
  if (sub === 'festival') {
    const how = lc(rest[0]);
    if (!['start', 'stop'].includes(how)) return reply(ui.card('🎉', 'Festival', [], [`\`${prefix}god festival start\` • \`stop\``])), true;
    const r = P.festivalNow(group, how === 'start');
    if (!r.ok) return reply(ui.info('No festival is on.')), true;
    if (how === 'start') await announce(ctx, group, `🎉 *${r.name}* has begun! Everybody earns +${r.pct}% for ${r.hours} hours.`);
    return reply(ui.card('🎉', how === 'start' ? `${r.name} started` : 'Festival stopped', [how === 'start' ? `+${r.pct}% pay for ${r.hours} hours` : ' '].filter((x) => x.trim()))), true;
  }
  if (sub === 'season') {
    const how = lc(rest[0]);
    if (how === 'end') {
      const r = P.seasonEnd(group);
      await announce(ctx, group, `🏆 Season ${r.result.n} ended. ${r.result.won.length ? r.result.won.map((w) => ui.tag(w.jid)).join(' ') + ' won.' : 'Nobody won a prize.'}`, r.result.won.map((w) => w.jid));
      return reply(ui.card('🏆', 'Season ended', [`Season ${r.result.n}: ${r.result.won.length} prize${r.result.won.length === 1 ? '' : 's'} paid. A new season has begun.`]), { mentions: r.result.won.map((w) => w.jid) }), true;
    }
    if (how === 'days') {
      const n = nums(rest.slice(1))[0];
      const r = n === undefined ? { ok: false } : P.seasonDays(group, n);
      if (!r.ok) return fail('Days from now: 0 to 365.'), true;
      return reply(ui.card('🏆', 'Season clock', [`The season ends in ${n} days.`])), true;
    }
    if (how === 'points' && target) {
      const n = nums(rest.slice(1))[0];
      const r = n === undefined ? { ok: false } : P.seasonPoints(group, target, n);
      if (!r.ok) return fail('Points: 0 to 1000000000.'), true;
      return reply(ui.card('🏆', 'Season points set', [`${tagLine(target)}: ${n} points`]), who), true;
    }
    const b = season.current(group);
    return reply(ui.card('🏆', `Season ${b.n}`, [`Ends in ${ui.dur(Math.max(0, b.end - Date.now()))}`], [`\`${prefix}god season end\` • \`days 10\` • \`points @user 50\``])), true;
  }
  if (sub === 'guild') {
    const how = lc(rest[0]);
    if (!how || how === 'list') {
      const rows = guild.top(group, 20).map((g) => `*#${g.id}* ${g.name} – level ${g.level} • ${guild.sizeOf(g)} members • bank ${ui.fmt(g.bank)}`);
      return reply(ui.card('🛡️', 'Guilds', rows.length ? rows : ['No guilds.'], [`\`${prefix}god guild disband 2\` • \`level 2 5\` • \`bank 2 1000\` • \`kick 2 @user\` • \`leader 2 @user\``])), true;
    }
    const gid = nums(rest.slice(1))[0];
    const g = gid ? guild.find(group, `#${gid}`) : null;
    if (!g) return fail('Give the guild number from the list.'), true;
    const val = nums(rest.slice(2))[0];
    const r = how === 'disband' ? P.guildDo(group, 'disband', g) : how === 'level' ? P.guildDo(group, 'level', g, val) : how === 'bank' ? P.guildDo(group, 'bank', g, val) : how === 'kick' && target ? P.guildDo(group, 'kick', g, target) : how === 'leader' && target ? P.guildDo(group, 'leader', g, target) : { ok: false };
    if (!r.ok) return fail('That did not work (is the number or the person right?).'), true;
    await announce(ctx, group, `🛡️ God changed the guild *${g.name}* (${how}).`, target ? [target] : []);
    return reply(ui.card('🛡️', 'Guild changed', [`*${g.name}*: ${how} done.`]), who), true;
  }
  if (sub === 'dungeon') {
    const how = lc(rest[0]);
    const id = nums(rest.slice(1))[0];
    if (how === 'call' && id) {
      const r = P.dungeonCall(group, id);
      if (!r.ok) return fail('There is no open expedition with that number.'), true;
      await announce(ctx, group, `🐉 Expedition #${id} was called off. The fees went back.`, Object.values(r.run.party));
      return reply(ui.card('🐉', 'Expedition called off', [`#${id}: the fees were returned.`])), true;
    }
    const rows = dungeon.open(group).map((r) => `*#${r.id}* ${dungeon.byId(r.dungeon).name} – ${Object.keys(r.party).length} in the party`);
    return reply(ui.card('🐉', 'Expeditions', rows.length ? rows : ['None open.'], [`\`${prefix}god dungeon call 3\``])), true;
  }
  if (sub === 'clearstate') {
    const what = P.RESETS[lc(rest[0])];
    if (!what) return reply(ui.card('🧹', 'Reset a feature', ['Clears everything a feature remembers in this realm (not the settings, not the citizens).'], [`\`${prefix}god clearstate ${Object.keys(P.RESETS).join('|')} confirm\``])), true;
    if (!rest.some((a) => lc(a) === 'confirm')) return reply(ui.warn(`This clears the ${lc(rest[0])} of *${await nameOf(ctx.sock, group)}*. Send it again with the word *confirm* at the end.`)), true;
    P.reset(group, what);
    await announce(ctx, group, `The ${lc(rest[0])} of the realm started again from nothing.`);
    return reply(ui.card('🧹', 'Cleared', [`The ${lc(rest[0])} state of this realm is empty now.`])), true;
  }
  return false;
}

module.exports = { handle, HELP, SUBS };
