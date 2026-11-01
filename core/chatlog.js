// The console shows a small card for every message the bot handles, in gold, white and black:
//
//   ┏━ 21:35:07 ━ GROUP ━━━━━━━━━━━━━━━━━━━━━━━
//   ┃ Chat   Fex Squad (128)
//   ┃ From   Ada · Admin
//   ┃ Number +27833333333
//   ┃ Kind   text · command
//   ┃ Text   .menu
//   ┃ Speed  ▰▰▰▰▰▰▰▱  48 ms · fast
//   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// The card is printed when the bot has finished with the message, so the speed is real.
// CONSOLE_CHAT=off hides it, CONSOLE_CHAT=compact prints one short line per message, CONSOLE_COLOR=off drops the colours.
// NOTE: this prints what people write to the bot, on the owner's console only. Nothing is saved to a file.

const GOLD = '\x1b[38;5;220m';
const GOLD_BG = '\x1b[48;5;220m';
const WHITE = '\x1b[97m';
const WHITE_BG = '\x1b[107m';
const GREY = '\x1b[38;5;245m';
const BLACK = '\x1b[30m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const WIDTH = 44; // fits a phone screen (Termux and most host panels)
const LABEL = 7; // "Speed  " "Number "
const VALUE = WIDTH - 2 - LABEL; // room for the words after a label
const MAX_LINES = 3; // a long message is cut after this many lines

const off = (v) => ['off', '0', 'false', 'no'].includes(String(v || '').toLowerCase());
const enabled = () => !off(process.env.CONSOLE_CHAT);
const compact = () => String(process.env.CONSOLE_CHAT || '').toLowerCase() === 'compact';
const colorOn = () => !off(process.env.CONSOLE_COLOR) && process.env.NO_COLOR === undefined;

// text people wrote can hold control characters (even colour codes): remove them so they cannot mess up the console
const clean = (s) =>
  String(s || '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
const oneLine = (s, max) => {
  const t = clean(s).replace(/\s*\n\s*/g, ' ⏎ ').replace(/\s{2,}/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// colour helpers (plain text when colours are off)
const paint = (codes, text) => (colorOn() ? `${codes}${text}${RESET}` : text);
const badgeGold = (t) => paint(`${BLACK}${GOLD_BG}${BOLD}`, ` ${t} `);
const badgeWhite = (t) => paint(`${BLACK}${WHITE_BG}${BOLD}`, ` ${t} `);
const gold = (t) => paint(`${GOLD}${BOLD}`, t);
const white = (t) => paint(WHITE, t);
const whiteBold = (t) => paint(`${WHITE}${BOLD}`, t);
const grey = (t) => paint(GREY, t);

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

const timeText = () => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: require('./clock').zone(), hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
  } catch (err) {
    return new Date().toISOString().slice(11, 19);
  }
};

// the card (a pure function, so a test can check it)
function card({ time, group, chat, members, who, role, number, kind, isCommand, command, text, ms, fromMe }) {
  const where = group ? 'GROUP' : 'PRIVATE';
  const used = 2 + (time.length + 2) + 1 + (where.length + 2); // what is already on the top line, without colours
  const top = `${gold('┏━')}${badgeGold(time)}${gold('━')}${badgeWhite(where)}${gold('━'.repeat(Math.max(2, WIDTH - used)))}`;
  const bar = gold('┃');
  const row = (label, value, valuePaint = white) => `${bar} ${grey(label.padEnd(LABEL))}${valuePaint(value)}`;
  const rows = [];
  rows.push(row('Chat', group ? `${oneLine(chat, VALUE - (members ? String(members).length + 3 : 0))}${members ? ` (${members})` : ''}` : 'Private chat', group ? gold : whiteBold));
  rows.push(row('From', `${oneLine(who, 18)}${fromMe ? ' · bot account' : role ? ` · ${role}` : ''}`, whiteBold));
  if (number) rows.push(row('Number', number));
  rows.push(row('Kind', `${kind}${isCommand ? ` · command${command ? ` ${command}` : ''}` : ''}`, isCommand ? gold : white));
  const body = wrap(text || '', VALUE, MAX_LINES);
  if (body.length) body.forEach((line, i) => rows.push(row(i === 0 ? 'Text' : '', line, isCommand ? gold : white)));
  const sp = speed(ms);
  rows.push(`${bar} ${grey('Speed'.padEnd(LABEL))}${gold('▰'.repeat(sp.filled))}${grey('▱'.repeat(8 - sp.filled))}  ${whiteBold(sp.shown)} ${grey(`· ${sp.word}`)}`);
  const bottom = gold(`┗${'━'.repeat(WIDTH - 1)}`);
  return [top, ...rows, bottom].join('\n');
}

// one short line (CONSOLE_CHAT=compact)
function line({ time, group, chat, who, text, kind, isCommand, fromMe }) {
  const body = text ? oneLine(text, 110) : `[${kind || 'message'}]`;
  const arrow = fromMe ? gold('➜') : grey('│');
  const chatPart = group ? `${gold(oneLine(chat, 28))} ${grey('›')} ` : '';
  return `${badgeGold(time)}${badgeWhite(group ? 'GROUP' : 'PRIVATE')} ${chatPart}${whiteBold(oneLine(who, 22))} ${arrow} ${isCommand ? gold(body) : white(body)}`;
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
    const phone = names.phoneOf(sender);
    const kind = kindOf(content);
    const shown = kind === 'reaction' ? content.reactionMessage?.text || '' : text;
    let command = '';
    if (isCommand && text) command = String(text).trim().slice(String(prefix || '').length).split(/\s+/)[0].toLowerCase().slice(0, 20);
    pending.set(msg, {
      at: Date.now(), time: timeText(), group: isGroup, fromMe, role, kind, isCommand: !!isCommand, command, text: shown,
      chat: isGroup ? info?.subject || `Group …${String(jid).replace(/\D/g, '').slice(-4)}` : '',
      members: isGroup && info ? (info.participants || []).length : 0,
      who: fromMe ? 'You' : msg.pushName || names.get(sender) || 'Unknown',
      number: phone ? `+${phone}` : '',
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
    console.log(compact() ? line(info) : card({ ...info, ms: Date.now() - info.at }));
  } catch (err) {
    // never break message handling
  }
}

// the "bot is online" line in the same colours
function banner(text) {
  if (!enabled() && !colorOn()) return console.log(text);
  console.log(`${badgeGold('ONLINE')}${badgeWhite('READY')} ${whiteBold(text)}`);
}

module.exports = { incoming, finish, card, line, wrap, speed, banner, enabled, colorOn, kindOf };
