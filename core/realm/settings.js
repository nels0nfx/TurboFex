// God's settings. Every feature of the Empire registers its numbers here (with a safe minimum and maximum), and nothing
// is hard-coded. A setting has a default, God can change it for ALL realms, or for ONE realm (which wins over "all").
//   register('core', { title, icon, settings: { dailyBase: { label, def, min, max, kind: 'int' | 'float' | 'bool', unit } } })
//   get('core.dailyBase', group)   set('core.dailyBase', 400, group | null)   reset('core.dailyBase', group | null)
// Every feature also gets a switch ("<feature>.on") that turns the whole feature on or off.
const jsonstore = require('../jsonstore');

const js = jsonstore.open('realm-settings', { all: {}, realms: {} });
const features = new Map(); // id -> { id, title, icon, settings: Map(key -> def) }

function register(id, def) {
  const f = { id, title: def.title || id, icon: def.icon || '⚙️', about: def.about || '', settings: new Map() };
  f.settings.set('on', { label: `${f.title} is switched on`, def: def.defaultOn !== false, kind: 'bool', switch: true });
  for (const [key, s] of Object.entries(def.settings || {})) f.settings.set(key, { kind: 'int', ...s });
  features.set(id, f);
  return f;
}

// a feature (or a later phase) can add more settings to a feature that exists already
function extend(id, key, s) {
  const f = features.get(id);
  if (!f) throw new Error(`Unknown realm feature: ${id}`);
  f.settings.set(key, { kind: 'int', ...s });
}

const defOf = (full) => {
  const [fid, ...rest] = String(full).split('.');
  const f = features.get(fid);
  return f ? f.settings.get(rest.join('.')) || null : null;
};

function get(full, group) {
  const d = defOf(full);
  if (!d) throw new Error(`Unknown realm setting: ${full}`);
  if (group && js.data.realms[group] && full in js.data.realms[group]) return js.data.realms[group][full];
  if (full in js.data.all) return js.data.all[full];
  return d.def;
}

// where a value comes from: 'realm' (set for one realm), 'all' (set for all realms) or 'default'
function sourceOf(full, group) {
  if (group && js.data.realms[group] && full in js.data.realms[group]) return 'realm';
  if (full in js.data.all) return 'all';
  return 'default';
}

// reads the text God typed: "400", "1,000", "2.5", "on", "off", "5%"
function parse(d, text) {
  const t = String(text).trim().toLowerCase().replace(/[,_\s]/g, '').replace(/%$/, '');
  if (d.kind === 'bool') {
    if (['on', 'true', 'yes', '1', 'enable'].includes(t)) return { ok: true, value: true };
    if (['off', 'false', 'no', '0', 'disable'].includes(t)) return { ok: true, value: false };
    return { ok: false, error: 'Use on or off.' };
  }
  const n = Number(t);
  if (!t || !Number.isFinite(n)) return { ok: false, error: 'That is not a number.' };
  if (d.kind === 'int' && !Number.isInteger(n)) return { ok: false, error: 'Use a whole number.' };
  if (n < d.min || n > d.max) return { ok: false, error: `Allowed: ${d.min} to ${d.max}${d.unit ? ` ${d.unit}` : ''}.` };
  return { ok: true, value: d.kind === 'int' ? Math.round(n) : Math.round(n * 1000) / 1000 };
}

// group = null changes it for every realm, a group id only for that realm
function set(full, text, group = null) {
  const d = defOf(full);
  if (!d) return { ok: false, error: 'There is no such setting.' };
  const p = typeof text === 'boolean' || typeof text === 'number' ? { ok: true, value: text } : parse(d, text);
  if (!p.ok) return p;
  const before = get(full, group);
  if (group) (js.data.realms[group] || (js.data.realms[group] = {}))[full] = p.value;
  else js.data.all[full] = p.value;
  js.touch();
  return { ok: true, value: p.value, before };
}

function reset(full, group = null) {
  const d = defOf(full);
  if (!d) return { ok: false, error: 'There is no such setting.' };
  const before = get(full, group);
  if (group) {
    if (js.data.realms[group]) delete js.data.realms[group][full];
  } else {
    delete js.data.all[full];
  }
  js.touch();
  return { ok: true, before, value: get(full, group) };
}

// every override of one realm is removed (used when the realm is wiped)
function resetRealm(group) {
  delete js.data.realms[group];
  js.touch();
}

const featureOn = (id, group) => get(`${id}.on`, group);
const list = () => [...features.values()];
const one = (id) => features.get(id) || null;

// "core.dailyBase" or just "dailyBase" (when only one feature has it) or "core dailyBase"
function find(text) {
  const t = String(text || '').trim().replace(/\s+/g, '.').toLowerCase();
  if (!t) return null;
  for (const f of features.values()) {
    for (const key of f.settings.keys()) if (`${f.id}.${key}`.toLowerCase() === t) return { full: `${f.id}.${key}`, def: f.settings.get(key), feature: f };
  }
  const hits = [];
  for (const f of features.values()) for (const key of f.settings.keys()) if (key.toLowerCase() === t) hits.push({ full: `${f.id}.${key}`, def: f.settings.get(key), feature: f });
  return hits.length === 1 ? hits[0] : null;
}

const show = (d, v) => (d.kind === 'bool' ? (v ? 'on' : 'off') : `${Number(v).toLocaleString('en-US')}${d.unit ? ` ${d.unit}` : ''}`);

module.exports = { extend, register, get, set, reset, resetRealm, featureOn, list, one, find, defOf, sourceOf, show, parse };
