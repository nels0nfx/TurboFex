const clock = require('../core/clock');

const PLACES = {
  london: 'Europe/London', paris: 'Europe/Paris', berlin: 'Europe/Berlin', madrid: 'Europe/Madrid', rome: 'Europe/Rome',
  moscow: 'Europe/Moscow', istanbul: 'Europe/Istanbul', lisbon: 'Europe/Lisbon', amsterdam: 'Europe/Amsterdam',
  cairo: 'Africa/Cairo', lagos: 'Africa/Lagos', accra: 'Africa/Accra', nairobi: 'Africa/Nairobi', kampala: 'Africa/Kampala',
  johannesburg: 'Africa/Johannesburg', capetown: 'Africa/Johannesburg', durban: 'Africa/Johannesburg', pretoria: 'Africa/Johannesburg',
  harare: 'Africa/Harare', lusaka: 'Africa/Lusaka', windhoek: 'Africa/Windhoek', gaborone: 'Africa/Gaborone', maputo: 'Africa/Maputo',
  addisababa: 'Africa/Addis_Ababa', daressalaam: 'Africa/Dar_es_Salaam', casablanca: 'Africa/Casablanca', kinshasa: 'Africa/Kinshasa',
  dubai: 'Asia/Dubai', mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', india: 'Asia/Kolkata', karachi: 'Asia/Karachi', dhaka: 'Asia/Dhaka',
  bangkok: 'Asia/Bangkok', singapore: 'Asia/Singapore', hongkong: 'Asia/Hong_Kong', beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai',
  tokyo: 'Asia/Tokyo', seoul: 'Asia/Seoul', manila: 'Asia/Manila', jakarta: 'Asia/Jakarta', riyadh: 'Asia/Riyadh',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', perth: 'Australia/Perth', auckland: 'Pacific/Auckland',
  newyork: 'America/New_York', washington: 'America/New_York', chicago: 'America/Chicago', denver: 'America/Denver',
  losangeles: 'America/Los_Angeles', la: 'America/Los_Angeles', sanfrancisco: 'America/Los_Angeles', toronto: 'America/Toronto',
  vancouver: 'America/Vancouver', mexico: 'America/Mexico_City', saopaulo: 'America/Sao_Paulo', buenosaires: 'America/Argentina/Buenos_Aires',
  utc: 'UTC', gmt: 'UTC',
};

function resolveZone(input) {
  const key = input.toLowerCase().replace(/[^a-z]/g, '');
  if (PLACES[key]) return PLACES[key];
  // a real zone name such as Africa/Lagos (capital letters fixed)
  const fixed = input.split('/').map((p) => p.trim().split(/[_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('_')).join('/');
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: fixed });
    return fixed;
  } catch (err) {
    return null;
  }
}

module.exports = {
  name: 'time',
  category: 'tools',
  description: 'Current time here, or in another city: time Lagos, time New York, time Asia/Tokyo',
  async run({ rest, reply, prefix }) {
    if (!rest) {
      const p = clock.parts();
      return reply(`🕒 *${p.zone}*\n${p.time}\n📅 ${p.day}, ${p.date}`);
    }
    const zone = resolveZone(rest);
    if (!zone) return reply(`I do not know "${rest}".\nTry a big city (${prefix}time Lagos) or a zone name (${prefix}time Asia/Tokyo).`);
    const d = new Date();
    const f = (opts, loc = 'en-GB') => new Intl.DateTimeFormat(loc, { timeZone: zone, ...opts }).format(d);
    await reply(`🕒 *${rest.trim()}* (${zone})\n${f({ hour: 'numeric', minute: '2-digit', hour12: true }, 'en-US')}\n📅 ${f({ weekday: 'long' })}, ${f({ day: 'numeric', month: 'short', year: 'numeric' })}`);
  },
};
