// Guess the country from its flag
const { num } = require('../utils');
const { norm } = require('./typerace');

const timeoutMs = 45000;
const title = 'Flags';

// [ISO code, name, other accepted names]
const COUNTRIES = [
  ['NG', 'Nigeria'], ['GH', 'Ghana'], ['KE', 'Kenya'], ['ZA', 'South Africa'], ['EG', 'Egypt'], ['MA', 'Morocco'], ['ET', 'Ethiopia'], ['TZ', 'Tanzania'],
  ['UG', 'Uganda'], ['SN', 'Senegal'], ['CM', 'Cameroon'], ['DZ', 'Algeria'], ['ZW', 'Zimbabwe'], ['ZM', 'Zambia'], ['RW', 'Rwanda'], ['AO', 'Angola'],
  ['MZ', 'Mozambique'], ['CI', 'Ivory Coast', ['cote divoire', 'cote d ivoire']], ['US', 'United States', ['usa', 'america', 'united states of america', 'us']],
  ['GB', 'United Kingdom', ['uk', 'britain', 'great britain']], ['CA', 'Canada'], ['MX', 'Mexico'], ['BR', 'Brazil'], ['AR', 'Argentina'], ['CO', 'Colombia'],
  ['CL', 'Chile'], ['PE', 'Peru'], ['CU', 'Cuba'], ['JM', 'Jamaica'], ['FR', 'France'], ['DE', 'Germany'], ['IT', 'Italy'], ['ES', 'Spain'], ['PT', 'Portugal'],
  ['NL', 'Netherlands', ['holland']], ['BE', 'Belgium'], ['CH', 'Switzerland'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'],
  ['PL', 'Poland'], ['GR', 'Greece'], ['TR', 'Turkey', ['turkiye']], ['RU', 'Russia'], ['UA', 'Ukraine'], ['IE', 'Ireland'], ['IN', 'India'], ['PK', 'Pakistan'],
  ['BD', 'Bangladesh'], ['CN', 'China'], ['JP', 'Japan'], ['KR', 'South Korea', ['korea']], ['ID', 'Indonesia'], ['PH', 'Philippines'], ['VN', 'Vietnam'],
  ['TH', 'Thailand'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates', ['uae', 'emirates']], ['IL', 'Israel'],
  ['IR', 'Iran'], ['IQ', 'Iraq'], ['AU', 'Australia'], ['NZ', 'New Zealand'],
];

// the flag emoji of a country code (two regional indicator letters)
const flag = (iso) => String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const status = (g) => `🏳️ ${g.flag}  (${g.name.length} letters)`;
const reveal = (g) => `It was *${g.name}* ${g.flag}.`;

function create() {
  const [iso, name, alt = []] = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
  return { type: 'flags', flag: flag(iso), name, answers: [name, ...alt] };
}
const intro = (g) => `🏳️ *Flag quiz*\n\n${g.flag}\n\nWhich country is this? First to type it wins!`;

async function onMessage({ game, text, who, send, end, touch }) {
  const t = norm(text);
  if (!t || t.length > 40) return;
  touch();
  if (!game.answers.some((a) => norm(a) === t)) return;
  await send(`🎉 @${num(who.jid)} got it! It was *${game.name}* ${game.flag}.`, [who.jid]);
  return end(who);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs, COUNTRIES, flag };
