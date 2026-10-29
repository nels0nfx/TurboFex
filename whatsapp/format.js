// Gives the text replies of commands WhatsApp formatting: bold titles and labels, symbol bullets, commands and examples
// in monospace. It runs on every command reply, with two levels:
//   'full'   all rules
//   'system' for commands whose reply is mostly content (jokes, translations, text tools, announcements): only the
//            bot's own messages (usage hints, warnings, results of ✅ ❌ ⚠️) are formatted, the content is never touched
// A reply that already contains WhatsApp formatting is left alone.
const CONTENT_ONLY = new Set([
  // the reply IS the content: what the person typed, or text from a generator
  'say', 'hidetag', 'tagall', 'translate', 'tr', 'define', 'quote', 'fancy', 'reverse', 'base64', 'hash', 'password', 'random',
  'joke', 'compliment', 'fact', 'riddle', 'truth', 'dare', 'wyr', 'pickup', '8ball', 'ship', 'rate', 'dice', 'coin', 'choose', 'slots',
]);

const ALREADY = /[*_`~]|^>/m;
const EMOJI = '\\p{Extended_Pictographic}\\uFE0F?';
const SYSTEM_START = new RegExp(
  `^\\s*(?:(?:⚠️|❌|✅|ℹ️|🚫|⏳|🔒|🔓|🔎|💡)|(?:Use:|Usage:|Write:|Examples?:)|(?:Reply to|Reply with|Type|Write|Give me|Use:|Use |Ask|Send|Tag|Say|Which|What|How|Who|Where|When|Pick|Choose|Example|Try|Please|Nothing|No |There is|You |I )\\b)`,
  'i'
);

// 'full' | 'system' | false
function mode(cmd) {
  if (!cmd || cmd.format === false) return false;
  return CONTENT_ONLY.has(cmd.name) ? 'system' : 'full';
}
const applies = (cmd) => !!mode(cmd);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// isCmd(name) -> true when name is a real command (only those are put in monospace)
function format(text, isCmd, prefix, level = 'full') {
  if (typeof text !== 'string' || !text.trim() || ALREADY.test(text) || text.length > 3500) return text;
  if (level === 'system' && !SYSTEM_START.test(text)) return text;

  const lines = text.split('\n');
  const p = esc(prefix);
  const isCmdLine = (l) => new RegExp(`^${p}([a-z0-9]{2,20})(\\s|$)`, 'i').test(l.trim()) && isCmd(l.trim().slice(prefix.length).split(/\s/)[0].toLowerCase());
  const inline = new RegExp(`(^|[\\s(])(${p}[a-z0-9]{2,20})(?=$|[\\s).,:;!?])`, 'gi');
  const leadEmoji = new RegExp(`^(\\s*(?:▸\\s+)?(?:${EMOJI}\\s+)?)`, 'u');

  const out = lines.map((raw, i) => {
    let line = raw;
    if (!line.trim()) return line;

    // 1. a title: first line, emoji first, short, several lines follow
    if (i === 0 && lines.length > 1 && line.length <= 70 && !/[.?]$/.test(line) && new RegExp(`^(?:${EMOJI})`, 'u').test(line)) return `*${line.replace(/:$/, '')}*`;

    // a lone heading like "Use:" or "Examples:"
    if (/^\s*(Use|Usage|Write|Examples?|Try|Options?):?\s*$/i.test(line)) return `*${line.trim().replace(/:$/, '')}:*`;

    // 2. bullets
    line = line.replace(/^(\s*)[-•]\s+/, '$1▸ ');

    // 3. a command line (".mode public - change the mode") or "Example: .mode public": the command goes in monospace
    const ex = new RegExp(`^(\\s*(?:▸\\s+)?(?:${EMOJI}\\s+)?)((?:Examples?|Try|Use|Usage|Write|Type)):\\s+(${p}\\S.*)$`, 'iu').exec(line);
    if (ex && isCmdLine(ex[3])) return `${ex[1]}*${ex[2]}:* \`${ex[3].trim()}\``;
    if (isCmdLine(line.replace(leadEmoji, ''))) {
      const lead = leadEmoji.exec(line)[1];
      const rest = line.slice(lead.length);
      const d = /^(.*?)\s+[-–—]\s+(.*)$/.exec(rest);
      return d ? `${lead}\`${d[1].trim()}\` – ${d[2]}` : `${lead}\`${rest.trim()}\``;
    }

    // 4. "Label: value" -> "*Label:* value"
    const m = new RegExp(`^(\\s*(?:▸\\s+)?(?:${EMOJI}\\s+)?)([A-Za-z][A-Za-z0-9 /()'-]{1,26}):\\s+(\\S.*)$`, 'u').exec(line);
    if (m && m[2].trim().split(/\s+/).length <= 4 && !/^https?$/i.test(m[2])) line = `${m[1]}*${m[2]}:* ${m[3]}`;

    // 5. commands that really exist, anywhere in the sentence
    line = line.replace(inline, (all, pre, token) => (isCmd(token.slice(prefix.length).toLowerCase()) ? `${pre}\`${token}\`` : all));

    // 6. an instruction ("Reply to a picture with this command.") is written in italics
    if (!/[`*_]/.test(line) && /^\s*(Reply to|Reply with|Send|Type|Write|Give me|Tag|Ask|Pick|Choose)\b/i.test(line)) return `_${line.trim()}_`;
    return line;
  });

  // 7. a single sentence that starts with an emoji: the sentence is bold ("✅ *Done.*"); a long one only its first sentence
  if (out.length === 1 && out[0] === lines[0]) {
    const s = new RegExp(`^(${EMOJI})\\s+(\\S.*)$`, 'u').exec(lines[0]);
    if (s && !/[`*_]/.test(s[2])) {
      if (s[2].length <= 140) return `${s[1]} *${s[2]}*`;
      const cut = /^(.{10,140}?[.!?])(\s+|$)/.exec(s[2]);
      if (cut) return `${s[1]} *${cut[1]}* ${s[2].slice(cut[0].length)}`.trimEnd();
    }
  }
  const result = out.join('\n');
  return result;
}

module.exports = { format, applies, mode };
