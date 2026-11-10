'use strict';
const { PluginHost } = require('../core/plugins/host');
const hosts = [];
const CTX = { args: [], rest: '', chat: { id: 'chat-1', isGroup: true, name: 'Test group' }, sender: { id: 's-1', name: 'Sam', isAdmin: true, isOwner: false } };
function fakeEnv(extra) {
  const e = { sends: [], logs: [], storage: new Map(),
    send: async (chat, text) => { e.sends.push({ chat, text }); },
    notified: [], notifyOwner: async (t) => { e.notified.push(t); },
    log: (l) => e.logs.push(l),
    isPublicHost: async (h) => !/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(h) && h !== 'internal.example.com',
    fetch: async (u) => ({ status: 200, text: 'body of ' + u }) };
  return Object.assign(e, extra || {});
}
function make(source, o = {}) {
  const env = fakeEnv(o.env);
  const manifest = { id: o.id || 'test-plugin', permissions: o.permissions || ['chat.send'], network: { domains: o.domains || [] } };
  const host = new PluginHost({ id: manifest.id, manifest, source, grants: o.grants || manifest.permissions, limits: o.limits, env, policy: o.policy });
  hosts.push(host); return { host, env };
}
const stopAll = () => { for (const h of hosts.splice(0)) h.stop(); };
module.exports = { make, CTX, stopAll, fakeEnv };
