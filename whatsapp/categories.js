// MENU CATEGORIES
// Every command file declares its own category, for example:  category: 'group',
// The menu builds itself from that (commands are listed A-Z inside each category).
// Categories with no commands stay hidden. A command without a valid category is
// shown under OTHER and the bot prints a warning at startup.
const info = {
  general: { title: 'GENERAL', icon: '⚡', symbol: '✦' },
  group: { title: 'GROUP', icon: '👥', symbol: '❖' },
  autoreply: { title: 'AUTOREPLY', icon: '💬', symbol: '✧' },
  status: { title: 'STATUS', icon: '📢', symbol: '◈' },
  watch: { title: 'WATCH', icon: '👁️', symbol: '◉' },
  tools: { title: 'TOOLS', icon: '🧰', symbol: '✪' },
  fun: { title: 'FUN', icon: '🎉', symbol: '✺' },
  games: { title: 'GAMES', icon: '🎮', symbol: '✥' },
  ai: { title: 'AI', icon: '🤖', symbol: '✦' },
  budget: { title: 'BUDGET', icon: '💰', symbol: '❂' },
  download: { title: 'DOWNLOAD', icon: '📥', symbol: '⇩' },
  effect: { title: 'EFFECT', icon: '✨', symbol: '❋' },
  media: { title: 'MEDIA', icon: '🎬', symbol: '❈' },
  audio: { title: 'AUDIO', icon: '🎧', symbol: '♪' },
  video: { title: 'VIDEO', icon: '🎞️', symbol: '▣' },
  editor: { title: 'EDITOR', icon: '🎨', symbol: '✎' },
  owner: { title: 'OWNER', icon: '👑', symbol: '♛' },
  security: { title: 'SECURITY', icon: '🛡️', symbol: '✜' },
  lookup: { title: 'LOOKUP', icon: '🔎', symbol: '⌘' },
  other: { title: 'OTHER', icon: '📦', symbol: '✱' },
};

// Returns [{ key, meta, cmds }] in menu order. Owner-only commands are hidden from non-owners.
function groupByCategory(commandList, isOwner) {
  const visible = commandList.filter((c) => isOwner || !(c.ownerOnly || c.realOwnerOnly));
  const groups = {}; const seen = new Set(); // a command is listed once, in one category only
  for (const c of visible) {
    const id = c.pluginId ? c.pluginId + ':' + c.name : c;
    if (seen.has(id)) continue; seen.add(id);
    const key = info[c.category] ? c.category : 'other';
    (groups[key] = groups[key] || []).push(c);
  }
  // categories are listed alphabetically (by their title)
  return Object.keys(info)
    .filter((k) => groups[k])
    .sort((a, b) => info[a].title.localeCompare(info[b].title))
    .map((k) => ({
      key: k,
      meta: info[k],
      cmds: groups[k].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

// Plugin commands sit in the normal categories. Every one of them carries this marker beside its name; native commands never do.
// The marker comes from the command itself (pluginId), so it appears and disappears with the plugin by itself.
const PLUGIN_MARK = '〔P〕';
const mark = (c) => (c && c.pluginId ? ' ' + PLUGIN_MARK : '');
// The category a plugin command goes to. In this order: 1) the owner's own choice (.plugin category), 2) the plugin's manifest "category",
// 3) a guess from the plugin's name and commands, then its description, 4) a guess from the permissions it asks for, 5) TOOLS.
const PLUGIN_CATEGORIES = Object.keys(info).filter((k) => k !== 'owner');
const GUESS = [ // the first match wins; words are matched at the start of a word
  ['autoreply', /\b(mention|tagged?|auto-?repl|repl(y|ies)|respon[ds]|afk|away|busy|greet|answer)/],
  ['group', /\b(group|member|admin|lock|unlock|mute|kick|ban|warn|welcome|invite|promote|demote|antilink|rules?)/],
  ['security', /\b(spam|scam|virus|protect|secur|filter|block|safe)/],
  ['games', /\b(game|quiz|trivia|dice|riddle|puzzle|play)/],
  ['ai', /\b(ai|gpt|chatbot|assistant|smart)\b/],
  ['download', /\b(download|youtube|tiktok|instagram|facebook)/],
  ['audio', /\b(audio|music|song|mp3|voice|podcast)/],
  ['video', /\b(video|movie|clip)/],
  ['media', /\b(sticker|image|photo|picture|media|gif)/],
  ['lookup', /\b(lookup|search|weather|dictionary|translat|defin|price|rate|currency|convert|time ?zone)/],
  ['budget', /\b(budget|expense|money|saving|finance|loan)/],
  ['status', /\b(status|story)/],
  ['fun', /\b(fun|joke|meme|quote|fact|funny|roast|compliment)/],
  ['general', /\b(help|info|about|ping|menu)\b/],
];
function pluginCategory(manifest, owned) {
  if (owned && info[owned] && owned !== 'owner') return owned;
  const want = manifest && manifest.category;
  if (want && info[want] && want !== 'owner') return want;
  const names = ((manifest && manifest.name) || '') + ' ' + (((manifest && manifest.commands) || []).map((c) => (typeof c === 'string' ? c : c && c.name) || '').join(' '));
  const words = (t) => String(t).toLowerCase().replace(/[_.-]+/g, ' ');
  for (const text of [words(names), words((manifest && manifest.description) || '')]) for (const [cat, re] of GUESS) if (re.test(text)) return cat;
  const perms = (manifest && manifest.permissions) || [];
  if (perms.some((p) => p.startsWith('group.'))) return 'group';
  if (perms.some((p) => p.startsWith('media.'))) return 'media';
  if (manifest && manifest.events && manifest.events.length && !(manifest.commands || []).length) return 'autoreply';
  return 'tools';
}

module.exports = { info, groupByCategory, PLUGIN_MARK, mark, pluginCategory, PLUGIN_CATEGORIES };
