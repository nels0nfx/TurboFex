const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const baileys = require('../core/baileys');
const config = require('../config');
const brand = require('../core/brand');
const scheduler = require('../core/scheduler');
const meta = require('./metadata');
const { withTimeout } = require('./timeout');
const { handleMessage, diag, isKnownCommand } = require('./handler');
const { handleParticipants } = require('./events');
const sent = require('./sent');
const outbox = require('./outbox');
const idmap = require('./idmap');
const watchers = require('./watchers');
const store = require('./store');
const { getText, isCommandText } = require('./utils');
const startup = require('./startup');
const ack = require('./ack');
const { makeCache } = require('../core/cache');
const { fastKeys } = require('../core/fastkeys');
const pairfix = require('../core/pairfix');
const sessionBackup = require('../core/sessionbackup');
const linkpreview = require('../core/linkpreview');
const names = require('./names');
const mentions = require('./mentions');
const presence = require('./presence');
const adminguard = require('./adminguard');
const { flushAll } = require('../core/flush');
const perf = require('./perf');
const replay = require('./replay');
const welcome = require('./welcome');
const status = require('./status');
const setup = require('../core/setup');
const sessionid = require('../core/sessionid');
const { DATA } = require('../core/paths');

let generation = 0; // only the newest connection may do anything
let current = null;
let reconnectTimer = null;
let attempts = 0; // failed connection attempts in a row (the wait between attempts grows, so we never hammer WhatsApp)
let watchdog = null;
const queues = new Map(); // one line of waiting messages per chat

const FRESH_SECONDS = 120; // a message that arrived while the bot was reconnecting is still answered if it is this young

// how the bot shows up in Linked devices (only used when linking). 'android' can receive view-once files.
function pickBrowser(Browsers, registered) {
  // While LINKING, the standard identity is used unless BOT_BROWSER is set on purpose: it is the one WhatsApp accepts reliably
  const want = String(registered ? store.getBrowser() || config.browser || process.env.BOT_BROWSER || '' : process.env.BOT_BROWSER || '').toLowerCase();
  if (want === 'android') {
    const a = Browsers.android;
    try {
      if (typeof a === 'function') return a('Chrome');
      if (Array.isArray(a)) return a;
    } catch (err) {
      // fall through
    }
    console.log('⚠️ This WhatsApp library has no "android" identity. Using the default one.');
  }
  if (want === 'macos' && Browsers.macOS) return Browsers.macOS('Desktop');
  if (want === 'windows' && Browsers.windows) return Browsers.windows('Chrome');
  return Browsers.ubuntu('Chrome');
}

// Checks every minute that WhatsApp still answers. A connection can die silently (the bot looks online but hears
// nothing): that is the "bot sleeps" problem. Two missed answers in a row = reconnect at once.
function startWatchdog(sock, alive) {
  stopWatchdog();
  let misses = 0;
  watchdog = setInterval(async () => {
    if (!alive()) return stopWatchdog();
    try {
      await withTimeout(
        sock.query({ tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:p' }, content: [{ tag: 'ping', attrs: {} }] }),
        20000,
        'ping timed out'
      );
      misses = 0;
    } catch (err) {
      misses += 1;
      console.log(`⚠️ WhatsApp did not answer a health check (${misses}/2): ${err.message}`);
      if (misses >= 2) {
        misses = 0;
        console.log('🔌 The connection stopped answering. Reconnecting...');
        try {
          sock.end(new Error('Watchdog: connection stopped answering'));
        } catch (e) {
          // already closed
        }
      }
    }
  }, 60000);
  if (watchdog.unref) watchdog.unref();
}

function stopWatchdog() {
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
}

const isFresh = (msg) => {
  const ts = replay.timestampOf(msg);
  return ts > 0 && Date.now() / 1000 - ts < FRESH_SECONDS;
};

// messages of ONE chat are handled in order, different chats never wait for each other
function enqueue(jid, task) {
  const previous = queues.get(jid) || Promise.resolve();
  const next = previous.then(task).catch(() => {}).finally(() => {
    if (queues.get(jid) === next) queues.delete(jid);
  });
  queues.set(jid, next);
}

async function startWhatsApp() {
  const lib = await baileys.load(); // works with the old and the new library version
  const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = lib;
  const cacheKeys = lib.makeCacheableSignalKeyStore || ((keys) => keys); // keeps encryption keys in memory (much faster on slow disks)

  const gen = ++generation;
  clearTimeout(reconnectTimer);
  stopWatchdog();
  // never keep two connections open (two copies fight each other and cause "Bad MAC")
  if (current) {
    try {
      current.ev.removeAllListeners();
      current.end(undefined);
    } catch (err) {
      // already closed
    }
    current = null;
  }

  try {
    sessionBackup.restoreIfNeeded(config.sessionDir); // a damaged login is restored from the last backup
  } catch (err) {
    console.error('Login restore failed:', err.message);
  }
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
  if (gen !== generation) return;

  // No login: the pairing site is the way to get one (the console shows what to do and nothing is asked)
  if (!state.creds.registered && !config.consoleLink) {
    setup.waitForSession(config, 'none');
    return;
  }

  const logger = pino({ level: 'silent' });

  // While linking, ask for the CURRENT WhatsApp Web version: an outdated one makes WhatsApp refuse the link
  let versionOpt = {};
  if (!state.creds.registered) {
    try {
      const fetcher = lib.fetchLatestWaWebVersion || lib.fetchLatestBaileysVersion;
      const found = fetcher ? await withTimeout(fetcher(), 10000, 'version lookup timed out') : null;
      if (found && Array.isArray(found.version)) {
        versionOpt = { version: found.version };
        console.log(`WhatsApp Web version used for linking: ${found.version.join('.')}`);
      }
    } catch (err) {
      console.log('Could not look up the current WhatsApp Web version, using the built-in one.');
    }
  }

  const sock = makeWASocket({
    auth: { creds: state.creds, keys: cacheKeys(fastKeys(state.keys), logger) },
    logger,
    ...versionOpt,
    browser: pickBrowser(Browsers, !!state.creds.registered),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    keepAliveIntervalMs: 25000, // WhatsApp is pinged more often, so a dead connection is noticed sooner
    getMessage: async (key) => outbox.get(key), // lets WhatsApp ask for a message again ("Waiting for this message" fix)
    userDevicesCache: makeCache(30 * 60 * 1000), // who has which devices: remembered for 30 min (faster group replies)
    msgRetryCounterCache: makeCache(10 * 60 * 1000),
    cachedGroupMetadata: async (jid) => {
      const t = Date.now();
      try {
        return await meta.getMeta(sock, jid);
      } finally {
        perf.metaMs += Date.now() - t;
      }
    },
    getUrlInfo: (text) => (store.getLinkPreview() ? linkpreview.getUrlInfo(text, {}, sock.waUploadToServer) : undefined), // link previews (see core/linkpreview.js)
    emitOwnEvents: false, // our own replies do not need to come back as incoming events
  });
  current = sock;
  const alive = () => gen === generation;
  const linking = pairfix.install(sock); // lets a new device link again (see core/pairfix.js)
  let qrFallback = false; // a pairing code was chosen but WhatsApp refused it: the QR is shown instead
  let latestQr = null;
  const showQr = (raw) => {
    latestQr = raw;
    if (config.pairMethod === 'code' && !qrFallback) return; // the person chose a pairing code: no QR
    console.log('\n==============================================');
    console.log('  LINK THE BOT: WhatsApp > Linked devices >');
    console.log('  Link a device, then SCAN this QR code with the phone.');
    console.log('  If WhatsApp asks again, a NEW QR appears: scan it too.');
    console.log('==============================================\n');
    qrcode.generate(raw, { small: true });
  };
  linking.onRefresh(showQr);
  // WhatsApp answers a pairing-code request with an error when it refuses it; the library shows a code anyway
  let lastIqError = null;
  if (sock.ws && typeof sock.ws.on === 'function') {
    sock.ws.on('CB:iq,type:error', (node) => {
      const e = Array.isArray(node && node.content) ? node.content.find((c) => c && c.tag === 'error') : null;
      lastIqError = { at: Date.now(), code: e && e.attrs && e.attrs.code, text: e && e.attrs && e.attrs.text };
    });
  }
  ack.installStatusAck(sock); // stops WhatsApp from cutting the connection about every 50 minutes

  // remember the ids of our own replies so we never answer ourselves
  const rawSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    // a private chat is addressed the way WhatsApp itself addresses that person (LID when known). Messages sent to
    // the phone number of such a person show "Waiting for this message" on many phones.
    if (typeof args[0] === 'string' && args[0].endsWith('@s.whatsapp.net') && !args[2]?.statusJidList) {
      args[0] = idmap.lidSync(args[0]) || args[0];
    }
    // tags in groups use the id the group uses, so WhatsApp shows the person's NAME instead of a number
    if (typeof args[0] === 'string' && args[0].endsWith('@g.us') && Array.isArray(args[1]?.mentions) && args[1].mentions.length) {
      args[1] = await mentions.fix(sock, args[0], args[1]);
    } else if (typeof args[0] === 'string' && !args[0].endsWith('@g.us') && !args[0].endsWith('@broadcast') && Array.isArray(args[1]?.mentions) && args[1].mentions.length) {
      args[1] = mentions.inPrivate(args[1]); // a private chat shows a tag as a bare number: write the name instead
    }
    // a message with a link gets a link preview (the card with picture and title)
    const content = args[1];
    if (content && typeof content.text === 'string' && content.linkPreview === undefined && !content.edit && store.getLinkPreview()) {
      const info = await linkpreview.getUrlInfo(content.text, {}, sock.waUploadToServer);
      if (info) args[1] = { ...content, linkPreview: info };
    }
    perf.metaMs = 0;
    const t0 = Date.now();
    const res = await rawSend(...args);
    perf.lastSendMs = Date.now() - t0;
    perf.lastMetaMs = perf.metaMs;
    if (res?.key?.id) sent.remember(res.key.id);
    outbox.remember(res);
    return res;
  };

  sock.ev.on('creds.update', () => {
    if (alive()) Promise.resolve(saveCreds()).catch((e) => console.error('Could not save the login:', e.message));
  });

  let pairingAsked = false;
  let invalidLogin = false;

  sock.ev.on('connection.update', async (update) => {
    if (!alive()) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr && !config.consoleLink) {
      // WhatsApp wants a NEW link (the saved login is not accepted). Linking happens on the pairing site, not here.
      if (!invalidLogin) {
        invalidLogin = true;
        try {
          sock.ev.removeAllListeners();
          sock.end(undefined);
        } catch (err) {
          // already closed
        }
        current = null;
        stopWatchdog();
        scheduler.stop();
        sessionid.forget();
        setup.waitForSession(config, 'invalid');
      }
      return;
    }

    if (qr) {
      showQr(linking.fixQr(qr)); // the QR is always shown

      // the pairing code (unless the person chose the QR code), once per attempt
      if (config.pairingNumber && config.pairMethod !== 'qr' && !pairingAsked && !sock.authState.creds.registered) {
        pairingAsked = true;
        const asked = Date.now();
        try {
          const raw = await sock.requestPairingCode(config.pairingNumber);
          await new Promise((r) => setTimeout(r, 3000)); // WhatsApp's answer arrives a moment after the code is made
          if (lastIqError && lastIqError.at >= asked - 500) {
            console.log(`\n⚠️ WhatsApp REFUSED the pairing code request (${lastIqError.code || '?'} ${lastIqError.text || ''}).`);
            console.log('   Codes are refused by WhatsApp at the moment. Here is the QR code instead, scan it:\n');
            qrFallback = true;
            if (latestQr) showQr(latestQr);
          } else {
            const code = raw?.match(/.{1,4}/g)?.join('-') || raw;
            console.log('\n==============================================');
            console.log(`  PAIRING CODE:  ${code}`);
            console.log('  WhatsApp > Linked devices > Link a device >');
            console.log('  "Link with phone number instead" > enter the code');
            console.log('==============================================\n');
          }
        } catch (err) {
          console.log('Could not get a pairing code:', err.message, '- here is the QR code instead:');
          qrFallback = true;
          if (latestQr) showQr(latestQr);
        }
      }
    }

    if (connection === 'open') {
      console.log(`✅ ${brand.botName} is online as ${sock.user?.id}`);
      scheduler.start(sock);
      presence.apply(sock); // always online / auto bio
      replay.open(); // for a few seconds, skip old messages WhatsApp re-delivers
      startWatchdog(sock, alive);
      sessionBackup.schedule(config.sessionDir); // daily login backup, monthly cleanup
      const stable = setTimeout(() => {
        if (alive()) attempts = 0; // connected for a while: forget earlier failures
      }, 30000);
      if (stable.unref) stable.unref();

      // load the group list once, so the first command in a group never waits for WhatsApp
      setTimeout(async () => {
        if (!alive()) return;
        try {
          const all = await withTimeout(sock.groupFetchAllParticipating(), 30000, 'group list timed out');
          meta.prime(all);
        } catch (err) {
          // not important: groups are loaded one by one when needed
        }
      }, 3000);

      // an update that was just installed leaves a marker: turn it into an "update complete" note (once)
      startup.noteFromUpdateMarker();
      // the first time an account connects it gets a welcome message; after a restart or update it gets a short "I am back" message
      setTimeout(async () => {
        if (!alive()) return;
        try {
          await welcome.maybeSendWelcome(sock);
        } catch (e) {
          console.error('Welcome message error:', e.message);
        }
        try {
          if (alive()) await startup.announce(sock);
        } catch (e) {
          console.error('Restart message error:', e.message);
        }
      }, welcome.settings.delayMs);
      // The bot started fine, so a fresh update does not need to be rolled back
      try {
        fs.rmSync(path.join(DATA, 'rollback', 'pending'), { force: true });
      } catch (err) {
        // ignore
      }
    }

    if (connection === 'close') {
      scheduler.stop();
      stopWatchdog();
      const status = lastDisconnect?.error?.output?.statusCode;
      let delay;
      attempts += 1;
      if (status === DisconnectReason.loggedOut) {
        console.log('Logged out of WhatsApp. Clearing saved login, starting fresh...');
        sessionBackup.markLoggedOut(); // the backups are no longer valid
        fs.rmSync(config.sessionDir, { recursive: true, force: true });
        attempts = 0;
        delay = 3000;
        if (!config.consoleLink) {
          sessionid.forget(); // that session ID is finished: a NEW one is needed
          setup.waitForSession(config, 'logged-out');
          return;
        }
      } else if (status === DisconnectReason.connectionReplaced) {
        // another copy of the bot is using this number. Fighting it makes both copies reconnect forever and makes
        // WhatsApp send the "Finished syncing" notification again and again, so wait longer each time.
        delay = Math.min(300000, 30000 * 2 ** Math.min(attempts - 1, 3));
        console.log(`⚠️ This WhatsApp number was opened somewhere else (another copy of the bot?). Make sure only ONE copy is running. Trying again in ${Math.round(delay / 1000)}s.`);
      } else if (status === DisconnectReason.restartRequired) {
        attempts = 0;
        delay = 500; // normal after linking: reconnect straight away
        console.log('Reconnecting after WhatsApp asked for a restart...');
      } else {
        delay = Math.min(30000, 2000 * 2 ** Math.min(attempts - 1, 4)) + Math.random() * 1000;
        console.log(`Connection closed (code ${status}). Reconnecting in ${Math.round(delay / 1000)}s...`);
      }
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => startWhatsApp().catch((e) => {
        console.error('Reconnect failed:', e.message);
        reconnectTimer = setTimeout(() => startWhatsApp().catch(console.error), 10000);
      }), delay);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (!alive()) return;
    const prefix = store.effectivePrefix();
    for (const msg of messages) {
      // WhatsApp statuses (auto view / like / save)
      if (msg.key.remoteJid === 'status@broadcast') {
        status.handleStatus(sock, msg).catch((e) => console.error('Status error:', e.message));
        continue;
      }
      // 'append' = messages that were waiting while the bot reconnected. Fresh ones are still answered (before, they were dropped).
      if (type !== 'notify' && !(type === 'append' && !msg.key.fromMe && isFresh(msg))) continue;
      if (replay.isReplay(msg)) {
        diag.stats.replaysIgnored += 1;
        continue;
      }
      const run = async () => {
        try {
          await withTimeout(handleMessage(sock, msg), 60000, 'Handling a message took too long');
        } catch (err) {
          console.error('Message error:', err);
        }
      };
      // commands never wait for other messages; everything else (game answers...) stays in order per chat
      if (isCommandText(getText(msg), prefix, isKnownCommand)) run();
      else enqueue(msg.key.remoteJid || 'unknown', run);
    }
  });

  // edits and deletions that WhatsApp reports as updates
  sock.ev.on('messages.update', (updates) => {
    if (!alive()) return;
    watchers.onUpdate(sock, updates).catch((e) => console.error('Update watcher error:', e.message));
  });

  // learn which phone number belongs to which hidden id
  const learn = (list) => {
    try {
      idmap.learnContacts(list);
      names.learnContacts(list);
    } catch (err) {
      // not important
    }
  };
  sock.ev.on('contacts.upsert', (list) => alive() && learn(list));
  sock.ev.on('contacts.update', (list) => alive() && learn(list));
  sock.ev.on('lid-mapping.update', (m) => alive() && idmap.learn(m?.lid, m?.pn));

  sock.ev.on('group-participants.update', async (update) => {
    if (!alive()) return;
    try {
      await handleParticipants(sock, update);
    } catch (err) {
      console.error('Group event error:', err);
    }
  });

  sock.ev.on('call', (calls) => {
    if (alive()) adminguard.handleCalls(sock, calls).catch((e) => console.error('Call handler error:', e.message));
  });

  sock.ev.on('groups.update', (updates) => {
    if (!alive()) return;
    // the group's name, description and settings are updated in the saved group info (no refetch, no waiting)
    for (const u of updates || []) if (u.id && !meta.patch(u.id, u)) meta.invalidate(u.id);
  });
}

// when the host stops the bot, write the saved changes to disk first
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    flushAll().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

module.exports = { startWhatsApp };
