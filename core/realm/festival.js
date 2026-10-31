// The Empire, phase 5: festivals. Every few days the realm celebrates by itself: everybody earns more for some hours.
// (The Sovereign can also pass a Festival law, see gov.js.) God sets how often, how long and how strong, and can start or stop one.
const settings = require('./settings');
const S = require('./state');
const civic = require('./civic');
const ticker = require('./ticker');

const DAY = 86400000;
const HOUR = 3600000;
const NAMES = ['Harvest Fair', 'Feast of Lanterns', 'Market Carnival', 'Midsummer Revel', 'Founders\' Day', 'Night of Songs', 'Festival of Fex'];

settings.register('festival', {
  title: 'Festivals',
  icon: '🎉',
  about: 'The realm celebrates every few days: everybody earns more for some hours',
  settings: {
    everyDays: { label: 'A festival starts by itself every (0 = never by itself)', def: 7, min: 0, max: 365, unit: 'days' },
    hours: { label: 'How long a festival lasts', def: 6, min: 1, max: 168, unit: 'hours' },
    payPct: { label: 'Extra pay for everybody during a festival', def: 10, min: 1, max: 300, kind: 'float', unit: '%' },
  },
});
const get = (k, g) => settings.get(`festival.${k}`, g);
const box = (group) => {
  const r = S.realmOf(group);
  return r.fest || (r.fest = { next: 0, n: 0, active: null });
};
const id = 'festival:auto';

function start(group, now = Date.now(), opts = {}) {
  const b = box(group);
  const hours = opts.hours || get('hours', group);
  const pct = opts.pct || get('payPct', group);
  const name = opts.name || NAMES[b.n % NAMES.length];
  b.n += 1;
  b.active = { name, until: now + hours * HOUR, pct };
  const every = get('everyDays', group);
  b.next = every > 0 ? now + every * DAY : 0;
  civic.addEffect(group, { id, kind: 'pay', mult: 1 + pct / 100, until: b.active.until, src: 'festival', name, icon: '🎉' });
  S.touch();
  civic.log(group, `${name} began.`, now);
  return { ok: true, ...b.active, hours };
}
function stop(group) {
  const b = box(group);
  if (!b.active) return { ok: false };
  const was = b.active;
  b.active = null;
  civic.removeEffect(group, id);
  S.touch();
  return { ok: true, was };
}
const active = (group, now = Date.now()) => {
  const r = S.js.data.realms[group];
  return r && r.fest && r.fest.active && r.fest.active.until > now ? r.fest.active : null;
};
const nextAt = (group) => {
  const r = S.js.data.realms[group];
  return r && r.fest ? r.fest.next : 0;
};

async function job(post, now = Date.now()) {
  for (const group of Object.keys(S.js.data.realms)) {
    if (!S.isOn(group) || !settings.featureOn('festival', group)) continue;
    const b = box(group);
    const say = async (text) => {
      try {
        await post(group, { text });
      } catch (err) {
        console.log(`The festival news could not be sent to ${group}: ${err.message}`);
      }
    };
    if (b.active && b.active.until <= now) {
      const was = b.active;
      b.active = null;
      civic.removeEffect(group, id);
      S.touch();
      await say(`🎉 *${was.name} is over.* Back to normal pay. See you at the next one!`);
    }
    const every = get('everyDays', group);
    if (!b.active && every > 0) {
      if (!b.next) {
        b.next = now + every * DAY; // the first one comes after one period, not at once
        S.touch();
      } else if (b.next <= now) {
        const f = start(group, now);
        await say(`🎉 *${f.name} has begun!*\n\nEverybody earns *+${f.pct}%* on the daily gift and work for *${f.hours || get('hours', group)} hours*.\n\n▸ \`daily\` • \`work\` • \`collect\``);
      }
    }
  }
}
ticker.register('realm-festival', job);

module.exports = { NAMES, start, stop, active, nextAt, box, get, job };
