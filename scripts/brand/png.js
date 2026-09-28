/**
 * Just enough PNG to trim and recolour the brand assets — no dependency.
 *
 * `sharp` is not installed and adding an image library for two one-off asset
 * steps is not worth it: Node's own zlib inflates and deflates the image data,
 * and everything between is arithmetic. Handles 8-bit non-interlaced RGB/RGBA,
 * which is what every file in public/images is.
 */
const fs = require('fs');
const zlib = require('zlib');

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

function readChunks(buf) {
  const out = []; let p = 8;
  while (p < buf.length) { const len = buf.readUInt32BE(p); out.push({ type: buf.toString('ascii', p + 4, p + 8), data: buf.subarray(p + 8, p + 8 + len) }); p += 12 + len; }
  return out;
}

function decode(file) {
  const cs = readChunks(fs.readFileSync(file));
  const ihdr = cs.find((c) => c.type === 'IHDR').data;
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], ctype = ihdr[9], interlace = ihdr[12];
  if (depth !== 8 || interlace !== 0 || (ctype !== 6 && ctype !== 2)) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${ctype}, interlace ${interlace})`);
  }
  const bpp = ctype === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++]; const line = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) line[i] = (line[i] + paeth(a, b, c)) & 255;
    }
    line.copy(px, y * stride); prev = line;
  }
  return { w, h, bpp, ctype, px };
}

function encode({ w, h, bpp, ctype, px }) {
  const stride = w * bpp;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ctype;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bounding box of visible pixels: alpha above a floor, or — for RGB — not near-white. */
function bounds({ w, h, bpp, ctype, px }) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * w * bpp + x * bpp;
    const visible = ctype === 6 ? px[o + 3] > 8 : !(px[o] > 245 && px[o + 1] > 245 && px[o + 2] > 245);
    if (visible) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) throw new Error('image is entirely blank');
  return { minX, minY, maxX, maxY };
}

module.exports = { decode, encode, bounds };
