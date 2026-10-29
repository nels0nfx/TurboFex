// The Empire, phase 2 (careers): career, work, weekly.
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const ui = require('../core/realm/ui');
const stuff = require('../core/realm/stuff');
const careers = require('../core/realm/careers');
const settings = require('../core/realm/settings');
const { realmCommand } = require('../core/realm/cmd');

const goodsLine = (g) => (g ? `${stuff.get(g.id).icon} *${stuff.get(g.id).name}:* +${g.added}${g.lost ? ` _(${g.lost} lost: the bag is full)_` : ''}` : null);

module.exports = [
  realmCommand({
    name: 'career',
    aliases: ['careers', 'job', 'profession'],
    feature: 'careers',
    description: 'Choose your profession and see your level: career / career farmer / career quit',
    async run({ args, reply, myJid, prefix }, { group }) {
      const word = (args[0] || '').toLowerCase();
      if (word === 'quit' || word === 'leave') {
        const r = careers.quit(group, myJid);
        return reply(r.ok ? ui.card('🧳', 'You left your career', ['Your levels are kept if you come back.']) : ui.info('You have no career.'));
      }
      if (word) {
        const cr = careers.findCareer(word);
        if (!cr) return reply(ui.warn(`I do not know that career. See \`${prefix}career\`.`));
        const r = careers.choose(group, myJid, cr.id);
        if (!r.ok) {
          const m = { same: ui.info(`You are a ${cr.name} already.`), rank: ui.warn(`A ${cr.name} must be at least a ${r.need ? r.need.name : 'higher rank'}.`), wait: ui.wait('You changed career lately.', r.waitMs || 0) }[r.why];
          return reply(m || ui.warn('That did not work.'));
        }
        return reply(ui.card('✅', `You are now a ${cr.icon} ${cr.name}`, [`_${cr.about}_`, `*Level:* ${r.level}`], [`\`${prefix}work\` – start working`, `\`${prefix}shop\` – the ${careers.toolOf(cr).name} makes you earn more`]));
      }
      const st = careers.status(group, myJid);
      const rank = A.rank(group, myJid);
      const rows = [];
      if (st.career) {
        rows.push(`*You:* ${st.career.icon} ${st.career.name} • level ${st.level}${st.max ? ' (max)' : ''}`, st.nextXp ? `${ui.bar(st.xp - careers.xpFor(group, st.level), st.nextXp - careers.xpFor(group, st.level))} ${st.xp} / ${st.nextXp} xp` : '', `*Tool:* ${st.tool ? `${careers.toolOf(st.career).icon} ${careers.toolOf(st.career).name} (${st.tool} uses)` : `none – the ${careers.toolOf(st.career).name} adds +${settings.get('careers.toolBonus', group)}%`}`, '');
      }
      rows.push(...careers.CAREERS.map((c) => {
        const need = careers.minRankOf(group, c);
        const lock = rank.index < need ? ` 🔒 ${A.RANKS[need].name}` : '';
        return `${c.icon} *${c.name}*${lock} – _${c.about}_`;
      }));
      await reply(ui.card('⚒️', 'Careers', rows.filter((r) => r !== ''), [`\`${prefix}career miner\` – choose one`, `\`${prefix}work\` – work (every ${settings.get('careers.workCooldown', group)} minutes)`]));
    },
  }),
  realmCommand({
    name: 'work',
    aliases: ['labor', 'toil'],
    feature: 'careers',
    description: 'Work at your career for Aurum and goods',
    async run({ reply, myJid, prefix }, { group }) {
      const r = careers.work(group, myJid);
      if (!r.ok) {
        if (r.why === 'nocareer') return reply(ui.card('⚒️', 'You have no career', ['Choose a profession first.'], [`\`${prefix}career\` – see them all`]));
        if (r.why === 'rank') return reply(ui.warn(`A ${r.career.name} must be at least a ${r.need.name}.`));
        return reply(ui.wait(`You are resting.`, r.waitMs));
      }
      const rows = [
        `*Earned:* +${ui.money(r.pay)}${r.first ? ' _(first work of the day +)_' : ''}${r.tool ? ' _(tool +)_' : ''}${r.meal ? ' _(meal +)_' : ''}`,
        goodsLine(r.goods),
        `*Level:* ${r.level}${r.levelUp ? ' 🎉 *level up!*' : ''} • ${r.xp} xp`,
        ...r.notes.map((n) => `_${n}_`),
        `*Purse:* ${ui.money(A.balance(group, myJid))}`,
      ].filter(Boolean);
      await reply(ui.card(r.career.icon, `${r.career.name} at work`, rows, [`\`${prefix}inventory\` • \`${prefix}sell all\``]));
    },
  }),
  realmCommand({
    name: 'weekly',
    aliases: ['weeklygift'],
    feature: 'careers',
    description: 'Your big bonus of the week (more with a higher career level)',
    async run({ reply, myJid }, { group }) {
      const r = careers.weekly(group, myJid);
      if (!r.ok) return reply(ui.wait('You took your weekly bonus.', r.waitMs));
      await reply(ui.card('🎉', 'Weekly bonus', [`*Earned:* +${ui.money(r.pay)}`, goodsLine(r.goods), `*Purse:* ${ui.money(A.balance(group, myJid))}`].filter(Boolean), [], r.career ? `A higher ${r.career.name} level pays more.` : 'Choose a career for goods and a bigger bonus.'));
    },
  }),
];
