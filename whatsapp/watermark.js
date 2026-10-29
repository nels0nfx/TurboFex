// A small line added under the result of some commands, but only when they worked.
// Which commands: brand.js (categories + names). The owner can turn it off or change the text with "watermark".
const brand = require('../core/brand');
const store = require('./store');

function text() {
  return store.watermarkCfg().text || brand.watermark.text;
}

function applies(cmd) {
  if (!store.watermarkCfg().on) return false;
  if (cmd.watermark === false) return false;
  if (cmd.watermark === true) return true;
  return brand.watermark.categories.includes(cmd.category) || brand.watermark.commands.includes(cmd.name);
}

// messages that are NOT a finished result (errors, hints, "working on it") never get the watermark
const NOT_A_RESULT = /^\s*(⚠️|❌|⏳|🚫|ℹ️|😕|🏓 Pinging|💡|(Type|Reply|Say|Write|Send|Tag|Use|Please|Nothing|Give|Which|Example)\b)/i;

function stamp(wm, current) {
  const s = String(current || '');
  if (!s.trim() || s.includes(wm)) return s;
  return `${s}\n\n${wm}`;
}

// returns a copy of the content with the watermark added (or the same content when it should not get one)
function mark(content, wm) {
  if (!content || typeof content !== 'object' || content.edit || content.delete || content.react) return content;
  if (typeof content.text === 'string') {
    if (NOT_A_RESULT.test(content.text)) return content;
    return { ...content, text: stamp(wm, content.text) };
  }
  if ((content.image || content.video || content.document) && !NOT_A_RESULT.test(content.caption || '')) {
    return { ...content, caption: stamp(wm, content.caption) };
  }
  return content; // stickers and audio cannot carry text
}

module.exports = { applies, mark, text, NOT_A_RESULT };
