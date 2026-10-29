// Chat games with a lobby. Whoever starts a game opens a lobby; people type "join" to play.
// Only players who joined can play. The bot counts down, warns when time is running out,
// and quiz-style games continue round after round until the end, then show a scoreboard.
const { num, whoIds, whoJid } = require('../utils');
const ttt = require('./ttt');
const guess = require('./guess');
const hangman = require('./hangman');
const scramble = require('./scramble');
const trivia = require('./trivia');
const mathquiz = require('./mathquiz');
const rps = require('./rps');
const slots = require('./slots');
const riddle = require('./riddle');
const emojiquiz = require('./emojiquiz');
const wordle = require('./wordle');
const connect4 = require('./connect4');
const duel = require('./duel');
const typerace = require('./typerace');
const flags = require('./flags');
const capitals = require('./capitals');
const higherlower = require('./higherlower');
const mines = require('./mines');
const blackjack = require('./blackjack');
const bingo = require('./bingo');

const handlers = { ttt, guess, hangman, scramble, trivia, mathquiz, rps, slots, riddle, emojiquiz, wordle, connect4, duel, typerace, flags, capitals, higherlower, mines, blackjack, bingo };
const active = new Map();
const EXPIRE_MS = 10 * 60 * 1000; // a game nobody touches for 10 minutes disappears

// all times in milliseconds (tests change these)
const settings = {
  pauseMs: 2500, // pause between rounds
  lobbyMs: 30000, // how long people can join
  inviteMs: 45000, // how long an invited player has to accept
  tickMs: 1000, // one step of the 3-2-1 countdown
  lobbyWarnAtMs: [15000, 5000], // "x seconds left to join" reminders
  lobbyGapMs: 3000, // no reminder if the lobby is not longer than reminder + this
  warnAtMs: [30000, 15000, 5000], // "x seconds left" warnings during a round
  minGapMs: 10000, // no warning if the round is not longer than warning + this
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = (p) => `@${num(p.jid)}`;
const mentionsOf = (g) => g.players.map((p) => p.jid);
const isPlayer = (g, ids) => g.players.some((p) => p.ids.some((i) => ids.includes(i)));
const limitsOf = (g) => (handlers[g.type].limits ? handlers[g.type].limits(g.opts) : { min: 1, max: 10 });

function later(g, ms, fn) {
  const t = setTimeout(() => {
    Promise.resolve().then(fn).catch((e) => console.error('Game error:', e.message));
  }, ms);
  if (t.unref) t.unref();
  g.timers.push(t);
  return t;
}

function clearAll(g) {
  clearTimeout(g.timer);
  (g.timers || []).forEach(clearTimeout);
  g.timers = [];
}

function get(jid) {
  const g = active.get(jid);
  if (g && Date.now() - g.t > EXPIRE_MS) {
    end(jid);
    return null;
  }
  return g || null;
}

function end(jid) {
  const g = active.get(jid);
  if (g) clearAll(g);
  active.delete(jid);
}

const busyText = (prefix) => `⚠️ A game is already running in this chat. Finish it, or type ${prefix}endgame`;

// "trivia 8" -> 8 rounds (1 to 20), nothing given -> the default
function parseRounds(args, fallback = 5) {
  const n = args.map((a) => parseInt(a, 10)).find((x) => Number.isInteger(x));
  return n ? Math.min(20, Math.max(1, n)) : fallback;
}

// Who may end the game: whoever started it, or a player in tic-tac-toe
function canEnd(game, ids) {
  if (ids.some((i) => game.starter.includes(i))) return true;
  if (['connect4', 'duel', 'blackjack', 'mines', 'higherlower', 'bingo'].includes(game.type)) return isPlayer(game, ids); // the players may end their own game
  return game.type === 'ttt' && !!game.x && (ttt.isPlayer(game.x, ids) || ttt.isPlayer(game.o, ids));
}

function standings(s) {
  const rows = Object.values(s.scores).sort((a, b) => b.n - a.n);
  if (!rows.length) return 'Nobody scored.';
  return rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} @${num(r.jid)} - ${r.n}`).join('\n');
}

function roundHeader(g) {
  const s = g.series;
  const rows = Object.values(s.scores).sort((a, b) => b.n - a.n);
  const line = rows.length ? `\nScores: ${rows.map((r) => `@${num(r.jid)} ${r.n}`).join(' • ')}` : '';
  return `🔔 *Round ${s.round}/${s.total}*${line}`;
}

// ---------------------------------------------------------------- lobby
function lobbyText(g) {
  const lim = limitsOf(g);
  const left = Math.max(0, Math.round((g.lobbyEnds - Date.now()) / 1000));
  const title = handlers[g.type].title;
  const rounds = g.series ? ` • ${g.series.total} rounds` : '';
  const head = g.invited
    ? `🎮 *${title}*\n${tag(g.players[0])} challenges ${g.invitedJid ? `@${num(g.invitedJid)}` : 'you'}!`
    : `🎮 *${title}*${rounds}`;
  const need = g.players.length < lim.min ? ` (need ${lim.min - g.players.length} more)` : '';
  return (
    `${head}\n👥 Players (${g.players.length}/${lim.max}): ${g.players.map(tag).join(' ')}${need}\n` +
    `✍️ ${g.invited ? 'Type *join* to accept!' : 'Type *join* to play, *quit* to leave'}\n` +
    `⏱️ Starting in ${left}s${lim.max > 1 && lim.min < lim.max ? ' • the host can type *start* to begin now' : ''}`
  );
}

// opens the lobby (or starts straight away for solo play)
async function open({ sock, jid, msg, type, starter, rounds = 1, options = {}, invited = null, invitedJid = null, instant = false }) {
  const g = {
    type, phase: 'lobby', players: [{ ids: starter.ids, jid: starter.jid }], invited, invitedJid,
    starter: starter.ids, opts: options, t: Date.now(), activity: false, roundId: 0, waiting: false,
    timer: null, timers: [], notified: {}, lobbyEnds: 0,
    series: rounds > 1 ? { total: rounds, round: 1, scores: {}, idle: 0 } : null,
  };
  active.set(jid, g);

  const lim = limitsOf(g);
  if (instant || lim.max <= 1) {
    await launch(sock, jid, g);
    return g;
  }

  const ms = invited ? settings.inviteMs : settings.lobbyMs;
  g.lobbyEnds = Date.now() + ms;
  await sock.sendMessage(jid, { text: lobbyText(g), mentions: [...mentionsOf(g), ...(invitedJid ? [invitedJid] : [])] }, msg ? { quoted: msg } : undefined);
  for (const w of settings.lobbyWarnAtMs) {
    if (ms > w + settings.lobbyGapMs) later(g, ms - w, () => remindLobby(sock, jid, g, w));
  }
  later(g, ms, () => closeLobby(sock, jid, g));
  return g;
}

async function remindLobby(sock, jid, g, w) {
  if (active.get(jid) !== g || g.phase !== 'lobby') return;
  await sock.sendMessage(jid, {
    text: `⏳ *${Math.round(w / 1000)} seconds left to join!*\n👥 ${g.players.map(tag).join(' ')}\nType *join* to play.`,
    mentions: mentionsOf(g),
  });
}

async function closeLobby(sock, jid, g) {
  if (active.get(jid) !== g || g.phase !== 'lobby') return;
  if (g.players.length < limitsOf(g).min) {
    end(jid);
    await sock.sendMessage(jid, { text: `😕 Nobody joined in time, so I cancelled the ${handlers[g.type].title}.` });
    return;
  }
  await launch(sock, jid, g);
}

// handles the plain words "join", "quit" and "start" while the lobby is open
async function lobbyWord(sock, msg, jid, g, who, word) {
  const send = (text, mentions = []) => sock.sendMessage(jid, { text, mentions }, { quoted: msg });
  const lim = limitsOf(g);
  const mine = isPlayer(g, who.ids);

  if (word === 'join') {
    if (mine) return send('ℹ️ You already joined.');
    if (g.invited && !who.ids.some((i) => g.invited.includes(i))) return send('⛔ This challenge is for someone else.');
    if (g.players.length >= lim.max) return send('⛔ The game is full.');
    g.players.push({ ids: who.ids, jid: who.jid });
    g.t = Date.now();
    await send(`✅ @${num(who.jid)} joined! Players (${g.players.length}/${lim.max}): ${g.players.map(tag).join(' ')}`, mentionsOf(g));
    if (g.players.length >= lim.max) launch(sock, jid, g).catch((e) => console.error('Game start error:', e.message));
    return;
  }

  if (word === 'quit' && mine) {
    if (who.ids.some((i) => g.starter.includes(i))) {
      end(jid);
      return send('🛑 The host left, so the game was cancelled.');
    }
    g.players = g.players.filter((p) => !p.ids.some((i) => who.ids.includes(i)));
    return send(`👋 @${num(who.jid)} left. Players (${g.players.length}/${lim.max}): ${g.players.map(tag).join(' ')}`, mentionsOf(g));
  }

  if (word === 'start' && who.ids.some((i) => g.starter.includes(i))) {
    if (g.players.length < lim.min) return send(`⚠️ I need at least ${lim.min} players to start.`);
    launch(sock, jid, g).catch((e) => console.error('Game start error:', e.message));
  }
}

// ---------------------------------------------------------------- starting and rounds
// An edit must carry the tags again, or the names turn into bare numbers after the first edit
async function edit(sock, jid, key, text, mentions) {
  try {
    if (!key) throw new Error('no key');
    await sock.sendMessage(jid, { text, edit: key, mentions });
  } catch (err) {
    await sock.sendMessage(jid, { text, mentions });
  }
}

async function launch(sock, jid, g) {
  if (g.phase !== 'lobby') return;
  clearAll(g);
  g.phase = 'starting';
  const h = handlers[g.type];
  Object.assign(g, h.create(g.opts, g.players));

  if (g.players.length > 1) {
    const names = g.players.map(tag).join(' ');
    const first = await sock.sendMessage(jid, { text: `🚦 *Game on!* ${names}\nStarting in *3*`, mentions: mentionsOf(g) });
    for (const step of ['2', '1']) {
      await sleep(settings.tickMs);
      await edit(sock, jid, first?.key, `🚦 *Game on!* ${names}\nStarting in *${step}*`, mentionsOf(g));
    }
    await sleep(settings.tickMs);
    await edit(sock, jid, first?.key, `🟢 *GO!* ${names}`, mentionsOf(g));
  }
  if (active.get(jid) !== g) return; // ended during the countdown

  g.phase = 'playing';
  g.roundId = 1;
  g.t = Date.now();
  arm(sock, jid, g);
  const header = g.series ? `${roundHeader(g)}\n\n` : '';
  const note = g.series ? `\n\n🔁 ${g.series.total} rounds in a row. Type !endgame to stop.` : '';
  await sock.sendMessage(jid, { text: header + h.intro(g) + note, mentions: mentionsOf(g) });
  if (h.onStart) await h.onStart(ctxFor(sock, jid, g)); // games that move by themselves (higher/lower, bingo, blackjack...)
}

// each round has a time limit with warnings; when it runs out the answer is shown and play continues
function arm(sock, jid, g) {
  clearAll(g);
  const h = handlers[g.type];
  if (!h.timeoutMs) return;
  const roundId = g.roundId;
  g.timer = setTimeout(() => {
    onTimeout(sock, jid, g, roundId).catch((e) => console.error('Game timer error:', e.message));
  }, h.timeoutMs);
  if (g.timer.unref) g.timer.unref();
  for (const w of settings.warnAtMs) {
    if (h.timeoutMs > w + settings.minGapMs) later(g, h.timeoutMs - w, () => warn(sock, jid, g, roundId, w));
  }
}

async function warn(sock, jid, g, roundId, w) {
  if (active.get(jid) !== g || g.roundId !== roundId || g.phase !== 'playing' || g.waiting) return;
  const info = handlers[g.type].status ? `\n${handlers[g.type].status(g)}` : '';
  await sock.sendMessage(jid, { text: `⏳ *${Math.round(w / 1000)} seconds left!*${info}` });
}

async function onTimeout(sock, jid, g, roundId) {
  if (active.get(jid) !== g || g.roundId !== roundId || g.phase !== 'playing' || g.waiting) return;
  const h = handlers[g.type];
  const res = h.onTimeout ? h.onTimeout(g) : { text: `⌛ Time's up! ${h.reveal(g)}`, winners: null, mentions: [] };
  await sock.sendMessage(jid, { text: res.text, mentions: res.mentions || [] });
  await finishRound(sock, jid, g, res.winners || null);
}

// Called when a round is over. winner can be one player, a list of players, or nobody.
async function finishRound(sock, jid, g, winner) {
  clearAll(g);
  const s = g.series;
  if (!s) return end(jid);
  if (active.get(jid) !== g || g.waiting) return;

  const winners = Array.isArray(winner) ? winner : winner ? [winner] : [];
  for (const w of winners) {
    const key = w.ids[0] || w.jid;
    s.scores[key] = s.scores[key] || { jid: w.jid, n: 0 };
    s.scores[key].n += 1;
  }
  s.idle = g.activity ? 0 : s.idle + 1;
  const scorers = Object.values(s.scores).map((r) => r.jid);

  if (s.idle >= 2) {
    end(jid);
    return sock.sendMessage(jid, { text: `😴 Nobody is playing, so I stopped the game.\n\n${standings(s)}`, mentions: scorers });
  }
  if (s.round >= s.total) {
    end(jid);
    return sock.sendMessage(jid, { text: `🏁 *Game over!*\n\n${standings(s)}`, mentions: scorers });
  }

  g.waiting = true; // answers are ignored during the short pause
  later(g, settings.pauseMs, () => nextRound(sock, jid, g));
}

async function nextRound(sock, jid, g) {
  if (active.get(jid) !== g) return;
  const h = handlers[g.type];
  g.series.round += 1;
  g.roundId += 1;
  Object.assign(g, h.create(g.opts, g.players));
  g.waiting = false;
  g.activity = false;
  g.t = Date.now();
  arm(sock, jid, g);
  await sock.sendMessage(jid, { text: `${roundHeader(g)}\n\n${h.intro(g)}`, mentions: mentionsOf(g) });
  if (h.onStart) await h.onStart(ctxFor(sock, jid, g));
}

// With no prefix, "join", "quit" and "start" could also be the name of a command (join is one). While a game waits for
// players, these three words belong to the game. Everything else, once the game runs, is a command when it is one.
function claims({ jid, text }) {
  const g = get(jid);
  if (!g) return false;
  const word = String(text || '').trim().toLowerCase();
  return g.phase === 'lobby' && (word === 'join' || word === 'quit' || word === 'start');
}

// Passes a normal chat message to the game running in that chat
async function route({ sock, msg, jid, text, botIds }) {
  const g = get(jid);
  if (!g) return;
  const who = { ids: whoIds(msg, botIds), jid: whoJid(msg, sock) };
  const word = text.trim().toLowerCase();

  if (g.phase === 'lobby') return lobbyWord(sock, msg, jid, g, who, word);
  if (g.phase !== 'playing' || g.waiting) return;

  if (!isPlayer(g, who.ids)) {
    // only people who joined can play
    const k = who.ids[0] || who.jid;
    if (word === 'join' && Date.now() - (g.notified[k] || 0) > 60000) {
      g.notified[k] = Date.now();
      await sock.sendMessage(jid, { text: `⛔ @${num(who.jid)}, this game already started. You can join the next one!`, mentions: [who.jid] }, { quoted: msg });
    }
    return;
  }

  await handlers[g.type].onMessage({ ...ctxFor(sock, jid, g), text: text.trim(), who, botIds, send: (t, mentions = []) => sock.sendMessage(jid, { text: t, mentions }, { quoted: msg }) });
}

// what a game handler is given to work with
function ctxFor(sock, jid, g) {
  return {
    game: g, players: g.players, sock, jid,
    send: (t, mentions = []) => sock.sendMessage(jid, { text: t, mentions }),
    end: (winner) => finishRound(sock, jid, g, winner),
    later: (ms, fn) => later(g, ms, fn),
    touch: () => {
      g.t = Date.now();
      g.activity = true;
    },
  };
}

// the shared start code for the simple games (guess, hangman, scramble, trivia, mathquiz, rps, slots)
async function fromCommand(ctx, type, { defaultRounds = 5, options = {} } = {}) {
  const { sock, jid, msg, args, reply, prefix, myIds, myJid } = ctx;
  if (get(jid)) return reply(busyText(prefix));
  const solo = args.some((a) => a.toLowerCase() === 'solo');
  const rounds = parseRounds(args, defaultRounds);
  await open({ sock, jid, msg, type, starter: { ids: myIds, jid: myJid }, rounds, options, instant: solo });
}

module.exports = { claims,
  get, end, open, busyText, canEnd, parseRounds, route, fromCommand, settings,
  ttt, guess, hangman, scramble, trivia, mathquiz, rps, slots, riddle, emojiquiz, wordle, connect4, duel, typerace, flags, capitals, higherlower, mines, blackjack, bingo,
};
