// The console shows every message the bot sees, one line each, in gold, white and black:
//   black on gold = the time, black on white = GROUP or PRIVATE, gold = the chat name, white = who wrote and what.
// Switch it off with CONSOLE_CHAT=off (in config.env or the host variables). CONSOLE_COLOR=off keeps the lines but drops the colours.
// NOTE: this prints what people write to the bot, on the owner's console only. Nothing is saved to a file.

const GOLD = '\x1b[38;5;220m';
const GOLD_BG = '\x1b[48;5;220m';
const WHITE = '\x1b[97m';
const WHITE_BG = '\x1b[107m';
const BLACK = '\x1b[30m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const off = (v) => ['off', '0', 'false', 'no'].includes(String(v || '').toLowerCase());
const enabled = () => !off(process.env.CONSOLE_CHAT);
const colorOn = () => !off(process.env.CONSOLE_COLOR) && process.env.NO_COLOR === undefined;

// text people wrote can hold control characters (even colour codes): remove them so they cannot mess up the console
const safe = (s, max) => {
  const t = String(s || '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s*\n\s*/g, ' ⏎ ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// colour helpers (plain text when colours are off)
const paint = (codes, text) => (colorOn() ? `${codes}${text}${RESET}` : text);
const badgeGold = (t) => paint(`${BLACK}${GOLD_BG}${BOLD}`, ` ${t} `);
const badgeWhite = (t) => paint(`${BLACK}${WHITE_BG}${BOLD}`, ` ${t} `);
const gold = (t) => paint(`${GOLD}${BOLD}`, t);
const white = (t) => paint(WHITE, t);
const whiteBold = (t) => paint(`${WHITE}${BOLD}`, t);
const dim = (t) => paint(DIM, t);

// what kind of message is it when there is no text?
const KINDS = [
  ['imageMessage', 'image'], ['videoMessage', 'video'], ['audioMessage', 'voice/audio'], ['stickerMessage', 'sticker'],
  ['documentMessage', 'document'], ['contactMessage', 'contact'], ['contactsArrayMessage', 'contacts'], ['locationMessage', 'location'],
  ['liveLocationMessage', 'live location'], ['pollCreationMessage', 'poll'], ['pollCreationMessageV3', 'poll'], ['reactionMessage', 'reaction'],
];
function kindOf(content) {
  for (const [key, label] of KINDS) if (content && content[key]) return label;
  return 'message';
}

const clock = () => {
  try {
    return require('./clock').parts().hhmm;
  } catch (err) {
    return new Date().toISOString().slice(11, 16);
  }
};

// builds the line (exported so a test can check it)
function format({ time, group, chat, who, text, kind, isCommand, fromMe }) {
  const where = group ? 'GROUP' : 'PRIVATE';
  const body = text ? safe(text, 110) : `[${kind || 'message'}]`;
  const arrow = fromMe ? gold('➜') : dim('│');
  const bodyOut = isCommand ? gold(body) : white(body);
  const chatPart = group ? `${gold(safe(chat, 28))} ${dim('›')} ` : '';
  return `${badgeGold(time)}${badgeWhite(where)} ${chatPart}${whiteBold(safe(who, 22))} ${arrow} ${bodyOut}`;
}

// called by the handler for each message the bot receives (never throws, never waits)
function incoming({ msg, jid, isGroup, text, content, prefix, isCommand }) {
  if (!enabled()) return;
  try {
    const names = require('../whatsapp/names');
    const meta = require('../whatsapp/metadata');
    const k = msg.key || {};
    const fromMe = !!k.fromMe;
    const sender = isGroup ? k.participant : jid;
    let who = fromMe ? 'You' : msg.pushName || names.get(sender) || names.phoneOf(sender) || 'Someone';
    let chat = '';
    if (isGroup) {
      const cached = meta.peek(jid);
      chat = cached?.subject || `Group …${String(jid).replace(/\D/g, '').slice(-4)}`;
    }
    console.log(format({ time: clock(), group: isGroup, chat, who, text, kind: kindOf(content), isCommand: !!isCommand, fromMe }));
  } catch (err) {
    // a log line must never break message handling
  }
}

// the "bot is online" line in the same colours
function banner(text) {
  if (!enabled() && !colorOn()) return console.log(text);
  console.log(`${badgeGold('ONLINE')}${badgeWhite('READY')} ${whiteBold(text)}`);
}

module.exports = { incoming, format, banner, safe, enabled, colorOn, kindOf };
