const store = require('../whatsapp/store');
const clock = require('../core/clock');
const repeat = require('../core/repeat');

const MAX_PER_CHAT = 10;

const HELP = (prefix) =>
  `*Schedule a message or a command*\n` +
  `Write when, then what. Times are 24-hour, in the bot region (${clock.zone()}).\n\n` +
  `▸ \`${prefix}schedule 18:30 Dinner time!\` every day\n` +
  `▸ \`${prefix}schedule once 18:30 Meeting now\` one time\n` +
  `▸ \`${prefix}schedule weekdays 07:30 Good morning\` Mon-Fri (or weekends)\n` +
  `▸ \`${prefix}schedule weekly mon,thu 19:00 Training\` chosen days\n` +
  `▸ \`${prefix}schedule monthly 1 09:00 Rent is due\` day of the month\n` +
  `▸ \`${prefix}schedule every 2h Drink water\` every 10 minutes to 7 days\n\n` +
  `*A bot command instead of text* (owner only): \`${prefix}schedule daily 07:00 run joke\` runs the joke command at 07:00 every day.\n` +
  `See them with \`${prefix}schedules\`, remove one with \`${prefix}unschedule <number>\``;

const ERRORS = {
  time: 'I could not read the time. Use 24-hour time like 18:30.',
  days: 'I could not read the days. Use mon, tue, wed, thu, fri, sat, sun (for example mon,thu).',
  monthday: 'The day of the month must be a number from 1 to 31.',
  every: 'I could not read how often. Try: every 30m, every 2h or every 1d.',
  tooOften: `That is too often. The shortest is every ${repeat.MIN_EVERY_MIN} minutes.`,
  tooRare: 'That is too rare. The longest is every 7 days.',
  text: 'Write the message (or run <command>) after the time.',
};

module.exports = {
  name: 'schedule',
  category: 'tools',
  description: 'Send a message or run a command at a time, once or repeating: schedule weekdays 07:30 Good morning',
  async run({ jid, rest, reply, prefix, isGroup, isAdmin, isOwner }) {
    if (isGroup && !(isAdmin || isOwner)) return reply('⚠️ Only group admins can schedule messages.');
    if (!rest.trim()) return reply(HELP(prefix));
    const { isKnownCommand } = require('../whatsapp/handler'); // loaded late: the handler loads this file

    const parsed = repeat.parse(rest);
    if (parsed.error) return reply(`⚠️ ${ERRORS[parsed.error] || ERRORS.time}\n\n${HELP(prefix)}`);
    let { text } = parsed;

    // a command: "run joke" always works; with a prefix set, ".joke" works too
    let cmd = null;
    const run = /^run\s+(\S+)([\s\S]*)$/i.exec(text);
    if (run && isKnownCommand(run[1])) cmd = `${run[1]}${run[2]}`.trim();
    else if (prefix && text.startsWith(prefix) && isKnownCommand(text.slice(prefix.length).split(/\s+/)[0])) cmd = text.slice(prefix.length).trim();
    if (run && !cmd) return reply(`⚠️ "${run[1]}" is not a command I know. See ${prefix}menu.`);
    if (cmd) {
      // a scheduled command runs with the owner's rights, so only the owner can set one
      if (!isOwner) return reply('⚠️ Only the bot owner can schedule a command. Admins can schedule messages.');
      if (/^(schedule|unschedule|restart|update|relink|backup|broadcast)\b/i.test(cmd)) return reply('⚠️ That command cannot be scheduled.');
      text = `${prefix}${cmd}`;
    }
    if (text.length > 1000) return reply('⚠️ That message is too long (max 1000 characters).');
    if (store.schedules().filter((s) => s.jid === jid).length >= MAX_PER_CHAT) {
      return reply(`⚠️ This chat already has ${MAX_PER_CHAT} scheduled items. Remove one with ${prefix}unschedule <number>`);
    }

    const item = store.addSchedule({ jid, time: parsed.time, text, repeat: parsed.repeat, cmd });
    await reply(`✅ *Scheduled #${item.id}*\n*What:* ${cmd ? `command ${cmd.split(/\s/)[0]}` : 'message'}\n*When:* ${repeat.describe(item)} _(${clock.zone()} time)_\nRemove it with \`${prefix}unschedule ${item.id}\``);
  },
};
