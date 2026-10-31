// What a citizen is in society (office, nobility, guild, season, jail): the lines shown in the profile.
const S = require('./state');
const ui = require('./ui');
const civic = require('./civic');
const gov = require('./gov');
const nobility = require('./nobility');
const guild = require('./guild');
const season = require('./season');
const settings = require('./settings');

function lines(group, jid, now = Date.now()) {
  const out = [];
  const o = gov.officeOf(group, jid);
  if (o) out.push(`*Office:* ${o === 'sovereign' ? '👑 Sovereign' : `${gov.OFFICES.find((x) => x.id === o).icon} ${gov.OFFICES.find((x) => x.id === o).name}`}`);
  const n = nobility.titleOf(group, jid, now);
  if (n) out.push(`*Nobility:* ${n.icon} ${n.name} (${ui.dur(n.until - now)} left, +${nobility.perk(group, n.id)}% pay)`);
  const g = guild.guildOf(group, jid);
  if (g) out.push(`*Guild:* 🛡️ ${g.name} • level ${g.level}${guild.isLeader(g, jid) ? ' • leader' : ''}`);
  const c = S.citizen(group, jid, false);
  if (c && c.crown) out.push(`*Champion:* 🏆 Season ${c.crown.n} (${c.crown.name})`);
  if (settings.featureOn('season', group) && season.pointsOf(group, jid) > 0) out.push(`*Season points:* ${season.pointsOf(group, jid)} (place ${season.placeOf(group, jid)})`);
  const j = civic.jailLeft(group, jid, now);
  if (j > 0) out.push(`*In jail:* ⛓️ ${ui.dur(j)} left`);
  return out;
}

module.exports = { lines };
