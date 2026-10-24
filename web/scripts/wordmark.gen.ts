// Generates wordmark.data.ts: overlap-free outlines of "homecookd" for the footer wordmark (brief 8.13).
//
//   node scripts/wordmark.gen.ts        (Node ≥ 23.6 runs .ts directly; writes the Footer's wordmark.data.ts)
//
// Why not live text: Fraunces is a variable font whose glyphs keep overlapping contours (the "e"
// crossbar, the bowls of "o" and "d"). Any stroke-based erosion of live text (-webkit-text-stroke,
// or an SVG <text> mask) strokes those inner contours too and cuts visible notches through the
// letters mid-animation, in Chrome and Safari alike. So we render the word once in headless Chrome
// with the exact shipped settings (Fraunces v38, weight 800, SOFT 100, WONK 0, opsz 144, −0.01em),
// trace each letter's 50% coverage contour (d3-contour, sub-pixel), simplify it (≤ 0.3 units) and
// ship plain SVG paths. Units: 1 em = 1000. Stroking those paths in the footer color erodes them
// exactly like the a3 Savor reference (a round-joined stroke = erosion by a disk).
//
// It also measures each letter's thickest point (Euclidean distance transform), so the animation
// starts from a stroke that hides every letter completely and the thickest stem shows first.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { contours } from 'd3-contour';

const WORD = 'homecookd';
const FS = 1000;
const PAD = 120;
const VW = Math.ceil(FS * 0.7 * WORD.length) + PAD * 2; // ≈ 0.6em per letter at weight 800, plus slack
const VH = Math.ceil(FS * 1.2) + PAD * 2;
const TOLERANCE = 0.3;
const FONT_URL = 'https://fonts.gstatic.com/s/fraunces/v38/6NUV8FyLNQOQZAnv9ZwIlOkuy91B.woff2'; // = next/font's latin file
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const here = join(dirname(fileURLToPath(import.meta.url)), '../src/components/sections/Footer');
const work = mkdtempSync(join(tmpdir(), 'wordmark-'));

async function main() {
  const font = Buffer.from(await (await fetch(FONT_URL)).arrayBuffer());
  writeFileSync(join(work, 'font.woff2'), font);
  writeFileSync(
    join(work, 'index.html'),
    `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:W;src:url(font.woff2) format('woff2');font-weight:100 900;font-display:block}
html,body{margin:0;background:#fff}
#w{position:absolute;left:${PAD}px;top:${PAD}px;font:800 ${FS}px/1 W;font-variation-settings:'SOFT' 100,'WONK' 0,'opsz' 144;letter-spacing:-0.01em;color:#000;white-space:nowrap}
#out{position:absolute;left:-99999px}
</style><span id="w">${WORD}</span><pre id="out"></pre>
<script>
document.fonts.load('800 ${FS}px W').then(function(){
  var t=document.getElementById('w').firstChild, r=document.createRange(), chars=[];
  for(var i=0;i<t.length;i++){r.setStart(t,i);r.setEnd(t,i+1);var b=r.getBoundingClientRect();chars.push([b.left,b.right]);}
  document.getElementById('out').textContent=JSON.stringify({ok:document.fonts.check('800 ${FS}px W'),chars:chars});
});
</script>`,
  );
  const url = `file://${join(work, 'index.html')}`;
  const flags = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${VW},${VH}`, '--virtual-time-budget=8000'];
  const dom = execFileSync(CHROME, [...flags, '--dump-dom', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const meta = JSON.parse(/<pre id="out">([^<]*)<\/pre>/.exec(dom)?.[1] ?? 'null') as { ok: boolean; chars: [number, number][] } | null;
  if (!meta?.ok) throw new Error('Font did not load in headless Chrome');
  const right = Math.max(...meta.chars.map(([, r]) => r));
  if (right > VW - PAD / 2) throw new Error(`"${WORD}" is wider than the capture (${Math.round(right)} > ${VW - PAD / 2}px): raise VW`);
  execFileSync(CHROME, [...flags, `--screenshot=${join(work, 'shot.png')}`, url], { stdio: 'ignore' });

  const { data, info } = await sharp(readFileSync(join(work, 'shot.png'))).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const cov = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) cov[i] = (255 - data[i]) / 255;

  // Connected components (8-way) of any ink, assigned to letters by their centroid.
  const label = new Int32Array(w * h).fill(-1);
  const comps: { x0: number; y0: number; x1: number; y1: number; letter: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (cov[start] <= 0.01 || label[start] !== -1) continue;
    const id = comps.length;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sw = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      sx += px * cov[p]; sw += cov[p];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (cov[q] > 0.01 && label[q] === -1) { label[q] = id; stack.push(q); }
        }
    }
    const cx = sx / sw;
    let letter = meta.chars.findIndex(([l, r]) => cx >= l && cx < r);
    if (letter < 0) letter = meta.chars.reduce((best, [l, r], i) => (Math.abs((l + r) / 2 - cx) < Math.abs((meta.chars[best][0] + meta.chars[best][1]) / 2 - cx) ? i : best), 0);
    comps.push({ x0, y0, x1, y1, letter });
  }

  type Pt = [number, number];
  const letters: { ch: string; rings: Pt[][]; r: number }[] = [];
  for (let li = 0; li < WORD.length; li++) {
    const mine = comps.map((c, i) => ({ ...c, i })).filter((c) => c.letter === li);
    if (!mine.length) throw new Error(`No ink for letter ${li}`);
    const cx0 = Math.min(...mine.map((c) => c.x0)) - 2;
    const cy0 = Math.min(...mine.map((c) => c.y0)) - 2;
    const cw = Math.max(...mine.map((c) => c.x1)) + 3 - cx0;
    const ch = Math.max(...mine.map((c) => c.y1)) + 3 - cy0;
    const ids = new Set(mine.map((c) => c.i));
    const vals = new Float64Array(cw * ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const p = (y + cy0) * w + (x + cx0);
        vals[y * cw + x] = ids.has(label[p]) ? cov[p] : 0;
      }
    const geo = contours().size([cw, ch]).thresholds([0.5])(Array.from(vals))[0];
    const rings: Pt[][] = [];
    for (const poly of geo.coordinates)
      for (const ring of poly) rings.push(simplifyRing(ring.map(([x, y]) => [x + cx0, y + cy0] as Pt), TOLERANCE));
    letters.push({ ch: WORD[li], rings, r: maxInscribedRadius(vals, cw, ch) });
  }

  // Ink box of the whole word → viewBox origin.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of letters) for (const ring of l.rings) for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const out = letters.map((l) => {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    const d = l.rings
      .map((ring) => {
        const pts = ring.map(([x, y]) => [r1(x - minX), r1(y - minY)] as Pt);
        for (const [x, y] of pts) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
        let s = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}l`;
        for (let i = 1; i < pts.length; i++) s += pair(r1(pts[i][0] - pts[i - 1][0]), r1(pts[i][1] - pts[i - 1][1]));
        return s + 'z';
      })
      .join('');
    return { ch: l.ch, d, box: [bx0, by0, r1(bx1 - bx0), r1(by1 - by0)], r: r1(l.r) };
  });
  const maxStroke = Math.ceil(2 * Math.max(...letters.map((l) => l.r)) + 4);
  const file = `// GENERATED by scripts/wordmark.gen.ts (Fraunces v38 · 800 · SOFT 100 · WONK 0 · opsz 144 · −0.01em). Do not edit by hand.
// Units: 1 em = 1000. Each letter is an overlap-free outline (fill-rule evenodd); \`r\` is its thickest
// point's half-width, \`box\` its ink box [x, y, w, h]. \`maxStroke\` hides every letter completely.
export const WORDMARK = {
  width: ${r1(maxX - minX)},
  height: ${r1(maxY - minY)},
  maxStroke: ${maxStroke},
  letters: [
${out.map((l) => `    { ch: '${l.ch}', box: [${l.box.join(', ')}], r: ${l.r}, d: '${l.d}' },`).join('\n')}
  ],
} as const;
`;
  writeFileSync(join(here, 'wordmark.data.ts'), file);
  console.log(`wordmark: ${r1(maxX - minX)} × ${r1(maxY - minY)}, maxStroke ${maxStroke}, ${(file.length / 1024).toFixed(1)} KB, points ${letters.reduce((n, l) => n + l.rings.reduce((m, r) => m + r.length, 0), 0)}`);
  for (const l of out) console.log(`  ${l.ch}: box ${l.box.join(', ')}  r ${l.r}`);
}

function fmt(n: number): string {
  return String(n).replace(/^(-?)0\./, '$1.');
}
function pair(dx: number, dy: number): string {
  const a = fmt(dx);
  const b = fmt(dy);
  return (a.startsWith('-') ? a : ' ' + a) + (b.startsWith('-') ? b : ' ' + b);
}

/** Ramer–Douglas–Peucker on a closed ring (drops the repeated closing point). */
function simplifyRing(ring: [number, number][], tol: number): [number, number][] {
  const pts = ring.slice(0, -1);
  if (pts.length < 8) return pts;
  let far = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), tol);
  const b = rdp([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
function rdp(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1e-9;
  let idx = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), tol).slice(0, -1), ...rdp(pts.slice(idx), tol)];
}

/** Max Euclidean distance from an ink pixel (coverage ≥ .5) to the nearest non-ink pixel (Felzenszwalb EDT). */
function maxInscribedRadius(vals: Float64Array, w: number, h: number): number {
  const INF = 1e12;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = vals[i] >= 0.5 ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; pass(h); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  let best = 0;
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; pass(w); for (let x = 0; x < w; x++) best = Math.max(best, d[x]); }
  return Math.sqrt(best);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
