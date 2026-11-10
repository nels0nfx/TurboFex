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
  mediaPerCall: 3, mediaPerMinute: 6, mediaBytes: 1024 * 1024, fetchBytesMax: 1024 * 1024, captionChars: 1000,
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

class Broker {
  constructor({ manifest, grants, env, policy, now }) {
    this.manifest = manifest; this.grants = grants || []; this.env = env;
    this.p = { ...DEFAULT_POLICY, ...(policy || {}) };
    this.now = now || Date.now;
    this.sendTimes = []; this.notifyTimes = []; this.strikes = 0; this.violations = [];
    this.storage = env.storage || new Map();
  }
  newCall(ctx, extra) { return { ctx: ctx || {}, send: extra && extra.send, sendMedia: extra && extra.sendMedia, groupInfo: extra && extra.groupInfo, media: 0, sends: 0, logs: 0, fetches: 0, pending: [] }; }
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
        case 'storage.set': this.need('storage'); return this.sset(parseArgs(argsJson, ['key', 'value']));
        case 'net.fetch': this.need('network'); return await this.fetch(parseArgs(argsJson, ['url']), st);
        case 'net.fetchBytes': this.need('network'); return await this.fetchBytes(parseArgs(argsJson, ['url']), st);
        case 'media.send': this.need('media.send'); return await this.media(parseArgs(argsJson, ['kind', 'data', 'mimetype', 'fileName', 'caption'], MAX_MEDIA_ARGS_CHARS), st);
        case 'group.info': this.need('group.read'); parseArgs(argsJson, []); return this.groupInfo(st);
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
  async media(a, st) {
    if (!st.ctx.chat) this.deny('not_allowed', 'there is no chat to answer in');
    if (!['image', 'sticker', 'document'].includes(a.kind)) throw new BrokerError('bad_args', 'unknown kind');
    if (a.caption.length > this.p.captionChars) throw new BrokerError('too_long', 'caption too long');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data) || a.data.length > Math.ceil(this.p.mediaBytes / 3) * 4 + 4) throw new BrokerError('too_long', 'file not allowed');
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length || buf.length > this.p.mediaBytes) throw new BrokerError('too_long', 'file size not allowed');
    const kind = sniff(buf);
    let mime = kind && kind.mime; let name = '';
    if (a.kind === 'image' && !(kind && kind.image)) throw new BrokerError('bad_file', 'not a picture');
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
  groupInfo(st) {
    if (!st.groupInfo) throw new BrokerError('not_allowed', 'only inside a command in a group');
    const g = st.groupInfo; // plain numbers and a name only: no member list, no phone numbers
    return JSON.stringify({ name: String(g.name || '').slice(0, 100), size: Number(g.size) || 0, admins: Number(g.admins) || 0 });
  }
  async notify(a) {
    if (!a.text.length || a.text.length > this.p.notifyChars) throw new BrokerError('too_long', 'message size not allowed');
    const t = this.now(); this.notifyTimes = this.notifyTimes.filter((x) => t - x < 3600000);
    if (this.notifyTimes.length >= this.p.notifiesPerHour) throw new BrokerError('rate_limited', 'too many messages to the owner');
    this.notifyTimes.push(t);
    await this.env.notifyOwner(a.text); return 'null';
  }
}
module.exports = { Broker, BrokerError, DEFAULT_POLICY, sniff };
