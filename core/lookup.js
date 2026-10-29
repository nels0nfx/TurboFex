// The pure parts of the lookup commands (weather, translate, currency): kept apart from the network code so they can be tested.

const WMO = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog with frost',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};
const weatherText = (code) => WMO[code] || 'Unknown';

const dayName = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

// Open-Meteo answers -> the message
function weatherMessage(place, w) {
  const c = w.current;
  const lines = [
    `*Weather in ${place}*`,
    `▸ *Now:* ${Math.round(c.temperature_2m)}°C (feels like ${Math.round(c.apparent_temperature)}°C), ${weatherText(c.weather_code)}`,
    `▸ *Humidity:* ${c.relative_humidity_2m}%   *Wind:* ${Math.round(c.wind_speed_10m)} km/h`,
    `▸ *Rain now:* ${c.precipitation} mm`,
    '',
    '*Next days*',
  ];
  const d = w.daily;
  for (let i = 0; i < Math.min(3, d.time.length); i++) {
    lines.push(`▸ ${i === 0 ? 'Today' : dayName(d.time[i])}: ${Math.round(d.temperature_2m_min[i])}–${Math.round(d.temperature_2m_max[i])}°C, ${weatherText(d.weather_code[i])}, rain chance ${d.precipitation_probability_max[i] ?? 0}%`);
  }
  return lines.join('\n');
}

const LANGS = {
  af: 'Afrikaans', ar: 'Arabic', bn: 'Bengali', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
  fa: 'Persian', fi: 'Finnish', fr: 'French', ha: 'Hausa', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian', ig: 'Igbo',
  it: 'Italian', ja: 'Japanese', ko: 'Korean', ms: 'Malay', nl: 'Dutch', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian',
  ru: 'Russian', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil', th: 'Thai', tl: 'Filipino', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu',
  vi: 'Vietnamese', yo: 'Yoruba', zh: 'Chinese', zu: 'Zulu',
};

// "fr", "French" -> "fr" (or null)
function langCode(input) {
  const t = String(input || '').toLowerCase().trim();
  if (LANGS[t]) return t;
  return Object.keys(LANGS).find((k) => LANGS[k].toLowerCase() === t) || null;
}

// "100 usd eur" -> { amount: 100, from: 'USD', to: 'EUR' }; "usd ngn" -> amount 1. Also "100 usd to eur".
function parseConvert(text) {
  const words = String(text || '').trim().split(/\s+/).filter((w) => w.toLowerCase() !== 'to' && w.toLowerCase() !== 'in');
  let amount = 1;
  if (words.length && /^[\d.,]+$/.test(words[0])) amount = Number(words.shift().replace(/,/g, ''));
  if (words.length !== 2 || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) return null;
  const [from, to] = words.map((w) => w.toUpperCase());
  return /^[A-Z]{3}$/.test(from) && /^[A-Z]{3}$/.test(to) ? { amount, from, to } : null;
}

const money = (n) => (n >= 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(Number(n.toPrecision(4))));

module.exports = { weatherText, weatherMessage, dayName, langCode, LANGS, parseConvert, money };
