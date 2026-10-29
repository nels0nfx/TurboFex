// every unit is stored as "how many of the base unit it is"
const GROUPS = {
  length: { base: 'm', units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 } },
  weight: { base: 'g', units: { mg: 0.001, g: 1, kg: 1000, t: 1e6, oz: 28.349523125, lb: 453.59237 } },
  volume: { base: 'l', units: { ml: 0.001, l: 1, gal: 3.785411784, cup: 0.2365882365, floz: 0.0295735295625 } },
  speed: { base: 'ms', units: { ms: 1, kmh: 1 / 3.6, mph: 0.44704, knot: 0.514444 } },
  data: { base: 'b', units: { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 } },
};
const ALIASES = { kph: 'kmh', 'km/h': 'kmh', 'm/s': 'ms', mile: 'mi', miles: 'mi', feet: 'ft', foot: 'ft', inch: 'in', inches: 'in', kilometer: 'km', kilometers: 'km', meter: 'm', meters: 'm', kilo: 'kg', kilos: 'kg', pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', litre: 'l', liter: 'l', litres: 'l', liters: 'l', celsius: 'c', fahrenheit: 'f', kelvin: 'k', '°c': 'c', '°f': 'f' };

const TEMPS = ['c', 'f', 'k'];
const toC = (v, u) => (u === 'c' ? v : u === 'f' ? (v - 32) * 5 / 9 : v - 273.15);
const fromC = (v, u) => (u === 'c' ? v : u === 'f' ? v * 9 / 5 + 32 : v + 273.15);
const round = (n) => Math.round(n * 1e6) / 1e6;

module.exports = {
  name: 'convert',
  category: 'tools',
  aliases: ['unit'],
  description: 'Convert units: convert 10 km mi, convert 30 c f, convert 5 kg lb',
  async run({ args, reply, prefix }) {
    const value = parseFloat(args[0]);
    const norm = (u) => { const x = String(u || '').toLowerCase(); return ALIASES[x] || x; };
    const from = norm(args[1]);
    const to = norm(args[2]);
    if (!Number.isFinite(value) || !from || !to) {
      return reply(`Write: ${prefix}convert <number> <from> <to>\nExamples: ${prefix}convert 10 km mi\n${prefix}convert 30 c f\n${prefix}convert 5 kg lb\n\nUnits: mm cm m km in ft yd mi | mg g kg t oz lb | ml l gal cup | kmh mph ms knot | b kb mb gb tb | c f k`);
    }
    if (TEMPS.includes(from) && TEMPS.includes(to)) {
      return reply(`🌡️ ${value}°${from.toUpperCase()} = *${round(fromC(toC(value, from), to))}°${to.toUpperCase()}*`);
    }
    const group = Object.values(GROUPS).find((g) => from in g.units && to in g.units);
    if (!group) return reply('⚠️ I cannot convert between those two units (they must measure the same thing).');
    await reply(`📏 ${value} ${from} = *${round((value * group.units[from]) / group.units[to])} ${to}*`);
  },
};
