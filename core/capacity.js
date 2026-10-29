// Server capacity guard. Before a heavy command (video, audio, pictures...) runs, the bot checks that the server can
// really handle it: the needed tools exist, there is enough free memory, the server is not overloaded, and not too many
// heavy jobs already run. If not, the person gets a clear message instead of a crash, a freeze or a very slow bot.
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// how much free memory a command needs to run safely (MB) and how many may run at the same time
const WEIGHTS = {
  light: { memMB: 0, parallel: Infinity },
  medium: { memMB: 120, parallel: 3 },
  heavy: { memMB: 250, parallel: 1 },
};
const HEAVY_COOLDOWN_MS = 8000; // one heavy command per person every few seconds
const LAG_LIMIT_MS = 400; // the bot itself is this late = overloaded
const LOAD_PER_CPU = 2.5; // a high load average only counts together with...
const LOAD_NEEDS_LAG_MS = 150; // ...a bot that is at least this late

const active = { medium: 0, heavy: 0 };
const lastHeavy = new Map(); // person -> time of last heavy command
let lag = 0;

// ---- how late is the bot's own clock? (a high number means the CPU is overloaded)
let expected = Date.now() + 500;
const lagTimer = setInterval(() => {
  const now = Date.now();
  const late = Math.max(0, now - expected);
  lag = lag * 0.7 + late * 0.3;
  expected = now + 500;
}, 500);
if (lagTimer.unref) lagTimer.unref();

function readNumber(file) {
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    return v === 'max' ? Infinity : Number(v);
  } catch (err) {
    return null;
  }
}

// memory in MB: the limit of this server/container, what is used and what is left
function memory() {
  const mb = (b) => Math.round(b / 1048576);
  let limit = os.totalmem();
  let used = process.memoryUsage().rss;
  const cgLimit = readNumber('/sys/fs/cgroup/memory.max') ?? readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const cgUsed = readNumber('/sys/fs/cgroup/memory.current') ?? readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  if (cgLimit && Number.isFinite(cgLimit) && cgLimit < limit * 4) limit = Math.min(limit, cgLimit);
  if (cgUsed && Number.isFinite(cgUsed)) used = Math.max(used, cgUsed);
  let free = limit - used;
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    if (m) free = Math.min(free, Number(m[1]) * 1024);
  } catch (err) {
    // not Linux
  }
  return { limitMB: mb(limit), usedMB: mb(used), freeMB: mb(Math.max(0, free)) };
}

function load() {
  const cpus = os.cpus().length || 1;
  return { cpus, load1: Number(os.loadavg()[0].toFixed(2)), perCpu: Number((os.loadavg()[0] / cpus).toFixed(2)), lagMs: Math.round(lag) };
}

// ---- tools: checked once, then remembered for a minute
const toolCache = new Map();
function checkTool(name) {
  const hit = toolCache.get(name);
  if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.ok);
  const done = (ok) => {
    toolCache.set(name, { ok, at: Date.now() });
    return ok;
  };
  if (name === 'sharp' || name === 'qrcode') {
    try {
      require.resolve(name);
      return Promise.resolve(done(true));
    } catch (err) {
      return Promise.resolve(done(false));
    }
  }
  if (name === 'ffmpeg') {
    let bin = 'ffmpeg';
    try {
      bin = require('@ffmpeg-installer/ffmpeg').path;
    } catch (err) {
      // use the system one
    }
    return new Promise((resolve) => {
      execFile(bin, ['-version'], { timeout: 8000 }, (err) => resolve(done(!err)));
    });
  }
  return Promise.resolve(true);
}

// ---- what a command needs: written in the command file (needs / weight) or found from the code it uses
function describe(cmd, source = '') {
  const needs = new Set(cmd.needs || []);
  if (!cmd.needs) {
    if (/loadSharp|require\(['"]sharp['"]\)/.test(source)) needs.add('sharp');
    if (/ffmpeg\(/.test(source)) needs.add('ffmpeg');
    if (/require\(['"]qrcode['"]\)/.test(source)) needs.add('qrcode');
  }
  let weight = cmd.weight;
  if (!weight) weight = needs.has('ffmpeg') ? 'heavy' : needs.has('sharp') ? 'medium' : 'light';
  return { needs: [...needs], weight };
}

const NAMES = { sharp: 'sharp (pictures)', ffmpeg: 'ffmpeg (video and audio)', qrcode: 'qrcode' };

// Can the server run this command right now? Returns { ok: true, release } or { ok: false, why, detail }
async function enter(cmd, who) {
  const info = cmd.capacity || { needs: [], weight: 'light' };
  if (info.weight === 'light' && !info.needs.length) return { ok: true, release() {} };

  for (const tool of info.needs) {
    if (!(await checkTool(tool))) {
      return { ok: false, why: 'missing', detail: `${NAMES[tool] || tool} is not installed on this server. Start the bot with npm install enabled${tool === 'ffmpeg' ? ' (or install ffmpeg)' : ''}.` };
    }
  }
  const w = WEIGHTS[info.weight] || WEIGHTS.light;

  if (info.weight === 'heavy' && who) {
    const wait = HEAVY_COOLDOWN_MS - (Date.now() - (lastHeavy.get(who) || 0));
    if (wait > 0) return { ok: false, why: 'cooldown', detail: `Heavy commands can be used once every ${HEAVY_COOLDOWN_MS / 1000} seconds per person.`, waitSeconds: Math.ceil(wait / 1000) };
  }
  if (active[info.weight] !== undefined && active[info.weight] >= w.parallel) {
    return { ok: false, why: 'busy', detail: `${active[info.weight]} ${info.weight} command(s) are already running (limit ${w.parallel}).` };
  }
  const mem = memory();
  if (w.memMB && mem.freeMB < w.memMB) {
    return { ok: false, why: 'memory', detail: `Only ${mem.freeMB} MB of memory is free, this command needs about ${w.memMB} MB.` };
  }
  const l = load();
  // The load average of a shared server (or a container on a busy host) can be high while THIS bot is perfectly fast:
  // it counts every program on the machine. So it only counts when the bot itself is also slowed down a little.
  if (info.weight === 'heavy' && (l.lagMs > LAG_LIMIT_MS || (l.perCpu > LOAD_PER_CPU && l.lagMs > LOAD_NEEDS_LAG_MS))) {
    return { ok: false, why: 'overloaded', detail: `The server is overloaded right now (delay ${l.lagMs} ms, load ${l.load1} on ${l.cpus} CPU).` };
  }

  if (active[info.weight] !== undefined) active[info.weight] += 1;
  if (info.weight === 'heavy' && who) {
    lastHeavy.set(who, Date.now());
    if (lastHeavy.size > 2000) lastHeavy.clear();
  }
  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      if (active[info.weight] !== undefined) active[info.weight] = Math.max(0, active[info.weight] - 1);
    },
  };
}

// the message people see (owners also get the technical detail)
function refusal(result, isOwner) {
  const base = {
    missing: '⚠️ This feature is not available on this server.',
    cooldown: `⏳ Please wait ${result.waitSeconds || 8} seconds before using another heavy command.`,
    busy: '⚠️ The server is busy with other jobs right now. Please try again in a minute.',
    memory: '⚠️ The server is low on memory right now, so I cannot run this safely. Please try again later.',
    overloaded: '⚠️ The server is overloaded right now, so I cannot run this safely. Please try again in a minute.',
  }[result.why] || '⚠️ I cannot run this right now. Please try again later.';
  return isOwner ? `${base}\n🛡️ ${result.detail}` : base;
}

function snapshot() {
  return { memory: memory(), load: load(), active: { ...active } };
}

module.exports = { enter, refusal, describe, snapshot, checkTool, memory, load, WEIGHTS };
