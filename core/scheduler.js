// Runs timed jobs once a minute: automatic group open/close and scheduled messages
const clock = require('./clock');
const store = require('../whatsapp/store');
const birthdays = require('../whatsapp/birthdays');
const repeat = require('./repeat');
const ticker = require('./realm/ticker'); // the Empire's timed jobs (checkRealms below runs them)

let timer = null;
let lastKey = '';

// sends the text of a scheduled item, or runs its command as the owner
async function runItem(sock, item) {
  try {
    if (item.cmd) {
      const prefix = store.effectivePrefix();
      await require('../whatsapp/handler').runText(sock, item.jid, `${prefix}${item.cmd}`); // loaded late: no circular import
    } else {
      await sock.sendMessage(item.jid, { text: item.text });
    }
  } catch (err) {
    console.log(`Scheduled item ${item.id} failed: ${err.message}`);
  }
}

// "every 2 hours" items are checked every 20 seconds
async function checkIntervals(sock) {
  const now = Date.now();
  let changed = false;
  for (const item of [...store.schedules()]) {
    if (item.repeat?.kind !== 'interval') continue;
    const had = item.nextAt;
    const due = repeat.dueInterval(item, now);
    if (had !== item.nextAt) changed = true;
    if (due) await runItem(sock, item);
  }
  if (changed) store.touchSchedules();
}

async function tick(sock) {
  const p = clock.parts();
  const key = `${p.date} ${p.hhmm}`;
  if (key === lastKey) return; // already handled this minute
  lastKey = key;

  if (p.hhmm === '08:00') birthdays.announceToday(sock).catch((e) => console.log('Birthday job failed:', e.message));

  const jobs = [];
  store.forEachGroup((jid, g) => {
    if (g.autoMute.mute === p.hhmm) jobs.push({ jid, mode: 'announcement', text: '🔒 Group closed automatically. Only admins can send messages.' });
    if (g.autoMute.unmute === p.hhmm) jobs.push({ jid, mode: 'not_announcement', text: '🔓 Group opened automatically. Everyone can send messages.' });
  });

  // Scheduled messages and commands (!schedule): every day / weekdays / chosen days / monthly / once
  for (const item of [...store.schedules()]) {
    if (!repeat.isDue(item, p)) continue;
    await runItem(sock, item);
    if (item.once || item.repeat?.kind === 'once') store.removeSchedule(item.id);
  }

  for (const job of jobs) {
    try {
      await sock.groupSettingUpdate(job.jid, job.mode);
      await sock.sendMessage(job.jid, { text: job.text });
    } catch (err) {
      console.log(`Scheduled job failed for ${job.jid}: ${err.message}`);
    }
  }
}

// reminders ("!remind 10m call mom") are checked every 20 seconds
async function checkReminders(sock) {
  const now = Date.now();
  for (const r of [...store.reminders()]) {
    if (r.at > now) continue;
    store.removeReminder(r.id);
    const late = now - r.at > 2 * 60 * 1000 ? ' (a bit late, I was offline)' : '';
    const isGroup = String(r.jid).endsWith('@g.us');
    try {
      await sock.sendMessage(r.jid, {
        text: `⏰ ${isGroup ? `@${String(r.who).split('@')[0].split(':')[0]} ` : ''}*Reminder${late}:*\n${r.text}`,
        mentions: isGroup ? [r.who] : [],
      });
    } catch (err) {
      console.log(`Reminder ${r.id} could not be sent: ${err.message}`);
    }
  }
}

// the Empire: every job of the realms (news, elections, events...) that is due is done here
let realmBusy = false;
async function checkRealms(sock) {
  if (realmBusy) return;
  realmBusy = true;
  try {
    const mentions = require('../whatsapp/mentions');
    await ticker.run(async (group, content) => {
      await sock.sendMessage(group, await mentions.fix(sock, group, content));
      await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 2500))); // groups are not all written to at the same second
    });
  } finally {
    realmBusy = false;
  }
}

function start(sock) {
  stop();
  timer = setInterval(() => {
    checkRealms(sock).catch((e) => console.error('Realm error:', e.message));
    tick(sock).catch((e) => console.error('Scheduler error:', e.message));
    checkIntervals(sock).catch((e) => console.error('Scheduler (interval) error:', e.message));
    checkReminders(sock).catch((e) => console.error('Reminder error:', e.message));
  }, 20000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, checkReminders, checkIntervals, checkRealms };
