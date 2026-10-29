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

const settings = { minimumDelayMs: 0 }; // tests can shorten delays
const stats = { seen: 0, viewed: 0, liked: 0, saved: 0, errors: 0, rejected: 0, viewMs: null, route: '-', lagSec: null, last: null, lastError: null }; // shown by !statusinfo

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
const likeDay = { day: '', count: 0, lastAt: 0 };
function likeAllowed(limit) {
  const today = new Date().toISOString().slice(0, 10);
  if (likeDay.day !== today) Object.assign(likeDay, { day: today, count: 0 });
  return !limit || likeDay.count < limit;
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
        stats.rejected += 1;
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
    stats.rejected += 1;
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
const viewLane = makeLane(4);
const slowLane = makeLane(3);

async function handleStatus(sock, msg) {
  const cfg = store.statusCfg();
  if (!cfg.view && !cfg.like && !cfg.save) return;
  if (msg.key.fromMe || !msg.message || msg.message.protocolMessage) return; // our own status, or a status being deleted
  if (seen.statuses.check('status', msg.key.id)) return; // never twice, also after a restart

  const who = msg.key.participant || msg.participant;
  if (!who) return;
  const posted = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp) || 0;
  if (posted && Date.now() / 1000 - posted > 24 * 3600) return; // older than a day: it has expired anyway
  stats.lagSec = posted ? Math.max(0, Math.round(Date.now() / 1000 - posted)) : null; // how long WhatsApp took to bring it to the bot
  names.learnMessage({ key: { remoteJid: 'status@broadcast', participant: who }, pushName: msg.pushName });
  stats.seen += 1;
  stats.last = Date.now();
  console.log(`📢 Status from ${num(who)} (${[cfg.view && 'view', cfg.like && 'like', cfg.save && 'save'].filter(Boolean).join(', ')})`);
  const fail = (what, err) => {
    stats.errors += 1;
    stats.lastError = `${what}: ${String(err?.message || err).slice(0, 80)}`;
    console.error(`Status ${what} failed:`, err?.message || err);
  };
  // The view is ALWAYS immediate. The "status delay" setting (if you set one) only delays the like and the save.
  const wait = Math.max(settings.minimumDelayMs, rand(cfg.delayMin, cfg.delayMax) * 1000);
  // 1) the VIEW: always immediate
  const viewJob = async () => {
    if (!cfg.view && !cfg.like) return;
    const t0 = Date.now();
    try {
      await markViewed(sock, msg, who);
      stats.viewed += 1;
      stats.viewMs = Date.now() - t0;
    } catch (err) {
      fail('view', err);
    }
  };

  // 2) the LIKE and the SAVE: only here is there any waiting. Past the daily like limit there is nothing to wait for.
  const slowJob = async () => {
    const limited = cfg.like && !likeAllowed(cfg.dailyLikeLimit);
    if (limited) {
      stats.limited = (stats.limited || 0) + 1;
      if (stats.limited === 1) console.log(`ℹ️ Daily like limit (${cfg.dailyLikeLimit}) reached: statuses are still viewed, but not liked until tomorrow.`);
    }
    const wantLike = cfg.like && !limited;
    if (!wantLike && !cfg.save) return; // nothing left to do: no delay, no waiting place taken
    if (wait > 0) await sleep(wait);
    if (wantLike) {
      const pause = LIKE_GAP_MS - (Date.now() - likeDay.lastAt);
      if (pause > 0) await sleep(pause + Math.random() * 500);
      likeDay.lastAt = Date.now();
      if (settings.likeGapMs) await sleep(settings.likeGapMs);
      try {
        await likeStatus(sock, msg, who, pick(cfg.emojis));
        stats.liked += 1;
        likeDay.count += 1;
        console.log(`❤️ Liked the status of ${num(who)} (${stats.route})`);
      } catch (err) {
        fail('like', err);
      }
    }
    if (cfg.save) {
      try {
        await saveStatus(sock, msg, normalize(sock, cfg.saveTo) || ownerChat(sock), who);
        stats.saved += 1;
      } catch (err) {
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
    if (cfg.like || cfg.save) slowLane(() => slowJob().catch((e) => fail('status', e)));
  });
}

const likeToday = () => (likeDay.day === new Date().toISOString().slice(0, 10) ? likeDay.count : 0);

module.exports = { handleStatus, settings, stats, markViewed, likeStatus, likeToday };
