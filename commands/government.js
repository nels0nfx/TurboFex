// The Empire, phase 4: the government. government, election, stand, vote, appoint, dismiss, decree, salary, tax, treasury,
// law, referendum, impeach, jail, pardon, court, sue.
// The rules live in core/realm/gov.js and core/realm/court.js. Every number is a setting God can change.
const gov = require('../core/realm/gov');
const court = require('../core/realm/court');
const civic = require('../core/realm/civic');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const ui = require('../core/realm/ui');
const { realmCommand } = require('../core/realm/cmd');
const { resolveTarget } = require('../whatsapp/utils');

const who = (jid) => (jid ? ui.tag(jid) : '_nobody_');
const num = (words) => {
  for (const w of words) {
    const t = String(w).replace(/,/g, '');
    if (/^\d{1,12}(\.\d+)?$/.test(t) && t.replace(/\D/g, '').length < 11) return Number(t);
  }
  return NaN;
};
// words of a command without the tagged person or a phone number
const textOf = (args) => args.filter((a) => !/^@/.test(a) && !/^\+?\d{7,15}$/.test(a)).join(' ');
const OFFICE_NAMES = { treasurer: 'treasurer', marshal: 'marshal', steward: 'steward', money: 'treasurer', law: 'marshal', trade: 'steward' };

module.exports = [
  // ---------------------------------------------------------------- the government
  realmCommand({
    name: 'government',
    aliases: ['rulers', 'sovereign'],
    feature: 'government',
    description: 'Who rules the realm: the Sovereign, the three officers, the tax, the laws and what is going on',
    async run({ reply, prefix, myJid }, { group }) {
      const now = Date.now();
      const o = gov.overview(group, now);
      const rows = [];
      if (o.sovereign) {
        rows.push(`👑 *Sovereign:* ${who(o.sovereign.jid)}${o.sovereign.until > now ? ` _(${ui.dur(o.sovereign.until - now)} left)_` : ' _(the term is over)_'}`);
      } else rows.push('👑 *Sovereign:* _nobody – the seat is vacant_');
      for (const off of o.officers) rows.push(`${off.icon} *${off.name}:* ${who(off.holder && off.holder.jid)}`);
      rows.push('', `*Income tax:* ${o.tax}% _(the most allowed: ${o.maxTax}%)_`, `*Treasury:* ${ui.money(o.treasury)}`);
      if (o.laws.length) rows.push('', '*Laws in force*', ...o.laws.map((l) => `${l.icon} ${l.name} – ${ui.dur(l.until - now)} left`));
      if (o.decree) rows.push('', `📜 *Decree:* _${o.decree.text}_`);
      const news = [];
      if (o.election && o.election.endsAt > now) news.push(`🗳️ An election is open (${ui.dur(o.election.endsAt - now)} left)`);
      if (o.referendum) news.push(`🗳️ A referendum is open: ${gov.lawById(o.referendum.law).name}`);
      if (o.impeach) news.push(o.impeach.stage === 'vote' ? '⚖️ An impeachment vote is open' : `✍️ A petition against the Sovereign has ${Object.keys(o.impeach.signers).length} signatures`);
      if (o.prisoners.length) news.push(`⛓️ ${o.prisoners.length} in jail`);
      if (news.length) rows.push('', ...news);
      const me = gov.officeOf(group, myJid);
      const hints = me ? [`You are the *${me === 'sovereign' ? 'Sovereign' : gov.OFFICES.find((x) => x.id === me).name}*.`] : [];
      hints.push(`\`${prefix}election\` • \`${prefix}law\` • \`${prefix}treasury\` • \`${prefix}court\``);
      await reply(ui.card('🏛️', 'The Government', rows, hints), { mentions: [o.sovereign && o.sovereign.jid, ...o.officers.map((x) => x.holder && x.holder.jid)].filter(Boolean) });
    },
  }),

  // ---------------------------------------------------------------- elections
  realmCommand({
    name: 'election',
    aliases: ['elections'],
    feature: 'government',
    description: 'The election: election shows it, election start opens one when the seat is vacant',
    async run({ args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      if ((args[0] || '').toLowerCase() === 'start') {
        const r = gov.startElection(group, myJid, now);
        if (!r.ok) {
          if (r.why === 'seated') return reply(ui.warn(`There is a Sovereign. The term ends in ${ui.dur(r.until - now)}; then an election starts by itself.`));
          return reply(ui.info('An election is open already.'));
        }
        return reply(ui.card('🗳️', 'An election is open', [`It lasts *${ui.dur(r.election.endsAt - now)}*.`, `*Standing costs:* ${ui.money(gov.get('candidacyFee', group))}`, `*Votes needed to win:* ${gov.get('votesNeeded', group)}`], [`\`${prefix}stand\` – stand as a candidate`, `\`${prefix}vote @user\` – vote`]));
      }
      const e = gov.overview(group, now).election;
      if (!e) {
        const sov = gov.sovereign(group);
        return reply(ui.card('🗳️', 'No election now', [sov ? `The Sovereign ${who(sov.jid)} rules for ${ui.dur(Math.max(0, sov.until - now))} more.` : 'The seat is *vacant*.'], sov ? [] : [`\`${prefix}election start\` – open one`]), { mentions: sov ? [sov.jid] : [] });
      }
      const rows = gov.tally(e).map((t, i) => `${i + 1}. ${who(t.jid)} – *${t.votes}* vote${t.votes === 1 ? '' : 's'}`);
      await reply(ui.card('🗳️', 'The election', [...(rows.length ? rows : ['_No candidates yet._']), '', `*Ends in:* ${ui.dur(Math.max(0, e.endsAt - now))}`, `*Votes cast:* ${Object.keys(e.voters).length}`], [`\`${prefix}stand\` – stand as a candidate (${ui.money(gov.get('candidacyFee', group))})`, `\`${prefix}vote 1\` or \`${prefix}vote @user\``]), { mentions: gov.tally(e).map((t) => t.jid) });
    },
  }),
  realmCommand({
    name: 'stand',
    aliases: ['candidate', 'runfor'],
    feature: 'government',
    description: 'Stand as a candidate in the election (it costs a fee)',
    async run({ reply, myJid, prefix }, { group }) {
      const r = gov.stand(group, myJid);
      if (!r.ok) {
        const m = { none: ui.info(`There is no election now. \`${prefix}election start\` opens one when the seat is vacant.`), already: ui.info('You are a candidate already.'), limit: ui.warn(`You have ruled ${r.limit} terms in a row. Rest one term.`), full: ui.warn('There are enough candidates already.'), poor: ui.warn(`Standing costs ${ui.money(r.fee || 0)}.`), god: ui.warn('God does not stand for election.') }[r.why];
        return reply(m || ui.warn('That did not work.'));
      }
      await reply(ui.card('🗳️', 'You are a candidate', [`${ui.tag(myJid)} stands for Sovereign.`, r.fee ? `*Fee paid:* ${ui.money(r.fee)}` : ''].filter(Boolean), [`Others can vote with \`${prefix}vote @user\``]), { mentions: [myJid] });
    },
  }),
  realmCommand({
    name: 'vote',
    aliases: ['ballot'],
    feature: 'government',
    description: 'Vote for a candidate: vote @user or vote 1 (the number in the election list)',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      let target = resolveTarget(msg, args);
      const e = gov.overview(group, now).election;
      if (!target && e) {
        const n = parseInt(args[0], 10);
        const row = n >= 1 ? gov.tally(e)[n - 1] : null;
        if (row) target = row.jid;
      }
      if (!target) return reply(ui.card('🗳️', 'Vote', [], [`\`${prefix}vote @user\` or \`${prefix}vote 1\` (see \`${prefix}election\`)`]));
      const r = gov.castVote(group, myJid, target, now);
      if (!r.ok) return reply({ none: ui.info('There is no election now.'), nocandidate: ui.warn('That person is not a candidate.'), voted: ui.info('You voted already.') }[r.why] || ui.warn('That did not work.'));
      await reply(ui.card('🗳️', 'Vote counted', [`${ui.tag(myJid)} voted for ${ui.tag(target)}.`]), { mentions: [myJid, target] });
    },
  }),

  // ---------------------------------------------------------------- the Sovereign
  realmCommand({
    name: 'appoint',
    aliases: ['office'],
    feature: 'government',
    description: 'The Sovereign appoints an officer: appoint treasurer @user / marshal / steward',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const word = args.map((a) => a.toLowerCase()).find((a) => OFFICE_NAMES[a]);
      const target = resolveTarget(msg, args);
      if (!word || !target) return reply(ui.card('🏛️', 'Appoint an officer', gov.OFFICES.map((o) => `${o.icon} *${o.name}* – ${o.about}`), [`\`${prefix}appoint treasurer @user\``], 'Only the Sovereign can appoint.'));
      const r = gov.appoint(group, myJid, OFFICE_NAMES[word], target);
      if (!r.ok) return reply({ rights: ui.warn('Only the Sovereign can appoint officers.'), self: ui.warn('You are the Sovereign already.'), god: ui.warn('God cannot hold an office.'), stranger: ui.warn('That person is not a citizen of this realm yet.'), busy: ui.warn(`That person is the ${r.has} already.`) }[r.why] || ui.warn('That did not work.'));
      await reply(ui.card('🏛️', `New ${r.office.name}`, [`${r.office.icon} ${ui.tag(target)} is now the *${r.office.name}*.`, `_${r.office.about}_`]), { mentions: [target] });
    },
  }),
  realmCommand({
    name: 'dismiss',
    aliases: ['sack'],
    feature: 'government',
    description: 'The Sovereign dismisses an officer: dismiss treasurer / marshal / steward',
    async run({ args, reply, myJid, prefix }, { group }) {
      const word = args.map((a) => a.toLowerCase()).find((a) => OFFICE_NAMES[a]);
      if (!word) return reply(ui.card('🏛️', 'Dismiss an officer', [], [`\`${prefix}dismiss treasurer\``]));
      const r = gov.dismiss(group, myJid, OFFICE_NAMES[word]);
      if (!r.ok) return reply({ rights: ui.warn('Only the Sovereign can dismiss officers.'), empty: ui.info('Nobody holds that office.') }[r.why] || ui.warn('That did not work.'));
      await reply(ui.card('🏛️', `${r.office.name} dismissed`, [`${ui.tag(r.was.jid)} is no longer the ${r.office.name}.`]), { mentions: [r.was.jid] });
    },
  }),
  realmCommand({
    name: 'decree',
    feature: 'government',
    description: 'The Sovereign makes a decree that everybody can read in the government list',
    async run({ args, reply, myJid, prefix }, { group }) {
      const r = gov.decree(group, myJid, args.join(' '));
      if (!r.ok) return reply({ rights: ui.warn('Only the Sovereign can make a decree.'), short: ui.card('📜', 'Decree', [], [`\`${prefix}decree Every Friday is a feast day\``]) }[r.why] || ui.warn('That did not work.'));
      await reply(ui.card('📜', 'A decree of the Sovereign', [`_${r.text}_`, `— ${ui.tag(myJid)}`]), { mentions: [myJid] });
    },
  }),
  realmCommand({
    name: 'salary',
    aliases: ['wage', 'paycheck'],
    feature: 'government',
    description: 'The Sovereign and the officers claim their daily salary from the treasury',
    async run({ reply, myJid }, { group }) {
      const r = gov.salary(group, myJid);
      if (!r.ok) return reply({ none: ui.info('Only the Sovereign and the three officers have a salary.'), wait: ui.wait('You were paid already.', r.waitMs || 0), empty: ui.warn('The treasury is empty.') }[r.why] || ui.warn('That did not work.'));
      await reply(ui.card('💼', 'Salary', [`*Paid:* ${ui.money(r.pay)}${r.pay < r.want ? ` _(the treasury could only pay this much; ${ui.fmt(r.want)} is the salary)_` : ''}`, `*Treasury left:* ${ui.money(A.treasury(group))}`]));
    },
  }),

  // ---------------------------------------------------------------- the Treasurer
  realmCommand({
    name: 'tax',
    aliases: ['taxes'],
    feature: 'government',
    description: 'The income tax: tax shows it, the Treasurer sets it (tax 5)',
    async run({ args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const rate = civic.taxRate(group);
      const max = gov.get('maxTax', group);
      if (!args.length) return reply(ui.card('🧾', 'Income tax', [`*Now:* ${rate}% of the daily gift, work and the weekly bonus`, `*The most allowed:* ${max}%`, `*Treasury:* ${ui.money(A.treasury(group))}`], [`The Treasurer sets it: \`${prefix}tax 5\``]));
      const pct = num(args);
      if (!(pct >= 0)) return reply(ui.warn(`Write the tax as a number: \`${prefix}tax 5\``));
      const r = gov.setTax(group, myJid, pct, now);
      if (!r.ok) return reply(r.why === 'rights' ? ui.warn('Only the Treasurer can set the tax.') : ui.warn(`The tax can be 0 to ${r.max}%.`));
      await reply(ui.card('🧾', 'Tax set', [`*Income tax:* ${r.pct}%`, 'It is taken from the daily gift, work and the weekly bonus, and goes to the treasury.']));
    },
  }),
  realmCommand({
    name: 'treasury',
    aliases: ['coffers', 'realmfund'],
    feature: 'government',
    description: 'The treasury: treasury shows it, treasury log, and the Treasurer spends with treasury grant @user 100 / treasury relief 500',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'grant' || sub === 'relief') {
        const target = sub === 'grant' ? resolveTarget(msg, args.slice(1)) : null;
        const r = gov.spend(group, myJid, sub, num(args.slice(1)), target, now);
        if (!r.ok) {
          const m = { rights: ui.warn('Only the Treasurer can spend the treasury.'), amount: ui.warn('Give an amount.'), poor: ui.warn(`The treasury only has ${ui.money(r.have || 0)}.`), cap: ui.warn(`The daily limit: you can still spend ${ui.money(r.left || 0)} today.`), target: ui.warn(`\`${prefix}treasury grant @user 100\``), stranger: ui.warn('That person is not a citizen yet.'), nobody: ui.info('Nobody needs relief: every citizen is a Citizen or higher.'), small: ui.warn(`Too little for ${r.people} people. Spend more.`) }[r.why];
          return reply(m || ui.warn('That did not work.'));
        }
        const lines = r.to.slice(0, 8).map((p) => `${ui.tag(p.jid)} +${ui.fmt(p.got)}`);
        return reply(ui.card(sub === 'grant' ? '🎁' : '🤲', sub === 'grant' ? 'Grant paid' : 'Relief paid', [`*Spent:* ${ui.money(r.amount)}`, ...lines, r.to.length > 8 ? `_and ${r.to.length - 8} more_` : '', `*Treasury left:* ${ui.money(A.treasury(group))}`].filter(Boolean)), { mentions: r.to.slice(0, 8).map((p) => p.jid) });
      }
      if (sub === 'log' || sub === 'ledger') {
        const rows = civic.recentLog(group, 12).map((l) => `• ${new Date(l.at).toISOString().slice(5, 16).replace('T', ' ')} ${l.text}`);
        return reply(ui.card('📒', 'What the rulers did', rows.length ? rows : ['Nothing yet.']));
      }
      const o = gov.overview(group, now);
      const officer = gov.officer(group, 'treasurer');
      await reply(ui.card('🏺', 'The Treasury', [`*Aurum:* ${ui.money(o.treasury)}`, `*Income tax:* ${o.tax}%`, `*The Treasurer can still spend today:* ${ui.money(o.capLeft)}`, `*Treasurer:* ${who(officer && officer.jid)}`, '', 'It fills from taxes, fees, fines and candidacy fees. It pays salaries, laws, grants and relief.'], [`\`${prefix}treasury log\` – what the rulers did`, `\`${prefix}treasury grant @user 100\` • \`${prefix}treasury relief 500\` (Treasurer)`]), { mentions: officer ? [officer.jid] : [] });
    },
  }),

  // ---------------------------------------------------------------- laws and referendums
  realmCommand({
    name: 'law',
    aliases: ['laws', 'enact'],
    feature: 'government',
    description: 'The laws: law lists them, the Sovereign or the Steward enacts one with law festival',
    async run({ args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const word = args.join(' ').trim();
      if (word) {
        const r = gov.enactLaw(group, myJid, word, now);
        if (!r.ok) {
          const m = {
            unknown: ui.warn(`I do not know that law. See \`${prefix}law\`.`),
            rights: ui.warn(`Only ${r.law ? r.law.by.map((x) => `the ${x}`).join(' or ') : 'the rulers'} can enact ${r.law ? r.law.name : 'that'}.`),
            referendum: ui.warn(`*${r.law && r.law.name}* is a big law. The Sovereign must call a referendum: \`${prefix}referendum ${r.law && r.law.id}\``),
            active: ui.info(`${r.law && r.law.name} is in force already.`),
            poor: ui.warn(`The treasury has ${ui.money(r.have || 0)}. ${r.law && r.law.name} costs ${ui.money(r.law ? r.law.cost : 0)}.`),
          }[r.why];
          return reply(m || ui.warn('That did not work.'));
        }
        const l = r.law;
        const rows = [`${l.icon} *${l.name}* is now law.`, `_${l.about(l.pct)}_`, l.hours ? `*Lasts:* ${ui.dur(l.hours * 3600000)}` : '', l.cost ? `*Cost:* ${ui.money(l.cost)} from the treasury` : '', r.freed !== undefined ? `*Set free:* ${r.freed}` : '', r.collected !== undefined ? `*Collected:* ${ui.money(r.collected)}` : ''].filter(Boolean);
        return reply(ui.card('📜', 'A new law', rows), { mentions: [] });
      }
      const rows = gov.LAWS.map((base) => {
        const l = gov.lawView(group, base);
        return `${l.icon} *${l.name}* (\`${l.id}\`)${l.big ? ' 🗳️ _referendum_' : ''}\n   ${l.about(l.pct)}${l.hours ? ` • ${l.hours}h` : ''} • costs ${ui.fmt(l.cost)}`;
      });
      const active = gov.activeLaws(group, now);
      if (active.length) rows.unshift('*In force:* ' + active.map((a) => `${a.icon} ${a.name} (${ui.dur(a.until - now)})`).join(', '), '');
      await reply(ui.card('📜', 'The laws', rows, [`\`${prefix}law festival\` – the Sovereign or the Steward enacts it`, `\`${prefix}referendum prosperity\` – a big law needs the vote of the citizens`], `Treasury: ${ui.money(A.treasury(group))}`));
    },
  }),
  realmCommand({
    name: 'referendum',
    aliases: ['referenda', 'plebiscite'],
    feature: 'government',
    description: 'The citizens vote on a law: the Sovereign calls it (referendum prosperity), everybody votes (referendum yes / no)',
    async run({ args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const word = (args[0] || '').toLowerCase();
      const o = gov.overview(group, now);
      if (word === 'yes' || word === 'no') {
        const r = gov.refVote(group, myJid, word === 'yes', now);
        if (!r.ok) return reply({ none: ui.info('There is no referendum now.'), voted: ui.info('You voted already.') }[r.why] || ui.warn('That did not work.'));
        return reply(ui.card('🗳️', 'Vote counted', [`You voted *${word}*.`]));
      }
      if (word) {
        const r = gov.callReferendum(group, myJid, args.join(' '), now);
        if (!r.ok) return reply({ rights: ui.warn('Only the Sovereign can call a referendum.'), unknown: ui.warn(`I do not know that law. See \`${prefix}law\`.`), running: ui.info('A referendum is open already.'), active: ui.info('That law is in force already.') }[r.why] || ui.warn('That did not work.'));
        return reply(ui.card('🗳️', `Referendum: ${r.law.icon} ${r.law.name}`, [`_${r.law.about(r.law.pct)}_`, `*Costs:* ${ui.money(r.law.cost)} from the treasury`, `*Open for:* ${ui.dur(r.referendum.endsAt - now)}`, `*It passes with:* ${gov.get('refPass', group)}% yes and at least ${gov.get('refQuorum', group)} votes`], [`\`${prefix}referendum yes\` • \`${prefix}referendum no\``]));
      }
      const r = o.referendum;
      if (!r) return reply(ui.card('🗳️', 'No referendum now', ['The Sovereign can call one about any law.'], [`\`${prefix}law\` – the laws`]));
      const law = gov.lawView(group, gov.lawById(r.law));
      await reply(ui.card('🗳️', `Referendum: ${law.icon} ${law.name}`, [`_${law.about(law.pct)}_`, `*Yes:* ${Object.keys(r.yes).length} • *No:* ${Object.keys(r.no).length}`, `*Ends in:* ${ui.dur(Math.max(0, r.endsAt - now))}`], [`\`${prefix}referendum yes\` • \`${prefix}referendum no\``]));
    },
  }),
  realmCommand({
    name: 'impeach',
    aliases: ['recall'],
    feature: 'government',
    description: 'Remove the Sovereign: impeach signs the petition, then impeach yes / no in the vote',
    async run({ args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const word = (args[0] || '').toLowerCase();
      if (word === 'yes' || word === 'no') {
        const r = gov.impeachVote(group, myJid, word === 'yes', now);
        if (!r.ok) return reply({ none: ui.info('There is no impeachment vote now.'), voted: ui.info('You voted already.') }[r.why] || ui.warn('That did not work.'));
        return reply(ui.card('⚖️', 'Vote counted', [`You voted *${word}*.`]));
      }
      const r = gov.petition(group, myJid, now);
      if (!r.ok) {
        const m = { vacant: ui.info('There is no Sovereign.'), self: ui.warn('You are the Sovereign.'), blocked: ui.wait('An impeachment failed lately.', r.waitMs || 0), voting: ui.info(`A vote is open: \`${prefix}impeach yes\` or \`${prefix}impeach no\``), signed: ui.info(`You signed already (${r.count} signatures).`) }[r.why];
        return reply(m || ui.warn('That did not work.'));
      }
      if (r.opened) return reply(ui.card('⚖️', 'The impeachment vote is open', [`${r.count} citizens signed the petition.`, `*Open for:* ${gov.get('impeachHours', group)} hours`, `*The Sovereign is removed with:* ${gov.get('impeachPct', group)}% yes and at least ${gov.get('impeachQuorum', group)} votes`], [`\`${prefix}impeach yes\` • \`${prefix}impeach no\``]));
      await reply(ui.card('✍️', 'Petition signed', [`*Signatures:* ${r.count} / ${r.needed}`, `At ${r.needed} signatures a vote opens.`]));
    },
  }),

  // ---------------------------------------------------------------- justice
  realmCommand({
    name: 'jail',
    aliases: ['arrest', 'prison'],
    feature: 'government',
    description: 'The Marshal jails a citizen (jail @user 30). Without a name: who is in jail',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const target = resolveTarget(msg, args);
      if (!target) {
        const rows = civic.prisoners(group, now).map((p) => `⛓️ ${ui.tag(p.jid)} – ${ui.dur(p.left)}`);
        return reply(ui.card('⛓️', 'The jail', rows.length ? rows : ['Nobody is in jail.'], [`The Marshal: \`${prefix}jail @user 30\``], 'A prisoner cannot work, collect, trade, auction or claim the daily gift.'), { mentions: civic.prisoners(group, now).map((p) => p.jid) });
      }
      const minutes = num(args.filter((a) => !/^@/.test(a) && !/^\+?\d{7,15}$/.test(a))) || 30;
      const r = gov.jailPerson(group, myJid, target, minutes, now);
      if (!r.ok) {
        const m = { rights: ui.warn('Only the Marshal can jail people.'), god: ui.warn('God cannot be jailed.'), self: ui.warn('You cannot jail yourself.'), sovereign: ui.warn('The Sovereign cannot be jailed. The citizens can impeach them.'), stranger: ui.warn('That person is not a citizen yet.'), minutes: ui.warn(`Jail time is 1 to ${r.max} minutes.`), already: ui.info('That person is in jail already.'), cooldown: ui.wait('That person was jailed lately.', r.waitMs || 0) }[r.why];
        return reply(m || ui.warn('That did not work.'));
      }
      await reply(ui.card('⛓️', 'Jailed', [`${ui.tag(target)} is in jail for *${r.minutes} minutes*.`, 'No work, collect, trade, auction or daily gift until they are free.'], [`The Sovereign can pardon: \`${prefix}pardon @user\``]), { mentions: [target] });
    },
  }),
  realmCommand({
    name: 'pardon',
    feature: 'government',
    description: 'The Sovereign sets a prisoner free: pardon @user',
    async run({ msg, args, reply, myJid }, { group }) {
      const target = resolveTarget(msg, args);
      if (!target) return reply(ui.warn('Name the prisoner: pardon @user'));
      const r = gov.pardon(group, myJid, target);
      if (!r.ok) return reply(r.why === 'rights' ? ui.warn('Only the Sovereign can pardon.') : ui.info('That person is not in jail.'));
      await reply(ui.card('🕊️', 'Pardoned', [`${ui.tag(target)} is free.`]), { mentions: [target] });
    },
  }),
  realmCommand({
    name: 'court',
    aliases: ['trial', 'cases'],
    feature: 'court',
    description: 'The court of law: court sue @user reason, court list, court guilty 3, court innocent 3',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      const now = Date.now();
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'sue' || sub === 'file') return sue(msg, args.slice(1), reply, myJid, group, prefix, now);
      if (sub === 'guilty' || sub === 'innocent') {
        const r = court.vote(group, myJid, parseInt(args[1], 10) || null, sub === 'guilty', now);
        if (!r.ok) return reply({ none: ui.info('There is no open case with that number.'), party: ui.warn('You are part of this case, so you cannot be on the jury.'), voted: ui.info('You voted already.') }[r.why] || ui.warn('That did not work.'));
        return reply(ui.card('⚖️', `Case #${r.case.id}: vote counted`, [`${ui.tag(r.case.plaintiff)} v ${ui.tag(r.case.defendant)}`, `*Votes so far:* ${r.total} (the verdict is read when the time is over${r.early ? ' – the jury is full' : ''})`]), { mentions: [r.case.plaintiff, r.case.defendant] });
      }
      const list = court.open(group, now);
      if (sub === 'case' || /^\d+$/.test(sub)) {
        const c = court.find(group, parseInt(args[1] || sub, 10));
        if (!c) return reply(ui.info('There is no such case.'));
        const n = court.counts(c);
        return reply(ui.card('⚖️', `Case #${c.id}`, [`${ui.tag(c.plaintiff)} v ${ui.tag(c.defendant)}`, `_${c.reason}_`, c.status === 'open' ? `*Open:* ${ui.dur(Math.max(0, c.ends - now))} left • votes: ${n.guilty + n.innocent}` : `*Verdict:* ${c.verdict}${c.fine ? ` • fine ${ui.fmt(c.fine)}` : ''}`]), { mentions: [c.plaintiff, c.defendant] });
      }
      const rows = list.map((c) => `*#${c.id}* ${ui.tag(c.plaintiff)} v ${ui.tag(c.defendant)} – _${c.reason}_ • ${ui.dur(c.ends - now)} left`);
      await reply(ui.card('⚖️', 'The court', rows.length ? rows : ['No open cases.'], [`\`${prefix}court sue @user reason\` – file a case (${ui.money(court.get('filingFee', group))})`, `\`${prefix}court guilty 3\` • \`${prefix}court innocent 3\` – the jury votes`], `A guilty verdict: a fine of ${ui.money(court.get('fine', group))} and ${court.get('jailMinutes', group)} minutes in jail.`), { mentions: list.flatMap((c) => [c.plaintiff, c.defendant]) });
    },
  }),
  realmCommand({
    name: 'sue',
    feature: 'court',
    description: 'File a case in court: sue @user reason',
    async run({ msg, args, reply, myJid, prefix }, { group }) {
      await sue(msg, args, reply, myJid, group, prefix, Date.now());
    },
  }),
];

async function sue(msg, args, reply, myJid, group, prefix, now) {
  const target = resolveTarget(msg, args);
  if (!target) return reply(ui.card('⚖️', 'File a case', [], [`\`${prefix}sue @user stole my harvest\``]));
  const r = court.sue(group, myJid, target, textOf(args), now);
  if (!r.ok) {
    const m = { self: ui.warn('You cannot sue yourself.'), god: ui.warn('God cannot be taken to court.'), stranger: ui.warn('That person is not a citizen yet.'), reason: ui.warn('Write what the case is about.'), busy: ui.info('There is a case against that person already.'), full: ui.warn(`The court has ${r.max} open cases. Wait for one to close.`), wait: ui.wait('You filed a case lately.', r.waitMs || 0), poor: ui.warn(`Filing costs ${ui.money(r.fee || 0)}.`) }[r.why];
    return reply(m || ui.warn('That did not work.'));
  }
  await reply(ui.card('⚖️', `Case #${r.case.id} is open`, [`${ui.tag(myJid)} v ${ui.tag(target)}`, `_${r.case.reason}_`, `*Filing fee:* ${ui.money(r.fee)}`, `*The jury votes for:* ${ui.dur(r.case.ends - now)}`], [`\`${prefix}court guilty ${r.case.id}\` • \`${prefix}court innocent ${r.case.id}\``], 'Everybody except the two sides can be on the jury.'), { mentions: [myJid, target] });
}
