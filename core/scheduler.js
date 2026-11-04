// Runs timed jobs once a minute: automatic group open/close and scheduled messages
const clock = require('./clock');
const store = require('../whatsapp/store');
const birthdays = require('../whatsapp/birthdays');
const repeat = require('./repeat');
const ticker = require('./realm/ticker'); // the Empire's timed jobs (checkRealms below runs them)

let timer = null;
let lastKey = '';

// A timed job that is due is also done when the bot was restarting at that exact minute (it runs up to GRACE_MIN minutes
// late), and every job remembers on disk that it ran for a given day, so a restart never repeats it and never skips it.
const GRACE_MIN = 10;
const toMin = (hhmm) => Number(String(hhmm).slice(0, 2)) * 60 + Number(String(hhmm).slice(3, 5));
const slotKey = (p, hhmm) => `${p.date} ${hhmm}`;

// is a time-of-day item due now (or a few minutes ago, not yet done)?
function dueNow(item, p) {
  if (!item.time || item.repeat?.kind === 'interval') return false;
  const late = toMin(p.hhmm) - toMin(item.time);
  if (!(late >= 0 && late <= GRACE_MIN)) return false;
  if (!repeat.isDue(item, { ...p, hhmm: item.time })) return false;
  return item.lastRun !== slotKey(p, item.time);
}

// the same for the group open / close times
function dueAuto(g, kind, p) {
  const at = g.autoMute && g.autoMute[kind];
  if (!at) return false;
  const late = toMin(p.hhmm) - toMin(at);
  if (!(late >= 0 && late <= GRACE_MIN)) return false;
  return g.autoMute[kind === 'mute' ? 'ranMute' : 'ranUnmute'] !== slotKey(p, at);
}

// the reminder BEFORE the group closes or opens ("the group closes in 10 minutes"). It is due from the moment
// `remind` minutes are left until the event, and it is late-proof like the other jobs (GRACE_MIN), but never sent
// after the event. The time it was sent is saved, so a restart cannot send it twice.
const REMIND_KEEP_MS = 20 * 60 * 60 * 1000;
function dueRemind(g, kind, p) {
  const am = g.autoMute;
  const at = am && am[kind];
  if (!at || !Number.isInteger(am.remind) || am.remind < 1) return 0;
  const left = (toMin(at) - toMin(p.hhmm) + 1440) % 1440; // minutes until the event
  const pastReminderTime = am.remind - left; // how long ago the reminder time was
  if (!(left > 0 && pastReminderTime >= 0 && pastReminderTime <= GRACE_MIN)) return 0;
  const ran = am[kind === 'mute' ? 'remMute' : 'remUnmute'];
  if (ran && Date.now() - ran < REMIND_KEEP_MS) return 0;
  return left;
}

// the text of that reminder (it tags everybody without listing names: see the job below)
function remindText(kind, at, left) {
  const mins = `${left} minute${left === 1 ? '' : 's'}`;
  return kind === 'mute'
    ? `⏰ *Heads up!*\n🔒 *The group closes in ${mins}* _(at ${at})_.\n_Please finish what you are saying._`
    : `⏰ *Heads up!*\n🔓 *The group opens in ${mins}* _(at ${at})_.\n_Get ready to chat!_`;
}

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
    if (due) {
      store.touchSchedules(); // the next time is saved BEFORE it runs, so a restart cannot run it twice
      changed = false;
      await runItem(sock, item);
    }
  }
  if (changed) store.touchSchedules();
}

async function tick(sock) {
  const p = clock.parts();
  const key = `${p.date} ${p.hhmm}`;
  if (key === lastKey) return; // already handled this minute
  lastKey = key;

  // birthdays: from 08:00 (until noon, in case the bot was restarting at 08:00); each group is told once per day
  if (p.hhmm >= '08:00' && p.hhmm <= '12:00') birthdays.announceToday(sock).catch((e) => console.log('Birthday job failed:', e.message));

  const jobs = [];
  store.forEachGroup((jid, g) => {
    if (dueAuto(g, 'mute', p)) jobs.push({ jid, g, mark: 'ranMute', at: g.autoMute.mute, mode: 'announcement', text: '🔒 Group closed automatically. Only admins can send messages.' });
    if (dueAuto(g, 'unmute', p)) jobs.push({ jid, g, mark: 'ranUnmute', at: g.autoMute.unmute, mode: 'not_announcement', text: '🔓 Group opened automatically. Everyone can send messages.' });
  });

  // the reminders before closing / opening
  const reminders = [];
  store.forEachGroup((jid, g) => {
    for (const kind of ['mute', 'unmute']) {
      const left = dueRemind(g, kind, p);
      if (left) reminders.push({ jid, g, kind, left });
    }
  });

  // Scheduled messages and commands (!schedule): every day / weekdays / chosen days / monthly / once
  for (const item of [...store.schedules()]) {
    if (!dueNow(item, p)) continue;
    item.lastRun = slotKey(p, item.time); // remembered on disk BEFORE it runs: a restart cannot send it twice
    store.touchSchedules();
    await runItem(sock, item);
    if (item.once || item.repeat?.kind === 'once') store.removeSchedule(item.id);
  }

  for (const r of reminders) {
    const mark = r.kind === 'mute' ? 'remMute' : 'remUnmute';
    try {
      r.g.autoMute[mark] = Date.now(); // remembered before it is sent
      store.update(r.jid, () => {});
      const info = await require('../whatsapp/metadata').getMeta(sock, r.jid); // loaded late: no circular import
      const everyone = (info?.participants || []).map((m) => m.id);
      if (!everyone.length) throw new Error('no member list');
      await sock.sendMessage(r.jid, { text: remindText(r.kind, r.g.autoMute[r.kind], r.left), mentions: everyone }); // everybody is notified, no numbers are shown
    } catch (err) {
      r.g.autoMute[mark] = null; // it did not work: tried again in the next minute (within the grace time)
      store.update(r.jid, () => {});
      console.log(`Reminder before closing/opening failed for ${r.jid}: ${err.message}`);
    }
  }

  for (const job of jobs) {
    try {
      job.g.autoMute[job.mark] = slotKey(p, job.at); // remembered before it runs
      store.update(job.jid, () => {});
      await sock.groupSettingUpdate(job.jid, job.mode);
      await sock.sendMessage(job.jid, { text: job.text });
    } catch (err) {
      job.g.autoMute[job.mark] = null; // it did not work: tried again in the next minute (within the grace time)
      store.update(job.jid, () => {});
      console.log(`Scheduled job failed for ${job.jid}: ${err.message}`);
    }
  }
}

// reminders ("!remind 10m call mom") are checked every 20 seconds
async function checkReminders(sock) {
  const now = Date.now();
  for (const r of [...store.reminders()]) {
    if (r.at > now) continue;
    if (r.retryAt && r.retryAt > now) continue; // a failed one waits a little before the next try
    const late = now - r.at > 2 * 60 * 1000 ? ' (a bit late, I was offline)' : '';
    const isGroup = String(r.jid).endsWith('@g.us');
    try {
      await sock.sendMessage(r.jid, {
        text: `⏰ ${isGroup ? `@${String(r.who).split('@')[0].split(':')[0]} ` : ''}*Reminder${late}:*\n${r.text}`,
        mentions: isGroup ? [r.who] : [],
      });
      store.removeReminder(r.id); // removed (and saved at once) only AFTER it was really sent: a restart or a failed send never loses it
    } catch (err) {
      r.tries = (r.tries || 0) + 1;
      console.log(`Reminder ${r.id} could not be sent (try ${r.tries}): ${err.message}`);
      if (r.tries >= 5) store.removeReminder(r.id); // given up after five tries
      else {
        r.retryAt = now + r.tries * 60 * 1000;
        store.touchSchedules();
      }
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

module.exports = { start, stop, tick, checkReminders, checkIntervals, checkRealms, dueRemind, remindText };
