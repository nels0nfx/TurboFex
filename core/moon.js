// Moon phase worked out on the bot itself (no web service needed). Good to within about a day.
const SYNODIC = 29.530588853; // days from one new moon to the next
const EPOCH = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
const DAY = 86400000;

const PHASES = [
  ['New Moon', '🌑'],
  ['Waxing Crescent', '🌒'],
  ['First Quarter', '🌓'],
  ['Waxing Gibbous', '🌔'],
  ['Full Moon', '🌕'],
  ['Waning Gibbous', '🌖'],
  ['Last Quarter', '🌗'],
  ['Waning Crescent', '🌘'],
];

// age: days since the last new moon (0 to 29.5)
function age(date = new Date()) {
  const days = (date.getTime() - EPOCH) / DAY;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC;
}

function info(date = new Date()) {
  const a = age(date);
  const slot = Math.floor(((a / SYNODIC) * 8 + 0.5) % 8); // 8 phases, each centred on its moment
  const [name, emoji] = PHASES[slot];
  const lit = Math.round(((1 - Math.cos((2 * Math.PI * a) / SYNODIC)) / 2) * 100);
  const toFull = (SYNODIC / 2 - a + SYNODIC) % SYNODIC;
  const toNew = (SYNODIC - a) % SYNODIC;
  return {
    name,
    emoji,
    age: a,
    lit,
    nextFull: new Date(date.getTime() + toFull * DAY),
    nextNew: new Date(date.getTime() + (toNew || SYNODIC) * DAY),
  };
}

module.exports = { info, age, SYNODIC };
