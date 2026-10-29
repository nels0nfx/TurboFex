// region: the bot's region = its time zone. It decides the clock in menus, scheduled messages, birthdays (08:00) and auto open/close.
const store = require('../whatsapp/store');
const clock = require('../core/clock');

// country (or common name) -> time zone. A country with several zones gets its main one; use the city form for another (Africa/Lagos).
const COUNTRIES = {
  nigeria: 'Africa/Lagos', ghana: 'Africa/Accra', kenya: 'Africa/Nairobi', 'south africa': 'Africa/Johannesburg', uganda: 'Africa/Kampala',
  tanzania: 'Africa/Dar_es_Salaam', zimbabwe: 'Africa/Harare', zambia: 'Africa/Lusaka', botswana: 'Africa/Gaborone', namibia: 'Africa/Windhoek',
  mozambique: 'Africa/Maputo', malawi: 'Africa/Blantyre', rwanda: 'Africa/Kigali', ethiopia: 'Africa/Addis_Ababa', egypt: 'Africa/Cairo',
  morocco: 'Africa/Casablanca', algeria: 'Africa/Algiers', tunisia: 'Africa/Tunis', senegal: 'Africa/Dakar', cameroon: 'Africa/Douala',
  'ivory coast': 'Africa/Abidjan', angola: 'Africa/Luanda', sudan: 'Africa/Khartoum', somalia: 'Africa/Mogadishu', lesotho: 'Africa/Maseru',
  eswatini: 'Africa/Mbabane', swaziland: 'Africa/Mbabane', congo: 'Africa/Kinshasa', drc: 'Africa/Kinshasa', liberia: 'Africa/Monrovia',
  uk: 'Europe/London', 'united kingdom': 'Europe/London', england: 'Europe/London', ireland: 'Europe/Dublin', france: 'Europe/Paris',
  germany: 'Europe/Berlin', spain: 'Europe/Madrid', portugal: 'Europe/Lisbon', italy: 'Europe/Rome', netherlands: 'Europe/Amsterdam',
  belgium: 'Europe/Brussels', switzerland: 'Europe/Zurich', sweden: 'Europe/Stockholm', norway: 'Europe/Oslo', poland: 'Europe/Warsaw',
  greece: 'Europe/Athens', turkey: 'Europe/Istanbul', russia: 'Europe/Moscow', ukraine: 'Europe/Kyiv',
  usa: 'America/New_York', us: 'America/New_York', 'united states': 'America/New_York', canada: 'America/Toronto', mexico: 'America/Mexico_City',
  brazil: 'America/Sao_Paulo', argentina: 'America/Argentina/Buenos_Aires', colombia: 'America/Bogota', peru: 'America/Lima', chile: 'America/Santiago',
  jamaica: 'America/Jamaica', 'trinidad and tobago': 'America/Port_of_Spain',
  india: 'Asia/Kolkata', pakistan: 'Asia/Karachi', bangladesh: 'Asia/Dhaka', 'sri lanka': 'Asia/Colombo', nepal: 'Asia/Kathmandu',
  china: 'Asia/Shanghai', japan: 'Asia/Tokyo', korea: 'Asia/Seoul', 'south korea': 'Asia/Seoul', indonesia: 'Asia/Jakarta', philippines: 'Asia/Manila',
  vietnam: 'Asia/Ho_Chi_Minh', thailand: 'Asia/Bangkok', malaysia: 'Asia/Kuala_Lumpur', singapore: 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong',
  uae: 'Asia/Dubai', dubai: 'Asia/Dubai', 'united arab emirates': 'Asia/Dubai', 'saudi arabia': 'Asia/Riyadh', qatar: 'Asia/Qatar', kuwait: 'Asia/Kuwait',
  iran: 'Asia/Tehran', iraq: 'Asia/Baghdad', israel: 'Asia/Jerusalem', jordan: 'Asia/Amman', lebanon: 'Asia/Beirut',
  australia: 'Australia/Sydney', 'new zealand': 'Pacific/Auckland',
};

const valid = (z) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: z });
    return true;
  } catch (err) {
    return false;
  }
};

const allZones = () => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch (err) {
    return [];
  }
};

// "Nigeria", "lagos", "Africa/Lagos", "UTC+2" -> a time zone name (or null)
function find(input) {
  const raw = String(input || '').trim();
  const q = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  if (COUNTRIES[q]) return COUNTRIES[q];
  const utc = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})$/.exec(q);
  if (utc) {
    const h = Number(utc[2]);
    if (h > 14) return null;
    return h === 0 ? 'UTC' : `Etc/GMT${utc[1] === '+' ? '-' : '+'}${h}`; // Etc zones are written the other way round
  }
  const exact = allZones().find((z) => z.toLowerCase() === q.replace(/ /g, '_'));
  if (exact) return exact;
  if (raw.includes('/') && valid(raw)) return raw;
  const city = q.replace(/ /g, '_');
  const byCity = allZones().filter((z) => z.toLowerCase().split('/').pop() === city);
  return byCity.length === 1 ? byCity[0] : null;
}

const show = (z) => {
  const p = clock.parts();
  return `*${z}*\n▸ Time now: ${p.time}\n▸ Date: ${p.date}`;
};

module.exports = {
  name: 'region',
  aliases: ['timezone', 'tz'],
  category: 'owner',
  ownerOnly: true,
  needs: [],
  weight: 'light',
  description: 'Change the bot region (time zone): region Nigeria, region Africa/Lagos, region reset',
  async run({ args, rest, reply, prefix }) {
    const q = rest.trim();
    if (!q) {
      return reply(
        `*Bot region*\n${show(clock.zone())}\n\n` +
          `The region sets the clock, scheduled messages, birthdays (08:00) and auto open/close.\n` +
          `▸ \`${prefix}region Nigeria\`\n▸ \`${prefix}region Africa/Lagos\`\n▸ \`${prefix}region UTC+2\`\n▸ \`${prefix}region reset\` (back to the default)`
      );
    }
    if (/^(reset|default)$/i.test(q)) {
      store.setRegion(null);
      return reply(`✅ Region is back to the default.\n${show(clock.zone())}`);
    }
    const zone = find(q);
    if (!zone || !valid(zone)) {
      return reply(`⚠️ I do not know the region "${q.slice(0, 40)}". Try a country (Nigeria), a city (Lagos) or a full name like Africa/Lagos.`);
    }
    store.setRegion(zone);
    return reply(`✅ Region changed.\n${show(zone)}`);
  },
};
module.exports.find = find;
