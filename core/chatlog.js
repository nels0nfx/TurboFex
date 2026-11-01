// The console shows a small card for every message the bot handles, in a soft "holographic" gradient:
//
//   ╭─ 21:35:07 ─ GROUP ─ CMD ────────
//   │ Chat    Fex Squad (128)
//   │ From    Ada · Admin
//   │ Number  +27833333333
//   │ Kind    text · command menu
//   │ Text    .menu
//   │ Speed   ▰▰▰▰▰▰▰▰ 48 ms
//   ╰─ instant ───────────────────────
//
// The card is printed when the bot has finished with the message, so the speed is real.
// Settings (all optional, set them as host variables or in config.env):
//   CONSOLE_CHAT=off       hide the cards            CONSOLE_CHAT=compact   one short line per message
//   CONSOLE_COLOR=off      no colours                CONSOLE_COLOR=256      for old terminals that do not know full colours
//   CONSOLE_THEME=holo     (default) cyan, violet, pink      aurora: green, blue, purple      sunset: gold, coral, purple      gold: the old look
//   CONSOLE_WIDTH=36       width of the card (28 to 70). Without it the width follows the screen, or 36.
// NOTE: this prints what people write to the bot, on the owner's console only. Nothing is saved to a file.
//
// Why true colours and not the 16 basic ones: some host panels redraw the basic "black" and "white" in their own theme, which
// made the old badges unreadable (the text had the same colour as the badge). Every colour here is written out in full.

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const THEMES = {
  holo: [[0, 229, 255], [122, 134, 255], [214, 112, 255], [255, 128, 196], [255, 196, 140]],
  aurora: [[72, 255, 176], [0, 214, 255], [96, 140, 255], [170, 110, 255]],
  sunset: [[255, 214, 94], [255, 150, 96], [255, 96, 140], [190, 90, 255]],
  gold: [[255, 232, 120], [255, 200, 40], [255, 150, 30]],
};
const INK = [12, 12, 28]; // dark text on a coloured badge
const LABEL_COLOR = [150, 150, 190]; // the words Chat, From, Number...
const SOFT = [226, 228, 246]; // normal text
const BRIGHT = [255, 255, 255];
const DIM = [105, 108, 140];
const MINT = [88, 255, 176];
const SKY = [96, 214, 255];
const AMBER = [255, 190, 90];
const CORAL = [255, 100, 112];

const MAX_LINES = 3; // a long message is cut after this many lines
const LABEL = 8; // "Number  "

const off = (v) => ['off', '0', 'false', 'no'].includes(String(v || '').toLowerCase());
const enabled = () => !off(process.env.CONSOLE_CHAT);
const compact = () => String(process.env.CONSOLE_CHAT || '').toLowerCase() === 'compact';
const colorOn = () => !off(process.env.CONSOLE_COLOR) && process.env.NO_COLOR === undefined;
const mode256 = () => /^(256|8bit)$/i.test(String(process.env.CONSOLE_COLOR || ''));

// the width of a card: CONSOLE_WIDTH, else the screen (when there is one), else 36 (fits a phone)
function width() {
  const set = Number(process.env.CONSOLE_WIDTH);
  const cols = Number(process.stdout && process.stdout.columns) || 0;
  const w = set || (cols ? cols - 2 : 36);
  return Math.max(28, Math.min(70, Math.round(w)));
}

// ---------------------------------------------------------------- colours
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
function to256([r, g, b]) {
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) return Math.max(232, Math.min(255, 232 + Math.round((r - 8) / 10.4))); // grey ramp
  const c = (x) => Math.round((clamp(x) / 255) * 5);
  return 16 + 36 * c(r) + 6 * c(g) + c(b);
}
const fgCode = (rgb) => (mode256() ? `\x1b[38;5;${to256(rgb)}m` : `\x1b[38;2;${rgb.map(clamp).join(';')}m`);
const bgCode = (rgb) => (mode256() ? `\x1b[48;5;${to256(rgb)}m` : `\x1b[48;2;${rgb.map(clamp).join(';')}m`);

const stops = () => THEMES[String(process.env.CONSOLE_THEME || '').toLowerCase()] || THEMES.holo;
// the colour at position t (0 to 1) along the theme
function at(t) {
  const s = stops();
  const x = Math.max(0, Math.min(1, t)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(x));
  const f = x - i;
  return s[i].map((v, k) => v + (s[i + 1][k] - v) * f);
}

// text in one colour (plain text when colours are off)
const paint = (rgb, text, bold = false) => (colorOn() ? `${bold ? BOLD : ''}${fgCode(rgb)}${text}${RESET}` : text);
// text where every letter has its own colour, from position a to position b of the theme
function gradient(text, a = 0, b = 1, bold = false) {
  if (!colorOn()) return text;
  const chars = [...String(text)];
  if (!chars.length) return '';
  const out = chars.map((ch, i) => (ch === ' ' ? ch : `${fgCode(at(a + ((b - a) * i) / Math.max(1, chars.length - 1)))}${ch}`)).join('');
  return `${bold ? BOLD : ''}${out}${RESET}`;
}
// a badge: dark text on a coloured background
const pill = (text, t) => (colorOn() ? `${bgCode(at(t))}${fgCode(INK)}${BOLD} ${text} ${RESET}` : `[${text}]`);

// ---------------------------------------------------------------- text helpers
// text people wrote can hold control characters (even colour codes): remove them so they cannot mess up the console
const clean = (s) =>
  String(s || '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '');
const oneLine = (s, max) => {
  const t = clean(s).replace(/\s*\n\s*/g, ' ⏎ ').replace(/\s{2,}/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// cuts text into lines of at most `width` characters (a very long word is cut too)
function wrap(text, width, maxLines) {
  const out = [];
  for (const raw of clean(text).split('\n')) {
    let line = '';
    for (let word of raw.trim().split(/\s+/).filter(Boolean)) {
      while ([...word].length > width) {
        if (line) { out.push(line); line = ''; }
        out.push([...word].slice(0, width).join(''));
        word = [...word].slice(width).join('');
      }
      if ([...line].length + [...word].length + (line ? 1 : 0) > width) { out.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  const lines = out.filter((l, i, a) => l || (i > 0 && i < a.length - 1 && a[i - 1])); // keep single empty lines between paragraphs
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${[...kept[maxLines - 1]].slice(0, width - 1).join('').trimEnd()}…`;
    return kept;
  }
  return lines;
}

// what kind of message is it?
const KINDS = [
  ['imageMessage', 'image'], ['videoMessage', 'video'], ['audioMessage', 'voice/audio'], ['stickerMessage', 'sticker'],
  ['documentMessage', 'document'], ['contactMessage', 'contact'], ['contactsArrayMessage', 'contacts'], ['locationMessage', 'location'],
  ['liveLocationMessage', 'live location'], ['pollCreationMessage', 'poll'], ['pollCreationMessageV3', 'poll'], ['reactionMessage', 'reaction'],
];
function kindOf(content) {
  for (const [key, label] of KINDS) if (content && content[key]) return label;
  return 'text';
}

// speed: a bar of 8 and a word
function speed(ms) {
  const steps = [[120, 8, 'instant'], [250, 7, 'very fast'], [500, 6, 'fast'], [800, 5, 'good'], [1200, 4, 'normal'], [2000, 3, 'slowish'], [4000, 2, 'slow']];
  const hit = steps.find(([limit]) => ms < limit) || [Infinity, 1, 'very slow'];
  const shown = ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.max(0, Math.round(ms))} ms`;
  return { filled: hit[1], word: hit[2], shown };
}
// green when fast, amber when slowish, red when slow
const speedColor = (filled) => (filled >= 7 ? MINT : filled >= 5 ? SKY : filled >= 3 ? AMBER : CORAL);

const timeText = () => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: require('./clock').zone(), hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
  } catch (err) {
    return new Date().toISOString().slice(11, 19);
  }
};

// ---------------------------------------------------------------- the card (a pure function, so a test can check it)
function card({ time, group, chat, members, who, role, number, kind, isCommand, command, text, ms, fromMe }) {
  const W = width();
  const VALUE = W - 2 - LABEL; // room for the words after a label
  const where = group ? 'GROUP' : 'PRIVATE';

  // the top line: time, where, and CMD for a command; the rest is a gradient rule
  const used = 3 + time.length + 3 + (where.length + 2) + (isCommand ? 3 + 5 : 0) + 1;
  const rule = (n, a, b) => gradient('─'.repeat(Math.max(2, n)), a, b);
  const top = `${gradient('╭─', 0, 0.05)} ${paint(BRIGHT, time, true)} ${gradient('─', 0.08, 0.1)} ${pill(where, group ? 0.78 : 0.18)}${
    isCommand ? ` ${gradient('─', 0.3, 0.32)} ${pill('CMD', 0.5)}` : ''
  } ${rule(W - used, 0.4, 1)}`;

  // the lines of the card, each with a stick coloured along the gradient
  const lines = [];
  const add = (label, value) => lines.push([label, value]);
  add('Chat', group ? paint(SKY, `${oneLine(chat, VALUE - (members ? String(members).length + 3 : 0))}${members ? ` (${members})` : ''}`, true) : paint(BRIGHT, 'Private chat', true));
  add('From', `${paint(BRIGHT, oneLine(who, 16), true)}${fromMe ? paint(at(0.8), ' · bot account') : role ? paint(at(0.8), ` · ${role}`) : ''}`);
  if (number) add('Number', paint(SOFT, number));
  add('Kind', `${paint(SOFT, kind)}${isCommand ? `${paint(DIM, ' · ')}${gradient(`command${command ? ` ${command}` : ''}`, 0.15, 0.85, true)}` : ''}`);
  const body = wrap(text || '', VALUE, MAX_LINES);
  body.forEach((line, i) => add(i === 0 ? 'Text' : '', isCommand ? gradient(line, 0.1, 0.9) : paint(SOFT, line)));
  const sp = speed(ms);
  const sc = speedColor(sp.filled);
  const bar = [...Array(8).keys()].map((i) => (i < sp.filled ? paint(at((i + 0.5) / 8), '▰') : paint(DIM, '▱'))).join('');
  add('Speed', `${bar} ${paint(sc, sp.shown, true)}`);

  const total = lines.length + 1;
  const rows = lines.map(([label, value], i) => `${paint(at((i + 1) / (total + 1)), '│')} ${paint(LABEL_COLOR, label.padEnd(LABEL))}${value}`);
  // the bottom line carries the verdict
  const bottom = `${gradient('╰─', 0.9, 1)} ${paint(sc, sp.word, true)} ${rule(W - (sp.word.length + 4), 0.9, 0.2)}`;
  return [top, ...rows, bottom].join('\n');
}

// one short line (CONSOLE_CHAT=compact)
function line({ time, group, chat, who, text, kind, isCommand, fromMe }) {
  const body = text ? oneLine(text, 110) : `[${kind || 'message'}]`;
  const arrow = fromMe ? paint(at(0.8), '➜') : paint(DIM, '│');
  const chatPart = group ? `${paint(SKY, oneLine(chat, 28), true)} ${paint(DIM, '›')} ` : '';
  return `${paint(BRIGHT, time, true)} ${pill(group ? 'GROUP' : 'PRIVATE', group ? 0.78 : 0.18)} ${chatPart}${paint(BRIGHT, oneLine(who, 22), true)} ${arrow} ${isCommand ? gradient(body, 0.1, 0.9) : paint(SOFT, body)}`;
}

const pending = new WeakMap(); // message -> what we know about it, until the bot is done with it

// the handler tells us about every message it accepts (never throws, never waits)
function incoming({ msg, jid, isGroup, text, content, prefix, isCommand }) {
  if (!enabled()) return;
  try {
    const names = require('../whatsapp/names');
    const meta = require('../whatsapp/metadata');
    const { num, participantIds } = require('../whatsapp/utils');
    const k = msg.key || {};
    const fromMe = !!k.fromMe;
    const sender = isGroup ? k.participant : jid;
    const info = meta.peek(jid);
    const me = num(sender);
    const member = isGroup && info ? (info.participants || []).find((p) => participantIds(p).includes(me)) : null;
    const role = member ? (member.admin === 'superadmin' ? 'Creator' : member.admin === 'admin' ? 'Admin' : 'Member') : '';
    const phone = names.phoneOf(sender); // already written with a + in front
    const kind = kindOf(content);
    const shown = kind === 'reaction' ? content.reactionMessage?.text || '' : text;
    let command = '';
    if (isCommand && text) command = String(text).trim().slice(String(prefix || '').length).split(/\s+/)[0].toLowerCase().slice(0, 20);
    pending.set(msg, {
      at: Date.now(), time: timeText(), group: isGroup, fromMe, role, kind, isCommand: !!isCommand, command, text: shown,
      chat: isGroup ? info?.subject || `Group …${String(jid).replace(/\D/g, '').slice(-4)}` : '',
      members: isGroup && info ? (info.participants || []).length : 0,
      who: fromMe ? 'You' : msg.pushName || names.get(sender) || 'Unknown',
      number: phone ? `+${String(phone).replace(/^\++/, '')}` : '',
    });
  } catch (err) {
    // a log line must never break message handling
  }
}

// the handler calls this when it is done with the message: print the card with the real speed
function finish(msg) {
  const info = pending.get(msg);
  if (!info) return;
  pending.delete(msg);
  try {
    console.log(compact() ? line(info) : `${card({ ...info, ms: Date.now() - info.at })}\n`);
  } catch (err) {
    // never break message handling
  }
}

// the "bot is online" lines in the same colours
function banner(text) {
  if (!enabled() && !colorOn()) return console.log(text);
  const W = width();
  console.log(
    `\n${gradient('╭─', 0, 0.05)} ${pill('ONLINE', 0.2)} ${pill('READY', 0.6)} ${gradient('─'.repeat(Math.max(2, W - 20)), 0.6, 1)}\n` +
      `${gradient('│', 0.5, 0.5)} ${paint(BRIGHT, text, true)}\n` +
      `${gradient(`╰${'─'.repeat(W - 1)}`, 1, 0.2)}\n`
  );
}

module.exports = { incoming, finish, card, line, wrap, speed, banner, enabled, colorOn, kindOf, gradient, width };
