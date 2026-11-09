// WhatsApp Status: auto view, auto like (react) and auto save, with a natural delay
const store = require('./store');
const seen = require('./seen');
const media = require('./media');
const clock = require('../core/clock');
const { ownerChat, normalize } = require('./owner');
const idmap = require('./idmap');
const ack = require('./ack');
const names = require('./names');
const { num, selfJid } = require('./utils');
const jsonstore = require('../core/jsonstore');
const clockCore = require('../core/clock');

// Everything the status features count or remember is kept on disk (data/status-activity.json), so a restart does not make
// the bot forget how many statuses it already liked today, what it did with each status, or its totals.
//   likes     the daily like counter { day, count, lastAt }
//   totals    seen / viewed / liked / saved / errors / rejected / limited since the bot was first used
//   progress  what was already done for each status id { t: time, v: viewed, l: liked, s: saved, n: failed tries }
//   history   the last interactions (newest last)
const js = jsonstore.open('status-activity', () => ({ likes: { day: '', count: 0, lastAt: 0 }, totals: {}, progress: {}, history: [], last: null, lastError: null }), { delay: 500 });
const COUNTERS = ['seen', 'viewed', 'liked', 'saved', 'errors', 'rejected', 'limited'];
const MAX_PROGRESS = 1500;
const MAX_HISTORY = 200;

const settings = { minimumDelayMs: 0 }; // tests can shorten delays
const stats = { seen: 0, viewed: 0, liked: 0, saved: 0, errors: 0, rejected: 0, limited: 0, viewMs: null, route: '-', lagSec: null, last: js.data.last || null, lastError: js.data.lastError || null }; // shown by !statusinfo
for (const k of COUNTERS) stats[k] = Number(js.data.totals[k]) || 0; // the totals come back after a restart

// adds one to a counter and saves it
function bump(k) {
  stats[k] = (Number(stats[k]) || 0) + 1;
  js.data.totals[k] = stats[k];
  js.touch();
}
function note(k, v) {
  stats[k] = v;
  if (k === 'last' || k === 'lastError') {
    js.data[k] = v;
    js.touch();
  }
}
const history = (n = 20) => js.data.history.slice(-n).reverse();
function record(action, who, ok, extra) {
  js.data.history.push({ at: Date.now(), action, who: num(who), ok: !!ok, ...(extra || {}) });
  if (js.data.history.length > MAX_HISTORY) js.data.history.splice(0, js.data.history.length - MAX_HISTORY);
  js.touch();
}

// what was already done for a status (made when the status is first seen)
function progressOf(id) {
  const all = js.data.progress;
  let p = all[id];
  if (!p) {
    p = all[id] = { t: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > MAX_PROGRESS) for (const k of keys.slice(0, keys.length - MAX_PROGRESS)) delete all[k];
    js.touch();
  }
  return p;
}
const inflight = new Set(); // statuses being handled right now (in this process)

const rand = (a, b) => (b > a ? a + Math.random() * (b - a) : a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function saveStatus(sock, msg, to, who) {
  const m = media.unwrap(msg.message) || {};
  const header = `📥 *Status saved*\n👤 From @${num(who)}\n🕒 ${clock.stamp(Date.now())}`;
  const mentions = who ? [who] : [];
  if (m.imageMessage || m.videoMessage || m.audioMessage) {
    const buffer = await media.download(sock, msg);
    if (m.imageMessage) return sock.sendMessage(to, { image: buffer, caption: `${header}${m.imageMessage.caption ? `\n\n${m.imageMessage.caption}` : ''}`, mentions });
    if (m.videoMessage) return sock.sendMessage(to, { video: buffer, caption: `${header}${m.videoMessage.caption ? `\n\n${m.videoMessage.caption}` : ''}`, mentions });
    await sock.sendMessage(to, { text: header, mentions });
    return sock.sendMessage(to, { audio: buffer, mimetype: m.audioMessage.mimetype || 'audio/ogg; codecs=opus', ptt: !!m.audioMessage.ptt });
  }
  const text = m.conversation || m.extendedTextMessage?.text;
  if (text) return sock.sendMessage(to, { text: `${header}\n\n${text}`, mentions });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);

// Marks a status as viewed IN A WAY THE POSTER CAN SEE.
// sock.readMessages() only tells the poster when the bot account has "read receipts" on; otherwise it sends a private
// "read-self" receipt. So the real "read" receipt is sent directly (it is instant), and readMessages() runs in the
// background afterwards so the bot's own devices know it was seen. Nothing here can hold up the like.
async function markViewed(sock, msg, who) {
  const key = msg.key;
  let lastErr = null;
  let ok = false;
  for (const p of [...new Set([who, key.participantPn, key.participantAlt].filter(Boolean))]) {
    try {
      await within(sock.sendReceipt('status@broadcast', p, [key.id], 'read'), 8000, 'view receipt');
      ok = true;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  within(sock.readMessages([key]), 10000, 'readMessages').catch(() => {}); // background, never awaited
  if (!ok) throw lastErr || new Error('could not mark the status as viewed');
}

// Reacts to a status.
// On accounts WhatsApp moved to hidden "LID" addresses, the list of people who receive the like must contain LID
// addresses ONLY. A list that mixes LID and phone-number addresses is refused by WhatsApp (error 479) while the library
// still reports success. So the lists are tried in this order, and WhatsApp's real answer is read after each one:
//   1. LID only (poster + the bot)       2. phone numbers only       3. the old mixed list (old library versions)
// If every list is refused, the like is sent straight to the poster as a last resort.
let routeBrokenUntil = 0;

// A real person does not like hundreds of statuses a day. The bot stops liking (it keeps viewing) after this many per day,
// and keeps a short pause between two likes. Both protect the account from being limited by WhatsApp.
const LIKE_GAP_MS = 1500;
// Statuses older than this are still VIEWED but not liked. After a new link or a long break WhatsApp hands over the statuses of the
// last 24 hours in one go; liking hundreds of old statuses within minutes is what gets an account limited. (STATUS_LIKE_MAX_HOURS changes it.)
const LIKE_MAX_AGE_S = (Number(process.env.STATUS_LIKE_MAX_HOURS) || 3) * 3600;
// "Today" is the day in the bot's own time zone (the one set with the region command), the same clock the rest of the bot uses.
const dayKey = () => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: clockCore.zone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (err) {
    return new Date().toISOString().slice(0, 10);
  }
};
const likeDay = js.data.likes; // saved with the rest: the counter survives a restart
function rollDay() {
  const today = dayKey();
  if (likeDay.day !== today) {
    Object.assign(likeDay, { day: today, count: 0 });
    js.touch();
  }
  return today;
}
// Takes one place in today's likes BEFORE the like is sent. Several likes can be waiting at the same time, so checking
// only the finished ones let the daily limit be passed. Returns the day it counted for, or null when the limit is reached.
function reserveLike(limit) {
  const today = rollDay();
  if (limit && likeDay.count >= limit) return null;
  likeDay.count += 1;
  js.touch();
  return today;
}
function releaseLike(day) {
  if (day && likeDay.day === day && likeDay.count > 0) {
    likeDay.count -= 1; // the like failed: the place is given back
    js.touch();
  }
}

async function react(sock, to, key, emoji, opts) {
  const id = ack.newId(sock);
  const answer = ack.listen(sock, id, 4000);
  await within(sock.sendMessage(to, { react: { key, text: emoji } }, { ...opts, ...(id ? { messageId: id } : {}) }), 15000, 'like');
  return answer();
}

const lidOf = (j) => (j && idmap.isLid(j) ? `${num(j)}@lid` : null);
const pnOf = (j) => (j && idmap.isPn(j) ? `${num(j)}@s.whatsapp.net` : null);

async function likeStatus(sock, msg, who, emoji) {
  const key = msg.key;
  const mePn = selfJid(sock);
  const meLid = lidOf(sock.user?.lid) || idmap.lidSync(mePn);
  const forms = [who, key.participantPn, key.participantAlt];
  const posterLid = forms.map(lidOf).find(Boolean) || idmap.lidSync(forms.map(pnOf).find(Boolean));
  const posterPn = forms.map(pnOf).find(Boolean) || (posterLid && idmap.pnSync(posterLid));

  const uniq = (l) => [...new Set(l.filter(Boolean))];
  const lists = [];
  if (posterLid && meLid) lists.push(uniq([posterLid, meLid]));
  if (posterPn) lists.push(uniq([posterPn, mePn]));
  lists.push(uniq([who, key.participantPn, key.participantAlt, mePn])); // what old library versions accepted

  if (Date.now() > routeBrokenUntil) {
    for (const list of lists) {
      try {
        const r = await react(sock, 'status@broadcast', key, emoji, { statusJidList: list });
        if (r.ok !== false) {
          stats.route = `status (${list.every((j) => j.endsWith('@lid')) ? 'lid' : list.some((j) => j.endsWith('@lid')) ? 'mixed' : 'number'} list)`;
          return;
        }
        bump('rejected');
        console.log(`⚠️ WhatsApp refused a like with the list [${list.map((j) => j.split('@')[1]).join(', ')}] (error ${r.error}), trying the next way...`);
      } catch (err) {
        // try the next list
      }
    }
    routeBrokenUntil = Date.now() + 10 * 60 * 1000; // every list refused: skip straight to the last resort for a while
  }

  // last resort: straight to the poster
  const r = await react(sock, posterLid || who, key, emoji, {});
  if (r.ok === false) {
    bump('rejected');
    throw new Error(`WhatsApp refused the like (error ${r.error}). This is a known problem of the WhatsApp library with some accounts.`);
  }
  stats.route = 'direct';
}

// Statuses are handled a few at a time: after a reconnect WhatsApp can hand over dozens at once, and sending views and
// likes for all of them together made everything slow. There are TWO lanes: VIEWS (instant, nothing ever waits in them) and
// LIKES / SAVES (they wait for the status delay and the pause between likes). Before, one lane did both, so once the daily
// like limit was reached every status still sat through the delay and views became very slow.
function makeLane(max) {
  const waiting = [];
  let running = 0;
  const pump = () => {
    while (running < max && waiting.length) {
      const job = waiting.shift();
      running += 1;
      job().catch(() => {}).finally(() => {
        running -= 1;
        pump();
      });
    }
  };
  return (job) => {
    waiting.push(job);
    pump();
  };
}
const viewLane = makeLane(8);
const slowLane = makeLane(3);

async function handleStatus(sock, msg) {
  const cfg = store.statusCfg();
  if (!cfg.view && !cfg.like && !cfg.save) return;
  if (msg.key.fromMe || !msg.message || msg.message.protocolMessage) return; // our own status, or a status being deleted
  const id = msg.key.id;
  if (id && seen.statuses.has('status', id)) return; // handled by an older version: never twice
  if (id && inflight.has(id)) return; // already being worked on right now

  // Only a real status counts: a picture, a video, a voice note or a text. Other things can arrive on the status channel
  // (reactions to a status, key updates, messages without any content): they are never viewed, liked or counted.
  const inner = media.unwrap(msg.message) || {};
  if (!(inner.imageMessage || inner.videoMessage || inner.audioMessage || inner.ptvMessage || inner.conversation || inner.extendedTextMessage)) return;

  const who = msg.key.participant || msg.participant;
  if (!who) return;
  const posted = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp) || 0;
  if (posted && Date.now() / 1000 - posted > 24 * 3600) return; // older than a day: it has expired anyway

  // What is still to do for THIS status. What was done before a restart is remembered, so after a reconnect nothing is
  // done twice and nothing that was only half done is forgotten.
  const first = !(id && js.data.progress[id]);
  const prog = id ? progressOf(id) : { t: Date.now() };
  if ((prog.n || 0) >= 3) return; // it failed three times: stop trying
  const tooOldToLike = !!posted && Date.now() / 1000 - posted > LIKE_MAX_AGE_S;
  if (tooOldToLike && cfg.like && !prog.l) prog.l = 3; // old: viewed, not liked, and not tried again
  const todo = {
    view: (cfg.view || cfg.like) && !prog.v,
    like: cfg.like && !prog.l,
    save: cfg.save && !prog.s,
  };
  if (!todo.view && !todo.like && !todo.save) return;
  if (id) inflight.add(id);
  const finish = () => {
    if (id) inflight.delete(id);
    js.touch();
  };

  stats.lagSec = posted ? Math.max(0, Math.round(Date.now() / 1000 - posted)) : null; // how long WhatsApp took to bring it to the bot
  names.learnMessage({ key: { remoteJid: 'status@broadcast', participant: who }, pushName: msg.pushName });
  if (first) bump('seen');
  note('last', Date.now());
  console.log(`📢 Status from ${num(who)} (${[cfg.view && 'view', cfg.like && 'like', cfg.save && 'save'].filter(Boolean).join(', ')})${first ? '' : ' (finishing what a restart interrupted)'}`);
  const fail = (what, err) => {
    bump('errors');
    prog.n = (prog.n || 0) + 1;
    note('lastError', `${what}: ${String(err?.message || err).slice(0, 80)}`);
    console.error(`Status ${what} failed:`, err?.message || err);
  };
  // The view is ALWAYS immediate. The "status delay" setting (if you set one) only delays the like and the save.
  const wait = Math.max(settings.minimumDelayMs, rand(cfg.delayMin, cfg.delayMax) * 1000);
  // 1) the VIEW: always immediate
  const viewJob = async () => {
    if (!todo.view) return;
    const t0 = Date.now();
    try {
      await markViewed(sock, msg, who);
      bump('viewed');
      prog.v = 1;
      stats.viewMs = Date.now() - t0;
    } catch (err) {
      fail('view', err);
    }
  };

  // 2) the LIKE and the SAVE: only here is there any waiting. Past the daily like limit there is nothing to wait for.
  const slowJob = async () => {
    let reserved = null;
    let wantLike = todo.like;
    if (wantLike) {
      const live = store.statusCfg(); // read NOW, not when the status arrived: a limit set a moment ago must count
      reserved = live.like ? reserveLike(Number(live.dailyLikeLimit) || 0) : null;
      if (!reserved) {
        wantLike = false;
        if (live.like) {
          prog.l = 2; // skipped because of the daily limit: it is not liked tomorrow instead
          bump('limited');
          if (likeDay.told !== likeDay.day && (likeDay.told = likeDay.day)) console.log(`ℹ️ Daily like limit (${live.dailyLikeLimit}) reached: statuses are still viewed, but not liked until tomorrow.`);
        }
      }
    }
    const wantSave = todo.save;
    if (!wantLike && !wantSave) return; // nothing left to do: no delay, no waiting place taken
    if (wait > 0) await sleep(wait);
    if (wantLike) {
      // the owner may have lowered the limit or switched liking off while this like was waiting its turn
      const live = store.statusCfg();
      if (!live.like || (Number(live.dailyLikeLimit) && likeDay.count > Number(live.dailyLikeLimit))) {
        releaseLike(reserved);
        wantLike = false;
        if (live.like) prog.l = 2;
      }
    }
    if (!wantLike && !wantSave) return;
    if (wantLike) {
      const pause = LIKE_GAP_MS - (Date.now() - likeDay.lastAt);
      if (pause > 0) await sleep(pause + Math.random() * 500);
      likeDay.lastAt = Date.now();
      if (settings.likeGapMs) await sleep(settings.likeGapMs);
      try {
        await likeStatus(sock, msg, who, pick(store.statusCfg().emojis));
        bump('liked');
        prog.l = 1;
        record('like', who, true, { id });
        console.log(`❤️ Liked the status of ${num(who)} (${stats.route})`);
      } catch (err) {
        releaseLike(reserved);
        record('like', who, false, { id });
        fail('like', err);
      }
    }
    if (wantSave) {
      try {
        await saveStatus(sock, msg, normalize(sock, cfg.saveTo) || ownerChat(sock), who);
        bump('saved');
        prog.s = 1;
        record('save', who, true, { id });
      } catch (err) {
        record('save', who, false, { id });
        fail('save', err);
      }
    }
  };

  viewLane(async () => {
    try {
      await viewJob();
    } catch (e) {
      fail('status', e);
    }
    // the daily limit is already reached and nothing else is to be done: skip the slow queue completely
    const lim = Number(store.statusCfg().dailyLikeLimit) || 0;
    if (todo.like && !todo.save && lim && likeToday() >= lim) {
      prog.l = 2;
      bump('limited');
      return finish();
    }
    if (todo.like || todo.save) slowLane(() => slowJob().catch((e) => fail('status', e)).finally(finish));
    else finish();
  });
}

const likeToday = () => (likeDay.day === dayKey() ? likeDay.count : 0);

module.exports = { saveStatus, handleStatus, settings, stats, markViewed, likeStatus, likeToday, history, store: js };
