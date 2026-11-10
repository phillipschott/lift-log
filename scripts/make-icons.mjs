// Generates the PWA / home-screen PNG icons into public/ with no dependencies.
// Run: node scripts/make-icons.mjs
// Design: dark #0e0f11 square, bright #4f8cff dumbbell (same shapes as public/favicon.svg).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = [0x0e, 0x0f, 0x11];
const FG = [0x4f, 0x8c, 0xff];

// Dumbbell in a 64x64 design grid: [x, y, w, h, cornerRadius]
const SHAPES = [
  [20, 29, 24, 6, 2], // bar
  [13, 18, 8, 28, 3], // inner plates
  [43, 18, 8, 28, 3],
  [7, 24, 6, 16, 2], // outer plates
  [51, 24, 6, 16, 2],
];

function inRoundRect(px, py, [x, y, w, h, r]) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

// scale: fraction of the canvas the 64-unit design occupies (maskable icons
// keep the glyph inside the central safe zone).
function render(size, scale) {
  const SS = 4; // supersampling per axis for anti-aliasing
  const px = Buffer.alloc(size * size * 3);
  const unit = (size * scale) / 64;
  const off = (size - 64 * unit) / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (i + (sx + 0.5) / SS - off) / unit;
          const v = (j + (sy + 0.5) / SS - off) / unit;
          if (SHAPES.some((s) => inRoundRect(u, v, s))) hits++;
        }
      }
      const a = hits / (SS * SS);
      const k = (j * size + i) * 3;
      for (let c = 0; c < 3; c++) px[k + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
    }
  }
  return encodePNG(size, size, px);
}

// --- minimal PNG encoder (8-bit RGB, no alpha: iOS fills transparency with black anyway)
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const icons = [
  ['icon-180.png', 180, 0.86],
  ['icon-192.png', 192, 0.86],
  ['icon-512.png', 512, 0.86],
  ['icon-512-maskable.png', 512, 0.62], // fits the 80% safe-zone circle
];
for (const [name, size, scale] of icons) {
  writeFileSync(join(OUT, name), render(size, scale));
  console.log(`wrote public/${name}`);
}
