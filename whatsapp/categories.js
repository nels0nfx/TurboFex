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
  economy: { title: 'EMPIRE OF FEX', icon: '⚜️', symbol: '❁' },
  ai: { title: 'AI', icon: '🤖', symbol: '✦' },
  budget: { title: 'BUDGET', icon: '💰', symbol: '❂' },
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
  const groups = {};
  for (const c of visible) {
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

module.exports = { info, groupByCategory };
