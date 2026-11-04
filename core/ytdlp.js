// Downloads the audio of (almost) any link or song name using yt-dlp, a free tool that supports YouTube, TikTok,
// SoundCloud, Instagram, Facebook and hundreds of other sites. The tool is found on the server, or downloaded once
// into data/bin the first time it is needed (and updated by itself when a site changes).
// Optional: YTDLP_PATH = your own yt-dlp file, YTDLP_COOKIES = a cookies.txt (helps when YouTube asks "confirm you are not a bot").
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { assertPublicUrl } = require('./safefetch');
const { DATA } = require('./paths');
const dltemp = require('./dltemp');

const BIN_DIR = path.join(DATA, 'bin');
const COOKIES = path.join(DATA, 'cookies.txt');
const MAX_MB = Number(process.env.PLAY_MAX_MB) || 60;
const MAX_SECONDS = Number(process.env.PLAY_MAX_SECONDS) || 3600;
const WIN = process.platform === 'win32';
const SPACE_ERROR = /PYI-\d+|Failed to extract|No space left|ENOSPC|disk quota|Errno 28/i;
let installing = null;
let lastUpdate = 0;

function releaseFile() {
  if (WIN) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

const localPath = () => path.join(BIN_DIR, WIN ? 'yt-dlp.exe' : 'yt-dlp');

// true when the program runs. A program that fails only because the disk is full is NOT broken: it must never be downloaded
// again (every new copy used even more space), so that case is reported as NO_SPACE instead.
function works(bin) {
  const once = () => new Promise((resolve) => execFile(bin, ['--version'], { timeout: 15000, env: dltemp.env() }, (err, out, errOut) => resolve({ ok: !err, text: `${errOut || ''} ${err ? err.message : ''}` })));
  return once().then(async (r) => {
    if (!r.ok && SPACE_ERROR.test(r.text)) {
      dltemp.cleanStale(0); // leftovers of stopped downloads are the usual reason: clean them and try once more
      r = await once();
      if (!r.ok && SPACE_ERROR.test(r.text)) throw Object.assign(new Error('no space for the downloader'), { code: 'NO_SPACE' });
    }
    return r.ok;
  });
}

let foundBin = null; // the tool that worked last time: asking it again for its version on every download cost 1 to 3 seconds
async function findBinary() {
  if (foundBin && (foundBin === 'yt-dlp' || fs.existsSync(foundBin))) return foundBin;
  foundBin = null;
  for (const c of [process.env.YTDLP_PATH, localPath(), 'yt-dlp'].filter(Boolean)) {
    if ((c === 'yt-dlp' || fs.existsSync(c)) && (await works(c))) return (foundBin = c);
  }
  return null;
}

// downloads the tool once (about 35 MB)
async function install() {
  if (installing) return installing;
  installing = (async () => {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    if (!dltemp.ensureSpace(150)) throw Object.assign(new Error('no space for the downloader'), { code: 'NO_SPACE' });
    const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${releaseFile()}`, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`could not download the downloader (error ${res.status})`);
    const tmp = `${localPath()}.part`;
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    if (!WIN) fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, localPath());
    if (!(await works(localPath()))) throw new Error('the downloader was installed but does not run on this server');
    foundBin = localPath();
    return foundBin;
  })().finally(() => {
    installing = null;
    try {
      fs.rmSync(`${localPath()}.part`, { force: true }); // a half-written file would eat disk space
    } catch (err) {
      // nothing to remove
    }
  });
  return installing;
}

// the tool updates itself when sites change (at most once every 6 hours)
async function selfUpdate(bin) {
  if (Date.now() - lastUpdate < 6 * 3600 * 1000) return false;
  lastUpdate = Date.now();
  if (bin === 'yt-dlp') return false; // a system install is updated by the system
  return new Promise((resolve) => execFile(bin, ['-U'], { timeout: 120000, env: dltemp.env() }, (err) => resolve(!err)));
}

function ffmpegLocation() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch (err) {
    return null;
  }
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: dltemp.env() });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM'); // a gentle stop lets the downloader clean its unpacked files; a hard stop 4 seconds later if it ignores it
      setTimeout(() => child.kill('SIGKILL'), 4000).unref();
      reject(Object.assign(new Error('The download took too long'), { code: 'TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(Object.assign(new Error(err.trim().split('\n').pop() || `downloader exited with code ${code}`), { stderr: err }));
    });
  });
}

// What went wrong, in one word, from the text the downloader printed (null = unknown)
function classify(text) {
  const t = String(text || '');
  if (/does not pass filter/i.test(t)) return 'TOO_LONG';
  if (/larger than max-filesize|File is larger/i.test(t)) return 'TOO_BIG';
  if (SPACE_ERROR.test(t)) return 'NO_SPACE';
  if (/sign in to confirm|not a bot|confirm you.re not/i.test(t)) return 'BOT_BLOCK';
  if (/Unsupported URL: https?:\/\/[^\s]*(login|checkpoint)|log ?in (is )?required|login required|you must (log|sign) ?in|cookies.*(required|needed)|This content isn.t available|private (video|account)|Private video|members.only|authenticated|rate-limit reached or login/i.test(t)) return 'LOGIN_REQUIRED';
  if (/Unsupported URL|is not a valid URL|No video formats found|no video could be found|There is no video in this post/i.test(t)) return 'UNSUPPORTED';
  if (/Video unavailable|has been removed|no longer available|does not exist|404|Not Found|account (has been )?terminated|deleted/i.test(t)) return 'GONE';
  if (/HTTP Error 429|Too Many Requests/i.test(t)) return 'RATE_LIMIT';
  if (/Requested format is not available/i.test(t)) return 'NO_FORMAT';
  return null;
}

// Runs the downloader, and when a site changes or blocks us tries other ways: other clients, then a self-update.
// The YouTube ways are only used for YouTube: on any other site they repeat the same request and just cost time.
let goodWay = 0; // the number of the way that worked last time
async function runWithRetries(bin, build, limits = {}) {
  let out;
  const youtube = limits.youtube !== false;
  const ways = youtube
    ? [
        [],
        ['--extractor-args', 'youtube:player_client=android_vr'],
        ['--extractor-args', 'youtube:player_client=tv,web_safari'],
        ['--extractor-args', 'youtube:player_client=mweb'],
        ['--extractor-args', 'youtube:player_client=ios'],
        ['--js-runtimes', 'node'],
      ]
    : [[]];
  // the same ways, but the one that worked last time is first
  const first = youtube && goodWay < ways.length ? goodWay : 0;
  const order = [first, ...ways.map((_, n) => n).filter((n) => n !== first)];
  const attempts = order.map((n) => ways[n]);
  let lastErr;
  let cleaned = false;
  for (let i = 0; i < attempts.length && out === undefined; i++) {
    try {
      if (!dltemp.ensureSpace()) throw Object.assign(new Error('no space'), { code: 'NO_SPACE', stderr: 'No space left on device' });
      out = await run(bin, build(attempts[i]), 180000);
      if (youtube) goodWay = order[i];
    } catch (err) {
      lastErr = err;
      const text = String(err.stderr || err.message);
      const kind = err.code && err.code !== 'TIMEOUT' && !err.stderr ? err.code : classify(text);
      if (kind === 'TOO_LONG') throw Object.assign(new Error(`That video is longer than ${limits.minutes || 60} minutes.`), { code: 'TOO_LONG' });
      if (kind === 'TOO_BIG') throw Object.assign(new Error(`That file is bigger than ${limits.mb || MAX_MB} MB.`), { code: 'TOO_BIG' });
      if (err.code === 'TIMEOUT') throw err;
      if (kind === 'NO_SPACE') {
        // the disk is full: clean old leftovers and try the same way once more; if that fails it is reported, no other way can help
        if (cleaned) throw Object.assign(new Error('no space'), { code: 'NO_SPACE' });
        cleaned = true;
        dltemp.cleanStale(0);
        i -= 1;
        continue;
      }
      // these cannot be fixed by trying again another way
      if (['LOGIN_REQUIRED', 'UNSUPPORTED', 'GONE'].includes(kind)) throw Object.assign(new Error(String(text.trim().split('\n').pop() || kind).slice(0, 200)), { code: kind });
      if (i === 0 && (await selfUpdate(bin))) i = -1; // the site changed: update the tool and try again from the start
    }
  }
  if (out === undefined) {
    const text = String(lastErr?.stderr || lastErr?.message || '');
    const kind = classify(text);
    if (kind === 'BOT_BLOCK') throw Object.assign(new Error('YouTube blocked this server (it wants a login).'), { code: 'BOT_BLOCK' });
    if (kind) throw Object.assign(new Error(text.trim().split('\n').pop().slice(0, 200)), { code: kind });
    throw lastErr;
  }
  return out;
}

// A link is tidied before it is handed over: other Facebook hosts become www.facebook.com and tracking parts are removed
// (a mobile or tracking link often sends the downloader to a login page).
function cleanLink(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)facebook\.com$/i.test(u.hostname) && !/^www\.facebook\.com$/i.test(u.hostname)) u.hostname = 'www.facebook.com';
    for (const k of [...u.searchParams.keys()]) if (/^(fbclid|mibextid|__cft__.*|__tn__|rdid|share_url|utm_.*|igshid|si|feature|ref|sfnsn|_rdr)$/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch (err) {
    return url;
  }
}

const isYoutubeTarget = (target, isLink) => !isLink || /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test((() => { try { return new URL(target).hostname; } catch (e) { return ''; } })());

// The message a person gets when a download fails: what happened and what to do next. Technical detail only for the owner,
// and only when the cause is unknown. Used by every download command, so they all speak the same way.
function explain(err, { isOwner = false, prefix = '.', what = 'that' } = {}) {
  const code = err && err.code;
  const owner = (text) => (isOwner ? text : '');
  const detail = isOwner && !code ? `\n▸ *Details:* ${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 120)}` : '';
  switch (code) {
    case 'TOO_LONG':
    case 'TOO_BIG':
      return `⚠️ *${err.message}*\n▸ Please send a shorter one.`;
    case 'NO_SPACE':
      return isOwner
        ? `⚠️ *The server is out of disk space.*\n▸ I cleaned my temporary files. Free some space on the host, then try again.`
        : '⚠️ *I cannot download right now.*\n▸ The service is busy. Please try again in a few minutes.';
    case 'LOGIN_REQUIRED':
      return `⚠️ *I could not open ${what}.*\n▸ It looks private, or the site wants a login.\n▸ Make sure it is public, then send the link again.${owner(`\n▸ *Owner:* for private posts send a cookies.txt with \`${prefix}ytcookies\`.`)}`;
    case 'UNSUPPORTED':
      return `⚠️ *I could not find a video in ${what}.*\n▸ Send the direct link of a video post.`;
    case 'GONE':
      return `⚠️ *${what[0].toUpperCase()}${what.slice(1)} is no longer available.*\n▸ It may have been removed or made private. Try another link.`;
    case 'RATE_LIMIT':
      return '⚠️ *The site is limiting requests right now.*\n▸ Please try again in a few minutes.';
    case 'NO_FORMAT':
      return `⚠️ *I could not get a playable version of ${what}.*\n▸ Try another link.`;
    case 'TIMEOUT':
      return '⚠️ *That took too long.*\n▸ Try a shorter video, or try again in a moment.';
    case 'BOT_BLOCK':
      return isOwner
        ? `⚠️ *YouTube blocked this server.*\n▸ Send a cookies.txt with \`${prefix}ytcookies\` to fix it.`
        : '⚠️ *I could not download that right now.*\n▸ Please try another link or try again later.';
    default:
      return `⚠️ *I could not download ${what}.*\n▸ Check the link and try again.${detail}`;
  }
}

// faster downloads: 4 pieces at the same time, no waiting for a stuck connection, no touching the file date
const FAST = ['-N', '4', '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2', '--no-mtime'];

// A file WhatsApp cannot play as audio (webm) is repacked into ogg WITHOUT re-encoding (about a second); if that fails it is
// converted to aac. Before, every song was converted to MP3, which is slow on a small server.
function makePlayable(file, ff) {
  const ext = path.extname(file).toLowerCase();
  if (!ff || ['.m4a', '.mp4', '.mp3', '.aac', '.ogg', '.opus', '.wav'].includes(ext)) return Promise.resolve(file);
  const attempt = (args, to) =>
    new Promise((resolve, reject) => execFile(ff, ['-y', '-v', 'error', '-i', file, '-vn', ...args, to], { timeout: 90000 }, (err) => (err ? reject(err) : resolve(to))));
  const base = file.slice(0, -ext.length);
  return attempt(['-c:a', 'copy'], `${base}.ogg`).catch(() => attempt(['-c:a', 'aac', '-b:a', '128k'], `${base}.m4a`)).catch(() => file);
}

const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg; codecs=opus', '.opus': 'audio/ogg; codecs=opus', '.wav': 'audio/wav' };

// target = a link, or a song name (it is searched). Returns { buffer, mimetype, title, artist, duration, url }
async function downloadAudio(target, { onSetup, source = 'youtube' } = {}) {
  let bin = await findBinary();
  if (!bin) {
    if (onSetup) await onSetup();
    bin = await install();
  }
  const isLink = /^https?:\/\//i.test(target);
  if (isLink) target = cleanLink(target);
  if (isLink) await assertPublicUrl(target); // never a private or internal address
  const dir = dltemp.makeWorkDir();
  const ff = ffmpegLocation();
  const build = (extra) => [
    '--no-playlist', '--no-simulate', '-q', '--no-warnings',
    '--max-filesize', `${MAX_MB}M`,
    '--match-filter', `duration<=${MAX_SECONDS}`,
    '-o', path.join(dir, '%(id)s.%(ext)s'),
    '--print', 'after_move:%(title)s\t%(uploader)s\t%(duration_string)s\t%(webpage_url)s\t%(filepath)s',
    // m4a (aac) is taken as it is: it plays in WhatsApp and needs no conversion (this made every song much faster)
    '-f', 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best',
    ...FAST,
    ...(fs.existsSync(COOKIES) ? ['--cookies', COOKIES] : process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
    ...extra,
    isLink ? target : `${source === 'soundcloud' ? 'scsearch1' : 'ytsearch1'}:${target}`,
  ];

  try {
    const out = await runWithRetries(bin, build, { mb: MAX_MB, minutes: Math.round(MAX_SECONDS / 60), youtube: source !== 'soundcloud' && isYoutubeTarget(target, isLink) });

    const line = out.trim().split('\n').filter(Boolean).pop() || '';
    const [title, uploader, duration, url, file] = line.split('\t');
    const found = file && fs.existsSync(file) ? file : fs.readdirSync(dir).map((f) => path.join(dir, f))[0];
    if (!found || !fs.existsSync(found)) throw new Error('nothing was downloaded');
    const filePath = await makePlayable(found, ff);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return { buffer, mimetype: MIME[ext] || 'audio/mp4', title: title || '', artist: uploader && uploader !== 'NA' ? uploader : '', duration: duration && duration !== 'NA' ? duration : '', url: url && url !== 'NA' ? url : isLink ? target : '' };
  } finally {
    dltemp.release(dir);
  }
}

// target = a link or a name. Returns { buffer, ext, mimetype, title, artist, duration, url } with a video of at most 720p.
async function downloadVideo(target, { onSetup, noWatermark = false } = {}) {
  let bin = await findBinary();
  if (!bin) {
    if (onSetup) await onSetup();
    bin = await install();
  }
  const isLink = /^https?:\/\//i.test(target);
  if (isLink) target = cleanLink(target);
  if (isLink) await assertPublicUrl(target);
  const maxMb = Number(process.env.DL_MAX_MB) || MAX_MB;
  const maxSec = Number(process.env.DL_MAX_SECONDS) || 1800;
  const dir = dltemp.makeWorkDir();
  const ff = ffmpegLocation();
  const build = (extra) => [
    '--no-playlist', '--no-simulate', '-q', '--no-warnings',
    '--max-filesize', `${maxMb}M`,
    '--match-filter', `duration<=${maxSec}`,
    '-o', path.join(dir, '%(id)s.%(ext)s'),
    '--print', 'after_move:%(title)s\t%(uploader)s\t%(duration_string)s\t%(webpage_url)s\t%(filepath)s',
    // with ffmpeg: the best picture and sound up to 720p joined into an mp4; without it: a ready-made mp4
    // noWatermark (TikTok): the format called "download" is the one with the logo, it is never chosen
    ...(noWatermark
      ? (ff ? ['-f', 'b[format_id!*=download][ext=mp4][height<=1080]/bv*[format_id!*=download][vcodec^=avc1][height<=1080]+ba[ext=m4a]/bv*[format_id!*=download][height<=1080]+ba/b[format_id!*=download]', '--merge-output-format', 'mp4', '--ffmpeg-location', ff] : ['-f', 'b[format_id!*=download][ext=mp4]/b[format_id!*=download]'])
      : ff ? ['-f', 'b[height<=720][ext=mp4]/bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4', '--ffmpeg-location', ff] : ['-f', 'b[height<=720][ext=mp4]/b[ext=mp4]/b']),
    ...FAST,
    ...(fs.existsSync(COOKIES) ? ['--cookies', COOKIES] : process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
    ...extra,
    isLink ? target : `ytsearch1:${target}`,
  ];
  try {
    const out = await runWithRetries(bin, build, { mb: maxMb, minutes: Math.round(maxSec / 60), youtube: isYoutubeTarget(target, isLink) });
    const line = out.trim().split('\n').filter(Boolean).pop() || '';
    const [title, uploader, duration, url, file] = line.split('\t');
    const filePath = file && fs.existsSync(file) ? file : fs.readdirSync(dir).map((f) => path.join(dir, f))[0];
    if (!filePath || !fs.existsSync(filePath)) throw new Error('nothing was downloaded');
    const ext = path.extname(filePath).toLowerCase();
    const known = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' };
    return { buffer: fs.readFileSync(filePath), ext, mimetype: known[ext] || 'application/octet-stream', title: title || '', artist: uploader && uploader !== 'NA' ? uploader : '', duration: duration && duration !== 'NA' ? duration : '', url: url && url !== 'NA' ? url : isLink ? target : '' };
  } finally {
    dltemp.release(dir);
  }
}

// Searches a site and returns several results (not just the first): [{ id, title, channel, duration, url }].
// source: 'youtube' or 'soundcloud'. Works without cookies (a search does not need a login).
async function searchFlat(query, { source = 'youtube', limit = 10, onSetup } = {}) {
  let bin = await findBinary();
  if (!bin) {
    if (onSetup) await onSetup();
    bin = await install();
  }
  const prefix = source === 'soundcloud' ? 'scsearch' : 'ytsearch';
  const args = [
    '--flat-playlist', '--no-warnings', '-q', '--skip-download',
    '--print', '%(id)s\t%(title)s\t%(channel,uploader)s\t%(duration)s\t%(url)s',
    ...(fs.existsSync(COOKIES) ? ['--cookies', COOKIES] : process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
    `${prefix}${limit}:${query}`,
  ];
  const out = await run(bin, args, 45000);
  return out
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 5 && p[0] && p[1] && p[1] !== 'NA')
    .map(([id, title, channel, duration, url]) => ({
      id,
      title,
      channel: channel && channel !== 'NA' ? channel : '',
      duration: Number(duration) || 0,
      url: /^https?:/.test(url) ? url : source === 'youtube' ? `https://www.youtube.com/watch?v=${id}` : '',
    }))
    .filter((r) => r.url);
}

// the id of a YouTube link (watch?v=, youtu.be/, shorts/, embed/)
function youtubeId(url) {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/i.exec(String(url || ''));
  return m ? m[1] : null;
}

// the title of a YouTube link without logging in (used to find the same song elsewhere when YouTube blocks us)
async function titleOf(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return '';
    const j = await res.json();
    return [j.title, j.author_name].filter(Boolean).join(' ');
  } catch (err) {
    return '';
  }
}

module.exports = { explain, classify, cleanLink, downloadVideo, titleOf, downloadAudio, searchFlat, youtubeId, findBinary, install, MAX_MB, MAX_SECONDS };
