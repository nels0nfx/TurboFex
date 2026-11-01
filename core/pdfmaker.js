// Makes PDF files without any extra package: text to PDF, pictures to PDF, and joining PDFs into one.
// Joining reads normal PDFs (also the ones with compressed object streams). Password-protected PDFs are refused.
const zlib = require('zlib');

const A4 = [595, 842];
const MARGIN = 50;
const err = (code, message) => Object.assign(new Error(message), { code });

// ----- building a file from numbered objects -----
function build(objects, rootNum) {
  // objects: Map(number -> Buffer | string body, without "N 0 obj" and "endobj")
  const parts = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let pos = parts[0].length;
  const offsets = new Map();
  const max = Math.max(...objects.keys());
  for (let n = 1; n <= max; n++) {
    if (!objects.has(n)) continue;
    const body = objects.get(n);
    const head = Buffer.from(`${n} 0 obj\n`, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    const chunk = Buffer.concat([head, Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), tail]);
    offsets.set(n, pos);
    parts.push(chunk);
    pos += chunk.length;
  }
  let xref = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= max; n++) xref += offsets.has(n) ? `${String(offsets.get(n)).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
  xref += `trailer\n<< /Size ${max + 1} /Root ${rootNum} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

const stream = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);

// ----- text to PDF -----
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
// only the Western characters of the standard font; anything else becomes "?"
const latin = (s) => Array.from(String(s).replace(/\t/g, '    ').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-'))
  .map((c) => (c.charCodeAt(0) < 256 && (c.charCodeAt(0) >= 32 || c === '\n') ? c : '?')).join('');

function wrap(text, width = 90) {
  const lines = [];
  for (const raw of latin(text).split(/\r?\n/)) {
    let line = raw;
    if (!line) lines.push('');
    while (line.length > width) {
      let cut = line.lastIndexOf(' ', width);
      if (cut < width / 2) cut = width;
      lines.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    if (line) lines.push(line);
  }
  return lines;
}

function fromText(text, { title = '' } = {}) {
  if (!String(text || '').trim()) throw err('EMPTY', 'There is no text to put in the PDF.');
  const lines = wrap(String(text).trim());
  if (!lines.length) throw err('EMPTY', 'There is no text to put in the PDF.');
  const perPage = 56;
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((chunk, i) => {
    const pageNum = 4 + i * 2;
    kids.push(`${pageNum} 0 R`);
    let content = `BT /F1 11 Tf 14 TL ${MARGIN} ${A4[1] - MARGIN} Td\n`;
    for (const l of chunk) content += `(${esc(l)}) Tj T*\n`;
    content += 'ET';
    objects.set(pageNum, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNum + 1} 0 R >>`);
    objects.set(pageNum + 1, stream('', Buffer.from(content, 'latin1')));
  });
  objects.set(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);
  if (title) {
    const n = 4 + pages.length * 2;
    objects.set(n, `<< /Title (${esc(latin(title).slice(0, 100))}) /Producer (TurboFex) >>`);
  }
  return build(objects, 1);
}

// ----- pictures to PDF -----
// the size and colours of a JPEG file, or null when it is not one
function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), comps: buf[i + 9], progressive: marker === 0xc2 };
    }
    i += 2 + len;
  }
  return null;
}

// makes any picture a JPEG: JPEG files are used as they are, the rest needs "sharp"
async function toJpeg(buf) {
  if (jpegInfo(buf)) return buf;
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    throw err('NEED_SHARP', 'sharp is not installed');
  }
  return sharp(buf).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
}

async function fromImages(buffers) {
  if (!buffers.length) throw err('EMPTY', 'There is no picture to put in the PDF.');
  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = [];
  let n = 3;
  for (const raw of buffers) {
    const jpg = await toJpeg(raw);
    const info = jpegInfo(jpg);
    if (!info || !info.width || !info.height) throw err('BAD_IMAGE', 'That picture could not be read.');
    const cs = info.comps === 1 ? '/DeviceGray' : info.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const [pw, ph] = info.width > info.height ? [A4[1], A4[0]] : A4;
    const scale = Math.min((pw - 40) / info.width, (ph - 40) / info.height, 1.5);
    const w = info.width * scale;
    const h = info.height * scale;
    const x = (pw - w) / 2;
    const y = (ph - h) / 2;
    const img = n;
    const content = n + 1;
    const page = n + 2;
    n += 3;
    objects.set(img, stream(`/Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${info.comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''}`, jpg));
    objects.set(content, stream('', Buffer.from(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`, 'latin1')));
    objects.set(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`);
    kids.push(`${page} 0 R`);
  }
  objects.set(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
  return build(objects, 1);
}

// ----- reading a PDF (only what joining needs) -----
function parse(buf) {
  const s = buf.toString('latin1');
  if (!s.includes('%PDF-')) throw err('NOT_PDF', 'That is not a PDF file.');
  if (/\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(s)) throw err('ENCRYPTED', 'That PDF is password-protected.');
  const objs = new Map();
  const re = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    let end = s.indexOf('endobj', start);
    if (end === -1) end = s.length;
    const sm = /(\r?\n|\r)?stream\r?\n/.exec(s.slice(start, end));
    let dict;
    let data = null;
    if (sm && s.slice(start, start + sm.index).includes('>>')) {
      const dictEnd = start + sm.index;
      dict = s.slice(start, dictEnd).trim();
      const dataStart = start + sm.index + sm[0].length;
      let dataEnd = s.indexOf('endstream', dataStart);
      if (dataEnd === -1) dataEnd = end;
      let e = dataEnd;
      if (s[e - 1] === '\n') e -= 1;
      if (s[e - 1] === '\r') e -= 1;
      data = buf.subarray(dataStart, e);
      end = s.indexOf('endobj', dataEnd);
      if (end === -1) end = s.length;
    } else {
      dict = s.slice(start, end).trim();
    }
    objs.set(num, { dict, data });
    re.lastIndex = Math.max(re.lastIndex, end);
  }
  // objects packed inside compressed object streams
  for (const [num, o] of [...objs]) {
    if (!o.data || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    if (!/\/Filter\s*\/FlateDecode/.test(o.dict) || /\/DecodeParms/.test(o.dict)) {
      if (/\/Filter/.test(o.dict)) throw err('UNSUPPORTED', 'That PDF uses a format I cannot join.');
    }
    let text;
    try {
      text = (/\/Filter/.test(o.dict) ? zlib.inflateSync(o.data) : o.data).toString('latin1');
    } catch (e) {
      throw err('UNSUPPORTED', 'That PDF is damaged or uses a format I cannot join.');
    }
    const n = Number((/\/N\s+(\d+)/.exec(o.dict) || [])[1]);
    const first = Number((/\/First\s+(\d+)/.exec(o.dict) || [])[1]);
    const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const id = nums[i * 2];
      const off = nums[i * 2 + 1];
      const next = i + 1 < n ? nums[(i + 1) * 2 + 1] : text.length - first;
      if (!objs.has(id) || !objs.get(id).dict) objs.set(id, { dict: text.slice(first + off, first + next).trim(), data: null });
    }
    objs.delete(num);
  }
  return objs;
}

const refsOf = (dict) => [...dict.matchAll(/(\d+)\s+\d+\s+R\b/g)].map((x) => Number(x[1]));
const INHERIT = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

// the pages of a document in order: [{ num, dict }] (inherited page settings are copied into each page)
function pagesOf(objs) {
  let catalog = null;
  for (const o of objs.values()) {
    if (/\/Type\s*\/Catalog\b/.test(o.dict) && /\/Pages\s+\d+\s+\d+\s+R/.test(o.dict)) catalog = o;
  }
  if (!catalog) throw err('UNSUPPORTED', 'I could not find the pages of that PDF.');
  const root = Number(/\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog.dict)[1]);
  const out = [];
  const walk = (num, inherited, depth) => {
    const o = objs.get(num);
    if (!o || depth > 40) return;
    const own = { ...inherited };
    for (const key of INHERIT) {
      const mm = new RegExp(`/${key}\\s*(\\[[^\\]]*\\]|\\d+\\s+\\d+\\s+R|<<(?:[^<>]|<<[^<>]*>>)*>>|-?\\d+)`).exec(o.dict);
      if (mm) own[key] = mm[1];
    }
    if (/\/Type\s*\/Pages\b/.test(o.dict) || /\/Kids\s*\[/.test(o.dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
      for (const k of kids ? refsOf(kids[1]) : []) walk(k, own, depth + 1);
    } else {
      let dict = o.dict.replace(/\/Parent\s+\d+\s+\d+\s+R/, '');
      for (const key of INHERIT) if (own[key] && !new RegExp(`/${key}\\b`).test(dict)) dict = dict.replace(/>>\s*$/, `/${key} ${own[key]} >>`);
      out.push({ num, dict });
    }
  };
  walk(root, {}, 0);
  if (!out.length) throw err('UNSUPPORTED', 'That PDF has no pages.');
  return out;
}

function pageCount(buf) {
  return pagesOf(parse(buf)).length;
}

// joins PDFs (in the given order) into one
function merge(buffers) {
  if (buffers.length < 1) throw err('EMPTY', 'There is no PDF to join.');
  const out = new Map();
  const kids = [];
  let next = 3; // 1 = catalog, 2 = pages
  for (const buf of buffers) {
    const objs = parse(buf);
    const pages = pagesOf(objs);
    const map = new Map(); // old number -> new number
    const take = (old) => {
      if (map.has(old)) return map.get(old);
      const id = next++;
      map.set(old, id);
      return id;
    };
    const queue = [];
    const bodies = new Map();
    for (const p of pages) {
      take(p.num);
      queue.push(p.num);
      bodies.set(p.num, { dict: p.dict, data: objs.get(p.num).data });
      kids.push(map.get(p.num));
    }
    while (queue.length) {
      const old = queue.shift();
      const o = bodies.get(old) || objs.get(old);
      if (!o) continue;
      bodies.set(old, o);
      for (const r of refsOf(o.dict)) {
        if (!objs.has(r) || map.has(r)) continue;
        const target = objs.get(r);
        if (/\/Type\s*\/(Pages|Catalog)\b/.test(target.dict)) continue; // never the old page tree
        take(r);
        queue.push(r);
      }
    }
    for (const [old, id] of map) {
      const o = bodies.get(old);
      const dict = o.dict.replace(/(\d+)\s+(\d+)\s+R\b/g, (all, n) => (map.has(Number(n)) ? `${map.get(Number(n))} 0 R` : '0 0 R'));
      out.set(id, o.data ? Buffer.concat([Buffer.from(`${dict}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream', 'latin1')]) : dict);
    }
  }
  for (const [id, body] of out) {
    if (!Buffer.isBuffer(body)) continue;
    void id;
  }
  // pages get their new parent
  for (const k of kids) {
    const body = out.get(k);
    const text = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
    const head = text.toString('latin1', 0, Math.min(text.length, 4000));
    const closeAt = head.lastIndexOf('>>', head.indexOf('\nstream') === -1 ? head.length : head.indexOf('\nstream'));
    const patched = Buffer.concat([text.subarray(0, closeAt), Buffer.from('/Parent 2 0 R ', 'latin1'), text.subarray(closeAt)]);
    out.set(k, patched);
  }
  out.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  out.set(2, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  return build(out, 1);
}

module.exports = { fromText, fromImages, merge, pageCount, jpegInfo };
