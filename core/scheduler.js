// Runs timed jobs once a minute: automatic group open/close and scheduled messages
const clock = require('./clock');
const store = require('../whatsapp/store');
const birthdays = require('../whatsapp/birthdays');

let timer = null;
let lastKey = '';

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

  // Scheduled messages (!schedule)
  for (const item of [...store.schedules()]) {
    if (item.time !== p.hhmm) continue;
    try {
      await sock.sendMessage(item.jid, { text: item.text });
    } catch (err) {
      console.log(`Scheduled message ${item.id} failed: ${err.message}`);
    }
    if (item.once) store.removeSchedule(item.id);
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

function start(sock) {
  stop();
  timer = setInterval(() => {
    tick(sock).catch((e) => console.error('Scheduler error:', e.message));
    checkReminders(sock).catch((e) => console.error('Reminder error:', e.message));
  }, 20000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, checkReminders };
