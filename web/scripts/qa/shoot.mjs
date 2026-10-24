// Fast visual QA: headless Chrome screenshots of the whole page or one section, plus a contact sheet.
//
//   node scripts/qa/shoot.mjs --out /tmp/x                         # whole page at 1440x900, every 0.5 viewport
//   node scripts/qa/shoot.mjs --section pass-down --beats 8 --out /tmp/x
//   node scripts/qa/shoot.mjs --mobile --section how-it-works --out /tmp/x   # 390x844, touch
//   flags: --w --h --step --beats --rm (reduced motion) --nojs --wait <ms per shot> --url --cols
//          --per <frames per sheet page, default 24> --shotTimeout <ms, default 15000; a wedged shot is skipped>
//
// Prints console errors, failed requests, horizontal overflow and blank screens (QA B20: a shot where
// nothing but the nav is visible, i.e. visible text and media cover under 2% of the screen below the
// nav); writes NNN.jpg, meta.json and sheet.jpg (Read sheet.jpg to see every beat at once).
// Section ids: top, pass-down, how-it-works, recipe-box, plus every main section[id] and footer[id].
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = req('playwright')); }
catch { ({ chromium } = createRequire('/Users/calebwang/.npm/_npx/e41f203b7505f1fb/node_modules/')('playwright')); }

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => {
  if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const mobile = !!a.mobile;
const W = +(a.w ?? (mobile ? 390 : 1440)), H = +(a.h ?? (mobile ? 844 : 900));
const out = a.out ?? '/tmp/homecookd-shots';
const wait = +(a.wait ?? 700);
const url = a.url ?? 'http://localhost:3000/';
mkdirSync(out, { recursive: true });
// Drop frames and sheets from an earlier (possibly longer) run so the sheet only shows this run.
for (const f of readdirSync(out)) if (/^(\d{3}\.jpg|sheet(-\d+)?\.jpg)$/.test(f)) rmSync(`${out}/${f}`);
// A wedged page (busy main thread, dev-server recompile) must not stall the run: every shot is
// time-boxed and skipped on timeout, and a watchdog ends the whole run.
const SHOT_MS = +(a.shotTimeout ?? 15000);
const timeBox = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms: ${what}`)), ms))]);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 1,
  reducedMotion: a.rm ? 'reduce' : 'no-preference', javaScriptEnabled: !a.nojs,
  hasTouch: mobile, isMobile: mobile,
});
const page = await ctx.newPage();
page.setDefaultTimeout(SHOT_MS);
const logs = [], bad = [];
// Dev-only noise: Next's dev server preloads chunks it may not use right away.
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/preloaded using link preload/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
page.on('requestfailed', (r) => { const f = r.failure()?.errorText ?? ''; if (!/ERR_ABORTED/.test(f)) bad.push(`FAIL ${f} ${r.url()}`); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+(a.settle ?? 3000));

// Scroll range: a section (including its pin spacer) or the whole page.
const range = await page.evaluate((id) => {
  const total = document.documentElement.scrollHeight;
  if (!id) return { start: 0, end: total - innerHeight, total };
  const el = document.getElementById(id);
  if (!el) return { error: `no element #${id}`, total };
  const box = el.closest('.pin-spacer') || el;
  const r = box.getBoundingClientRect();
  const start = Math.max(0, r.top + scrollY - innerHeight * 0.15);
  const end = Math.min(total - innerHeight, r.bottom + scrollY - innerHeight * 0.85);
  return { start, end: Math.max(start, end), total };
}, a.section || null);
if (range.error) { console.error(range.error); await browser.close(); process.exit(1); }

const span = range.end - range.start;
const n = a.section ? Math.max(2, +(a.beats ?? 6)) : Math.ceil(span / (H * +(a.step ?? 0.5))) + 1;
const meta = [];
const watchdog = setTimeout(() => { console.error(`watchdog: run exceeded ${Math.round((n * (wait + SHOT_MS) + 60000) / 1000)}s`); process.exit(2); }, n * (wait + SHOT_MS) + 60000);
let shot = 0;
for (let i = 0; i < n; i++) {
  const y = Math.round(range.start + (n === 1 ? 0 : (span * i) / (n - 1)));
  try {
    await timeBox(page.evaluate((y) => { const l = window.__lenis; if (l) l.scrollTo(y, { immediate: true, force: true }); window.scrollTo(0, y); }, y), SHOT_MS, `scroll to ${y}`);
    await page.waitForTimeout(wait);
    const info = await timeBox(page.evaluate(() => ({
      y: Math.round(scrollY),
      motion: document.documentElement.dataset.motion ?? null, // "off" here means the page didn't hydrate in time
      overflowX: document.documentElement.scrollWidth - innerWidth,
      playing: [...document.querySelectorAll('video')].filter((v) => !v.paused).map((v) => (v.currentSrc || v.src).split('/').pop()),
      // share of the screen under the nav covered by visible text and media (blank-screen check)
      content: (() => {
        const top = 80, vh = innerHeight, vw = innerWidth;
        const seen = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; } return true; };
        const vis = (r) => Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, top)) * Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        let area = 0;
        for (const m of document.querySelectorAll('img, video, canvas, svg')) {
          if (m.closest('header')) continue;
          const a = vis(m.getBoundingClientRect());
          if (a > 400 && seen(m)) area += a;
        }
        const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (!n.textContent.trim() || !n.parentElement || n.parentElement.closest('header, script, style, .sr-only')) continue;
          const rg = document.createRange();
          rg.selectNodeContents(n);
          const a = vis(rg.getBoundingClientRect());
          if (a > 100 && seen(n.parentElement)) area += a;
        }
        return +(area / ((vh - top) * vw)).toFixed(3);
      })(),
    })), SHOT_MS, `probe at ${y}`);
    await page.screenshot({ path: `${out}/${String(shot).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 72, timeout: SHOT_MS });
    meta.push({ i, file: `${String(shot).padStart(3, '0')}.jpg`, ...info });
    shot++;
  } catch (e) {
    logs.push(`[shot ${i} y=${y}] skipped: ${e.message.split('\n')[0]}`);
  }
}
clearTimeout(watchdog);
// browser.close() can hang when several runs share the machine; don't let it hold the result.
await timeBox(browser.close(), 10000, 'browser.close').catch(() => {});

// Contact sheet (ffmpeg tile).
const files = readdirSync(out).filter((f) => /^\d{3}\.jpg$/.test(f)).sort();
const cols = +(a.cols ?? (mobile ? Math.min(files.length, 6) : Math.min(files.length, 4)));
const cellW = mobile ? 300 : 600;
// Long runs are split into pages of `--per` frames (default 24) so each sheet stays legible when read.
const per = Math.max(cols, +(a.per ?? 24));
const sheets = [];
const tile = (start, count, dest) => execFileSync('/opt/homebrew/bin/ffmpeg', ['-nostdin', '-v', 'error', '-y', '-framerate', '1',
  '-start_number', String(start), '-i', `${out}/%03d.jpg`,
  '-vf', `scale=${cellW}:-1,tile=${cols}x${Math.ceil(count / cols)}:padding=6:color=white`, '-frames:v', '1', dest]);
try {
  if (files.length) tile(0, files.length, `${out}/sheet.jpg`);
  if (files.length > per) for (let k = 0; k * per < files.length; k++) {
    const dest = `${out}/sheet-${k + 1}.jpg`;
    tile(k * per, Math.min(per, files.length - k * per), dest);
    sheets.push(dest);
  }
} catch (e) { logs.push('[sheet] ffmpeg failed: ' + e.message); }

writeFileSync(`${out}/meta.json`, JSON.stringify({ W, H, range, meta, logs, bad }, null, 1));
const maxOverflow = meta.length ? Math.max(...meta.map((m) => m.overflowX)) : null;
// a screenful with nothing but the nav reads as "the page broke" (QA B20)
const blankScreens = meta.filter((m) => m.content < 0.02).map((m) => `${m.file} (y=${m.y})`);
console.log(JSON.stringify({ shots: files.length, motion: [...new Set(meta.map((m) => m.motion))].join(','), sheet: `${out}/sheet.jpg`, ...(sheets.length ? { pages: sheets } : {}), pageHeightVh: (range.total / H).toFixed(1),
  horizontalOverflowPx: maxOverflow, blankScreens, consoleErrors: logs.slice(0, 20), failedRequests: bad.slice(0, 20) }, null, 1));
// Exit explicitly: a browser that didn't close cleanly would otherwise keep node alive.
process.exit(0);
