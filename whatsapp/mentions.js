// Makes tags show the person's NAME. WhatsApp shows "@Name" only when the tag uses the same kind of id the group uses for
// that member (new groups use hidden "LID" ids, older ones phone numbers). A tag with the other kind shows a bare number
// such as @245771534381197. This rewrites every tag of a message sent to a group (both the hidden list and the @number in
// the text) to the id the group itself uses.
const meta = require('./metadata');
const names = require('./names');
const { num, participantIds } = require('./utils');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function fix(sock, groupJid, content) {
  try {
    if (!content || !Array.isArray(content.mentions) || !content.mentions.length) return content;
    const info = await meta.getMeta(sock, groupJid);
    const members = info?.participants || [];
    if (!members.length) return content;

    const swaps = new Map(); // old number -> number the group uses
    const ids = content.mentions.map((m) => {
      const n = num(m);
      const p = members.find((x) => participantIds(x).includes(n));
      if (!p || !p.id) return m;
      if (num(p.id) !== n) swaps.set(n, num(p.id));
      return p.id;
    });
    if (!swaps.size) return { ...content, mentions: ids };

    const rewrite = (t) => {
      if (typeof t !== 'string') return t;
      let out = t;
      for (const [from, to] of swaps) out = out.replace(new RegExp(`@${esc(from)}(?!\\d)`, 'g'), `@${to}`);
      return out;
    };
    const next = { ...content, mentions: [...new Set(ids)] };
    if ('text' in next) next.text = rewrite(next.text);
    if ('caption' in next) next.caption = rewrite(next.caption);
    return next;
  } catch (err) {
    return content; // the message is sent as it is: a tag that shows a number is better than no message
  }
}

// In a private chat the tags use the person's PHONE NUMBER: WhatsApp then shows the name saved in the phone, or the number.
// A hidden id (LID) cannot be shown that way, so for those the name is written instead (never a long meaningless number).
function inPrivate(content) {
  try {
    if (!content || !Array.isArray(content.mentions) || !content.mentions.length) return content;
    const idmap = require('./idmap');
    const swaps = [];
    const keep = [];
    for (const m of content.mentions) {
      const n = num(m);
      const pn = idmap.isLid(m) ? idmap.pnSync(m) : idmap.isPn(m) ? m : null;
      if (pn) {
        keep.push(pn);
        if (num(pn) !== n) swaps.push([n, `@${num(pn)}`]);
      } else {
        const name = names.get(m);
        swaps.push([n, name ? `*${name}*` : '*a member*']);
      }
    }
    if (!swaps.length && keep.length === content.mentions.length && keep.every((k, i) => k === content.mentions[i])) return content;
    const rewrite = (t) => (typeof t === 'string' ? swaps.reduce((out, [from, to]) => out.replace(new RegExp(`@${esc(from)}(?!\\d)`, 'g'), to), t) : t);
    const next = { ...content, mentions: [...new Set(keep)] };
    if ('text' in next) next.text = rewrite(next.text);
    if ('caption' in next) next.caption = rewrite(next.caption);
    return next;
  } catch (err) {
    return content;
  }
}

// For a list of people in a GROUP reply: members are tagged (WhatsApp shows their name), people who are no longer in the
// group are written as their name. Returns [{ text, mention }] in the same order. A raw number or id is never shown.
async function describe(sock, groupJid, jids) {
  const idmap = require('./idmap');
  let ids = new Set();
  try {
    const info = await meta.getMeta(sock, groupJid);
    ids = new Set((info?.participants || []).flatMap((p) => participantIds(p)));
  } catch (err) {
    // everybody is then written as a name
  }
  return jids.map((j) => {
    const keys = [num(j)];
    const pn = idmap.isLid(j) ? idmap.pnSync(j) : null;
    const lid = idmap.isPn(j) ? idmap.lidSync(j) : null;
    if (pn) keys.push(num(pn));
    if (lid) keys.push(num(lid));
    if (keys.some((k) => ids.has(k))) return { text: `@${num(j)}`, mention: j };
    const name = names.get(j);
    return { text: name ? `*${name}*` : '_a former member_', mention: null };
  });
}

// every number the members of a group can be known by (phone numbers and hidden ids)
async function memberKeys(sock, groupJid) {
  const idmap = require('./idmap');
  const keys = new Set();
  try {
    const info = await meta.getMeta(sock, groupJid);
    for (const p of info?.participants || []) {
      for (const k of participantIds(p)) {
        keys.add(k);
        const pn = idmap.pnSync(`${k}@lid`);
        if (pn) keys.add(num(pn));
      }
    }
  } catch (err) {
    // an empty list: nobody is shown rather than people from other groups
  }
  return keys;
}

module.exports = { fix, inPrivate, describe, memberKeys };
