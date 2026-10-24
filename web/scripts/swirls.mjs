#!/usr/bin/env node
// VERO topographic swirl patterns (brief 7.1). simplex-noise (scale 0.0014 on 1600×1000, 1 octave:
// fewer, broader bands that stay calm behind body copy)
// + d3-contour thresholds every 0.11, filling every other band, in the *-swirl token color on
// transparent. Writes public/patterns/swirl-{green,forest,sun,chartreuse}.svg (≤ 30KB each).
//   node scripts/swirls.mjs [--force]
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNoise2D } from 'simplex-noise';
import { contours } from 'd3-contour';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'patterns');
const FORCE = process.argv.includes('--force');
mkdirSync(OUT, { recursive: true });

const W = 1600;
const H = 1000;
const STEP = 12; // grid resolution in px (keeps files small)
const GW = Math.ceil(W / STEP) + 1;
const GH = Math.ceil(H / STEP) + 1;

const COLORS = {
  green: '#64790A',
  forest: '#3D4E10',
  sun: '#FFCB4F',
  chartreuse: '#D9E65A',
};
const SEEDS = { green: 7, forest: 21, sun: 3, chartreuse: 11 };

// Ramer–Douglas–Peucker simplification (tolerance in px)
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let idx = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/** Rings smaller than this (px², ≈ a 32px blob) are specks that read as noise: drop them. */
const MIN_RING_AREA = 1000;

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2) * STEP * STEP;
}

function ringPath(ring) {
  if (ringArea(ring) < MIN_RING_AREA) return '';
  const raw = ring.map(([x, y]) => [x * STEP, y * STEP]);
  // closed ring: simplify the two halves separately (rdp needs distinct end points)
  const mid = Math.floor(raw.length / 2);
  const pts = raw.length < 8 ? raw : [...rdp(raw.slice(0, mid + 1), 1.6).slice(0, -1), ...rdp(raw.slice(mid), 1.6)];
  let d = '';
  let px = 0;
  let py = 0;
  pts.forEach(([x, y], i) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    d += i === 0 ? `M${rx} ${ry}` : `l${rx - px} ${ry - py}`;
    px = rx;
    py = ry;
  });
  return d + 'z';
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const [name, color] of Object.entries(COLORS)) {
  const file = path.join(OUT, `swirl-${name}.svg`);
  if (existsSync(file) && !FORCE) {
    console.log('[swirls] skip', name);
    continue;
  }
  const noise = createNoise2D(mulberry32(SEEDS[name]));
  const values = new Float64Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const x = i * STEP;
      const y = j * STEP;
      const s = 0.0014;
      // 1 octave, normalized to ~[0, 1]
      const v = noise(x * s, y * s);
      values[j * GW + i] = (v + 1) / 2;
    }
  }
  const thresholds = [];
  for (let t = 0.11; t < 1; t += 0.11) thresholds.push(+t.toFixed(2));
  const polys = contours().size([GW, GH]).smooth(true).thresholds(thresholds)(Array.from(values));
  // Band k = (contour k) minus (contour k+1); fill every other band with evenodd.
  const paths = [];
  for (let k = 0; k < polys.length - 1; k += 2) {
    const d = [polys[k], polys[k + 1]]
      .map((mp) =>
        mp.coordinates
          .map((poly) => poly.map(ringPath).join(''))
          .join(''),
      )
      .join('');
    paths.push(`<path d="${d}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><g fill="${color}" fill-rule="evenodd">${paths.join('')}</g></svg>`;
  writeFileSync(file, svg);
  console.log(`[swirls] ${name}: ${(statSync(file).size / 1024).toFixed(1)} KB`);
}
