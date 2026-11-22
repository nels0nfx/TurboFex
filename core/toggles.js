// "Already ON": repeating a switch must not claim that something was done. When a command is run with a single switch word
// (`autolikestatus on`, `antilink delete`, ...) the handler watches what the command saves (core/jsonstore.js probe). If the command
// saved something but it is exactly what was saved before, nothing changed, and the answer says so instead of "now ON".
// It can never say "already" wrongly: it needs proof (a save that changed nothing). When it cannot tell, the command's own answer is used.
const jsonstore = require('./jsonstore');

const SWITCH_WORDS = new Set(['on', 'off', 'delete', 'warn', 'kick', 'lock', 'block', 'dm', 'dms', 'group', 'groups']);
const ALL_WORD = new Set(['autoviewonce', 'antidelete', 'antiedit']); // "all" is a place for these, and a different thing elsewhere

const LABELS = {
  chatbot: 'Chatbot', autocorrect: 'Autocorrect', autotyping: 'Auto typing', autorecording: 'Auto recording', alwaysonline: 'Always online',
  delcmd: 'Command cleanup', autoread: 'Auto read', autobio: 'Auto bio', autoreact: 'Auto react', pmblocker: 'PM blocker', autotag: 'Auto tag',
  autoupdate: 'Auto update', birthday: 'Birthday wishes', goodbye: 'Goodbye message', welcome: 'Welcome message', pdm: 'Promote/demote notices',
  antidemote: 'Anti-demote', antipromote: 'Anti-promote', antifake: 'Anti-fake', antigstatus: 'Anti group status', antigm: 'Anti group mention',
  antimedia: 'Anti-media', antispam: 'Anti-spam', antilink: 'Anti-link', antiword: 'Anti-word', antibot: 'Anti-bot', captcha: 'Verification',
  antiraid: 'Raid protection', autosticker: 'Autosticker', groupinfo: 'Group info', lockdown: 'Lockdown', catchup: 'Catchup', swearjar: 'Swear jar',
  welcomedm: 'Welcome DM', weeklyrecap: 'Weekly recap', intro: 'Intro', linkpreview: 'Link previews', maintenance: 'Maintenance', rank: 'Rank',
  ratelimit: 'Rate limit', restartmsg: 'Restart message', autoviewstatus: 'Auto view status', autolikestatus: 'Auto like status',
  autosavestatus: 'Auto save status', statusreply: 'Status reply saving', stickerpack: 'Sticker pack', autoviewonce: 'Auto view-once',
  antidelete: 'Anti-delete', antiedit: 'Anti-edit', watermark: 'Watermark', amute: 'Auto mute', plugin: 'Plugins', slowmode: 'Slow mode',
};
// names that are plural ("are") and settings of one group that are not marked groupOnly
const PLURAL = new Set(['linkpreview', 'pdm', 'birthday', 'plugin']);
const GROUP_SETTING = new Set(['birthday', 'welcomedm', 'catchup', 'swearjar', 'weeklyrecap']);
const labelOf = (cmd) => LABELS[cmd.name] || (cmd.name ? cmd.name[0].toUpperCase() + cmd.name.slice(1) : 'That');

// the switch word of this call (or null): exactly one word, and it is a switch
function wordOf(cmd, args) {
  if (!cmd || !Array.isArray(args) || args.length !== 1) return null;
  const w = String(args[0] || '').toLowerCase();
  if (w === 'on' || w === 'off' || SWITCH_WORDS.has(w)) return w;
  if (w === 'all' && ALL_WORD.has(cmd.name)) return w;
  return null;
}

// the text that replaces the command's own answer when nothing changed
function alreadyText(cmd, word, isGroup) {
  const where = isGroup && (cmd.groupOnly || GROUP_SETTING.has(cmd.name)) ? ' in this group' : '';
  const w = word.toUpperCase();
  const is = PLURAL.has(cmd.name) ? 'are' : 'is';
  const head = word === 'on' || word === 'off' ? `${labelOf(cmd)} ${is} already ${w}${where}.` : `${labelOf(cmd)} ${is} already set to ${w}${where}.`;
  return `ℹ️ *${head}*\n▸ Nothing was changed.`;
}

// Starts watching one command call. Returns null when this call is not a single switch word.
function watch(cmd, args, isGroup) {
  const word = wordOf(cmd, args);
  if (!word) return null;
  const probe = jsonstore.probe();
  let decided = false;
  return {
    run: (fn) => probe.run(fn),
    // called for the command's FIRST answer: the replacement text when nothing changed, otherwise null
    decide(text) {
      if (decided) return null;
      decided = true;
      probe.close(); // what is saved after the first answer is not the switch
      if (/^\s*(⚠️|❌|🚫)/.test(String(text || ''))) return null; // a warning or a refusal is shown as it is
      return probe.verdict() === 'same' ? alreadyText(cmd, word, isGroup) : null;
    },
  };
}

module.exports = { watch, wordOf, alreadyText, labelOf };
