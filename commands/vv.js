// Reveals a view-once picture, video, voice note or text: reply to it with "vv".
const media = require('../whatsapp/media');
const watchers = require('../whatsapp/watchers');
const clock = require('../core/clock');
const { ownerChat } = require('../whatsapp/owner');
const { getQuoted, num } = require('../whatsapp/utils');
const { peel, findViewOnce } = require('../whatsapp/unwrap');
const vault = require('../whatsapp/vovault');

module.exports = {
  name: 'vv',
  aliases: ['viewonce', 'reveal'],
  category: 'watch',
  slow: true,
  ownerOnly: true,
  needs: [],
  silentOnSticker: true, // run by a sticker (setstickercmd vv): no answer, no reaction in the chat; the file goes to the view-once chat
  weight: 'medium',
  description: 'Open a view-once picture, video, voice note or text: reply to it with vv (vv me = send it to your own chat)',
  async run({ sock, jid, msg, args, reply, prefix, botIds, silent }) {
    const q = getQuoted(msg);
    if (!q) return reply(`Reply to a view-once message with *${prefix}vv*.\n*${prefix}vv me* sends the file to your own chat instead of this one.`);

    const vo = findViewOnce(q.message);
    const inner = peel(q.message).content;
    const kept = vault.get(q.id); // what the bot saved when it arrived: works again and again, also after the phone opened it

    // a view-once TEXT: the words are in the message (a quote of a view-once may be empty, then the complete message seen lately is used)
    const seen = watchers.recentViewOnce(q.id);
    const voFull = seen ? findViewOnce(seen.message) : null;
    if ((kept && kept.kind === 'text') || (vo && vo.kind === 'text') || (voFull && voFull.kind === 'text')) {
      const text = (kept && kept.kind === 'text' && kept.text) || (vo && vo.kind === 'text' && vo.text) || (voFull && voFull.text) || '';
      if (!text) return reply(`⚠️ I do not have the words of that view-once text.\n${watchers.OPEN_ON_PHONE}`);
      const dest = silent ? watchers.dest(sock, require('../whatsapp/store').watchCfg('viewonce'), jid) : (args[0] || '').toLowerCase() === 'me' ? ownerChat(sock) : jid;
      await sock.sendMessage(dest, { text: `👁️ *View-once text opened*\n🕒 ${clock.stamp(Date.now())}\n\n${text}` }, dest === jid && !silent ? { quoted: msg } : undefined);
      if (dest !== jid && !silent) await reply('✅ Sent to your chat.');
      return;
    }
    const node = (kept && kept.kind !== 'text' ? { caption: kept.caption, mimetype: kept.mime, ptt: kept.ptt } : null) || vo?.node || inner.imageMessage || inner.videoMessage || inner.audioMessage;
    if (!node) {
      // a view-once that was opened (on the phone) before the bot could save it: there is nothing left to fetch
      if (peel(q.message).viewOnce) return reply(`⚠️ I could not open that view-once.\n▸ It was opened before I could save it.\n▸ _Ask them to send it again._`);
      return reply('⚠️ That message has no picture, video or voice note in it.');
    }
    const kind = kept && kept.kind !== 'text' ? kept.kind : inner.videoMessage ? 'video' : inner.audioMessage ? 'audio' : 'image';

    // A reply only carries a short copy of the quoted message, and for a view-once the file details can be missing from it.
    // If the bot saw the complete message lately, that one is used.
    const full = !kept && vo?.empty ? watchers.recentViewOnce(q.id) : null;
    const source = full || {
      key: { remoteJid: jid, id: q.id, participant: q.participant, fromMe: botIds.includes(num(q.participant)) },
      message: q.message,
    };
    const fullNode = full ? findViewOnce(full.message)?.node : null;
    // the quote has no file details and the bot never saw the complete message: there is nothing left to fetch
    if (!kept && vo?.empty && !full) return reply(`⚠️ I could not open that view-once.\n▸ It was opened before I could save it.\n▸ _Ask them to send it again._`);
    let buffer;
    try {
      if (kept && kept.buffer) buffer = kept.buffer; // the saved copy: no download
      else if (vo || full) buffer = await vault.obtain(sock, source, { kind, node: fullNode || node }, watchers.fetchMedia); // downloaded now and saved, so the next vv works too
      else buffer = await watchers.fetchMedia(sock, source);
    } catch (err) {
      console.error('vv failed:', err.message);
      return reply(`⚠️ I could not open that file.\nReason: ${String(err.message).slice(0, 100)}\n${watchers.OPEN_ON_PHONE}`);
    }

    if (fullNode) Object.assign(node, { caption: node.caption || fullNode.caption, mimetype: node.mimetype || fullNode.mimetype, ptt: node.ptt ?? fullNode.ptt });
    // by sticker: to the chat chosen with viewoncejid (own chat, a chat, or the chat where it was sent); typed: here, or "me"
    const to = silent ? watchers.dest(sock, require('../whatsapp/store').watchCfg('viewonce'), jid) : (args[0] || '').toLowerCase() === 'me' ? ownerChat(sock) : jid;
    const caption = `👁️ *View-once opened*\n🕒 ${clock.stamp(Date.now())}${node.caption ? `\n\n${node.caption}` : ''}`;
    const opts = to === jid && !silent ? { quoted: msg } : undefined;
    if (kind === 'image') await sock.sendMessage(to, { image: buffer, caption }, opts);
    else if (kind === 'video') await sock.sendMessage(to, { video: buffer, caption }, opts);
    else await sock.sendMessage(to, { audio: buffer, mimetype: node.mimetype || 'audio/ogg; codecs=opus', ptt: !!node.ptt }, opts);
    if (to !== jid && !silent) await reply('✅ Sent to your chat.');
  },
};
