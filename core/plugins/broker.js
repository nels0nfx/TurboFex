'use strict';
// Plugin sandbox, part 2 of 3: the ONLY door out of the sandbox. Every request from a plugin arrives as text (JSON), is checked
// against the plugin's manifest and what the owner allowed, and only then does something through `env`.
class BrokerError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

const MAX_ARGS_CHARS = 100000;
// Only plain text fields are accepted. Unknown fields (also "__proto__") are refused, not ignored.
const MAX_MEDIA_ARGS_CHARS = 1500000;
const parseArgs = (json, allowed, maxChars = MAX_ARGS_CHARS) => {
  if (typeof json !== 'string' || json.length > maxChars) throw new BrokerError('bad_args', 'arguments too large');
  let o;
  try { o = JSON.parse(json); } catch (e) { throw new BrokerError('bad_args', 'not valid JSON'); }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.getPrototypeOf(o) !== Object.prototype) throw new BrokerError('bad_args', 'not an object');
  const out = Object.create(null);
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new BrokerError('bad_args', 'unknown field');
    if (typeof o[k] !== 'string') throw new BrokerError('bad_args', 'fields must be text');
    out[k] = o[k];
  }
  for (const k of allowed) if (!(k in out)) throw new BrokerError('bad_args', 'missing field');
  return out;
};

const DEFAULT_POLICY = {
  maxTextChars: 4000, sendsPerCall: 5, sendsPerMinute: 20, logsPerCall: 100, fetchesPerCall: 3, notifiesPerHour: 3, notifyChars: 500,
  fetchMs: 5000, fetchMaxChars: 256 * 1024, storageKeys: 200, storageBytes: 1024 * 1024, storageValueChars: 64 * 1024, strikeLimit: 5,
  kicksPerCall: 3, kicksPerHour: 20, settingsPerHour: 6, adminOpsPerHour: 6, reactsPerCall: 1, reactsPerMinute: 10, mediaPerCall: 3, mediaPerMinute: 6, convertsPerCall: 2, convertsPerMinute: 6, convertMs: 4000, mediaBytes: 1024 * 1024, postsPerMinute: 10, postBodyChars: 64 * 1024, pollsPerHour: 6, typingPerMinute: 20, dmsPerCall: 1, dmsPerHour: 10, downloadsPerCall: 1, downloadsPerMinute: 6, downloadBytes: 2 * 1024 * 1024, memberCalls: 2, mentionMax: 10, hashChars: 100000, fetchBytesMax: 1024 * 1024, captionChars: 1000,
};

// What a file really is, judged by its first bytes (never by its name or by what the plugin says it is)
function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', image: true };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', image: true };
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return { mime: 'image/gif', image: true };
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', image: true };
  if (b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-') return { mime: 'application/pdf', image: false };
  return null;
}
// audio files the bot is willing to convert or send (judged by their first bytes)
function sniffAudio(b) {
  if (b.length > 12 && b.toString('latin1', 0, 3) === 'ID3') return 'audio/mpeg';
  if (b.length > 3 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (b.length > 4 && b.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return 'audio/wav';
  if (b.length > 12 && b.toString('latin1', 4, 8) === 'ftyp') return 'audio/mp4';
  if (b.length > 4 && b.toString('latin1', 0, 4) === 'fLaC') return 'audio/flac';
  if (b.length > 6 && b.toString('latin1', 0, 6) === '#!AMR\n') return 'audio/amr';
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  return null;
}

// a short stable name for a chat's notes (two 32-bit FNV-1a runs, no Node modules so this file also runs in a browser)
function shortHash(t) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < t.length; i++) { a = Math.imul(a ^ t.charCodeAt(i), 0x01000193) >>> 0; b = Math.imul(b ^ t.charCodeAt(i), 0x85ebca6b) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

class Broker {
  constructor({ manifest, grants, env, policy, now }) {
    this.manifest = manifest; this.grants = grants || []; this.env = env;
    this.p = { ...DEFAULT_POLICY, ...(policy || {}) };
    this.now = now || Date.now;
    this.sendTimes = []; this.notifyTimes = []; this.strikes = 0; this.violations = [];
    this.storage = env.storage || new Map();
  }
  newCall(ctx, extra) { return { ctx: ctx || {}, send: extra && extra.send, sendMedia: extra && extra.sendMedia, react: extra && extra.react, quote: extra && extra.quote, mention: extra && extra.mention, presence: extra && extra.presence, poll: extra && extra.poll, dm: extra && extra.dm, members: extra && extra.members, download: extra && extra.download, dms: 0, downloads: 0, memberCalls: 0, manage: extra && extra.manage, kicks: 0, reacts: 0, adminOps: 0, groupInfo: extra && extra.groupInfo, media: 0, converts: 0, sends: 0, logs: 0, fetches: 0, pending: [] }; }
  deny(code, msg) { this.strikes++; this.violations.push(code); if (this.violations.length > 100) this.violations.shift(); throw new BrokerError(code, msg); }
  need(perm) {
    if (!(this.manifest.permissions || []).includes(perm)) this.deny('not_declared', perm + ' is not in the manifest');
    if (!this.grants.includes(perm)) this.deny('not_granted', perm + ' was not granted by the owner');
  }
  async handle(name, argsJson, st) {
    try {
      switch (name) {
        case 'log': return this.log(parseArgs(argsJson, ['text']), st);
        case 'chat.send': this.need('chat.send'); return await this.send(parseArgs(argsJson, ['text']), st);
        case 'storage.get': this.need('storage'); return this.sget(parseArgs(argsJson, ['key']));
        case 'storage.list': this.need('storage'); parseArgs(argsJson, []); return JSON.stringify([...this.storage.keys()].sort().slice(0, this.p.storageKeys));
        case 'storage.delete': this.need('storage'); return this.sdel(parseArgs(argsJson, ['key']));
        case 'chat.react': this.need('chat.react'); return await this.react(parseArgs(argsJson, ['emoji']), st);
        case 'storage.set': this.need('storage'); return this.sset(parseArgs(argsJson, ['key', 'value']));
        case 'net.fetch': this.need('network'); return await this.fetch(parseArgs(argsJson, ['url']), st);
        case 'net.fetchBytes': this.need('network'); return await this.fetchBytes(parseArgs(argsJson, ['url']), st);
        case 'media.toSticker': this.need('media.convert'); return await this.convert('sticker', parseArgs(argsJson, ['data'], MAX_MEDIA_ARGS_CHARS), st);
        case 'media.toAudio': this.need('media.convert'); return await this.convert('audio', parseArgs(argsJson, ['data'], MAX_MEDIA_ARGS_CHARS), st);
        case 'media.send': this.need('media.send'); return await this.media(parseArgs(argsJson, ['kind', 'data', 'mimetype', 'fileName', 'caption'], MAX_MEDIA_ARGS_CHARS), st);
        case 'group.kick': this.need('group.manage'); return await this.manageKick(parseArgs(argsJson, ['member']), st);
        case 'group.open': case 'group.close': this.need('group.manage'); parseArgs(argsJson, []); return await this.manageSetting(name.slice(6), st);
        case 'group.promote': case 'group.demote': this.need('group.admins'); return await this.manageAdmin(name.slice(6), parseArgs(argsJson, ['member']), st);
        case 'group.rename': this.need('group.manage'); return await this.manageRename(parseArgs(argsJson, ['name']), st);
        case 'group.info': this.need('group.read'); parseArgs(argsJson, []); return this.groupInfo(st);
        case 'storage.chat.get': this.need('storage'); return this.sget(this.chatKey(parseArgs(argsJson, ['key']), st));
        case 'storage.chat.set': this.need('storage'); return this.sset(this.chatKey(parseArgs(argsJson, ['key', 'value']), st));
        case 'storage.chat.delete': this.need('storage'); return this.sdel(this.chatKey(parseArgs(argsJson, ['key']), st));
        case 'util.hash': return this.hash(parseArgs(argsJson, ['text', 'algo']));
        case 'net.post': this.need('network'); return await this.post(parseArgs(argsJson, ['url', 'body', 'type']), st);
        case 'chat.quote': this.need('chat.send'); return await this.quote(parseArgs(argsJson, ['text']), st);
        case 'chat.mention': this.need('chat.send'); return await this.mention(parseArgs(argsJson, ['text', 'members']), st);
        case 'chat.typing': this.need('chat.send'); return await this.typing(parseArgs(argsJson, ['kind']), st);
        case 'chat.poll': this.need('chat.send'); return await this.poll(parseArgs(argsJson, ['question', 'options', 'multi']), st);
        case 'user.dm': this.need('user.dm'); return await this.dm(parseArgs(argsJson, ['text']), st);
        case 'group.members': this.need('group.members'); parseArgs(argsJson, []); return await this.members(st);
        case 'group.describe': this.need('group.manage'); return await this.manageDescribe(parseArgs(argsJson, ['text']), st);
        case 'group.invite': this.need('group.invite'); parseArgs(argsJson, []); return await this.manageInvite(st);
        case 'media.download': this.need('media.read'); return await this.download(parseArgs(argsJson, ['which']), st);
        case 'owner.notify': this.need('owner.notify'); return await this.notify(parseArgs(argsJson, ['text']));
        default: this.deny('unknown_api', 'no such call');
      }
    } catch (e) {
      if (e instanceof BrokerError) { if (e.code === 'bad_args') { this.strikes++; this.violations.push('bad_args'); } throw e; }
      throw new BrokerError('failed', String(e && e.message || e).slice(0, 200));
    }
  }
  log(a, st) { if (++st.logs > this.p.logsPerCall) throw new BrokerError('rate_limited', 'too many log lines'); this.env.log && this.env.log(a.text.slice(0, 500)); return 'null'; }
  async send(a, st) {
    if (!st.ctx.chat) this.deny('not_allowed', 'there is no chat to answer in');
    if (!a.text.length || a.text.length > this.p.maxTextChars) throw new BrokerError('too_long', 'message size not allowed');
    if (++st.sends > this.p.sendsPerCall) throw new BrokerError('rate_limited', 'too many messages in one call');
    const t = this.now(); this.sendTimes = this.sendTimes.filter((x) => t - x < 60000);
    if (this.sendTimes.length >= this.p.sendsPerMinute) throw new BrokerError('rate_limited', 'too many messages per minute');
    this.sendTimes.push(t);
    // the target is ALWAYS the chat that triggered the call: the plugin cannot choose it
    if (st.send) await st.send(a.text); else await this.env.send(st.ctx.chat.id, a.text);
    return 'null';
  }
  sget(a) { this.key(a.key); return JSON.stringify(this.storage.has(a.key) ? this.storage.get(a.key) : null); }
  sset(a) {
    this.key(a.key);
    if (a.value.length > this.p.storageValueChars) throw new BrokerError('too_long', 'value too large');
    let total = a.value.length; for (const [k, v] of this.storage) if (k !== a.key) total += k.length + v.length;
    if ((!this.storage.has(a.key) && this.storage.size >= this.p.storageKeys) || total > this.p.storageBytes) throw new BrokerError('quota', 'storage is full');
    this.storage.set(a.key, a.value);
    if (this.env.persist) this.env.persist(this.storage);
    return 'null';
  }
  sdel(a) { this.key(a.key); if (this.storage.delete(a.key) && this.env.persist) this.env.persist(this.storage); return 'null'; }
  // a reaction goes ONLY to the message that triggered the call; the plugin chooses just the emoji
  async react(a, st) {
    if (!st.ctx.chat || !st.react) this.deny('not_allowed', 'there is no message to react to');
    const e = a.emoji;
    if (e !== '' && !(e.length <= 16 && /^\p{Extended_Pictographic}[\ufe0f\u{1F3FB}-\u{1F3FF}]?(?:\u200d\p{Extended_Pictographic}[\ufe0f\u{1F3FB}-\u{1F3FF}]?)*$/u.test(e))) throw new BrokerError('bad_args', 'only one emoji');
    if (++st.reacts > this.p.reactsPerCall) throw new BrokerError('rate_limited', 'too many reactions in one call');
    const t = this.now(); this.reactTimes = (this.reactTimes || []).filter((x) => t - x < 60000);
    if (this.reactTimes.length >= this.p.reactsPerMinute) throw new BrokerError('rate_limited', 'too many reactions per minute');
    this.reactTimes.push(t);
    await st.react(e);
    return 'null';
  }
  key(k) { if (!/^[a-z0-9._-]{1,64}$/i.test(k)) throw new BrokerError('bad_args', 'bad key'); }
  checkUrl(a, st) {
    if (++st.fetches > this.p.fetchesPerCall) throw new BrokerError('rate_limited', 'too many requests in one call');
    let u; try { u = new URL(a.url); } catch (e) { throw new BrokerError('bad_args', 'bad URL'); }
    if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) throw new BrokerError('net_denied', 'only plain https on the normal port');
    const domains = (this.manifest.network && this.manifest.network.domains) || [];
    if (!domains.includes(u.hostname)) throw new BrokerError('net_denied', 'domain is not in the manifest');
    return u;
  }
  async fetchBytes(a, st) {
    const u = this.checkUrl(a, st);
    if (!(await this.env.isPublicHost(u.hostname))) throw new BrokerError('net_denied', 'address is not public');
    const r = await Promise.race([this.env.fetchBytes(u.href), new Promise((_, rej) => setTimeout(() => rej(new BrokerError('net_timeout', 'request took too long')), this.p.fetchMs).unref())]);
    const buf = Buffer.from(r.bytes || []);
    if (buf.length > this.p.fetchBytesMax) throw new BrokerError('too_long', 'download too large');
    return JSON.stringify({ status: r.status, base64: buf.toString('base64') });
  }
  // pictures to stickers and audio to a small MP3: the bot does the work (never the plugin), small inputs only, a few per call and per minute
  async convert(what, a, st) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data) || a.data.length > Math.ceil(this.p.mediaBytes / 3) * 4 + 4) throw new BrokerError('too_long', 'file not allowed');
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length || buf.length > this.p.mediaBytes) throw new BrokerError('too_long', 'file size not allowed');
    if (what === 'sticker') { const k = sniff(buf); if (!(k && k.image)) throw new BrokerError('bad_file', 'not a picture'); }
    else if (!sniffAudio(buf)) throw new BrokerError('bad_file', 'not an audio file');
    if (++st.converts > this.p.convertsPerCall) throw new BrokerError('rate_limited', 'too many conversions in one call');
    const t = this.now(); this.convertTimes = (this.convertTimes || []).filter((x) => t - x < 60000);
    if (this.convertTimes.length >= this.p.convertsPerMinute) throw new BrokerError('rate_limited', 'too many conversions per minute');
    this.convertTimes.push(t);
    const fn = what === 'sticker' ? this.env.toSticker : this.env.toAudio; if (!fn) throw new BrokerError('not_allowed', 'conversion is not available');
    let out;
    try { out = await Promise.race([fn(buf), new Promise((_, rej) => setTimeout(() => rej(new BrokerError('convert_timeout', 'took too long')), this.p.convertMs).unref())]); }
    catch (e) { if (e instanceof BrokerError) throw e; throw new BrokerError('convert_failed', 'could not convert'); }
    out = Buffer.from(out || []); if (!out.length || out.length > this.p.mediaBytes) throw new BrokerError('too_long', 'the result is too big');
    return JSON.stringify(out.toString('base64'));
  }
  async media(a, st) {
    if (!st.ctx.chat) this.deny('not_allowed', 'there is no chat to answer in');
    if (!['image', 'sticker', 'document', 'audio'].includes(a.kind)) throw new BrokerError('bad_args', 'unknown kind');
    if (a.caption.length > this.p.captionChars) throw new BrokerError('too_long', 'caption too long');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data) || a.data.length > Math.ceil(this.p.mediaBytes / 3) * 4 + 4) throw new BrokerError('too_long', 'file not allowed');
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length || buf.length > this.p.mediaBytes) throw new BrokerError('too_long', 'file size not allowed');
    const kind = sniff(buf);
    let mime = kind && kind.mime; let name = '';
    if (a.kind === 'image' && !(kind && kind.image)) throw new BrokerError('bad_file', 'not a picture');
    if (a.kind === 'audio') { mime = sniffAudio(buf); if (!mime) throw new BrokerError('bad_file', 'not an audio file'); }
    if (a.kind === 'sticker' && !(kind && kind.mime === 'image/webp')) throw new BrokerError('bad_file', 'a sticker must be a WebP picture');
    if (a.kind === 'document') {
      if (!/^[A-Za-z0-9][\w. -]{0,59}$/.test(a.fileName) || a.fileName.includes('..')) throw new BrokerError('bad_args', 'bad file name');
      name = a.fileName;
      if (kind) { if (kind.mime === 'image/gif' || kind.mime === 'image/webp') throw new BrokerError('bad_file', 'file type not allowed'); mime = kind.mime; }
      else if (['text/plain', 'text/csv', 'application/json'].includes(a.mimetype) && !buf.includes(0)) mime = a.mimetype;
      else throw new BrokerError('bad_file', 'file type not allowed');
    }
    if (++st.media > this.p.mediaPerCall) throw new BrokerError('rate_limited', 'too many files in one call');
    const t = this.now(); this.mediaTimes = (this.mediaTimes || []).filter((x) => t - x < 60000);
    if (this.mediaTimes.length >= this.p.mediaPerMinute) throw new BrokerError('rate_limited', 'too many files per minute');
    this.mediaTimes.push(t);
    if (!st.sendMedia) this.deny('not_allowed', 'files cannot be sent here');
    await st.sendMedia({ kind: a.kind, buffer: buf, mimetype: mime, fileName: name, caption: a.caption });
    return 'null';
  }
  async fetch(a, st) {
    const u = this.checkUrl(a, st);
    if (!(await this.env.isPublicHost(u.hostname))) throw new BrokerError('net_denied', 'address is not public');
    const r = await Promise.race([this.env.fetch(u.href), new Promise((_, rej) => setTimeout(() => rej(new BrokerError('net_timeout', 'request took too long')), this.p.fetchMs).unref())]);
    return JSON.stringify({ status: r.status, text: String(r.text).slice(0, this.p.fetchMaxChars) });
  }
  // Removing people and opening or closing the group: the bot (index.js) makes the final checks (bot is admin, the person is not the
  // owner or an admin, the person is part of this very event); here come the rate limits.
  hourly(key, max) {
    const t = this.now(); const a = (this[key] || []).filter((x) => t - x < 3600000);
    if (a.length >= max) throw new BrokerError('rate_limited', 'too many group changes this hour');
    a.push(t); this[key] = a;
  }
  async manageKick(a, st) {
    if (!st.manage) throw new BrokerError('not_allowed', 'not possible here');
    if (++st.kicks > this.p.kicksPerCall) throw new BrokerError('rate_limited', 'too many removals in one call');
    this.hourly('kickTimes', this.p.kicksPerHour);
    await st.manage('kick', a.member); return 'null';
  }
  // making someone an admin or not: one person per call, 6 an hour, and only through a command used by an admin or the owner (the bot enforces this, not the plugin)
  async manageAdmin(action, a, st) {
    if (!st.manage) throw new BrokerError('not_allowed', 'not possible here');
    if (++st.adminOps > 1) throw new BrokerError('rate_limited', 'one person per call');
    this.hourly('adminTimes', this.p.adminOpsPerHour);
    await st.manage(action, a.member); return 'null';
  }
  async manageRename(a, st) {
    if (!st.manage) throw new BrokerError('not_allowed', 'not possible here');
    const n = a.name.trim();
    if (!n.length || n.length > 100 || /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e]/.test(n)) throw new BrokerError('bad_args', 'a group name is 1 to 100 plain characters');
    this.hourly('renameTimes', this.p.settingsPerHour);
    await st.manage('rename', n); return 'null';
  }
  async manageSetting(action, st) {
    if (!st.manage) throw new BrokerError('not_allowed', 'not possible here');
    this.hourly('settingTimes', this.p.settingsPerHour);
    await st.manage(action); return 'null';
  }
  groupInfo(st) {
    if (!st.groupInfo) throw new BrokerError('not_allowed', 'only inside a command in a group');
    const g = st.groupInfo; // plain numbers and a name only: no member list, no phone numbers
    return JSON.stringify({ name: String(g.name || '').slice(0, 100), size: Number(g.size) || 0, admins: Number(g.admins) || 0 });
  }
  // ---- Plugin API 1.1 (bot 1.6.1)
  chatKey(a, st) {
    if (!st.ctx.chat) this.deny('not_allowed', 'there is no chat for chat notes');
    if (!/^[a-z0-9._-]{1,40}$/i.test(a.key)) throw new BrokerError('bad_args', 'bad key');
    return { ...a, key: 'g.' + shortHash(String(st.ctx.chat.id)) + '.' + a.key };
  }
  hash(a) {
    if (!['sha256', 'sha1', 'md5'].includes(a.algo)) throw new BrokerError('bad_args', 'unknown algorithm');
    if (a.text.length > this.p.hashChars) throw new BrokerError('too_long', 'text too long');
    if (!this.env.hash) throw new BrokerError('not_allowed', 'hashing is not available here');
    return JSON.stringify(String(this.env.hash(a.algo, a.text)).slice(0, 128));
  }
  async post(a, st) {
    const u = this.checkUrl(a, st);
    if (!['application/json', 'application/x-www-form-urlencoded', 'text/plain'].includes(a.type)) throw new BrokerError('bad_args', 'content type not allowed');
    if (a.body.length > this.p.postBodyChars) throw new BrokerError('too_long', 'body too large');
    const t = this.now(); this.postTimes = (this.postTimes || []).filter((x) => t - x < 60000);
    if (this.postTimes.length >= this.p.postsPerMinute) throw new BrokerError('rate_limited', 'too many requests per minute');
    this.postTimes.push(t);
    if (!this.env.post) throw new BrokerError('not_allowed', 'POST is not available');
    if (!(await this.env.isPublicHost(u.hostname))) throw new BrokerError('net_denied', 'address is not public');
    const r = await Promise.race([this.env.post(u.href, a.body, a.type), new Promise((_, rej) => setTimeout(() => rej(new BrokerError('net_timeout', 'request took too long')), this.p.fetchMs).unref())]);
    return JSON.stringify({ status: r.status, text: String(r.text).slice(0, this.p.fetchMaxChars) });
  }
  // one shared message budget for send, quote and mention
  countSend(st, text) {
    if (!st.ctx.chat) this.deny('not_allowed', 'there is no chat to answer in');
    if (!text.length || text.length > this.p.maxTextChars) throw new BrokerError('too_long', 'message size not allowed');
    if (++st.sends > this.p.sendsPerCall) throw new BrokerError('rate_limited', 'too many messages in one call');
    const t = this.now(); this.sendTimes = this.sendTimes.filter((x) => t - x < 60000);
    if (this.sendTimes.length >= this.p.sendsPerMinute) throw new BrokerError('rate_limited', 'too many messages per minute');
    this.sendTimes.push(t);
  }
  async quote(a, st) { if (!st.quote) this.deny('not_allowed', 'there is no message to reply to'); this.countSend(st, a.text); await st.quote(a.text); return 'null'; }
  async mention(a, st) {
    let ids; try { ids = JSON.parse(a.members); } catch (e) { throw new BrokerError('bad_args', 'members must be a list'); }
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > this.p.mentionMax || ids.some((x) => typeof x !== 'string' || x.length > 64)) throw new BrokerError('bad_args', 'one to ' + this.p.mentionMax + ' people');
    if (!st.mention) this.deny('not_allowed', 'mentions are not possible here');
    this.countSend(st, a.text); await st.mention(a.text, ids); return 'null';
  }
  async typing(a, st) {
    if (!['typing', 'recording', 'paused'].includes(a.kind)) throw new BrokerError('bad_args', 'unknown kind');
    if (!st.ctx.chat || !st.presence) this.deny('not_allowed', 'there is no chat');
    const t = this.now(); this.typingTimes = (this.typingTimes || []).filter((x) => t - x < 60000);
    if (this.typingTimes.length >= this.p.typingPerMinute) throw new BrokerError('rate_limited', 'too many typing signals');
    this.typingTimes.push(t); await st.presence(a.kind); return 'null';
  }
  async poll(a, st) {
    let o; try { o = JSON.parse(a.options); } catch (e) { throw new BrokerError('bad_args', 'options must be a list'); }
    const q = a.question.trim();
    if (!q.length || q.length > 250) throw new BrokerError('bad_args', 'a question is 1 to 250 characters');
    if (!Array.isArray(o) || o.length < 2 || o.length > 12 || o.some((x) => typeof x !== 'string' || !x.trim().length || x.length > 100) || new Set(o.map((x) => x.trim())).size !== o.length) throw new BrokerError('bad_args', '2 to 12 different options of up to 100 characters');
    if (!['yes', 'no'].includes(a.multi)) throw new BrokerError('bad_args', 'bad choice');
    if (!st.poll) this.deny('not_allowed', 'a poll cannot be sent here');
    this.countSend(st, q); this.hourly('pollTimes', this.p.pollsPerHour);
    await st.poll(q, o.map((x) => x.trim()), a.multi === 'yes'); return 'null';
  }
  // a private message ONLY to the person who used the command: never to anyone else, never from a listener or timer
  async dm(a, st) {
    if (!st.dm) this.deny('not_allowed', 'only inside a command');
    if (!a.text.length || a.text.length > this.p.maxTextChars) throw new BrokerError('too_long', 'message size not allowed');
    if (++st.dms > this.p.dmsPerCall) throw new BrokerError('rate_limited', 'one private message per call');
    this.hourly('dmTimes', this.p.dmsPerHour);
    await st.dm(a.text); return 'null';
  }
  // ids are the plugin's own opaque ids (no phone numbers); they work with kick, promote, demote and mention
  async members(st) {
    if (!st.members) throw new BrokerError('not_allowed', 'only inside a group command or event');
    if (++st.memberCalls > this.p.memberCalls) throw new BrokerError('rate_limited', 'too many member lists in one call');
    const l = await st.members();
    return JSON.stringify((Array.isArray(l) ? l : []).slice(0, 1024).map((m) => ({ id: String(m.id).slice(0, 64), admin: !!m.admin })));
  }
  async manageDescribe(a, st) {
    if (!st.manage) throw new BrokerError('not_allowed', 'not possible here');
    const t = a.text.trim();
    if (t.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e]/.test(t)) throw new BrokerError('bad_args', 'a description is up to 500 plain characters');
    this.hourly('describeTimes', this.p.settingsPerHour);
    await st.manage('describe', t); return 'null';
  }
  async manageInvite(st) {
    if (!st.manage) throw new BrokerError('not_allowed', 'not possible here');
    this.hourly('inviteTimes', this.p.adminOpsPerHour);
    return JSON.stringify(String(await st.manage('invite') || ''));
  }
  async download(a, st) {
    if (!['message', 'quoted', 'any'].includes(a.which)) throw new BrokerError('bad_args', 'unknown choice');
    if (!st.download) throw new BrokerError('not_allowed', 'only inside a command');
    if (++st.downloads > this.p.downloadsPerCall) throw new BrokerError('rate_limited', 'one download per call');
    const t = this.now(); this.dlTimes = (this.dlTimes || []).filter((x) => t - x < 60000);
    if (this.dlTimes.length >= this.p.downloadsPerMinute) throw new BrokerError('rate_limited', 'too many downloads per minute');
    this.dlTimes.push(t);
    const r = await st.download(a.which, this.p.downloadBytes);
    if (!r) return 'null';
    const buf = Buffer.from(r.buffer || []);
    if (!buf.length || buf.length > this.p.downloadBytes) throw new BrokerError('too_long', 'the file is too big (up to ' + Math.floor(this.p.downloadBytes / 1048576) + ' MB)');
    return JSON.stringify({ kind: String(r.kind), mimetype: String(r.mimetype || '').slice(0, 80), size: buf.length, base64: buf.toString('base64') });
  }
  async notify(a) {
    if (!a.text.length || a.text.length > this.p.notifyChars) throw new BrokerError('too_long', 'message size not allowed');
    const t = this.now(); this.notifyTimes = this.notifyTimes.filter((x) => t - x < 3600000);
    if (this.notifyTimes.length >= this.p.notifiesPerHour) throw new BrokerError('rate_limited', 'too many messages to the owner');
    this.notifyTimes.push(t);
    await this.env.notifyOwner(a.text); return 'null';
  }
}
module.exports = { sniffAudio, Broker, BrokerError, DEFAULT_POLICY, sniff };
