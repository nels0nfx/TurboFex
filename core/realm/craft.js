// Crafting: turn goods into items and tools at the workbench, and use items. God can switch every recipe on or off, change the
// value of every item, and the size of one batch.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const stuff = require('./stuff');
const careers = require('./careers');

const HOUR = 3600000;

settings.register('crafting', {
  title: 'Crafting',
  icon: '🧰',
  about: 'The workbench: recipes, items and tools',
  settings: {
    maxBatch: { label: 'Most items made with one command', def: 20, min: 1, max: 1000, unit: 'items' },
    minRank: { label: 'Rank needed to craft (0 Commoner … 4 Lord)', def: 0, min: 0, max: 4, unit: 'rank' },
  },
});

// items (they live in the bag next to the goods)
stuff.define({ id: 'bread', name: 'Bread', icon: '🍞', value: 14, kind: 'item', about: 'eat it (use): more pay for a few hours', use: 'meal' });
stuff.define({ id: 'tonic', name: 'Tonic', icon: '🧪', value: 90, kind: 'item', about: 'drink it (use): your next work needs no waiting', use: 'tonic' });
stuff.define({ id: 'tunic', name: 'Fine Tunic', icon: '👘', value: 80, kind: 'item', about: 'fine clothes: sold to the realm for a good price' });
stuff.define({ id: 'sword', name: 'Sword', icon: '⚔️', value: 110, kind: 'item', about: 'a good blade: it keeps its value' });

const RECIPES = [
  { id: 'bread', out: 'bread', qty: 2, needs: { grain: 3 } },
  { id: 'tunic', out: 'tunic', qty: 1, needs: { cloth: 3 } },
  { id: 'sword', out: 'sword', qty: 1, needs: { iron: 2, cloth: 1 } },
  { id: 'tonic', out: 'tonic', qty: 1, needs: { wine: 2, grain: 2 } },
  // tools: crafted tools cost goods instead of Aurum
  { id: 'hoe', tool: 'hoe', needs: { iron: 2 } },
  { id: 'pickaxe', tool: 'pickaxe', needs: { iron: 3 } },
  { id: 'quill', tool: 'quill', needs: { cloth: 2 } },
  { id: 'spear', tool: 'spear', needs: { iron: 2, cloth: 1 } },
  { id: 'hammer', tool: 'hammer', needs: { iron: 3 } },
  { id: 'herbkit', tool: 'herbkit', needs: { cloth: 2, wine: 1 } },
];
for (const r of RECIPES) settings.extend('crafting', `recipe_${r.id}`, { label: `The ${r.id} recipe is allowed`, def: true, kind: 'bool' });
const recipeOn = (group, r) => settings.get(`crafting.recipe_${r.id}`, group);
const nameOfRecipe = (r) => (r.tool ? careers.TOOLS.find((t) => t.id === r.tool) : stuff.get(r.out));
const findRecipe = (t) => {
  const w = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
  return RECIPES.find((r) => r.id === w || nameOfRecipe(r).name.toLowerCase().replace(/[^a-z]/g, '') === w) || null;
};

function craft(group, jid, id, times = 1) {
  const r = findRecipe(id);
  if (!r) return { ok: false, why: 'unknown' };
  if (!recipeOn(group, r)) return { ok: false, why: 'off', recipe: r };
  if (A.rank(group, jid).index < settings.get('crafting.minRank', group)) return { ok: false, why: 'rank', need: A.RANKS[settings.get('crafting.minRank', group)] };
  times = Math.max(1, Math.min(Math.round(times) || 1, settings.get('crafting.maxBatch', group)));
  const c = S.citizen(group, jid);
  if (r.tool) {
    times = 1; // a tool is made one at a time
    if ((c.tools || {})[r.tool] > 0) return { ok: false, why: 'hastool', uses: c.tools[r.tool] };
  }
  const missing = Object.entries(r.needs).filter(([g, n]) => stuff.countOf(group, jid, g) < n * times).map(([g, n]) => ({ id: g, need: n * times, have: stuff.countOf(group, jid, g) }));
  if (missing.length) return { ok: false, why: 'missing', missing, recipe: r };
  if (r.out) {
    const room = stuff.bagSize(group, jid) - stuff.used(group, jid) + Object.values(r.needs).reduce((t, n) => t + n * times, 0);
    if (room < r.qty * times) return { ok: false, why: 'bag' };
  }
  for (const [g, n] of Object.entries(r.needs)) stuff.take(group, jid, g, n * times);
  if (r.tool) {
    c.tools = c.tools || {};
    c.tools[r.tool] = settings.get('careers.toolUses', group);
    S.touch();
    return { ok: true, recipe: r, tool: careers.TOOLS.find((t) => t.id === r.tool), times: 1, uses: c.tools[r.tool] };
  }
  stuff.add(group, jid, r.out, r.qty * times);
  return { ok: true, recipe: r, item: stuff.get(r.out), made: r.qty * times, times };
}

// using an item
function use(group, jid, id, now = Date.now()) {
  const it = stuff.get(id);
  if (!it) return { ok: false, why: 'unknown' };
  if (!it.use) return { ok: false, why: 'nouse', item: it };
  if (!stuff.take(group, jid, id, 1)) return { ok: false, why: 'none', item: it };
  const c = S.citizen(group, jid);
  if (it.use === 'meal') {
    c.meal = now + settings.get('careers.mealHours', group) * HOUR;
    S.touch();
    return { ok: true, item: it, text: `+${settings.get('careers.mealBonus', group)}% pay for ${settings.get('careers.mealHours', group)} hours` };
  }
  if (it.use === 'tonic') {
    c.tonic = true;
    S.touch();
    return { ok: true, item: it, text: 'your next work needs no waiting' };
  }
  return { ok: false, why: 'nouse', item: it };
}

module.exports = { RECIPES, recipeOn, findRecipe, nameOfRecipe, craft, use };
