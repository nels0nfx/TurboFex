// Wordle: guess the 5-letter word in 6 tries, as a team. Green = right place, yellow = in the word, black = not in the word.
const { num } = require('../utils');

const MAX_TRIES = 6;
const timeoutMs = 300000; // 5 minutes
const title = 'Wordle';

const WORDS = ['about', 'above', 'actor', 'adult', 'after', 'again', 'agent', 'alarm', 'album', 'alive', 'allow', 'alone', 'among', 'angry', 'apple', 'arena', 'argue', 'arise', 'armed', 'aside', 'audio', 'avoid', 'awake', 'award', 'bacon', 'badge', 'baker', 'basic', 'beach', 'beard', 'began', 'begin', 'being', 'below', 'bench', 'bible', 'birth', 'black', 'blame', 'blank', 'blast', 'blind', 'block', 'blood', 'board', 'boost', 'brain', 'brand', 'bread', 'break', 'brick', 'brief', 'bring', 'broad', 'brown', 'brush', 'build', 'cabin', 'candy', 'cargo', 'carry', 'catch', 'cause', 'chain', 'chair', 'chalk', 'charm', 'chart', 'chase', 'cheap', 'check', 'chest', 'chief', 'child', 'chose', 'civil', 'claim', 'class', 'clean', 'clear', 'climb', 'clock', 'close', 'cloud', 'coach', 'coast', 'could', 'count', 'court', 'cover', 'craft', 'crash', 'cream', 'crowd', 'crown', 'curve', 'daily', 'dance', 'death', 'delay', 'depth', 'dirty', 'doubt', 'dozen', 'draft', 'drama', 'dream', 'dress', 'drink', 'drive', 'eager', 'early', 'earth', 'eight', 'elite', 'empty', 'enemy', 'enjoy', 'enter', 'equal', 'error', 'event', 'every', 'exact', 'extra', 'faith', 'false', 'fancy', 'fault', 'feast', 'fiber', 'field', 'fifth', 'fight', 'final', 'first', 'flame', 'flash', 'fleet', 'floor', 'fluid', 'focus', 'force', 'forth', 'found', 'frame', 'fresh', 'front', 'fruit', 'funny', 'giant', 'given', 'glass', 'globe', 'glory', 'grace', 'grade', 'grain', 'grand', 'grant', 'grass', 'great', 'green', 'group', 'guard', 'guess', 'guest', 'guide', 'happy', 'heart', 'heavy', 'honey', 'horse', 'hotel', 'house', 'human', 'humor', 'ideal', 'image', 'index', 'inner', 'input', 'issue', 'jelly', 'joint', 'judge', 'juice', 'knife', 'known', 'label', 'large', 'laser', 'later', 'laugh', 'layer', 'learn', 'least', 'leave', 'legal', 'lemon', 'level', 'light', 'limit', 'local', 'logic', 'loose', 'lucky', 'lunch', 'magic', 'major', 'maker', 'march', 'match', 'maybe', 'mayor', 'meant', 'media', 'mercy', 'metal', 'might', 'minor', 'minus', 'model', 'money', 'month', 'moral', 'motor', 'mount', 'mouse', 'mouth', 'movie', 'music', 'naked', 'nerve', 'never', 'newly', 'night', 'noise', 'north', 'novel', 'nurse', 'ocean', 'offer', 'often', 'olive', 'onion', 'opera', 'order', 'other', 'ought', 'outer', 'owner', 'paint', 'panel', 'paper', 'party', 'peace', 'phase', 'phone', 'photo', 'piano', 'piece', 'pilot', 'pitch', 'place', 'plain', 'plane', 'plant', 'plate', 'point', 'pound', 'power', 'press', 'price', 'pride', 'prime', 'print', 'prior', 'prize', 'proof', 'proud', 'queen', 'quick', 'quiet', 'quite', 'radio', 'raise', 'range', 'rapid', 'ratio', 'reach', 'ready', 'realm', 'relax', 'reply', 'rider', 'right', 'river', 'robot', 'rough', 'round', 'route', 'royal', 'rural', 'salad', 'scale', 'scene', 'scope', 'score', 'sense', 'serve', 'seven', 'shade', 'shake', 'shall', 'shape', 'share', 'sharp', 'sheep', 'sheet', 'shelf', 'shell', 'shift', 'shine', 'shirt', 'shock', 'shoot', 'short', 'sight', 'since', 'sixth', 'skill', 'sleep', 'slice', 'slide', 'small', 'smart', 'smile', 'smoke', 'snake', 'solid', 'solve', 'sorry', 'sound', 'south', 'space', 'spare', 'speak', 'speed', 'spend', 'spice', 'split', 'sport', 'staff', 'stage', 'stand', 'start', 'state', 'steam', 'steel', 'stick', 'still', 'stock', 'stone', 'store', 'storm', 'story', 'strip', 'study', 'stuff', 'style', 'sugar', 'suite', 'sunny', 'super', 'sweet', 'table', 'taste', 'teach', 'thank', 'their', 'theme', 'there', 'these', 'thick', 'thing', 'think', 'third', 'those', 'three', 'throw', 'tiger', 'tight', 'timer', 'title', 'today', 'tooth', 'topic', 'total', 'touch', 'tough', 'tower', 'track', 'trade', 'train', 'treat', 'trend', 'trial', 'tribe', 'trick', 'truck', 'truly', 'trust', 'truth', 'twice', 'uncle', 'under', 'union', 'unity', 'until', 'upper', 'upset', 'urban', 'usage', 'usual', 'valid', 'value', 'video', 'virus', 'visit', 'vital', 'vocal', 'voice', 'waste', 'watch', 'water', 'wheel', 'where', 'which', 'while', 'white', 'whole', 'whose', 'woman', 'world', 'worry', 'worth', 'would', 'write', 'wrong', 'young', 'youth'];

// colours for one guess: 🟩 right place, 🟨 in the word, ⬛ not in the word (a letter used twice is only marked as often as it is in the word)
function score(guess, word) {
  const res = Array(5).fill('⬛');
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === word[i]) res[i] = '🟩';
    else left[word[i]] = (left[word[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === '🟩') continue;
    if (left[guess[i]] > 0) {
      res[i] = '🟨';
      left[guess[i]] -= 1;
    }
  }
  return res.join('');
}

const board = (g) => g.guesses.map((x) => `${score(x, g.word)}  ${x.toUpperCase()}`).join('\n');
const status = (g) => `🟩 Wordle • ${MAX_TRIES - g.guesses.length} tries left${g.guesses.length ? `\n${board(g)}` : ''}`;
const reveal = (g) => `The word was *${g.word.toUpperCase()}*.`;

function create() {
  return { type: 'wordle', word: WORDS[Math.floor(Math.random() * WORDS.length)], guesses: [] };
}
const intro = () => `🟩 *Wordle*\nGuess the 5-letter word! You have ${MAX_TRIES} tries as a team.\n🟩 right letter, right place\n🟨 right letter, wrong place\n⬛ not in the word\n\nSend a 5-letter word.`;

async function onMessage({ game, text, who, send, end, touch }) {
  const t = text.toLowerCase();
  if (!/^[a-z]{5}$/.test(t)) return;
  if (game.guesses.includes(t)) return send('ℹ️ You already tried that word.');
  touch();
  game.guesses.push(t);
  if (t === game.word) {
    await send(`🎉 @${num(who.jid)} got it in ${game.guesses.length}!\n\n${board(game)}`, [who.jid]);
    return end(who);
  }
  if (game.guesses.length >= MAX_TRIES) {
    await send(`😵 Out of tries!\n\n${board(game)}\n\nThe word was *${game.word.toUpperCase()}*.`);
    return end();
  }
  return send(`${board(game)}\n\n${MAX_TRIES - game.guesses.length} tries left`);
}

module.exports = { title, status, create, intro, onMessage, reveal, timeoutMs, score, WORDS };
