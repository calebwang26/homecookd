#!/usr/bin/env node
// Speed + crash guardrail for the lander (brief 11). Run before every deploy:
//   npm run build && npm run perf              # builds nothing itself; serves out/ on :4173
//   node scripts/perf-check.mjs https://homecookd.app   # or check a live URL
//   node scripts/perf-check.mjs --serve                 # only serve out/ on :4173
//
// One-time setup: npx playwright-core install webkit   (Chromium runs from the installed Chrome)
//
// For / , /learn, /teach and /?aud=kid (the home page sending a kid to /learn before paint) it checks:
//   1. iPhone Safari engine (WebKit, iPhone 15 Pro): loads, scrolls to the bottom, no uncaught
//      error and no "This page couldn't load" screen. (This would have caught the FarApart crash.)
//   2. Phone on a slow connection (Chrome, "Fast 3G" + 4× CPU slowdown): headline visible and
//      bytes downloaded before the first scroll stay within budget.
//   3. Phone on a good connection and a desktop (1440×900 @2x): bytes and JS before the first
//      scroll stay within budget.
// Exits 1 with the reasons when anything fails.
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = ['/', '/learn', '/teach', '/?aud=kid'];
// Paths that ROUTE_GATE redirects (src/lib/audience-gate.ts). They're measured with the HTTP cache
// on (still a fresh, empty one per run): a real visitor reuses the CSS and any JS the first page
// already fetched, and with the cache off those would be counted twice.
const REDIRECTS = new Set(['/?aud=kid']);

// Budgets: KB transferred before the first scroll (load + 2.5s idle, so it includes the idle-time
// prefetch of the next sections), JS KB within that, and ms until the H1 shows on the slow phone.
// ~12% over what /learn measured on 2026-10-16 (slow phone 1265 / 387 JS / ~3.6s headline; phone
// 2645 / 413; desktop 3790 / 419) — the live site before the speed pass was 1426 / 3568 / 6842 KB.
// Tighten them as the page gets lighter; never loosen one to make a deploy pass without knowing why.
const BUDGET = {
  slowPhone: { totalKB: 1420, jsKB: 440, headlineMs: 4500 },
  phone: { totalKB: 2950, jsKB: 460 },
  desktop: { totalKB: 4250, jsKB: 470 },
};

// DevTools' "Fast 3G" (bytes/s) and a mid-range phone CPU
const FAST_3G = { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 };

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain', '.ico': 'image/x-icon' };

/** out/ over HTTP like Vercel serves it: clean URLs, compressed text, byte ranges (Safari needs them for video). */
async function serveOut() {
  const OUT = path.join(ROOT, 'out');
  if (!existsSync(path.join(OUT, 'index.html'))) {
    console.error('No out/ build. Run `npm run build` first (or pass a URL).');
    process.exit(2);
  }
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(OUT, rel);
    if (!file.startsWith(OUT)) return res.writeHead(403).end();
    if ((!existsSync(file) || statSync(file).isDirectory()) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
    const size = statSync(file).size;
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    // Vercel's caching: hashed /_next/static and /fonts (vercel.json) are immutable, /media is
    // max-age=3600 (vercel.json), pages revalidate. Only the redirect paths run with the cache on.
    res.setHeader(
      'Cache-Control',
      /^\/(_next\/static|fonts)\//.test(rel)
        ? 'public, max-age=31536000, immutable'
        : rel.startsWith('/media/')
          ? 'public, max-age=3600, stale-while-revalidate=604800'
          : 'public, max-age=0, must-revalidate',
    );
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
      createReadStream(file, { start, end }).pipe(res);
    } else if (/^(text|application\/json|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      // Vercel compresses text (brotli); gzip is within a few % of it
      res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      createReadStream(file).pipe(zlib.createGzip({ level: 9 })).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
      createReadStream(file).pipe(res);
    }
  });
  // PERF_PORT=4174 when another checkout already serves on :4173
  const port = Number(process.env.PERF_PORT) || 4173;
  await new Promise((r) => server.listen(port, r));
  return { base: `http://localhost:${port}`, stop: () => server.close() };
}

/** The page the visitor ends up on has loaded (past any ROUTE_GATE redirect). */
async function landed(page) {
  await page.waitForFunction(() => !window.__hcAway && document.readyState === 'complete', null, { timeout: 60000, polling: 100 });
}

async function scrollThrough(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + 800; y += 400) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1500);
}

async function webkitCrashCheck(base) {
  console.log('\niPhone Safari engine (WebKit): load + scroll, no errors');
  const browser = await webkit.launch();
  try {
    for (const p of PATHS) {
      const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + p, { waitUntil: 'commit' });
      await landed(page);
      await page.waitForTimeout(2500);
      await scrollThrough(page);
      const broken = await page.evaluate(() => document.body.innerText.includes('This page couldn’t load'));
      if (errors.length || broken) fail(`${p}: ${broken ? 'error screen; ' : ''}${errors.join(' | ')}`);
      else ok(`${p}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

/** Load `url` and count what downloads before any scroll (load + 2.5s quiet). */
async function measure(browser, url, { viewport, dpr, mobile, throttle, cache = false }) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile ? devices['Pixel 7'].userAgent : undefined,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !cache });
  if (throttle) {
    await cdp.send('Network.emulateNetworkConditions', FAST_3G);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const types = new Map();
  let total = 0;
  let js = 0;
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    total += e.encodedDataLength;
    if (types.get(e.requestId) === 'Script') js += e.encodedDataLength;
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  // the H1 (any page) is on screen: rendered, opaque, with its webfont or the metric fallback, on
  // the page the visitor stays on (not one ROUTE_GATE has hidden while it redirects)
  let headlineMs = -1;
  try {
    await page.waitForFunction(
      () => {
        const h = document.querySelector('h1');
        if (!h || window.__hcAway || getComputedStyle(h).visibility === 'hidden') return false;
        const r = h.getBoundingClientRect();
        return r.height > 0 && r.top < innerHeight && parseFloat(getComputedStyle(h).opacity) > 0.9;
      },
      null,
      { timeout: 20000, polling: 50 },
    );
    headlineMs = Date.now() - t0;
  } catch {
    /* reported below */
  }
  await landed(page);
  await page.waitForTimeout(2500);
  await ctx.close();
  return { totalKB: Math.round(total / 1024), jsKB: Math.round(js / 1024), headlineMs, errors };
}

async function budgets(base) {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const runs = [
      ['slowPhone', 'Phone, Fast 3G + 4× slower CPU', { viewport: { width: 390, height: 844 }, dpr: 3, mobile: true, throttle: true }],
      ['phone', 'Phone, good connection', { viewport: { width: 390, height: 844 }, dpr: 3, mobile: true, throttle: false }],
      ['desktop', 'Desktop 1440×900 @2x', { viewport: { width: 1440, height: 900 }, dpr: 2, mobile: false, throttle: false }],
    ];
    for (const [key, label, opts] of runs) {
      console.log(`\n${label}: before the first scroll`);
      const b = BUDGET[key];
      for (const p of PATHS) {
        const m = await measure(browser, base + p, { ...opts, cache: REDIRECTS.has(p) });
        const parts = [`${m.totalKB}KB total (≤${b.totalKB})`, `${m.jsKB}KB JS (≤${b.jsKB})`];
        if (b.headlineMs) parts.push(`headline ${m.headlineMs}ms (≤${b.headlineMs})`);
        const bad =
          m.totalKB > b.totalKB ||
          m.jsKB > b.jsKB ||
          (b.headlineMs && (m.headlineMs < 0 || m.headlineMs > b.headlineMs)) ||
          m.errors.length;
        (bad ? fail : ok)(`${p}: ${parts.join(', ')}${m.errors.length ? ` errors: ${m.errors.join(' | ')}` : ''}`);
      }
    }
  } finally {
    await browser.close();
  }
}

if (process.argv.includes('--serve')) {
  // just host out/ (for poking at the build by hand)
  console.log(`serving out/ at ${(await serveOut()).base}`);
  await new Promise(() => {});
}
const arg = process.argv[2];
const server = arg ? { base: arg.replace(/\/+$/, ''), stop: () => {} } : await serveOut();
try {
  console.log(`perf-check: ${server.base}`);
  await webkitCrashCheck(server.base);
  await budgets(server.base);
} finally {
  server.stop();
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
