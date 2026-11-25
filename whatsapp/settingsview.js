// `settings`: everything the owner has set, in plain words. Secrets (API keys) are only counted, never shown.
const store = require('./store');
const autotag = require('./autotag');
const ignored = require('./ignored');

// a setting that may be missing, a true/false, a word or an object with .on
function isOn(v) {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'object') return v.on === undefined ? Object.keys(v).length > 0 : !!v.on;
  if (typeof v === 'string') return !['off', 'false', '0', ''].includes(v.toLowerCase());
  return !!v;
}
const onOff = (v) => (isOn(v) ? 'ON' : 'OFF');
const row = (label, value) => `▸ ${label}: *${value}*`;
const where = (to) => (!to ? 'your chat' : to === 'chat' ? 'where it was sent' : 'a chosen chat');

function watchLine(name) {
  const w = store.watchCfg(name);
  if (!w || !w.mode || w.mode === 'off') return 'OFF';
  return `${String(w.mode).toUpperCase()}, to ${where(w.to)}${name === 'viewonce' && w.guess === true ? ', guess ON' : ''}`;
}

function botText() {
  const st = store.statusCfg();
  const rate = store.rateCfg();
  const wm = store.watermarkCfg();
  const names = typeof store.apiKeyNames === 'function' ? store.apiKeyNames() : [];
  const keys = names.filter((n) => store.getApiKey(n)).length;
  const tag = autotag.state();
  const pm = store.getAuto('pm');
  const lines = [
    '⚙️ *Bot settings*',
    row('Mode', String(store.getMode()).toUpperCase()),
    row('Prefix', `[ ${store.effectivePrefix() || 'none'} ]`),
    row('Time zone', store.getRegion() || 'default'),
    row('Auto update', onOff(store.getAutoUpdate())),
    row('Restart message', onOff(store.getRestartMsg())),
    row('Server guard', onOff(store.getGuard())),
    row('Command reactions', onOff(store.getCmdReact())),
    row('Anti-call', onOff(store.getAnticall())),
    row('Link previews', onOff(store.getLinkPreview())),
    row('Rate limit', rate && rate.on ? `ON (${rate.limit} per minute${rate.owner ? ', also you' : ''})` : 'OFF'),
    row('Watermark', wm && wm.on ? 'ON' : 'OFF'),
    row('Sticker pack', onOff(store.stickerCfg())),
    '',
    '🤖 *Automation*',
    row('Auto typing', onOff(store.getAuto('typing'))),
    row('Auto recording', onOff(store.getAuto('recording'))),
    row('Always online', onOff(store.getAuto('online'))),
    row('Auto read', onOff(store.getAuto('read'))),
    row('Auto react', onOff(store.getAuto('react'))),
    row('Auto bio', onOff(store.getAuto('bio'))),
    row('Autocorrect', onOff(store.getAuto('autocorrect'))),
    row('Command cleanup', onOff(store.getAuto('delcmd'))),
    row('PM blocker', isOn(pm) ? (typeof pm === 'string' ? pm.toUpperCase() : pm && pm.mode ? String(pm.mode).toUpperCase() : 'ON') : 'OFF'),
    row('Maintenance', onOff(store.getAuto('maintenance'))),
    row('Chatbot', onOff(store.getAuto('chatbot'))),
    '',
    '📣 *Status*',
    row('Auto view', onOff(st.view)),
    row('Auto like', st.like ? `ON (${(st.emojis || []).join(' ') || 'no emojis'})` : 'OFF'),
    row('Auto save', onOff(st.save)),
    row('Status replies saved', onOff(st.saveReply)),
    row('Likes per day', st.dailyLikeLimit === 0 ? 'no limit' : st.dailyLikeLimit),
    '',
    '👁️ *Watchers*',
    row('View-once', watchLine('viewonce')),
    row('Anti-delete', watchLine('delete')),
    row('Anti-edit', watchLine('edit')),
    '',
    '📵 *Chats and keys*',
    row('Ignored chats', ignored.list().length),
    row('Auto tag', tag.all ? `ALL groups${tag.except.length ? ` (except ${tag.except.length})` : ''}` : tag.groups.length ? `${tag.groups.length} group${tag.groups.length === 1 ? '' : 's'}` : 'OFF'),
    row('API keys', `${keys} of ${names.length} set`),
  ];
  return lines.join('\n');
}

const modeOf = (v) => (!v || v === 'off' ? 'OFF' : String(v).toUpperCase());

function groupText(jid, name) {
  const g = store.getGroup(jid);
  const intro = g.intro || {};
  const lines = [
    `⚙️ *Settings of ${name || 'this group'}*`,
    row('Anti-link', modeOf(g.antilinkMode)),
    row('Anti-word', modeOf(g.antiwordMode)),
    row('Anti group mention', modeOf(g.antigmMode)),
    row('Anti group status', modeOf(g.antigstatusMode)),
    row('Anti-bot', modeOf(g.antibotMode)),
    row('Anti-tag', modeOf(g.antitagMode)),
    row('Anti-spam', modeOf(g.antispamMode)),
    row('Raid protection', modeOf(g.antiraid)),
    row('Verification', onOff(g.captcha)),
    row('Welcome message', onOff(g.welcome)),
    row('Goodbye message', onOff(g.goodbye)),
    row('Promote/demote notices', onOff(g.pdm)),
    row('Intro', onOff(intro.on)),
    row('Autosticker', onOff(g.autosticker)),
    row('Warn limit', g.warnLimit || 'default'),
    row('Turned-off commands', (g.disabled || []).length),
    row('Silenced members', (g.silenced || []).length),
    row('Bad words', (g.badWords || []).length),
    row('Anti-fake countries', (g.antifake || []).length),
    row('Ignored by me', ignored.isIgnored(jid) ? 'YES' : 'NO'),
    row('Auto tag', autotag.isOn(jid) ? 'ON' : 'OFF'),
  ];
  return lines.join('\n');
}

module.exports = { botText, groupText, isOn };
