// PDF maker: text or pictures to PDF, and joining PDFs.
//   pdf <text>                 text to PDF (or reply to a text message with: pdf)
//   pdf  (with / replying to a picture)   the picture as a PDF
//   pdf add  (picture or PDF)  puts a file in your list; pdf list; pdf clear
//   pdf make [name]            ONE PDF from your list, in the order you added (pictures become pages, PDFs are joined)
// The list is kept on disk (data/pdf-queue), so it is still there after a restart. It is cleared after 2 hours.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('../core/paths');
const pdfmaker = require('../core/pdfmaker');
const media = require('../whatsapp/media');
const { getQuoted, quotedText } = require('../whatsapp/utils');

const QUEUE_DIR = path.join(DATA, 'pdf-queue');
const MAX_FILES = 15;
const MAX_BYTES = 30 * 1024 * 1024;
const KEEP_MS = 2 * 60 * 60 * 1000;

const dirFor = (jid, who) => path.join(QUEUE_DIR, crypto.createHash('sha1').update(`${jid}|${who}`).digest('hex').slice(0, 16));

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => /^\d+\.(pdf|img)$/.test(f)).sort().map((f) => ({ f, full: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtimeMs }));
  } catch (err) {
    return [];
  }
}

// forgets lists that nobody touched for 2 hours (also other people's old lists)
function sweep() {
  try {
    for (const d of fs.readdirSync(QUEUE_DIR)) {
      const full = path.join(QUEUE_DIR, d);
      const files = listFiles(full);
      if (!files.length || Date.now() - Math.max(...files.map((x) => x.at)) > KEEP_MS) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch (err) {
    // no list folder yet
  }
}

// what the person gave: { kind: 'image' | 'pdf', source } from the message itself or the one it replies to
function findFile(msg, jid, botIds) {
  const img = media.findMedia(msg, jid, botIds);
  if (img && img.kind === 'image') return img;
  const holders = [{ m: media.unwrap(msg.message), source: msg }];
  const q = getQuoted(msg);
  if (q) {
    holders.push({
      m: media.unwrap(q.message),
      source: { key: { remoteJid: jid, id: q.id, participant: q.participant, fromMe: botIds.includes(String(q.participant || '').split('@')[0].split(':')[0]) }, message: q.message },
    });
  }
  for (const h of holders) {
    const d = h.m && h.m.documentMessage;
    if (d && (/pdf/i.test(d.mimetype || '') || /\.pdf$/i.test(d.fileName || ''))) return { kind: 'pdf', source: h.source };
  }
  return null;
}

const looksPdf = (b) => b.length > 8 && b.subarray(0, 1024).toString('latin1').includes('%PDF-');

async function send(sock, jid, msg, buffer, name) {
  const safe = String(name || 'document').replace(/[^\w\- ]+/g, '').trim().slice(0, 50) || 'document';
  return sock.sendMessage(jid, { document: buffer, mimetype: 'application/pdf', fileName: `${safe}.pdf` }, { quoted: msg });
}

module.exports = {
  name: 'pdf',
  aliases: ['topdf', 'makepdf'],
  category: 'media',
  slow: true,
  weight: 'medium',
  needs: [],
  description: 'Make a PDF from text or pictures, or join PDFs: pdf <text>, pdf add / pdf make',
  async run({ sock, jid, msg, args, rest, reply, prefix, botIds, myIds, isOwner }) {
    const who = (myIds && myIds[0]) || jid;
    const dir = dirFor(jid, who);
    const sub = String(args[0] || '').toLowerCase();
    sweep();

    const help = [
      '📄 *PDF maker*',
      `▸ *${prefix}pdf your text* - text to PDF (or reply to a text message)`,
      `▸ send or reply to a picture with *${prefix}pdf* - picture to PDF`,
      `▸ *${prefix}pdf add* (picture or PDF) - add to your list`,
      `▸ *${prefix}pdf make [name]* - join the list into one PDF`,
      `▸ *${prefix}pdf list* / *${prefix}pdf clear*`,
    ].join('\n');

    try {
      if (sub === 'clear') {
        fs.rmSync(dir, { recursive: true, force: true });
        return reply('🗑️ Your PDF list is empty.');
      }
      if (sub === 'list') {
        const files = listFiles(dir);
        if (!files.length) return reply(`Your list is empty. Add files with *${prefix}pdf add*.`);
        return reply(`📄 *Your list (${files.length})*\n${files.map((x, i) => `${i + 1}. ${x.f.endsWith('.pdf') ? 'PDF' : 'Picture'} · ${(x.size / 1024).toFixed(0)} KB`).join('\n')}\n\nJoin them: *${prefix}pdf make*`);
      }

      if (sub === 'add') {
        const found = findFile(msg, jid, botIds);
        if (!found) return reply(`Send or reply to a picture or a PDF with *${prefix}pdf add*.`);
        const files = listFiles(dir);
        if (files.length >= MAX_FILES) return reply(`⚠️ The list is full (${MAX_FILES} files). Use *${prefix}pdf make* or *${prefix}pdf clear*.`);
        const buffer = await media.download(sock, found.source);
        if (found.kind === 'pdf' && !looksPdf(buffer)) return reply('⚠️ That file is not a readable PDF.');
        if (files.reduce((n, x) => n + x.size, 0) + buffer.length > MAX_BYTES) return reply('⚠️ The list is too big (30 MB). Make the PDF first, or clear the list.');
        if (found.kind === 'pdf') {
          try {
            pdfmaker.pageCount(buffer); // refuse a protected or unreadable PDF now, not at the end
          } catch (err) {
            return reply(`⚠️ ${err.code === 'ENCRYPTED' ? 'That PDF is password-protected, I cannot join it.' : 'I cannot read that PDF.'}`);
          }
        }
        fs.mkdirSync(dir, { recursive: true });
        const next = files.length ? Math.max(...files.map((x) => parseInt(x.f, 10))) + 1 : 1;
        fs.writeFileSync(path.join(dir, `${String(next).padStart(3, '0')}.${found.kind === 'pdf' ? 'pdf' : 'img'}`), buffer);
        return reply(`✅ Added (${files.length + 1} in your list). Add more, or *${prefix}pdf make*.`);
      }

      if (sub === 'make' || sub === 'merge' || sub === 'join') {
        const files = listFiles(dir);
        if (!files.length) return reply(`Your list is empty. Add files with *${prefix}pdf add* first.`);
        await reply('⏳ Making your PDF...');
        const parts = [];
        let run = []; // pictures that follow each other become one block of pages
        const flush = async () => {
          if (run.length) parts.push(await pdfmaker.fromImages(run));
          run = [];
        };
        for (const x of files) {
          const data = fs.readFileSync(x.full);
          if (x.f.endsWith('.pdf')) {
            await flush();
            parts.push(data);
          } else run.push(data);
        }
        await flush();
        const out = parts.length === 1 ? parts[0] : pdfmaker.merge(parts);
        await send(sock, jid, msg, out, rest.slice(4).trim() || 'TurboFex');
        fs.rmSync(dir, { recursive: true, force: true });
        return null;
      }

      // ----- one picture, or text -----
      const found = findFile(msg, jid, botIds);
      if (found && found.kind === 'image') {
        await reply('⏳ Making your PDF...');
        const buffer = await media.download(sock, found.source);
        return await send(sock, jid, msg, await pdfmaker.fromImages([buffer]), 'picture');
      }
      if (found && found.kind === 'pdf') {
        return reply(`That is already a PDF. To join PDFs: *${prefix}pdf add* on each one, then *${prefix}pdf make*.`);
      }
      const text = rest || quotedText(getQuoted(msg));
      if (!text.trim()) return reply(help);
      return await send(sock, jid, msg, pdfmaker.fromText(text), 'text');
    } catch (err) {
      if (err.code === 'NEED_SHARP') return reply(isOwner ? '⚠️ PNG and other picture types need the "sharp" package (JPEG works without it).' : '⚠️ I can only use JPEG pictures here.');
      if (err.code === 'TOO_BIG') return reply(`⚠️ ${err.message}`);
      if (['ENCRYPTED', 'UNSUPPORTED', 'NOT_PDF', 'BAD_IMAGE', 'EMPTY'].includes(err.code)) return reply(`⚠️ ${err.message}`);
      console.error('pdf failed:', err.message);
      return reply(`⚠️ I could not make that PDF.${isOwner ? `\nReason: ${String(err.message).slice(0, 120)}` : ' Try another file.'}`);
    }
  },
};
