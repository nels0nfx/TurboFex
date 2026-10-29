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

const BIN_DIR = path.join(DATA, 'bin');
const COOKIES = path.join(DATA, 'cookies.txt');
const MAX_MB = Number(process.env.PLAY_MAX_MB) || 60;
const MAX_SECONDS = Number(process.env.PLAY_MAX_SECONDS) || 3600;
const WIN = process.platform === 'win32';
let installing = null;
let lastUpdate = 0;

function releaseFile() {
  if (WIN) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

const localPath = () => path.join(BIN_DIR, WIN ? 'yt-dlp.exe' : 'yt-dlp');

function works(bin) {
  return new Promise((resolve) => execFile(bin, ['--version'], { timeout: 15000 }, (err) => resolve(!err)));
}

async function findBinary() {
  for (const c of [process.env.YTDLP_PATH, localPath(), 'yt-dlp'].filter(Boolean)) {
    if ((c === 'yt-dlp' || fs.existsSync(c)) && (await works(c))) return c;
  }
  return null;
}

// downloads the tool once (about 35 MB)
async function install() {
  if (installing) return installing;
  installing = (async () => {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${releaseFile()}`, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`could not download the downloader (error ${res.status})`);
    const tmp = `${localPath()}.part`;
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    if (!WIN) fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, localPath());
    if (!(await works(localPath()))) throw new Error('the downloader was installed but does not run on this server');
    return localPath();
  })().finally(() => {
    installing = null;
  });
  return installing;
}

// the tool updates itself when sites change (at most once every 6 hours)
async function selfUpdate(bin) {
  if (Date.now() - lastUpdate < 6 * 3600 * 1000) return false;
  lastUpdate = Date.now();
  if (bin === 'yt-dlp') return false; // a system install is updated by the system
  return new Promise((resolve) => execFile(bin, ['-U'], { timeout: 120000 }, (err) => resolve(!err)));
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
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
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

// Runs the downloader, and when a site changes or blocks us tries other ways: other clients, then a self-update.
async function runWithRetries(bin, build, limits = {}) {
  let out;
  const attempts = [
    [],
    ['--extractor-args', 'youtube:player_client=android_vr'],
    ['--extractor-args', 'youtube:player_client=tv,web_safari'],
    ['--extractor-args', 'youtube:player_client=mweb'],
    ['--extractor-args', 'youtube:player_client=ios'],
    ['--js-runtimes', 'node'],
  ];
  let lastErr;
  for (let i = 0; i < attempts.length && out === undefined; i++) {
    try {
      out = await run(bin, build(attempts[i]), 180000);
    } catch (err) {
      lastErr = err;
      const text = String(err.stderr || err.message);
      if (/does not pass filter/i.test(text)) throw Object.assign(new Error(`That is longer than ${limits.minutes || 60} minutes.`), { code: 'TOO_LONG' });
      if (/larger than max-filesize|File is larger/i.test(text)) throw Object.assign(new Error(`That file is bigger than ${limits.mb || MAX_MB} MB.`), { code: 'TOO_BIG' });
      if (err.code === 'TIMEOUT') throw err;
      if (i === 0 && (await selfUpdate(bin))) i = -1; // the site changed: update the tool and try again from the start
    }
  }
  if (out === undefined) {
    const text = String(lastErr?.stderr || lastErr?.message || '');
    if (/sign in to confirm|not a bot|cookies|confirm you.re not/i.test(text)) throw Object.assign(new Error('YouTube blocked this server (it wants a login).'), { code: 'BOT_BLOCK' });
    throw lastErr;
  }
  return out;
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
  if (isLink) await assertPublicUrl(target); // never a private or internal address
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-'));
  const ff = ffmpegLocation();
  const build = (extra) => [
    '--no-playlist', '--no-simulate', '-q', '--no-warnings',
    '--max-filesize', `${MAX_MB}M`,
    '--match-filter', `duration<=${MAX_SECONDS}`,
    '-o', path.join(dir, '%(id)s.%(ext)s'),
    '--print', 'after_move:%(title)s\t%(uploader)s\t%(duration_string)s\t%(webpage_url)s\t%(filepath)s',
    // MP3 when ffmpeg exists (plays everywhere), else the best audio the site gives (usually m4a)
    ...(ff ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '5', '--ffmpeg-location', ff] : ['-f', 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best']),
    ...(fs.existsSync(COOKIES) ? ['--cookies', COOKIES] : process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
    ...extra,
    isLink ? target : `${source === 'soundcloud' ? 'scsearch1' : 'ytsearch1'}:${target}`,
  ];

  try {
    const out = await runWithRetries(bin, build, { mb: MAX_MB, minutes: Math.round(MAX_SECONDS / 60) });

    const line = out.trim().split('\n').filter(Boolean).pop() || '';
    const [title, uploader, duration, url, file] = line.split('\t');
    const filePath = file && fs.existsSync(file) ? file : fs.readdirSync(dir).map((f) => path.join(dir, f))[0];
    if (!filePath || !fs.existsSync(filePath)) throw new Error('nothing was downloaded');
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return { buffer, mimetype: MIME[ext] || 'audio/mp4', title: title || '', artist: uploader && uploader !== 'NA' ? uploader : '', duration: duration && duration !== 'NA' ? duration : '', url: url && url !== 'NA' ? url : isLink ? target : '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// target = a link or a name. Returns { buffer, ext, mimetype, title, artist, duration, url } with a video of at most 720p.
async function downloadVideo(target, { onSetup } = {}) {
  let bin = await findBinary();
  if (!bin) {
    if (onSetup) await onSetup();
    bin = await install();
  }
  const isLink = /^https?:\/\//i.test(target);
  if (isLink) await assertPublicUrl(target);
  const maxMb = Number(process.env.DL_MAX_MB) || MAX_MB;
  const maxSec = Number(process.env.DL_MAX_SECONDS) || 1800;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-'));
  const ff = ffmpegLocation();
  const build = (extra) => [
    '--no-playlist', '--no-simulate', '-q', '--no-warnings',
    '--max-filesize', `${maxMb}M`,
    '--match-filter', `duration<=${maxSec}`,
    '-o', path.join(dir, '%(id)s.%(ext)s'),
    '--print', 'after_move:%(title)s\t%(uploader)s\t%(duration_string)s\t%(webpage_url)s\t%(filepath)s',
    // with ffmpeg: the best picture and sound up to 720p joined into an mp4; without it: a ready-made mp4
    ...(ff ? ['-f', 'bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4', '--ffmpeg-location', ff] : ['-f', 'b[height<=720][ext=mp4]/b[ext=mp4]/b']),
    ...(fs.existsSync(COOKIES) ? ['--cookies', COOKIES] : process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
    ...extra,
    isLink ? target : `ytsearch1:${target}`,
  ];
  try {
    const out = await runWithRetries(bin, build, { mb: maxMb, minutes: Math.round(maxSec / 60) });
    const line = out.trim().split('\n').filter(Boolean).pop() || '';
    const [title, uploader, duration, url, file] = line.split('\t');
    const filePath = file && fs.existsSync(file) ? file : fs.readdirSync(dir).map((f) => path.join(dir, f))[0];
    if (!filePath || !fs.existsSync(filePath)) throw new Error('nothing was downloaded');
    const ext = path.extname(filePath).toLowerCase();
    const known = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' };
    return { buffer: fs.readFileSync(filePath), ext, mimetype: known[ext] || 'application/octet-stream', title: title || '', artist: uploader && uploader !== 'NA' ? uploader : '', duration: duration && duration !== 'NA' ? duration : '', url: url && url !== 'NA' ? url : isLink ? target : '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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

module.exports = { downloadVideo, titleOf, downloadAudio, searchFlat, youtubeId, findBinary, install, MAX_MB, MAX_SECONDS };
