// The Empire, phase 5: seasons. A season runs for some days. Citizens earn season points from the daily gift, work, guilds and
// dungeons; when the season ends the best get Aurum and a title, the points start again and the next season begins.
// Seasons also have weather: Summer pays a little more, Autumn gives estates a bigger harvest. God sets every number.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const civic = require('./civic');
const ticker = require('./ticker');

const DAY = 86400000;
const NAMES = [
  { name: 'Spring', icon: '🌱' },
  { name: 'Summer', icon: '☀️' },
  { name: 'Autumn', icon: '🍂' },
  { name: 'Winter', icon: '❄️' },
];

settings.register('season', {
  title: 'Seasons',
  icon: '🏆',
  about: 'A leaderboard season that ends with prizes and a title, and the weather of each season',
  settings: {
    days: { label: 'How long a season lasts', def: 30, min: 1, max: 365, unit: 'days' },
    pointsPct: { label: 'Season points earned, as a share of the normal amount', def: 100, min: 0, max: 1000, kind: 'float', unit: '%' },
    minPoints: { label: 'Points needed to win a prize', def: 20, min: 1, max: 1000000, unit: 'points' },
    prize1: { label: 'Prize for the 1st place', def: 2000, min: 0, max: 1000000000, unit: 'Aurum' },
    prize2: { label: 'Prize for the 2nd place', def: 1000, min: 0, max: 1000000000, unit: 'Aurum' },
    prize3: { label: 'Prize for the 3rd place', def: 500, min: 0, max: 1000000000, unit: 'Aurum' },
    summerPayPct: { label: 'Summer: extra pay for everybody', def: 5, min: 0, max: 100, kind: 'float', unit: '%' },
    autumnOutputPct: { label: 'Autumn: extra estate output', def: 10, min: 0, max: 100, kind: 'float', unit: '%' },
  },
});
const get = (k, g) => settings.get(`season.${k}`, g);

const box = (group) => {
  const r = S.realmOf(group);
  return r.season || (r.season = { n: 1, start: 0, end: 0, pts: {}, hall: [] });
};
const themeOf = (n) => NAMES[(n - 1) % NAMES.length];
const keyEq = (a, b) => !!a && !!b && S.keyOf(a) === S.keyOf(b);

// starts the season clock the first time it is needed, and applies the weather
function current(group, now = Date.now()) {
  const b = box(group);
  if (!b.end) {
    b.start = now;
    b.end = now + get('days', group) * DAY;
    S.touch();
  }
  weather(group, now);
  return b;
}
function weather(group, now = Date.now()) {
  const b = box(group);
  const t = themeOf(b.n).name;
  const id = 'season:weather';
  const wanted = t === 'Summer' ? { kind: 'pay', pct: get('summerPayPct', group), icon: '☀️' } : t === 'Autumn' ? { kind: 'output', pct: get('autumnOutputPct', group), icon: '🍂' } : null;
  const have = civic.effectsOf(group, now).find((e) => e.id === id);
  if (!wanted || !(wanted.pct > 0)) {
    if (have) civic.removeEffect(group, id);
    return;
  }
  const mult = 1 + wanted.pct / 100;
  if (!have || have.mult !== mult || have.kind !== wanted.kind || have.until !== b.end) {
    civic.addEffect(group, { id, kind: wanted.kind, mult, until: b.end, src: 'season', name: `${t} weather`, icon: wanted.icon });
  }
}

function points(group, jid, pts, now = Date.now()) {
  if (!settings.featureOn('season', group) || !S.isOn(group)) return 0;
  const add = Math.round((pts * get('pointsPct', group)) / 100);
  if (!(add > 0) || civic.isGod(jid)) return 0;
  const b = current(group, now);
  const k = S.keyOf(jid);
  const row = b.pts[k] || (b.pts[k] = { jid, pts: 0 });
  row.pts += add;
  S.touch();
  return add;
}
const board = (group, n = 10) =>
  Object.entries(box(group).pts)
    .map(([key, r]) => ({ key, jid: r.jid, pts: r.pts }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, n);
const pointsOf = (group, jid) => (box(group).pts[S.keyOf(jid)] || { pts: 0 }).pts;
const placeOf = (group, jid) => {
  const all = board(group, 100000);
  const i = all.findIndex((r) => keyEq(r.jid, jid));
  return i < 0 ? 0 : i + 1;
};

// ends the season now: prizes and titles for the best, then a new season starts
function finish(group, now = Date.now()) {
  const b = box(group);
  const top = board(group, 3);
  const min = get('minPoints', group);
  const won = [];
  top.forEach((r, i) => {
    if (r.pts < min) return;
    const prize = get(`prize${i + 1}`, group);
    if (prize > 0) A.add(group, r.jid, prize);
    if (i === 0) {
      const c = S.citizen(group, r.jid);
      c.crown = { n: b.n, name: themeOf(b.n).name };
    }
    won.push({ place: i + 1, jid: r.jid, pts: r.pts, prize });
  });
  const result = { n: b.n, theme: themeOf(b.n), won, players: Object.keys(b.pts).length };
  b.hall.push({ n: b.n, at: now, won: won.map((w) => ({ place: w.place, jid: w.jid, pts: w.pts })) });
  if (b.hall.length > 12) b.hall.splice(0, b.hall.length - 12);
  b.n += 1;
  b.pts = {};
  b.start = now;
  b.end = now + get('days', group) * DAY;
  civic.removeEffect(group, 'season:weather');
  weather(group, now);
  S.touch();
  civic.log(group, `Season ${result.n} ended.`, now);
  return result;
}
const due = (group, now = Date.now()) => {
  const b = S.js.data.realms[group] && S.js.data.realms[group].season;
  return !!b && b.end && b.end <= now;
};
const setPoints = (group, jid, pts) => {
  pts = Math.round(pts);
  if (!(pts >= 0 && pts <= 1e9)) return { ok: false };
  const b = box(group);
  if (pts === 0) delete b.pts[S.keyOf(jid)];
  else b.pts[S.keyOf(jid)] = { jid, pts };
  S.touch();
  return { ok: true, pts };
};
// God: the season is over on this day (days from now), keeps the points
const setEnd = (group, days, now = Date.now()) => {
  if (!(days >= 0 && days <= 365)) return { ok: false };
  const b = current(group, now);
  b.end = now + days * DAY;
  S.touch();
  return { ok: true, end: b.end };
};
const hall = (group) => box(group).hall.slice().reverse();

const tagOf = (jid) => `@${String(jid).split('@')[0].split(':')[0]}`;
async function job(post, now = Date.now()) {
  for (const group of Object.keys(S.js.data.realms)) {
    if (!S.isOn(group) || !settings.featureOn('season', group)) continue;
    if (!S.js.data.realms[group].season) continue;
    weather(group, now);
    if (!due(group, now)) continue;
    const r = finish(group, now);
    const medals = ['🥇', '🥈', '🥉'];
    const rows = r.won.map((w) => `${medals[w.place - 1]} ${tagOf(w.jid)} – ${w.pts} points${w.prize ? `, *${w.prize.toLocaleString('en-US')} Aurum*` : ''}${w.place === 1 ? ' and the title *Champion*' : ''}`);
    const next = themeOf(r.n + 1);
    try {
      await post(group, { text: `🏆 *Season ${r.n} (${r.theme.icon} ${r.theme.name}) is over!*\n\n${rows.length ? rows.join('\n') : '_Nobody earned enough points for a prize._'}\n\n${next.icon} *Season ${r.n + 1}: ${next.name}* begins now. The points start again.\n▸ \`season\` – the leaderboard`, mentions: r.won.map((w) => w.jid) });
    } catch (err) {
      console.log(`The season result could not be sent to ${group}: ${err.message}`);
    }
  }
}
ticker.register('realm-season', job);

module.exports = { NAMES, themeOf, current, points, pointsOf, placeOf, board, finish, due, setPoints, setEnd, hall, box, get, job };
