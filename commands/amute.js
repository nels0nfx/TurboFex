// amute = automatic group closing and opening, all in one command.
// It replaces three old commands (they are still its aliases): amute, aunmute and quiettime (nightmode).
//   amute                      -> shows what is set
//   amute 22:00                -> close the group every day at 22:00
//   amute close 22:00          -> the same
//   amute open 06:00           -> open the group every day at 06:00 (aunmute 06:00 does the same)
//   amute 22:00 06:00          -> both at once (quiettime 22:00 06:00 does the same)
//   amute remind 10            -> 10 minutes BEFORE it closes or opens, notify the group (a hidden tag; never say so in the reply)
//   amute remind off           -> no reminder
//   amute off                  -> stop closing and opening (close off / open off stop only one)
// The timed jobs themselves run in core/scheduler.js.
const store = require('../whatsapp/store');
const clock = require('../core/clock');

const CLOSE_WORDS = ['close', 'mute', 'lock'];
const OPEN_WORDS = ['open', 'unmute', 'unlock'];
const REMIND_WORDS = ['remind', 'reminder'];
const MAX_REMIND = 120; // minutes

const minutesText = (n) => `${n} minute${n === 1 ? '' : 's'}`;

function status(g, prefix) {
  const am = g.autoMute;
  const remind = am.remind > 0 ? `*${minutesText(am.remind)}* before the change` : '*OFF*';
  return (
    `⏰ *Auto open and close* _(${clock.zone()} time)_\n\n` +
    `🔒 *Closes at:* ${am.mute ? `*${am.mute}* every day` : '*OFF*'}\n` +
    `🔓 *Opens at:* ${am.unmute ? `*${am.unmute}* every day` : '*OFF*'}\n` +
    `🔔 *Reminder:* ${remind}\n\n` +
    `▸ \`${prefix}amute close 22:00\` – close every day at that time\n` +
    `▸ \`${prefix}amute open 06:00\` – open every day at that time\n` +
    `▸ \`${prefix}amute 22:00 06:00\` – both at once\n` +
    `▸ \`${prefix}amute remind 10\` – notify the group 10 minutes before\n` +
    `▸ \`${prefix}amute off\` – stop it all`
  );
}

const badTime = (prefix) => `⚠️ *That is not a time.*\n_Use the 24-hour clock, for example_ \`${prefix}amute close 22:00\``;

module.exports = {
  name: 'amute',
  aliases: ['aunmute', 'quiettime', 'nightmode', 'autoclose', 'autoopen'],
  category: 'group',
  description: 'Close and open the group by itself every day: amute 22:00 06:00, amute remind 10 notifies the group before it happens (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ jid, args, reply, prefix, cmdName }) {
    const g = store.getGroup(jid);
    let a = args.map((x) => x.toLowerCase());
    // the old names keep their old meaning: aunmute / autoopen = open, autoclose = close
    if (['aunmute', 'autoopen'].includes(cmdName) && a.length && !CLOSE_WORDS.concat(OPEN_WORDS, REMIND_WORDS).includes(a[0])) a = ['open', ...a];
    if (cmdName === 'autoclose' && a.length && !CLOSE_WORDS.concat(OPEN_WORDS, REMIND_WORDS).includes(a[0])) a = ['close', ...a];

    // ---- the reminder before it happens
    if (REMIND_WORDS.includes(a[0])) {
      if (a[1] === 'off' || a[1] === '0') {
        store.update(jid, (grp) => {
          grp.autoMute.remind = 0;
        });
        return reply('✅ *The reminder is OFF.*');
      }
      const n = Number(a[1]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_REMIND) {
        return reply(`🔔 *Reminder*\n_How many minutes before it closes or opens (1 to ${MAX_REMIND})?_\n*Example:* \`${prefix}amute remind 10\`\n*Stop it:* \`${prefix}amute remind off\``);
      }
      store.update(jid, (grp) => {
        grp.autoMute.remind = n;
        grp.autoMute.remMute = null;
        grp.autoMute.remUnmute = null;
      });
      const times = g.autoMute.mute || g.autoMute.unmute ? '' : `\n_Now set a time, for example_ \`${prefix}amute close 22:00\``;
      return reply(`✅ *Reminder set successfully.*\n▸ I'll notify the group ${minutesText(n)} before the scheduled change.${times}`);
    }

    // ---- turn it off
    if (a[0] === 'off') {
      const onlyOpen = ['aunmute', 'autoopen'].includes(cmdName);
      store.update(jid, (grp) => {
        grp.autoMute.unmute = null;
        if (!onlyOpen) {
          grp.autoMute.mute = null;
          grp.autoMute.remind = 0;
        }
      });
      return reply(onlyOpen ? '✅ *Automatic opening is now OFF.*' : '✅ *Automatic closing and opening are now OFF.*\n_Use_ `' + prefix + 'amute close off` _or_ `' + prefix + 'amute open off` _to stop only one._');
    }

    // ---- close or open at one time (or stop just that one)
    const closeWord = CLOSE_WORDS.includes(a[0]);
    const openWord = OPEN_WORDS.includes(a[0]);
    if (closeWord || openWord) {
      const field = closeWord ? 'mute' : 'unmute';
      const noun = closeWord ? 'closing' : 'opening';
      if (a[1] === 'off') {
        store.update(jid, (grp) => {
          grp.autoMute[field] = null;
        });
        return reply(`✅ *Automatic ${noun} is now OFF.*`);
      }
      const t = clock.parseHHMM(a[1]);
      if (!t) return reply(a[1] ? badTime(prefix) : status(g, prefix));
      store.update(jid, (grp) => {
        grp.autoMute[field] = t;
        grp.autoMute[closeWord ? 'ranMute' : 'ranUnmute'] = null;
        grp.autoMute[closeWord ? 'remMute' : 'remUnmute'] = null;
      });
      const rem = g.autoMute.remind > 0 ? `\n▸ I'll notify the group ${minutesText(g.autoMute.remind)} before.` : '';
      return reply(`${closeWord ? '🔒' : '🔓'} *The group will ${closeWord ? 'close' : 'open'} every day at ${t}* _(${clock.zone()} time)_.${rem}`);
    }

    // ---- a time, or two times (close and open)
    if (a.length) {
      const from = clock.parseHHMM(a[0]);
      const to = a[1] ? clock.parseHHMM(a[1]) : null;
      if (!from || (a[1] && !to) || (to && from === to)) return reply(badTime(prefix));
      store.update(jid, (grp) => {
        grp.autoMute.mute = from;
        grp.autoMute.ranMute = null;
        grp.autoMute.remMute = null;
        if (to) {
          grp.autoMute.unmute = to;
          grp.autoMute.ranUnmute = null;
          grp.autoMute.remUnmute = null;
        }
      });
      const rem = g.autoMute.remind > 0 ? `\n▸ I'll notify the group ${minutesText(g.autoMute.remind)} before.` : '';
      return reply(
        to
          ? `🌙 *Quiet time is ON.* The group closes at *${from}* and opens at *${to}* every day _(${clock.zone()} time)_.${rem}`
          : `🔒 *The group will close every day at ${from}* _(${clock.zone()} time)_.${rem}`
      );
    }

    return reply(status(g, prefix));
  },
};
