// Linking the bot. The normal way is the pairing SITE: the person links there, gets a session ID, puts it in SESSION_ID
// and starts the bot (core/sessionid.js). The bot's number and its owner come from that login, so NOTHING is asked in the console.
// The old way (the console asks for the number and shows a pairing code or QR) only runs when CONSOLE_LINK=1 is set.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DATA } = require('./paths');

const FILE = path.join(DATA, 'setup.json');
const line = '==============================================';

function saveNumber(number) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ number }));
  } catch (err) {
    console.log('Could not save the number:', err.message);
  }
}

// is the bot already linked? (then nothing is asked)
function linkedAccount(sessionDir) {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8'));
    if (creds && creds.registered) return { registered: true, number: String(creds.me?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '') };
  } catch (err) {
    // no login yet
  }
  return { registered: false };
}

// questions in the console. ask() gives null when nobody can answer (no keyboard, closed, or too slow)
function consoleIo(timeoutMs) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  return {
    ask: (q) =>
      new Promise((resolve) => {
        if (closed) return resolve(null);
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(v);
        };
        const timer = timeoutMs ? setTimeout(() => finish(null), timeoutMs) : null;
        rl.once('close', () => finish(null));
        rl.question(q, (a) => finish(String(a).trim()));
      }),
    close: () => rl.close(),
  };
}

function apply(config, number, method) {
  config.number = number;
  config.pairingNumber = number;
  if (!config.legacyOwner) config.ownerNumber = number; // one number is both the bot and its owner
  if (method) config.pairMethod = method;
}

async function ensure(config, io) {
  const linked = linkedAccount(config.sessionDir);
  if (linked.registered) {
    if (!config.number && linked.number) apply(config, linked.number, '');
    return { linked: true };
  }

  if (!config.consoleLink) return { needsSession: true }; // not linked: the site is the way (the caller explains it)

  let number = config.number;
  let method = config.pairMethod;
  if (number && method) {
    console.log(`\n📱 Using number +${number} (${method === 'code' ? 'pairing code' : 'QR code'}).`);
    return apply(config, number, method);
  }

  const own = !io;
  const talk = io || consoleIo(process.stdin.isTTY ? 0 : 180000); // without a keyboard it waits 3 minutes, then continues
  try {
    if (!number) {
      console.log(`\n${line}\n  📱 WHICH NUMBER DO YOU WANT TO USE?\n  This is the WhatsApp number the bot will be linked to,\n  and it will also be the OWNER of the bot.\n  Country code first, digits only, no +   (example: 2348012345678)\n${line}`);
      for (let tries = 0; tries < 5 && !number; tries += 1) {
        const answer = await talk.ask('Number: ');
        if (answer === null) break;
        const d = answer.replace(/\D/g, '');
        if (d.length >= 8 && d.length <= 15) number = d;
        else console.log('⚠️ That does not look right. Write the country code and the number, digits only (8 to 15 digits).');
      }
      if (!number) {
        console.log('\nNo number was given, so the bot starts without an owner and shows a QR code.\nTo set it: put NUMBER=2348012345678 in the environment, or restart and answer the question.\n');
        return;
      }
      saveNumber(number);
      console.log(`✅ Number saved: +${number}`);
    }

    if (!method) {
      console.log(`\n${line}\n  🔗 HOW DO YOU WANT TO LINK THE BOT?\n\n    1) Pairing code  (an 8-letter code you type on the phone)\n    2) QR code       (you scan it with the phone)\n${line}`);
      for (let tries = 0; tries < 5 && !method; tries += 1) {
        const answer = await talk.ask('Choose 1 or 2: ');
        if (answer === null) break;
        if (/^(1|code|pairing|pair)$/i.test(answer)) method = 'code';
        else if (/^(2|qr)$/i.test(answer)) method = 'qr';
        else console.log('⚠️ Please write 1 or 2.');
      }
    }
  } finally {
    if (own) talk.close();
  }
  console.log(method === 'code' ? '\n🔗 Linking with a PAIRING CODE...' : method === 'qr' ? '\n🔗 Linking with a QR CODE...' : '');
  apply(config, number, method || '');
}

// A login that just came from the site decides the bot's number and its owner (also when an older login was replaced)
function adoptLinkedNumber(config) {
  const linked = linkedAccount(config.sessionDir);
  if (!linked.registered || !linked.number) return false;
  const changed = config.number !== linked.number;
  apply(config, linked.number, '');
  if (changed) saveNumber(linked.number);
  return changed;
}

const REASONS = {
  none: 'This bot is not linked to WhatsApp yet.',
  failed: 'The session ID in the file could not be used (see the message above).',
  'logged-out': 'WhatsApp logged this bot out, so its saved login was removed.',
  invalid: 'WhatsApp did not accept the saved login, so the bot needs a new one.',
};

// the instructions shown instead of any question
function helpText(config, reason = 'none') {
  const site = String(config.pairSiteUrl || '').replace(/\/+$/, '');
  const file = path.basename(config.sessionIdFile || 'session_id.txt');
  const rule = '==============================================';
  return [
    '',
    rule,
    '  🔗 LINK THE BOT WITH A SESSION ID',
    `  ${REASONS[reason] || REASONS.none}`,
    '',
    `  1) Open the pairing site:  ${site}`,
    '  2) Link your WhatsApp number there and copy the session ID',
    '     (it looks like TFX-XXXX-XXXX-XXXX).',
    `  3) Open the file  ${file}  in the main folder of the bot`,
    '     (Files tab of your panel) and paste the ID after SESSION_ID=',
    '     Save the file.',
    '  4) RESTART the bot. Nothing is asked here in the console.',
    '',
    '  A session ID works once and expires after 24 hours.',
    rule,
    '',
  ].join('\n');
}

// No login and no way to get one right now: explain and wait (a restart picks up the new settings).
// The process stays alive on purpose: a host that restarts stopped bots would otherwise loop and keep asking the site.
function waitForSession(config, reason = 'none', log = console.log) {
  if (config.sessionIdFile) require('./sessionid').ensureFile(config.sessionIdFile, config.pairSiteUrl); // the file is ready to paste in
  log(helpText(config, reason));
  const again = setInterval(() => log(`ℹ️ Waiting for a session ID. ${REASONS[reason] || ''} Paste a session ID from ${config.pairSiteUrl} in ${path.basename(config.sessionIdFile || 'session_id.txt')} and restart the bot.`), 30 * 60 * 1000);
  return again;
}

module.exports = { ensure, linkedAccount, consoleIo, adoptLinkedNumber, helpText, waitForSession, FILE };
