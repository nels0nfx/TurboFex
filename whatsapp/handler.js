const fs = require('fs');
const path = require('path');
const config = require('../config');
const store = require('./store');
const cleanup = require('./cmdcleanup');
const meta = require('./metadata');
const activity = require('./activity');
const groupstats = require('./groupstats');
const recent = require('./recent');
const categories = require('./categories');
const seen = require('./seen');
const sent = require('./sent');
const replay = require('./replay');
const idmap = require('./idmap');
const watchers = require('./watchers');
const stickercmd = require('./stickercmd');
const ownername = require('./ownername');
const statusreply = require('./statusreply');
const i18n = require('../core/i18n');
const cmdreact = require('./cmdreact');
const { withTimeout } = require('./timeout');
const watermark = require('./watermark');
const fmt = require('./format');
const ratelimit = require('./ratelimit');
const stats = require('./stats');
const levels = require('./levels');
const names = require('./names');
const presence = require('./presence');
const chatbot = require('./chatbot');
const captcha = require('./captcha');
const autosticker = require('./autosticker');
const brand = require('../core/brand');
const { addExif } = require('../core/webpexif');
const capacity = require('../core/capacity');
const { runProtections } = require('./protect');
const { runPassive } = require('./passive');
const toggles = require('../core/toggles');
const ignored = require('./ignored');
const warm = require('./warm');
const { peel } = require('./unwrap');
const chatlog = require('../core/chatlog');
const ownerInfo = require('./owner');
const intent = require('./intent');
const context = require('./context');
const resilience = require('../core/resilience');
const { getText, num, whoIds, whoJid, participantIds, senderIds, isCommandText } = require('./utils');

const SLOT_LIMIT_MS = 10 * 60 * 1000; // the longest a medium or heavy command may hold its slot (a command can set its own `maxMs`)
const commands = new Map(); // name or alias -> command
const commandList = [];
const diag = {
  loadErrors: [],
  stats: { handled: 0, replaysIgnored: 0, duplicatesIgnored: 0 },
  timing: { n: 0, total: 0, max: 0, slow: [] }, // how long the bot takes to answer (shown by !status and !ping)
}; // shown by !status

// slow tasks (media, long commands) run on their own so they never block the chat
const running = new Set();
const idle = () => Promise.all([...running]);

function loadCommands() {
  const dir = path.join(__dirname, '..', 'commands');
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    try {
      // what the commands in this file need from the server (tools, memory): the capacity guard uses it
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      // a file exports one command, or a list of related commands
      for (const cmd of [].concat(require(path.join(dir, file)))) {
        cmd.capacity = capacity.describe(cmd, source);
        if (!categories.info[cmd.category]) {
          console.warn(`⚠️ Command "${cmd.name}" has no valid menu category (set category: '...' in its file)`);
        }
        commandList.push(cmd);
        commands.set(cmd.name, cmd);
        (cmd.aliases || []).forEach((a) => commands.set(a, cmd));
      }
    } catch (err) {
      diag.loadErrors.push(`${file}: ${err.message}`);
      console.error(`Could not load command ${file}:`, err.message);
    }
  }
  commandList.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`Loaded ${commandList.length} commands.`);
}
loadCommands();
try {
  require('../core/plugins').attach(commands, commandList); // plugins add their commands later, only when the owner turned them on
} catch (err) {
  console.error('Plugins could not be prepared:', err.message);
}
const maintenanceTold = new Map(); // chat -> when it was last told about the maintenance
const isKnownCommand = (word) => commands.has(String(word || '').toLowerCase());

// Works out who sent the message and what rights they (and the bot) have
async function getRoles(sock, msg, jid, isGroup) {
  const sIds = senderIds(msg);
  const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(num);
  const ownerNum = config.ownerNumber;
  const sudo = store.getSudo();
  const banned = store.getBanned();

  let isRealOwner = !!msg.key.fromMe || !!(ownerNum && sIds.includes(ownerNum));
  let isSudo = sudo.some((n) => sIds.includes(n));
  let isBanned = banned.some((n) => sIds.includes(n));
  let groupMetadata = null;
  let isAdmin = false;
  let isBotAdmin = false;

  if (isGroup) {
    groupMetadata = await meta.getMeta(sock, jid);
    const idx = meta.indexOf(groupMetadata); // lookup table: no walking through the whole member list for every message
    const senders = new Set();
    for (const id of sIds) {
      const p = idx.byId.get(id);
      if (p) senders.add(p);
    }
    for (const p of senders) {
      const ids = participantIds(p);
      if (ownerNum && ids.includes(ownerNum)) isRealOwner = true;
      if (sudo.some((n) => ids.includes(n))) isSudo = true;
      if (banned.some((n) => ids.includes(n))) isBanned = true;
      if (p.admin === 'admin' || p.admin === 'superadmin') isAdmin = true;
    }
    isBotAdmin = botIds.some((id) => idx.admins.has(id));
    // a message typed on the bot's own account counts as the bot being the sender
    if (msg.key.fromMe && isBotAdmin) isAdmin = true;
  }
  return {
    botIds, sIds, isRealOwner, isOwner: isRealOwner || isSudo, isBanned,
    groupMetadata, isAdmin, isBotAdmin,
  };
}

async function handleMessageInner(sock, msg) {
  if (!msg.message) {
    // WhatsApp sent a message but not its content (typical for view-once on a linked device): tell the watcher, do not stay silent
    watchers.noContent(sock, msg).catch(() => {});
    return;
  }
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;

  // Edit / delete notices are not chat messages: they go straight to the watcher, BEFORE the "seen before" check
  // (an edit can carry the id of the message it edits, and would wrongly be thrown away as a duplicate).
  const early = peel(msg.message).content;
  if (early.protocolMessage || early.secretEncryptedMessage) {
    watchers.run(sock, msg).catch((e) => console.error('Watcher error:', e.message));
    return;
  }

  // View-once files go to their watcher BEFORE the "seen before" check: the same message can arrive twice (first without its
  // file, then complete) and the complete one must not be thrown away as a duplicate.
  if (!msg.synthetic && !msg.key.fromMe) watchers.early(sock, msg);

  // never answer our own replies, and never handle one message twice (also after a restart)
  const synthetic = !!msg.synthetic; // a command run by the scheduler, not typed in the chat
  if (sent.has(msg.key.id)) return;
  if (!synthetic && seen.check(jid, msg.key.id)) {
    diag.stats.duplicatesIgnored += 1;
    return;
  }
  diag.stats.handled += 1;
  const t0 = Date.now();
  idmap.learnKey(msg.key);
  names.learnMessage(msg); // the name people use on WhatsApp, so notices can say the name instead of a number
  ownername.learn(sock, msg); // the owner's own name, for the menu header
  // remember how WhatsApp addresses the owner, so notifications to him can always be opened
  if (!jid.endsWith('@g.us') && !msg.key.fromMe && config.ownerNumber && !jid.endsWith('@broadcast')) {
    const pn = idmap.isPn(jid) ? jid : msg.key.remoteJidAlt || idmap.pnSync(jid);
    if (pn && num(pn) === config.ownerNumber) ownerInfo.remember(jid);
  }

  let text = getText(msg).trim();
  const isGroup = jid.endsWith('@g.us');
  const prefix = store.effectivePrefix(); // empty in "no prefix" mode

  const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(num);
  const meKey = senderIds(msg)[0] || jid; // who is talking: the key of the short-term memory (last command, waiting question)

  // the console shows every message (gold, white and black lines; switch off with CONSOLE_CHAT=off)
  if (!synthetic) chatlog.incoming({ msg, jid, isGroup, text, content: early, prefix, isCommand: isCommandText(text, prefix, isKnownCommand) });
  if (isGroup && !meta.peek(jid)) meta.getMeta(sock, jid).catch(() => {}); // so the next line can show the group name

  let cached = null;
  const roles = () => (cached = cached || getRoles(sock, msg, jid, isGroup));

  // a reply to somebody's status written by the owner: the status is saved (only when switched on, silently)
  if (!synthetic) statusreply.maybe(sock, msg, async () => (await roles()).isOwner).catch((e) => console.error('Status reply error:', e.message));

  // a sticker that the owner linked to a command: it runs that command as if the owner had typed it
  let sticker = null;
  if (!synthetic) {
    const bound = stickercmd.lookup(msg);
    if (bound && (msg.key.fromMe || (await roles()).isOwner)) {
      sticker = bound;
      text = stickercmd.textFor(bound, prefix);
    }
  }

  // the owner writes in a private chat: that person is not a stranger for the private message blocker
  if (!isGroup && msg.key.fromMe && !synthetic) presence.engage(jid);

  // owner automation: mark incoming messages as read
  if (!synthetic && !msg.key.fromMe && jid !== 'status@broadcast' && store.getAuto('read')) sock.readMessages([msg.key]).catch(() => {});

  // view-once / deleted / edited message watchers run on their own
  if (!synthetic) watchers.run(sock, msg, botIds).catch((e) => console.error('Watcher error:', e.message));

  // Banned users are ignored completely
  if (!msg.key.fromMe && store.getBanned().length) {
    const r = await roles();
    if (r.isBanned && !r.isOwner) return;
  }

  // An ignored chat (the owner switched it on with `ignore on`): nothing is done for what other people write there. The owner's own
  // commands still work, so it can be switched off again; everything else the owner writes there is ignored too.
  if (!synthetic && ignored.isIgnored(jid)) {
    if (!msg.key.fromMe && !(await roles()).isOwner) return;
    if (!isCommandText(text, prefix, isKnownCommand)) return;
  }

  // private message blocker: strangers who write to the bot in private are told (or blocked); the owner and sudo users are never affected
  if (!isGroup && !synthetic && !msg.key.fromMe && jid !== 'status@broadcast' && store.getAuto('pm', 'off') !== 'off') {
    const r = await roles();
    if (!r.isOwner) return presence.pmGuard(sock, jid, store.getAuto('pm'));
  }

  // Passive protections (anti-link, anti-word, anti-spam) and message counting
  if (isGroup && !msg.key.fromMe) {
    activity.count(jid, msg.key.participant);
    recent.touch(jid, msg.key.participant); // for listonline
    try {
      groupstats.onMessage(jid, msg.key.participant, text, { name: msg.pushName, isCommand: isCommandText(text, prefix, isKnownCommand), extraWords: store.getGroup(jid).badWords }); // groupstats, swearjar, catchup
    } catch (err) {
      console.error('Group counters failed:', err.message);
    }
    if (await runProtections({ sock, msg, jid, text, getRoles: roles })) return;
    if (text && captcha.check(sock, msg, jid, text, botIds)) return; // an answer to the verification question
    autosticker.maybe(sock, msg, jid, botIds).catch(() => {}); // pictures and videos become stickers (only when switched on)
  }
  // ranks: chatting earns XP (commands and rule breakers do not). Messages typed on the bot's own account count too
  // (they are the bot owner's own chat), under the account's own id.
  if (isGroup && !synthetic && store.getGroup(jid).rank && text && !isCommandText(text, prefix, isKnownCommand)) {
    const who = whoJid(msg, sock);
    const got = who ? levels.award(jid, who) : null;
    if (got && got.up) {
      sock.sendMessage(jid, { text: `🎉 *Level up!*\n@${num(who)} reached *level ${got.level}*`, mentions: [who] }, { quoted: msg }).catch(() => {});
    }
  }

  // the owner answers "Did you mean ...?" with a plain yes or no (no prefix): yes runs the corrected command as if it was typed
  if (!synthetic && text && context.hasAsk(jid)) {
    const got = context.answer(jid, meKey, text);
    if (got) {
      if (got.answer === 'no') { sock.sendMessage(jid, { text: '👍 *Okay, I will leave it.*' }, { quoted: msg }).catch(() => {}); return; }
      return handleMessageInner(sock, got.ask.fixed);
    }
  }

  let isCommand = isCommandText(text, prefix, isKnownCommand);
  if (isCommand && !prefix && !synthetic && require('./play').claims({ sock, msg, jid, text, botIds })) isCommand = false; // a game word, not a command
  if (!synthetic && (isCommand || msg.key.fromMe)) warm.touch(jid); // a chat in use: its device lists are kept fresh in the background (whatsapp/warm.js)
  if (!synthetic) presence.onIncoming(sock, msg, jid); // "typing..." / "recording..." when someone writes to the bot (only when switched on)
  if (!isCommand && !synthetic) presence.reactTo(sock, msg, jid, isGroup ? [num(msg.key.participant), levels.keyOf(msg.key.participant || '')] : [num(jid), levels.keyOf(jid)]); // auto reactions (only when switched on)

  // Games, AFK notices and auto-replies work for everyone, in every mode.
  // For commands they run alongside, so they never delay the answer.
  const passive = runPassive({ sock, msg, jid, text, isGroup, isCommand, prefix, botIds });
  if (!isCommand) {
    if (!synthetic && isGroup && !msg.key.fromMe && text) {
      try {
        require('../core/plugins').emit('message', { sock, jid, text, senderJid: msg.key.participant, pushName: msg.pushName, key: msg.key, mentioned: require('./utils').getMentioned(msg) }); // plugins that listen to group messages (only when the owner turned plugins on)
      } catch (err) {
        // a plugin problem never stops a message
      }
    }
    if (!synthetic && text && !require('./play').get(jid)) chatbot.maybeReply({ sock, msg, jid, text, botIds, commandList, isOwner: async () => (await roles()).isOwner, isRealOwner: async () => (await roles()).isRealOwner }).catch(() => {}); // NelsonFx chats (only when switched on)
    return passive;
  }

  let body = text.slice(prefix.length).trim();
  let [rawName, ...args] = body.split(/\s+/);
  let cmdName = (rawName || '').toLowerCase();
  // "again": the last command of this person in this chat is run again (all the normal checks apply to it, as if it was typed now)
  if (!synthetic && commands.get(cmdName)?.name === 'again') {
    const prev = context.recall(jid, meKey);
    if (prev && !prev.repeatable) return sock.sendMessage(jid, { text: `ℹ️ *That command cannot be repeated with again.*\n▸ _It changes things, so please type it yourself._` }, { quoted: msg }).catch(() => {});
    if (prev) { body = prev.body; [rawName, ...args] = body.split(/\s+/); cmdName = (rawName || '').toLowerCase(); }
  }
  const cmd = commands.get(cmdName);
  // run by a sticker and marked silent (vv): nothing is answered or reacted in this chat; problems are told in the owner's own chat
  const silent = !!sticker && !!cmd?.silentOnSticker;
  i18n.noteBot(sock);
  const rawReply = (t, extra = {}) => sock.sendMessage(silent ? ownerInfo.ownerChat(sock) : jid, { text: i18n.translate(t), ...extra }, synthetic || silent ? undefined : { quoted: msg });

  if (!cmd) {
    // a command file that failed to load: tell the owner why instead of staying silent (nobody else is answered)
    const failed = diag.loadErrors.find((e) => e.startsWith(`${cmdName}.js:`));
    if (failed && (await roles()).isOwner) {
      return rawReply(`⚠️ The command "${cmdName}" could not be loaded.\nReason: ${failed.slice(failed.indexOf(':') + 1).trim().slice(0, 150)}`);
    }
    // a mistyped command: say what was probably meant (only commands this person may use). The owner answers yes or no.
    if (!synthetic && !sticker && prefix && store.getAuto('autocorrect', true) !== false) {
      let rr = null;
      try { rr = await roles(); } catch (err) { return; }
      if (!rr.isOwner && store.getAuto('maintenance')) return;
      const allowed = (c) => !(
        (c.deniedIn && c.deniedIn(jid)) || (store.getMode() === 'private' && !rr.isOwner && !c.everyone) ||
        (c.realOwnerOnly && !rr.isRealOwner) || (c.ownerOnly && !rr.isOwner) || (c.adminOnly && !(rr.isAdmin || rr.isOwner)) ||
        (c.groupOnly && !isGroup) || (!rr.isOwner && isGroup && store.getGroup(jid).disabled.includes(c.name))
      );
      const hit = intent.suggest(cmdName, commands, allowed);
      if (!hit || !context.mayOffer(jid)) return;
      const tail = body.slice((rawName || '').length);
      const shown = `${prefix}${hit.name}${tail.trim() ? ' ' + tail.trim().slice(0, 40) : ''}`;
      if (rr.isOwner) {
        context.ask(jid, meKey, { fixed: context.withText(msg, prefix + hit.name + tail) });
        return rawReply(`🤔 *Did you mean* \`${shown}\`?\n▸ _Send_ *yes* _to run it, or_ *no* _to cancel._`);
      }
      return rawReply(`🤔 *Did you mean* \`${shown}\`?\n▸ _Send it again like that._`);
    }
    return;
  }
  if (cmd.deniedIn && cmd.deniedIn(jid)) return; // a plugin the owner switched off in this group: no answer at all
  const rest = body.slice((rawName || '').length).trim(); // everything after the command, keeps new lines

  let r;
  try {
    r = await roles();
  } catch (err) {
    console.error('Could not read group info:', err.message);
    return rawReply('⚠️ WhatsApp is slow right now and I could not check this group. Please try again in a moment.');
  }
  const { isOwner, isRealOwner, groupMetadata, isAdmin, isBotAdmin } = r;

  // Private mode (the default): only the owner can use commands. Everybody else gets NO answer at all.
  // (Games that are already running, auto-replies and group protection still work, they are not commands.)
  // (Commands marked "everyone" - rank, top, rules, report, birthday... - are meant for members, so they work in private mode too.)
  if (store.getMode() === 'private' && !isOwner && !cmd.everyone) return;

  // Restricted commands: anybody who is not allowed to use one gets NO answer at all (no warning, no explanation).
  // This check comes first, so nothing else (rate limit, "turned off", maintenance, group-only) can answer them either.
  if (cmd.realOwnerOnly && !isRealOwner) return;
  if (cmd.ownerOnly && !isOwner) return;
  if (cmd.adminOnly && !(isAdmin || isOwner)) return;

  // Commands an admin switched off in this group (disable), and maintenance mode: only the owner uses the bot
  if (!isOwner && isGroup && store.getGroup(jid).disabled.includes(cmd.name)) return rawReply(`⛔ *The command ${cmd.name} is turned off in this group.*`);
  if (!isOwner && store.getAuto('maintenance')) {
    const at = maintenanceTold.get(jid) || 0;
    if (Date.now() - at > 3600000) {
      maintenanceTold.set(jid, Date.now());
      if (maintenanceTold.size > 2000) maintenanceTold.clear();
      return rawReply('🛠️ *The bot is in maintenance.* Please try again later.');
    }
    return;
  }

  // one person cannot flood the bot (the owner is never limited)
  if (!isOwner || (store.rateCfg().owner && !synthetic)) {
    const who = levels.keyOf(msg.key.participant || msg.key.participantAlt || r.sIds[0] || jid) || r.sIds[0] || jid;
    let rl = { ok: true };
    if (rl.ok) rl = ratelimit.check(who);
    if (!rl.ok) {
      if (rl.notify) await rawReply(`⏳ *Slow down.* Please wait ${rl.seconds} seconds before using more commands.`).catch(() => {});
      return;
    }
  }

  if (cmd.groupOnly && !isGroup) return rawReply('⚠️ This command only works in groups. Add me to a group and try it there.');
  if (cmd.botAdminRequired && !isBotAdmin) {
    return rawReply(isAdmin || isOwner ? '⚠️ I need to be a group admin to do that. Please make me an admin, then try again.' : '⚠️ I cannot do that right now. Please ask a group admin to make me an admin first.');
  }

  const tStart = Date.now();
  const ts = replay.timestampOf(msg);
  const timing = {
    receivedAt: t0,
    thinkMs: tStart - t0, // time inside the bot before the command started (roles, group info)
    deliveryMs: ts ? Math.max(0, t0 - ts * 1000) : null, // time since WhatsApp stamped the message (includes clock differences)
  };

  const execute = async () => {
    // 0) a command that failed again and again is resting for a few minutes (the owner can still use it)
    const resting = isOwner ? null : resilience.hold(cmd.name);
    if (resting) {
      if (resting.first) await rawReply(`⏸️ *${cmd.name} is resting for a few minutes.*\n▸ _It failed several times in a row. Please try again a little later._`).catch(() => {});
      return;
    }
    if (!synthetic && cmd.name !== 'again') context.remember(jid, meKey, { body, name: cmd.name, repeatable: !cmd.noAgain && !cmd.botAdminRequired && cmd.category !== 'owner' });

    // 1) can the server really handle this command right now? (tools, memory, load, parallel jobs)
    const who = isOwner ? null : r.sIds[0] || jid;
    const gate = store.getGuard() ? await capacity.enter(cmd, who) : { ok: true, release() {} };
    if (!gate.ok) {
      console.log(`🛡️ Blocked "${cmd.name}": ${gate.why} - ${gate.detail}`);
      await rawReply(capacity.refusal(gate, isOwner)).catch(() => {});
      return;
    }

    // 2) ⏳ on the command while it works, ✅ when it is done
    const react = cmd.noReact || synthetic || silent ? { finish() {} } : cmdreact.begin(sock, msg, { since: t0 });

    // 3) the command gets its own copy of "sock": results of some commands get a watermark, and we notice warnings
    const mark = watermark.applies(cmd) ? watermark.text() : null;
    const styled = fmt.mode(cmd);
    let warned = false;
    let sentAny = false; // the command already showed something in the chat: it is then never run a second time
    const pending = new Set(); // everything the command is still sending: the ✅ waits for it, so it never comes before the answer
    const answers = []; // the messages the command sent in the chat (cleanup.js deletes them later, when the owner wants that)
    const csock = Object.create(sock);
    const switchWatch = toggles.watch(cmd, args, isGroup); // a single on/off word: a repeated switch says "already" instead of "done"
    csock.sendMessage = (to, content, opts) => {
      sentAny = true;
      if (switchWatch && typeof content?.text === 'string') {
        const same = switchWatch.decide(content.text);
        if (same) content = { ...content, text: same };
      }
      if (synthetic && opts?.quoted) opts = { ...opts, quoted: undefined }; // there is no real message to reply to
      if (typeof content?.text === 'string' && /^\s*(⚠️|❌|🚫)/.test(content.text)) warned = true;
      // stickers made by commands carry the pack name and author
      if (Buffer.isBuffer(content?.sticker) && cmd.stickerCredit !== false) {
        const sc = store.stickerCfg();
        if (sc.on) content = { ...content, sticker: addExif(content.sticker, { pack: sc.pack || brand.botName, author: sc.author || brand.creator }) };
      }
      if (styled && typeof content?.text === 'string' && !content.edit) content = { ...content, text: fmt.format(i18n.translate(content.text), (n) => !!prefix && commands.has(n), prefix, styled) };
      const sent = sock.sendMessage(to, mark ? watermark.mark(content, mark) : content, opts);
      pending.add(sent);
      Promise.resolve(sent).then((m) => { if (m?.key?.id && !cleanup.keeps(content) && to === jid) answers.push(m.key); }).catch(() => {}).finally(() => pending.delete(sent));
      return sent;
    };
    const reply = (t, extra = {}) => csock.sendMessage(silent ? ownerInfo.ownerChat(sock) : jid, { text: t, ...extra }, synthetic || silent ? undefined : { quoted: msg });

    let outcome = 'ok';
    try {
      const callCmd = () => cmd.run({
        sock: csock, msg, jid, args, rest, reply, cmdName, prefix, silent, config, commandList, botIds, diag, timing,
        myIds: whoIds(msg, botIds), myJid: whoJid(msg, sock),
        isGroup, isAdmin, isOwner, isRealOwner, isBotAdmin, groupMetadata,
      });
      const runCmd = () => (switchWatch ? switchWatch.run(callCmd) : callCmd());
      const attempt = async () => {
        try {
          await runCmd();
        } catch (first) {
          // a lookup that failed for a temporary reason (network, timeout, busy service) and has shown nothing yet gets one more try
          if ((cmd.category === 'lookup' || cmd.retry) && !sentAny && resilience.classify(first) === 'temporary') {
            await new Promise((res) => setTimeout(res, resilience.retryMs()));
            await runCmd();
          } else throw first;
        }
      };
      // A command that holds a "medium" or "heavy" slot must never hold it forever: one stuck download used to keep the only heavy slot
      // until the bot restarted, and every later heavy command was refused as "busy". When the time is up the slot is freed and the
      // command counts as failed. (The work itself cannot be cancelled from here; its own limits stop it in the end.)
      const weight = cmd.capacity && cmd.capacity.weight;
      const limitMs = cmd.maxMs || (weight === 'medium' || weight === 'heavy' ? SLOT_LIMIT_MS : 0);
      if (limitMs) await withTimeout(attempt(), limitMs, `The command timed out after ${limitMs >= 60000 ? Math.round(limitMs / 60000) + ' minutes' : Math.round(limitMs / 1000) + ' seconds'}`);
      else await attempt();
      if (warned) outcome = 'warn'; else resilience.ok(cmd.name);
    } catch (err) {
      outcome = 'fail';
      stats.error(cmd.name, err?.message || err);
      console.error(`Error in command ${cmd.name}:`, err);
      // only the owner sees the reason (it is technical); everybody else gets a simple message
      const kind = resilience.classify(err);
      context.markFailed(jid, meKey);
      const rest5 = resilience.fail(cmd.name, kind, err?.message || err);
      if (rest5.opened) { // the same failure over and over: the command rests, and the owner is told once
        Promise.resolve(sock.sendMessage(ownerInfo.ownerChat(sock), { text: `⏸️ *${cmd.name} is resting for ${rest5.minutes} minutes.*\n▸ _It failed several times in a row._\n▸ *Last reason:* ${rest5.why}\n▸ _It starts again by itself. You can still use it yourself._` })).catch(() => {});
      }
      if (kind === 'temporary') {
        const why = isOwner ? `\nReason: ${String(err?.message || err).slice(0, 150)}` : '\nPlease try again in a minute.';
        await rawReply(`⏳ That service is not answering right now.${why}`).catch(() => {});
      } else {
        const detail = isOwner ? `\nReason: ${String(err?.message || err).slice(0, 150)}` : '\nPlease try again in a moment.';
        await rawReply(`❌ Something went wrong running that command.${detail}`).catch(() => {});
      }
    } finally {
      gate.release();
      if (pending.size) await withTimeout(Promise.allSettled([...pending]), 8000, 'the answer is still being sent').catch(() => {}); // the ✅ comes after the answer
      react.finish(outcome);
      if (isGroup && !synthetic && outcome !== 'fail') cleanup.afterCommand(sock, msg, { isBotAdmin, cmd, hasArgs: args.length > 0, replies: answers });
      stats.record({ name: cmd.name, jid, outcome });
      const total = Date.now() - t0;
      const t = diag.timing;
      t.n += 1;
      t.total += total;
      t.max = Math.max(t.max, total);
      if (total > 2500) {
        t.slow.push(`${cmd.name} ${total}ms (thinking ${timing.thinkMs}ms)`);
        if (t.slow.length > 5) t.slow.shift();
        console.log(`⏱️ Slow command: ${cmd.name} took ${total} ms (${timing.thinkMs} ms before it started)`);
      }
    }
  };

  // long jobs (pictures, video, audio) must not hold up the other messages of the chat
  if (cmd.slow) {
    const job = execute().finally(() => running.delete(job));
    running.add(job);
    return;
  }
  await execute();
}

// the console card (core/chatlog.js) is printed when the message is fully handled, so its speed is real
const handleMessage = async (sock, msg) => {
  try {
    return await handleMessageInner(sock, msg);
  } finally {
    chatlog.finish(msg);
  }
};

// Runs a command as if the owner typed it in that chat (used by "schedule"). text = the command with its prefix (if any).
async function runText(sock, jid, text) {
  const msg = {
    key: { remoteJid: jid, fromMe: true, id: `TFXJOB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` },
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
    synthetic: true,
  };
  await handleMessage(sock, msg);
}

const resolveCommand = (word) => commands.get(String(word || '').toLowerCase()) || null;

module.exports = { handleMessage, diag, idle, runText, isKnownCommand, resolveCommand };
