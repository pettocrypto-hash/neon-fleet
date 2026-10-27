// Erzeugt die PWA-Icons (PNG) prozedural – ohne externe Abhängigkeiten.
// Aufruf: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
const PINK = hex('#ff2bd6'), CYAN = hex('#00f0ff'), VIOLET = hex('#9d4dff'), YELLOW = hex('#f9f871');

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function polyDist(px, py, pts) {
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    d = Math.min(d, segDist(px, py, ax, ay, bx, by));
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -d : d;
}

// Schiff (Interceptor-Pfeil) in Einheitskoordinaten [-1,1], Bug nach oben.
const SHIP = [
  [0, -0.62],
  [0.13, -0.2],
  [0.5, 0.25],
  [0.5, 0.42],
  [0.15, 0.3],
  [0.1, 0.48],
  [-0.1, 0.48],
  [-0.15, 0.3],
  [-0.5, 0.42],
  [-0.5, 0.25],
  [-0.13, -0.2],
];

function render(size, scale, rounded) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3; // Supersampling
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;
          // Hintergrund
          const rr = Math.hypot(u, v);
          let c = [0.03 + 0.12 * Math.max(0, 1 - rr), 0.01 + 0.03 * Math.max(0, 1 - rr), 0.06 + 0.22 * Math.max(0, 1 - rr)];
          // Raster
          const gu = (u / scale) * 4, gv = (v / scale) * 4;
          const gl = Math.min(Math.abs(gu - Math.round(gu)), Math.abs(gv - Math.round(gv)));
          if (gl < 0.025) c = c.map((ch, i) => ch + PINK[i] * 0.12);
          const U = u / scale, V = v / scale;
          const R = Math.hypot(U, V);
          // Neon-Ring mit Glow
          const ringD = Math.abs(R - 0.78);
          const ring = Math.max(0, 1 - ringD / 0.035);
          const ringGlow = Math.exp(-ringD * 14) * 0.6;
          for (let i = 0; i < 3; i++) c[i] += PINK[i] * (ring + ringGlow);
          // Innerer gestrichelter Ring
          const ang = Math.atan2(V, U);
          if (Math.abs(R - 0.68) < 0.012 && Math.sin(ang * 18) > 0) for (let i = 0; i < 3; i++) c[i] += CYAN[i] * 0.7;
          // Schiff
          const sd = polyDist(U, V, SHIP);
          const edge = Math.max(0, 1 - Math.abs(sd) / 0.022);
          const glow = Math.exp(-Math.abs(sd) * 18) * 0.7;
          if (sd < 0) c = c.map((ch, i) => ch * 0.25 + CYAN[i] * 0.12);
          for (let i = 0; i < 3; i++) c[i] += CYAN[i] * (edge + glow);
          // Energiekern + Triebwerk
          const core = Math.exp(-Math.hypot(U, V - 0.08) * 22);
          for (let i = 0; i < 3; i++) c[i] += PINK[i] * core * 1.4 + core * 0.4;
          const eng = Math.exp(-Math.hypot(U * 3, V - 0.6) * 9) * (V > 0.45 ? 1 : 0);
          for (let i = 0; i < 3; i++) c[i] += VIOLET[i] * eng + YELLOW[i] * eng * 0.3;
          // Ecken abrunden (nur nicht-maskable)
          let alpha = 1;
          if (rounded) {
            const k = 0.22;
            const qx = Math.max(Math.abs(u) - (1 - k), 0), qy = Math.max(Math.abs(v) - (1 - k), 0);
            const dd = Math.hypot(qx, qy) - k;
            alpha = Math.max(0, Math.min(1, -dd * size * 0.5 + 0.5));
          }
          r += Math.min(1, c[0]) * alpha;
          g += Math.min(1, c[1]) * alpha;
          b += Math.min(1, c[2]) * alpha;
          a += alpha;
        }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      const A = a / n;
      buf[o] = Math.round((A ? r / a : 0) * 255);
      buf[o + 1] = Math.round((A ? g / a : 0) * 255);
      buf[o + 2] = Math.round((A ? b / a : 0) * 255);
      buf[o + 3] = Math.round(A * 255);
    }
  return png(size, size, buf);
}

writeFileSync(join(out, 'icon-192.png'), render(192, 1, true));
writeFileSync(join(out, 'icon-512.png'), render(512, 1, true));
writeFileSync(join(out, 'icon-maskable-512.png'), render(512, 0.72, false));
writeFileSync(join(out, 'apple-touch-icon.png'), render(180, 0.9, false));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2">
<defs><radialGradient id="b"><stop offset="0" stop-color="#2a0a4a"/><stop offset="1" stop-color="#07020f"/></radialGradient>
<filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.03" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect x="-1" y="-1" width="2" height="2" rx="0.4" fill="url(#b)"/>
<circle r="0.78" fill="none" stroke="#ff2bd6" stroke-width="0.07" filter="url(#g)"/>
<polygon points="${SHIP.map((p) => p.join(',')).join(' ')}" fill="#06101e" stroke="#00f0ff" stroke-width="0.05" stroke-linejoin="round" filter="url(#g)"/>
<circle cy="0.08" r="0.07" fill="#ff2bd6" filter="url(#g)"/>
</svg>`;
writeFileSync(join(out, 'icon.svg'), svg);
console.log('Icons erzeugt in', out);
