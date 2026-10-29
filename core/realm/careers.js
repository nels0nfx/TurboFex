// Careers: a citizen picks one profession and works for Aurum and goods. Every career levels up with use, and has its own tool.
// God can change the pay, the waiting time, the levels, and the rank each career needs.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const shop = require('./shop');
const stuff = require('./stuff');

const HOUR = 3600000;
const DAY = 86400000;

settings.register('careers', {
  title: 'Careers',
  icon: '⚒️',
  about: 'Choosing a profession, working for Aurum and goods, levels, tools and the weekly bonus',
  settings: {
    payBase: { label: 'Pay for one work', def: 120, min: 0, max: 1000000, unit: 'Aurum' },
    workCooldown: { label: 'Waiting time between two works', def: 60, min: 1, max: 1440, unit: 'minutes' },
    xpStep: { label: 'Experience for the first level (grows with every level)', def: 50, min: 1, max: 100000, unit: 'xp' },
    maxLevel: { label: 'Highest career level', def: 20, min: 1, max: 100, unit: 'levels' },
    levelPay: { label: 'Extra pay for every level', def: 8, min: 0, max: 100, kind: 'float', unit: '%' },
    toolBonus: { label: 'Extra pay with the tool of the career', def: 25, min: 0, max: 500, kind: 'float', unit: '%' },
    toolUses: { label: 'How many works a new tool lasts', def: 25, min: 1, max: 10000, unit: 'uses' },
    firstWorkBonus: { label: 'Extra pay for the first work of the day', def: 50, min: 0, max: 500, kind: 'float', unit: '%' },
    goodsBase: { label: 'Goods that a farmer or miner gets from one work', def: 2, min: 0, max: 1000, unit: 'units' },
    switchCooldown: { label: 'Waiting time before a citizen can change career', def: 24, min: 0, max: 720, unit: 'hours' },
    weeklyBase: { label: 'The weekly bonus', def: 2000, min: 0, max: 10000000, unit: 'Aurum' },
    mealBonus: { label: 'Extra pay after eating bread', def: 15, min: 0, max: 500, kind: 'float', unit: '%' },
    mealHours: { label: 'How long a meal works', def: 3, min: 1, max: 72, unit: 'hours' },
  },
});
const get = (k, g) => settings.get(`careers.${k}`, g);

const CAREERS = [
  { id: 'farmer', name: 'Farmer', icon: '🧑‍🌾', good: 'grain', tool: 'hoe', minRank: 0, mult: 1, about: 'works the fields: Aurum and Grain' },
  { id: 'miner', name: 'Miner', icon: '⛏️', good: 'ore', tool: 'pickaxe', minRank: 0, mult: 1, about: 'digs in the mine: Aurum and Ore' },
  { id: 'scribe', name: 'Scribe', icon: '📜', good: null, tool: 'quill', minRank: 1, mult: 1.5, about: 'copies and writes: the best pay, no goods' },
  { id: 'guard', name: 'Guard', icon: '🛡️', good: null, tool: 'spear', minRank: 1, mult: 1.3, about: 'keeps the peace: steady pay' },
  { id: 'smith', name: 'Smith', icon: '🔨', good: 'iron', tool: 'hammer', minRank: 2, mult: 1.4, about: 'turns 2 Ore into 1 Iron (half pay without Ore)' },
  { id: 'healer', name: 'Healer', icon: '🌿', good: null, tool: 'herbkit', minRank: 2, mult: 1.6, about: 'cares for the sick: very good pay' },
];
for (const c of CAREERS) {
  settings.extend('careers', `pay_${c.id}`, { label: `Pay of the ${c.name} compared to the base (1 = normal)`, def: c.mult, min: 0, max: 100, kind: 'float', unit: '×' });
  settings.extend('careers', `minRank_${c.id}`, { label: `Rank a ${c.name} needs (0 Commoner … 4 Lord)`, def: c.minRank, min: 0, max: 4, unit: 'rank' });
}
const byId = (id) => CAREERS.find((c) => c.id === id) || null;
const findCareer = (t) => {
  const w = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
  return CAREERS.find((c) => c.id === w || c.name.toLowerCase() === w) || null;
};
const minRankOf = (group, c) => settings.get(`careers.minRank_${c.id}`, group);

// ---- tools: bought in the shop (or crafted)
const TOOLS = [
  { id: 'hoe', name: 'Hoe', icon: '🪓', career: 'farmer', price: 800 },
  { id: 'pickaxe', name: 'Pickaxe', icon: '⛏️', career: 'miner', price: 1000 },
  { id: 'quill', name: 'Fine Quill', icon: '🖋️', career: 'scribe', price: 1200 },
  { id: 'spear', name: 'Spear', icon: '🔱', career: 'guard', price: 1200 },
  { id: 'hammer', name: 'Smith Hammer', icon: '🔨', career: 'smith', price: 1500 },
  { id: 'herbkit', name: 'Herb Kit', icon: '🧺', career: 'healer', price: 1500 },
];
for (const t of TOOLS) {
  shop.register({
    id: t.id, name: t.name, icon: t.icon, price: t.price, kind: 'custom',
    about: (g) => `+${get('toolBonus', g)}% pay for a ${byId(t.career).name} • lasts ${get('toolUses', g)} works`,
    check: (g, jid, c) => ((c.tools || {})[t.id] > 0 ? `Your ${t.name} still has ${c.tools[t.id]} uses.` : null),
    apply: (g, jid, c) => {
      c.tools = c.tools || {};
      c.tools[t.id] = get('toolUses', g);
    },
  });
}
const toolOf = (career) => TOOLS.find((t) => t.career === career.id);
const toolUses = (group, jid, career) => ((S.citizen(group, jid).tools || {})[toolOf(career).id]) || 0;

// ---- levels
const levelOf = (group, xp) => Math.min(get('maxLevel', group), Math.floor(Math.sqrt((xp || 0) / get('xpStep', group))) + 1);
const xpFor = (group, level) => Math.pow(level - 1, 2) * get('xpStep', group);
function status(group, jid) {
  const c = S.citizen(group, jid);
  const cr = byId(c.career);
  const xp = cr ? (c.cx || {})[cr.id] || 0 : 0;
  const level = cr ? levelOf(group, xp) : 0;
  const max = level >= get('maxLevel', group);
  return { career: cr, xp, level, max, nextXp: cr && !max ? xpFor(group, level + 1) : null, tool: cr ? toolUses(group, jid, cr) : 0 };
}

// ---- choosing
function choose(group, jid, id, now = Date.now()) {
  const cr = byId(id);
  if (!cr) return { ok: false, why: 'unknown' };
  const c = S.citizen(group, jid);
  if (c.career === cr.id) return { ok: false, why: 'same', career: cr };
  const need = minRankOf(group, cr);
  const rank = A.rank(group, jid);
  if (rank.index < need) return { ok: false, why: 'rank', career: cr, need: A.RANKS[need] };
  const wait = get('switchCooldown', group) * HOUR - (now - (c.careerAt || 0));
  if (c.career && wait > 0) return { ok: false, why: 'wait', waitMs: wait };
  c.career = cr.id;
  c.careerAt = now;
  S.touch();
  return { ok: true, career: cr, level: levelOf(group, (c.cx || {})[cr.id] || 0) };
}
function quit(group, jid) {
  const c = S.citizen(group, jid);
  if (!c.career) return { ok: false };
  c.career = null;
  S.touch();
  return { ok: true };
}

// ---- working
function work(group, jid, now = Date.now(), rand = Math.random) {
  const c = S.citizen(group, jid);
  const cr = byId(c.career);
  if (!cr) return { ok: false, why: 'nocareer' };
  if (A.rank(group, jid).index < minRankOf(group, cr)) return { ok: false, why: 'rank', career: cr, need: A.RANKS[minRankOf(group, cr)] };
  let free = false;
  if (c.tonic) free = true; // a tonic: no waiting this time
  else {
    const cd = A.cooldown(group, jid, 'work', get('workCooldown', group) * 60000, now);
    if (!cd.ok) return { ok: false, why: 'wait', waitMs: cd.waitMs, career: cr };
  }
  if (free) {
    c.tonic = false;
    c.cd.work = now; // the waiting time starts again from this work
  }
  const xp0 = (c.cx || {})[cr.id] || 0;
  const level = levelOf(group, xp0);
  let mult = (get('payBase', group) * settings.get(`careers.pay_${cr.id}`, group)) * (1 + ((level - 1) * get('levelPay', group)) / 100) * A.earnMult(group, jid, now);
  const notes = [];
  // the tool
  const tool = toolOf(cr);
  let usedTool = false;
  if ((c.tools || {})[tool.id] > 0) {
    mult *= 1 + get('toolBonus', group) / 100;
    c.tools[tool.id] -= 1;
    usedTool = true;
    if (c.tools[tool.id] <= 0) {
      delete c.tools[tool.id];
      notes.push(`Your ${tool.name} broke.`);
    }
  }
  // a meal
  const meal = (c.meal || 0) > now;
  if (meal) mult *= 1 + get('mealBonus', group) / 100;
  // the first work of the day
  const day = Math.floor(now / DAY);
  const first = c.workDay !== day;
  if (first) mult *= 1 + get('firstWorkBonus', group) / 100;
  c.workDay = day;
  // goods
  let goods = null;
  if (cr.id === 'smith') {
    if (stuff.countOf(group, jid, 'ore') >= 2) {
      stuff.take(group, jid, 'ore', 2);
      goods = { id: 'iron', ...stuff.add(group, jid, 'iron', 1) };
    } else {
      mult *= 0.5;
      notes.push('No Ore in the bag: half pay. Bring 2 Ore.');
    }
  } else if (cr.good) {
    const n = get('goodsBase', group) + Math.floor(level / 3) + (rand() < 0.5 ? 1 : 0);
    goods = { id: cr.good, ...stuff.add(group, jid, cr.good, n) };
  }
  const pay = Math.round(mult);
  A.add(group, jid, pay);
  c.cx = c.cx || {};
  c.cx[cr.id] = xp0 + 10 + (usedTool ? 5 : 0);
  const level2 = levelOf(group, c.cx[cr.id]);
  S.touch();
  return { ok: true, career: cr, pay, goods, level: level2, levelUp: level2 > level, xp: c.cx[cr.id], tool: usedTool, meal, first, notes };
}

// ---- the weekly bonus (also for citizens without a career)
function weekly(group, jid, now = Date.now()) {
  const c = S.citizen(group, jid);
  const cd = A.cooldown(group, jid, 'weekly', 7 * DAY, now);
  if (!cd.ok) return { ok: false, waitMs: cd.waitMs };
  const st = status(group, jid);
  const bonus = 1 + (st.level > 1 ? ((st.level - 1) * get('levelPay', group)) / 100 : 0);
  const pay = Math.round(get('weeklyBase', group) * bonus * A.earnMult(group, jid, now));
  A.add(group, jid, pay);
  let goods = null;
  if (st.career && st.career.good) goods = { id: st.career.good, ...stuff.add(group, jid, st.career.good, 5) };
  S.touch();
  return { ok: true, pay, goods, career: st.career, level: st.level };
}

module.exports = { CAREERS, TOOLS, byId, findCareer, minRankOf, toolOf, status, levelOf, xpFor, choose, quit, work, weekly };
