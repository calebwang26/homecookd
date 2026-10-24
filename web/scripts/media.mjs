#!/usr/bin/env node
// Media pipeline (brief section 7.1). Idempotent: skips outputs that already exist unless --force.
//   node scripts/media.mjs           # everything
//   node scripts/media.mjs --force   # rebuild everything
//   node scripts/media.mjs --only=covers,posters,hand,video,hero,icons,webp,report
//
// 1. Copy the real app covers from ../data/synthetic/posters → public/media/app-covers/
// 2. WebP at 160/320/480/640/960/1280/1920 for every jpg/png in public/media/{stock,app-covers,app}
//    → public/media/_opt/<dir>/<name>-<w>.webp. A width larger than the source is written at the
//    source's own width (never upscaled) so the image loader can always round up blindly.
//    Quality starts at 78 and steps down (72 → 66 → 60) only when a file is over its width's budget
//    (brief 11: cards 640w ≤ 60KB, tiles 320w ≤ 25KB, photos 1280w ≤ 180KB). Alpha PNGs stay at 78.
// 3. A pre-blurred 96px `-blur.webp` for each photo-*.jpg (a6 mobile layer).
// 4. Extra app posters: app-record-add.jpg (11.5s: "Sunday dumplings" typed, Grandma picked, no tap
//    ring; 9.5s in the brief is mid-typing) and app-share-end.jpg (last frame).
// 4b. hand-phone-clean.png: the hand cutout with its light background fringe removed (see the step).
// 5. Hero loop seam check (SSIM first vs last frame); writes *-loop.mp4 with a 0.6s crossfade if < 0.9,
//    plus hero-loop-poster(-mobile).jpg = frame 0 of each loop file (so poster → video never jumps).
// 6. Hero contrast check: prints the max YAVG of the bottom-left text area.
// 7. src/app/apple-icon.png: 180×180, the pot mascot (src/app/icon.svg) on --canvas.
// 8. Budget report: every _opt file over its width budget, and the hero posters vs the LCP budget.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const MEDIA = path.join(PUB, 'media');
const OPT = path.join(MEDIA, '_opt');
const FFMPEG = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const FFPROBE = existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';

const FORCE = process.argv.includes('--force');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const run = (step) => !ONLY || ONLY.has(step);

export const WIDTHS = [160, 320, 480, 640, 960, 1280, 1920];
/** KB per output width (brief 11). The 1920 bucket only serves full-bleed photos and the hero poster. */
export const BUDGET_KB = { 160: 10, 320: 25, 480: 42, 640: 60, 960: 110, 1280: 180, 1920: 260 };
const QUALITIES = [78, 72, 66, 60];
/** app-record.mp4 frame for the "Add a recipe" still (typed + Grandma picked, no tap ring) */
const RECORD_ADD_AT = 11.5;
const need = (out) => FORCE || !existsSync(out);
const log = (...a) => console.log('[media]', ...a);

// 1. App covers
if (run('covers')) {
  const src = path.resolve(ROOT, '../data/synthetic/posters');
  const dst = path.join(MEDIA, 'app-covers');
  mkdirSync(dst, { recursive: true });
  const names = [
    'grandma-hand-pulled-noodle-soup',
    'grandma-red-braised-pork',
    'dad-sunday-chili',
    'dad-ginger-scallion-fish',
    'auntie-lin-scallion-pancakes',
  ];
  for (const n of names) {
    const from = path.join(src, `${n}.jpg`);
    const to = path.join(dst, `${n}.jpg`);
    if (!existsSync(from)) { log('MISSING cover', from); continue; }
    if (need(to)) { copyFileSync(from, to); log('cover', n); }
  }
}

// 4. Extra app posters (before webp so they get optimized too)
if (run('posters')) {
  const app = path.join(MEDIA, 'app');
  const add = path.join(app, 'app-record-add.jpg');
  if (need(add) && existsSync(path.join(app, 'app-record.mp4'))) {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(RECORD_ADD_AT), '-i', path.join(app, 'app-record.mp4'), '-frames:v', '1', '-q:v', '2', add]);
    log('poster app-record-add.jpg');
  }
  const end = path.join(app, 'app-share-end.jpg');
  if (need(end) && existsSync(path.join(app, 'app-share.mp4'))) {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-sseof', '-0.1', '-i', path.join(app, 'app-share.mp4'), '-frames:v', '1', '-q:v', '3', '-update', '1', end]);
    log('poster app-share-end.jpg');
  }
}

// 4b. Hand cutout defringe: the source cutout keeps 3–6px of its original grey background as opaque
// pixels around the hand and arm, which shows as a pale halo on the green See-it-work block. Pull
// the alpha in (chamfer distance from the transparent area), feather it, and recolor the remaining
// edge pixels from the opaque interior. Only the skin is eroded hard: inside the phone body's box
// (HAND_PHONE.body) the edge is just softened, so the bumper and screen hole keep their shape. The
// image border counts as opaque, so the forearm still bleeds off the bottom. Writes
// stock/hand-phone-clean.png, which HAND_PHONE uses.
if (run('hand')) {
  const input = path.join(MEDIA, 'stock', 'hand-phone.png');
  const out = path.join(MEDIA, 'stock', 'hand-phone-clean.png');
  if (existsSync(input) && need(out)) {
    const BODY = { left: 0.083, top: 0.007, right: 0.083 + 0.507, bottom: 0.007 + 0.671 }; // = HAND_PHONE.body
    const SKIN = { erosion: 4.5, feather: 2 };
    const PHONE = { erosion: 0.6, feather: 1.2 };
    const RAMP = 24; // px over which the phone settings blend into the skin settings
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const N = W * H;
    const INF = 1e9;
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) d[i] = data[i * 4 + 3] >= 128 ? INF : 0;
    const D2 = Math.SQRT2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 1);
        if (x > 0) v = Math.min(v, d[i - W - 1] + D2);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + D2);
      }
      d[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 1);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + D2);
        if (x > 0) v = Math.min(v, d[i + W - 1] + D2);
      }
      d[i] = v;
    }
    const bl = BODY.left * W, br = BODY.right * W, bt = BODY.top * H, bb = BODY.bottom * H;
    const outBuf = Buffer.from(data);
    const R = 6; // recolor window radius
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const di = d[i];
      if (di === 0 || di >= INF) continue;
      const outside = Math.max(bl - x, x - br, bt - y, y - bb, 0);
      const t = Math.min(1, outside / RAMP);
      const ero = PHONE.erosion + (SKIN.erosion - PHONE.erosion) * t;
      const fea = PHONE.feather + (SKIN.feather - PHONE.feather) * t;
      const a = Math.max(0, Math.min(1, (di - ero) / fea));
      outBuf[i * 4 + 3] = Math.round(a * 255);
      const deep = ero + fea + 2;
      if (a === 0 || di >= deep || t === 0) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
        const j = yy * W + xx;
        if (d[j] >= deep) { r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; n++; }
      }
      if (n) {
        const k = 0.8 * t; // mostly the interior color; keep a little of the pixel's own detail
        outBuf[i * 4] = Math.round(k * (r / n) + (1 - k) * data[i * 4]);
        outBuf[i * 4 + 1] = Math.round(k * (g / n) + (1 - k) * data[i * 4 + 1]);
        outBuf[i * 4 + 2] = Math.round(k * (b / n) + (1 - k) * data[i * 4 + 2]);
      }
    }
    await sharp(outBuf, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(out);
    log('hand hand-phone-clean.png (defringed)');
  }
}

// 4c. Handset's hand, pre-choked: the same matte Handset.tsx used to get from a live SVG filter
// (erode 5px, blur 1.4, keep the color inside). Baked here because WebKit repaints SVG filters on
// the CPU at full size, which janked and crashed iPhones next to the playing phone video.
if (run('hand')) {
  const input = path.join(MEDIA, 'stock', 'hand-phone.png');
  const out = path.join(OPT, 'stock', 'hand-phone-choked.webp');
  if (existsSync(input) && need(out)) {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const R = 5; // feMorphology radius: an 11×11 square min filter, done as two 1-D passes
    const a = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) a[i] = data[i * 4 + 3];
    const h = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let m = 255;
      for (let k = Math.max(0, x - R); k <= Math.min(W - 1, x + R); k++) m = Math.min(m, a[y * W + k]);
      h[y * W + x] = m;
    }
    const e = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let m = 255;
      for (let k = Math.max(0, y - R); k <= Math.min(H - 1, y + R); k++) m = Math.min(m, h[k * W + x]);
      e[y * W + x] = m;
    }
    const eb = await sharp(e, { raw: { width: W, height: H, channels: 1 } }).blur(1.4).extractChannel(0).raw().toBuffer();
    const outBuf = Buffer.from(data);
    for (let i = 0; i < W * H; i++) outBuf[i * 4 + 3] = Math.round((data[i * 4 + 3] * eb[i]) / 255);
    mkdirSync(path.dirname(out), { recursive: true });
    await sharp(outBuf, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 78, alphaQuality: 90, effort: 5 }).toFile(out);
    log('hand hand-phone-choked.webp');
  }
}

// 4d. Delivery video (src/lib/video.ts picks the file). The originals in public/media/{stock,app}
// stay untouched as masters; everything served lands in public/media/_opt/video/:
//   <name>.hevc.mp4  HEVC (hvc1), for browsers that can play it: Safari, Chrome, Edge (~half size)
//   <name>.mp4       H.264 re-encode for everyone else
//   hero-family-1280.*  for screens under 1600 physical px wide
// Hero only: the app screen recordings' H.264 masters are already lean (HEVC came out the same size
// or bigger), so they are served as they are. CRFs keep SSIM ≥ 0.99 against the master, so no
// visible change. Audio is dropped.
export const VIDEO_HEVC = ['stock/hero-family-1920', 'stock/hero-family-mobile'];
if (run('video')) {
  const outDir = path.join(OPT, 'video');
  mkdirSync(outDir, { recursive: true });
  const ff = (args) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  const x264 = (crf) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high'];
  const x265 = (crf) => ['-c:v', 'libx265', '-preset', 'slow', '-crf', String(crf), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error'];
  const tail = ['-an', '-movflags', '+faststart'];
  const jobs = [];
  for (const rel of VIDEO_HEVC) {
    const name = path.basename(rel);
    jobs.push({ in: `${rel}.mp4`, out: `${name}.hevc.mp4`, args: x265(25) });
  }
  jobs.push({ in: 'stock/hero-family-1920.mp4', out: 'hero-family-1920.mp4', args: x264(23) });
  jobs.push({ in: 'stock/hero-family-mobile.mp4', out: 'hero-family-mobile.mp4', args: x264(23) });
  const s1280 = ['-vf', 'scale=1280:-2:flags=lanczos'];
  jobs.push({ in: 'stock/hero-family-1920.mp4', out: 'hero-family-1280.mp4', args: [...s1280, ...x264(22)] });
  jobs.push({ in: 'stock/hero-family-1920.mp4', out: 'hero-family-1280.hevc.mp4', args: [...s1280, ...x265(24)] });
  for (const j of jobs) {
    const input = path.join(MEDIA, j.in);
    const out = path.join(outDir, j.out);
    if (!existsSync(input) || !need(out)) continue;
    ff(['-i', input, ...j.args, ...tail, out]);
    log(`video ${j.out} ${Math.round(statSync(out).size / 1024)}KB (master ${Math.round(statSync(input).size / 1024)}KB)`);
  }
}

// 5. Hero loop seam
if (run('hero')) {
  const stock = path.join(MEDIA, 'stock');
  const pairs = [
    ['hero-1920.mp4', 'hero-1920-loop.mp4', 6],
    ['hero-mobile-720x1280.mp4', 'hero-mobile-loop.mp4', 3],
  ];
  for (const [src, out, maxMB] of pairs) {
    const input = path.join(stock, src);
    if (!existsSync(input)) continue;
    const dur = parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input]).toString());
    let ssim = 1;
    try {
      const tmpA = path.join(OPT, `.seam-${src}-a.png`);
      const tmpB = path.join(OPT, `.seam-${src}-b.png`);
      mkdirSync(OPT, { recursive: true });
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', input, '-frames:v', '1', tmpA]);
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-sseof', '-0.08', '-i', input, '-update', '1', tmpB]);
      const res = execFileSync('bash', ['-c', `${FFMPEG} -i "${tmpA}" -i "${tmpB}" -lavfi ssim -f null - 2>&1 | grep -o 'All:[0-9.]*' | cut -d: -f2`]).toString();
      ssim = parseFloat(res) || 1;
      execFileSync('rm', ['-f', tmpA, tmpB]);
    } catch (e) { log('seam check failed', e.message); }
    log(`hero seam ${src}: SSIM ${ssim.toFixed(3)} (duration ${dur.toFixed(2)}s)`);
    const outPath = path.join(stock, out);
    if (ssim < 0.9 && need(outPath)) {
      const xf = 0.6;
      // Crossfade the tail into the head: [head ... tail] → tail fades into the first 0.6s.
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', input, '-filter_complex',
        `[0:v]split[a][b];[a]trim=start=${xf},setpts=PTS-STARTPTS[main];[b]trim=end=${xf},setpts=PTS-STARTPTS[head];` +
        `[main][head]xfade=transition=fade:duration=${xf}:offset=${(dur - 2 * xf).toFixed(3)},format=yuv420p[v]`,
        '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', outPath]);
      const mb = statSync(outPath).size / 1e6;
      log(`wrote ${out} (${mb.toFixed(2)} MB${mb > maxMB ? `, OVER ${maxMB}MB budget` : ''})`);
    }
  }
  // Loop posters = frame 0 of the loop files (the LCP image, so the poster → video swap never jumps)
  for (const [video, poster] of [['hero-1920-loop.mp4', 'hero-loop-poster.jpg'], ['hero-mobile-loop.mp4', 'hero-loop-poster-mobile.jpg']]) {
    const v = path.join(stock, video);
    const out = path.join(stock, poster);
    if (existsSync(v) && need(out)) {
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', v, '-frames:v', '1', '-q:v', '3', out]);
      log('poster', poster);
    }
  }
  // 6. Contrast check of the H1/sub area (bottom-left)
  try {
    const out = execFileSync('bash', ['-c', `${FFMPEG} -i "${path.join(stock, 'hero-1920.mp4')}" -vf "crop=iw*0.66:ih*0.45:0:ih*0.55,signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1 | grep -o 'YAVG=[0-9.]*' | cut -d= -f2 | sort -n | tail -1`]).toString().trim();
    log(`hero contrast: max YAVG in text area = ${out} ${parseFloat(out) > 110 ? '(> 110: raise the bottom scrim stop)' : '(ok)'}`);
  } catch (e) { log('contrast check failed', e.message); }
}

// 2 + 3. WebP widths and blur layers
async function encodeWebp(input, width, budgetKB, alpha) {
  let buf;
  let q = QUALITIES[0];
  for (q of QUALITIES) {
    buf = await sharp(input).rotate().resize({ width, withoutEnlargement: true })
      .webp({ quality: q, alphaQuality: 90, effort: 5 }).toBuffer();
    if (alpha || buf.length / 1024 <= budgetKB) break;
  }
  return { buf, q };
}

if (run('webp')) {
  const dirs = ['stock', 'app-covers', 'app'];
  const jobs = [];
  for (const dir of dirs) {
    const abs = path.join(MEDIA, dir);
    if (!existsSync(abs)) continue;
    const outDir = path.join(OPT, dir);
    mkdirSync(outDir, { recursive: true });
    for (const file of readdirSync(abs)) {
      if (!/\.(jpe?g|png)$/i.test(file)) continue;
      const name = file.replace(/\.(jpe?g|png)$/i, '');
      const input = path.join(abs, file);
      jobs.push(async () => {
        const meta = await sharp(input).metadata();
        const srcW = meta.width ?? 0;
        const alpha = !!meta.hasAlpha;
        const notes = [];
        let atSource = null; // the encode at the source's own width, reused for every larger bucket
        for (const w of WIDTHS) {
          const out = path.join(outDir, `${name}-${w}.webp`);
          if (!need(out)) continue;
          if (w >= srcW && atSource) { copyFileSync(atSource, out); continue; }
          const { buf, q } = await encodeWebp(input, Math.min(w, srcW), BUDGET_KB[w], alpha);
          writeFileSync(out, buf);
          if (q !== QUALITIES[0]) notes.push(`${w}@q${q}`);
          if (w >= srcW) atSource = out;
        }
        if (dir === 'stock' && name.startsWith('photo-')) {
          const out = path.join(outDir, `${name}-blur.webp`);
          if (need(out)) await sharp(input).rotate().resize({ width: 96 }).blur(8).webp({ quality: 60 }).toFile(out);
        }
        log('webp', `${dir}/${name}`, `(${srcW}px${alpha ? ', alpha' : ''})`, notes.length ? notes.join(' ') : '');
      });
    }
  }
  // small worker pool
  const POOL = 6;
  let i = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (i < jobs.length) { const j = jobs[i++]; await j(); }
  }));
}

// 7. Apple touch icon: the pot mascot on --canvas (iOS rounds the corners itself)
if (run('icons')) {
  const svg = path.join(ROOT, 'src/app/icon.svg');
  const out = path.join(ROOT, 'src/app/apple-icon.png');
  if (existsSync(svg) && need(out)) {
    const pot = await sharp(readFileSync(svg), { density: 600 }).resize(132, 132, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    await sharp({ create: { width: 180, height: 180, channels: 4, background: '#F7F7F2' } })
      .composite([{ input: pot, left: 24, top: 20 }])
      .flatten({ background: '#F7F7F2' })
      .png({ compressionLevel: 9 })
      .toFile(out);
    log('icon apple-icon.png');
  }
}

// 8. Budget report
if (run('report')) {
  const over = [];
  let total = 0;
  for (const dir of ['stock', 'app-covers', 'app']) {
    const abs = path.join(OPT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      const m = /-(\d+)\.webp$/.exec(f);
      const kb = statSync(path.join(abs, f)).size / 1024;
      total += kb;
      if (m && BUDGET_KB[m[1]] && kb > BUDGET_KB[m[1]] && !f.startsWith('hand-phone')) over.push(`${dir}/${f} ${kb.toFixed(0)}KB > ${BUDGET_KB[m[1]]}KB`);
    }
  }
  const kb = (f) => existsSync(path.join(OPT, 'stock', f)) ? (statSync(path.join(OPT, 'stock', f)).size / 1024).toFixed(0) : '–';
  log(`_opt total ${(total / 1024).toFixed(1)} MB; over budget: ${over.length ? '\n  ' + over.join('\n  ') : 'none'}`);
  log(`hero LCP posters: desktop 1920w ${kb('hero-loop-poster-1920.webp')}KB (≤ 200), mobile 960w ${kb('hero-loop-poster-mobile-960.webp')}KB (≤ 120)`);
}

log('done');
