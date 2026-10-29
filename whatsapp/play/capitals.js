// Guess the capital city of a country
const { num } = require('../utils');
const { norm } = require('./typerace');

const timeoutMs = 45000;
const title = 'Capitals';

// [country, capital, other accepted answers]
const CAPITALS = [
  ['Nigeria', 'Abuja'], ['Ghana', 'Accra'], ['Kenya', 'Nairobi'], ['South Africa', 'Pretoria', ['cape town', 'bloemfontein']], ['Egypt', 'Cairo'], ['Morocco', 'Rabat'],
  ['Ethiopia', 'Addis Ababa'], ['Tanzania', 'Dodoma'], ['Uganda', 'Kampala'], ['Senegal', 'Dakar'], ['Cameroon', 'Yaounde'], ['Algeria', 'Algiers'],
  ['Zimbabwe', 'Harare'], ['Zambia', 'Lusaka'], ['Rwanda', 'Kigali'], ['Angola', 'Luanda'], ['Mozambique', 'Maputo'], ['Ivory Coast', 'Yamoussoukro', ['abidjan']],
  ['United States', 'Washington DC', ['washington', 'washington d c']], ['United Kingdom', 'London'], ['Canada', 'Ottawa'], ['Mexico', 'Mexico City'], ['Brazil', 'Brasilia'],
  ['Argentina', 'Buenos Aires'], ['Colombia', 'Bogota'], ['Chile', 'Santiago'], ['Peru', 'Lima'], ['Cuba', 'Havana'], ['Jamaica', 'Kingston'], ['France', 'Paris'],
  ['Germany', 'Berlin'], ['Italy', 'Rome'], ['Spain', 'Madrid'], ['Portugal', 'Lisbon'], ['Netherlands', 'Amsterdam'], ['Belgium', 'Brussels'], ['Switzerland', 'Bern'],
  ['Sweden', 'Stockholm'], ['Norway', 'Oslo'], ['Denmark', 'Copenhagen'], ['Finland', 'Helsinki'], ['Poland', 'Warsaw'], ['Greece', 'Athens'], ['Turkey', 'Ankara'],
  ['Russia', 'Moscow'], ['Ukraine', 'Kyiv', ['kiev']], ['Ireland', 'Dublin'], ['India', 'New Delhi', ['delhi']], ['Pakistan', 'Islamabad'], ['Bangladesh', 'Dhaka'],
  ['China', 'Beijing', ['peking']], ['Japan', 'Tokyo'], ['South Korea', 'Seoul'], ['Indonesia', 'Jakarta'], ['Philippines', 'Manila'], ['Vietnam', 'Hanoi'],
  ['Thailand', 'Bangkok'], ['Malaysia', 'Kuala Lumpur'], ['Singapore', 'Singapore'], ['Saudi Arabia', 'Riyadh'], ['United Arab Emirates', 'Abu Dhabi'],
  ['Israel', 'Jerusalem'], ['Iran', 'Tehran'], ['Iraq', 'Baghdad'], ['Australia', 'Canberra'], ['New Zealand', 'Wellington'],
];

const status = (g) => `🏙️ Capital of ${g.country} (${g.capital.length} letters, starts with ${g.capital[0]})`;
const reveal = (g) => `The capital of ${g.country} is *${g.capital}*.`;

function create() {
  const [country, capital, alt = []] = CAPITALS[Math.floor(Math.random() * CAPITALS.length)];
  return { type: 'capitals', country, capital, answers: [capital, ...alt] };
}
const intro = (g) => `🏙️ *Capital quiz*\n\nWhat is the capital city of *${g.country}*?\nFirst to type it wins!`;

async function onMessage({ game, text, who, send, end, touch }) {
  const t = norm(text);
  if (!t || t.length > 40) return;
  touch();
  if (!game.answers.some((a) => norm(a) === t)) return;
  await send(`🎉 @${num(who.jid)} got it! The capital of ${game.country} is *${game.capital}*.`, [who.jid]);
  return end(who);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs, CAPITALS };
