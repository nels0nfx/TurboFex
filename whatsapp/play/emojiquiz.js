// Guess the word, movie or phrase from emojis
const { num } = require('../utils');
const { norm } = require('./riddle');

const timeoutMs = 60000;
const title = 'Emoji Quiz';

// [emojis, [accepted answers], hint]
const ITEMS = [
  ['🦁👑', ['lion king', 'the lion king'], 'a Disney movie'],
  ['🕷️🧑', ['spiderman', 'spider man', 'spider-man'], 'a superhero'],
  ['❄️👸', ['frozen', 'elsa'], 'a Disney movie'],
  ['🐠🔍', ['finding nemo', 'nemo'], 'a Disney/Pixar movie'],
  ['🧙‍♂️💍', ['lord of the rings', 'the lord of the rings'], 'a fantasy movie'],
  ['🚢🧊', ['titanic'], 'a famous movie'],
  ['🦇👨', ['batman'], 'a superhero'],
  ['🌏🌙', ['moon', 'earth and moon'], 'in space'],
  ['🍎📱', ['iphone', 'apple', 'apple iphone'], 'a phone brand'],
  ['🌧️☔', ['rain', 'umbrella'], 'weather'],
  ['🔥🐉', ['dragon', 'fire dragon', 'game of thrones'], 'a fantasy creature'],
  ['🏠🏃‍♂️', ['home run', 'homerun'], 'a sports term'],
  ['🐝🏠', ['beehive', 'bee hive', 'hive'], 'a place insects live'],
  ['🌹🐺', ['beauty and the beast'], 'a Disney movie'],
  ['⚽🏆', ['world cup', 'the world cup', 'fifa world cup'], 'a sports event'],
  ['🎹🐱', ['keyboard cat', 'piano cat'], 'a famous internet video'],
  ['📖🧙‍♂️⚡', ['harry potter'], 'a wizard'],
  ['🚗💨', ['fast and furious', 'fast furious', 'speed', 'fast car'], 'a movie series about cars'],
  ['👻🚫', ['ghostbusters', 'ghost busters'], 'a comedy movie'],
  ['🐼🥋', ['kung fu panda'], 'an animated movie'],
  ['🍫🏭', ['charlie and the chocolate factory', 'chocolate factory', 'willy wonka'], 'a candy movie'],
  ['🌊🐒', ['monkey', 'water monkey'], 'an animal'],
  ['🍕🐢', ['ninja turtles', 'teenage mutant ninja turtles', 'tmnt'], 'they love pizza'],
  ['🎈🏠👴', ['up'], 'a Pixar movie'],
  ['🦈🌊', ['jaws', 'shark'], 'a scary sea movie'],
  ['🔨⚡👱', ['thor'], 'a superhero'],
  ['🧞‍♂️🪔', ['aladdin'], 'a Disney movie'],
  ['🐀🍳', ['ratatouille'], 'a cooking movie'],
  ['🎤🐴', ['sing', 'horse singer'], 'an animated musical'],
  ['⏰🐰', ['alice in wonderland', 'white rabbit'], 'a story with a rabbit'],
];

const status = (g) => `😀 ${g.emojis}\n💡 Hint: ${g.hint} (${g.answers[0].length} letters)`;
const reveal = (g) => `The answer was *${g.answers[0]}*.`;

function create() {
  const [emojis, answers, hint] = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  return { type: 'emojiquiz', emojis, answers, hint };
}
const intro = (g) => `😀 *Emoji quiz*\n\n${g.emojis}\n\nWhat is it? Hint: ${g.hint}\nFirst to type it wins!`;

async function onMessage({ game, text, who, send, end, touch }) {
  const t = norm(text);
  if (!t || t.length > 50) return;
  touch();
  if (!game.answers.some((a) => norm(a) === t)) return;
  await send(`🎉 @${num(who.jid)} got it! The answer was *${game.answers[0]}*.`, [who.jid]);
  return end(who);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs, ITEMS };
