module.exports = {
  // Your personal number (country code + digits, no +). Required.
  ownerNumber: process.env.OWNER_NUMBER || '',

  // Bot number for pairing code instead of QR (optional).
  pairingNumber: process.env.PAIRING_NUMBER || '',

  // Command prefix
  prefix: process.env.PREFIX || '.',

  // private = only owner can use commands. public = everyone.
  mode: process.env.MODE || 'private',

  // How often the bot checks for updates (minutes). 0 = never.
  updateCheckMinutes: Number(process.env.UPDATE_CHECK_MINUTES) || 60,

  // Max concurrent heavy commands (downloads, media, etc.)
  maxHeavy: Number(process.env.MAX_HEAVY) || 2,

  // Daily status like limit (0 = unlimited)
  statusLikeLimit: Number(process.env.STATUS_LIKE_LIMIT) || 200,

  // Pause between status likes in ms
  statusLikePause: Number(process.env.STATUS_LIKE_PAUSE) || 3000,

  // Anti-spam: max commands per user per minute
  rateLimit: Number(process.env.RATE_LIMIT) || 12,

  // Auto view statuses
  autoViewStatus: process.env.AUTO_VIEW_STATUS !== '0',

  // Auto like statuses
  autoLikeStatus: process.env.AUTO_LIKE_STATUS !== '0',

  // Auto save statuses
  autoSaveStatus: process.env.AUTO_SAVE_STATUS === '1',

  // Reaction mode: off | always | smart
  cmdReact: process.env.CMD_REACT || 'smart',

  // Link preview: on | off
  linkPreview: process.env.LINK_PREVIEW !== '0',
};
