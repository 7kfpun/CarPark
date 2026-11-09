// Generates public/env/sky.hdr: a small procedural equirectangular sky (Radiance RGBE, 128x64).
// Run: node tools/make-sky-hdr.mjs
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';

const W = 128;
const H = 64;
const sunDir = (() => {
  const v = [-30, 50, -20];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

function rgbe(r, g, b) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) return [0, 0, 0, 0];
  const e = Math.ceil(Math.log2(m));
  const s = 256 / 2 ** e;
  return [
    Math.min(255, Math.floor(r * s)),
    Math.min(255, Math.floor(g * s)),
    Math.min(255, Math.floor(b * s)),
    e + 128,
  ];
}

const rows = [];
for (let y = 0; y < H; y++) {
  const row = [];
  const theta = ((y + 0.5) / H) * Math.PI; // 0 = up
  for (let x = 0; x < W; x++) {
    const phi = ((x + 0.5) / W) * Math.PI * 2;
    // three.js equirect: u along -x..; direction convention is close enough for a soft sky.
    const d = [Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi)];
    const up = d[1];
    let c;
    if (up >= 0) c = mix([0.85, 0.92, 1.0], [0.38, 0.6, 1.0], Math.pow(up, 0.6));
    else c = mix([0.85, 0.9, 0.95], [0.3, 0.33, 0.25], Math.min(1, -up * 2.5));
    const dot = Math.max(0, d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2]);
    const glow = Math.pow(dot, 24) * 1.5 + Math.pow(dot, 600) * 40;
    c = [c[0] + glow * 1.0, c[1] + glow * 0.9, c[2] + glow * 0.72];
    row.push(rgbe(...c));
  }
  // New-style RLE scanline (literal runs only): 2 2 hi lo, then each channel as runs of <=128 raw bytes.
  const out = [2, 2, W >> 8, W & 255];
  for (let ch = 0; ch < 4; ch++) {
    for (let i = 0; i < W; i += 128) {
      const n = Math.min(128, W - i);
      out.push(n);
      for (let k = 0; k < n; k++) out.push(row[i + k][ch]);
    }
  }
  rows.push(...out);
}
writeFileSync(
  new URL('../public/env/sky.hdr', import.meta.url),
  Buffer.concat([Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'latin1'), Buffer.from(rows)]),
);
