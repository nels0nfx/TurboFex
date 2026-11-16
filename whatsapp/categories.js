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
// The category a plugin command goes to: the one the plugin asked for (manifest "category"), else a sensible guess from what it does.
const PLUGIN_CATEGORIES = Object.keys(info).filter((k) => k !== 'owner');
function pluginCategory(manifest) {
  const want = manifest && manifest.category;
  if (want && info[want] && want !== 'owner') return want;
  const perms = (manifest && manifest.permissions) || [];
  if (perms.some((p) => p.startsWith('group.'))) return 'group';
  if (perms.some((p) => p.startsWith('media.'))) return 'media';
  if (manifest && manifest.events && manifest.events.length && !(manifest.commands || []).length) return 'autoreply';
  return 'tools';
}

module.exports = { info, groupByCategory, PLUGIN_MARK, mark, pluginCategory, PLUGIN_CATEGORIES };
