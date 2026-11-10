#!/usr/bin/env node
// Bug hunt's daily walk of the live site (docs/agents/BUG-HUNT.md, step 1). Reads only: it loads each page as an
// iPhone and as an Android phone, and never taps a button that sends anything.
//
//   node scripts/bug-hunt/walk.mjs --out <folder> [--base https://homecookd.app] [--only /i,/r]
//
// For every page × phone it saves a screenshot and writes report.json: the status, console and page errors, requests
// that failed or answered 4xx/5xx, sideways scroll, and every link and button. Then it asks each link once and lists
// the ones that don't answer. The TEST family's link comes from the gitignored docs/build/.test-family-link; its token
// is masked in everything printed or written.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = req('playwright')); }
catch { ({ chromium } = createRequire('/Users/calebwang/.npm/_npx/e41f203b7505f1fb/node_modules/')('playwright')); }

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const BASE = arg('base', 'https://homecookd.app').replace(/\/+$/, '');
const OUT = arg('out');
const ONLY = arg('only')?.split(',');
if (!OUT) { console.error('usage: walk.mjs --out <folder> [--base <url>] [--only /i,/r]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

// Gitignored files live in the main checkout, not in a worktree.
const main = dirname(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim());
const linkFile = join(main, 'docs/build/.test-family-link');
const testLink = existsSync(linkFile) ? readFileSync(linkFile, 'utf8').trim() : null;
const testQuery = testLink ? new URL(testLink).search : null;

/** Hide every token: a long query value, or a long path piece. */
const mask = (s) => String(s ?? '')
  .replace(/([?&][a-z]+=)[A-Za-z0-9_-]{12,}/gi, '$1<masked>')
  .replace(testQuery ? testQuery.slice(3) : /$^/, '<masked>');

const PHONES = {
  iphone: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  },
  android: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
  },
};

const PAGES = [
  ['/', 'lander'], ['/learn', 'learn'], ['/teach', 'teach'],
  ['/i', 'i-bare'], ...(testQuery ? [[`/i${testQuery}`, 'i-test-family']] : []),
  ['/i?t=notARealToken0000000000', 'i-dead'],
  ['/r', 'r-bare'], ['/r?s=notARealToken0000000000', 'r-dead'],
  ['/d', 'd-bare'], ['/d?t=notARealToken0000000000', 'd-dead'],
  ['/miss', 'miss'], ['/miss?k=notARealToken0000000000', 'miss-dead'],
  ['/a', 'a-bare'], ['/a?t=notARealToken0000000000', 'a-dead'],
  ['/privacy', 'privacy'], ['/terms', 'terms'], ['/nope', '404'],
].filter(([path]) => !ONLY || ONLY.includes(path.split('?')[0]));

const browser = await chromium.launch();
const report = [];
for (const [phone, device] of Object.entries(PHONES)) {
  for (const [path, name] of PAGES) {
    const context = await browser.newContext({ ...device, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const row = { phone, name, path: mask(path), consoleErrors: [], pageErrors: [], badRequests: [] };
    page.on('console', (m) => { if (m.type() === 'error') row.consoleErrors.push(mask(m.text()).slice(0, 300)); });
    page.on('pageerror', (e) => row.pageErrors.push(mask(e.message).slice(0, 300)));
    page.on('requestfailed', (r) => row.badRequests.push(`failed ${r.method()} ${mask(r.url())} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) row.badRequests.push(`${r.status()} ${r.request().method()} ${mask(r.url())}`); });
    try {
      const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
      row.status = res?.status();
    } catch (e) { row.loadError = mask(e.message).slice(0, 200); }
    await page.waitForTimeout(2500);
    Object.assign(row, await page.evaluate(() => {
      const seen = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      return {
        title: document.title,
        finalUrl: location.pathname,
        sideways: document.documentElement.scrollWidth - window.innerWidth,
        links: [...document.querySelectorAll('a[href]')].map((a) => ({ text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60), href: a.getAttribute('href'), seen: seen(a) })),
        buttons: [...document.querySelectorAll('button, [role=button]')].filter(seen).map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 60)),
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 700),
      };
    }).catch((e) => ({ evalError: e.message })));
    row.links = (row.links ?? []).map((l) => ({ ...l, href: mask(l.href) }));
    row.text = mask(row.text);
    await page.screenshot({ path: join(OUT, `${phone}-${name}.png`) }).catch(() => {});
    report.push(row);
    await context.close();
  }
}
await browser.close();

// Ask every link once (the masked ones are the test family's own, already loaded above).
const hrefs = new Map();
for (const row of report) for (const l of row.links ?? []) {
  if (!l.href || l.href.includes('<masked>') || l.href.startsWith('#')) continue;
  const key = l.href;
  if (!hrefs.has(key)) hrefs.set(key, { from: `${row.phone}/${row.name}`, text: l.text });
}
const linkResults = [];
for (const [href, from] of hrefs) {
  if (/^(mailto:|tel:|sms:|homecookd:)/.test(href)) { linkResults.push({ href, ...from, result: 'scheme' }); continue; }
  const url = new URL(href, BASE).toString();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': PHONES.iphone.userAgent } });
    linkResults.push({ href, ...from, result: res.status, landed: res.url !== url ? res.url : undefined });
  } catch (e) { linkResults.push({ href, ...from, result: `error ${e.message}` }); }
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), report, linkResults }, null, 2));

for (const row of report) {
  const bad = [row.loadError, ...row.pageErrors, ...row.consoleErrors, ...row.badRequests, row.sideways > 1 ? `scrolls sideways by ${row.sideways}px` : null].filter(Boolean);
  console.log(`${row.phone.padEnd(7)} ${row.name.padEnd(14)} ${row.status ?? '-'} "${row.title}" buttons: [${(row.buttons ?? []).join(' | ')}]`);
  for (const b of bad) console.log(`        ! ${b}`);
}
console.log('\nlinks:');
for (const l of linkResults) if (l.result !== 200) console.log(`  ${l.result} ${l.href} ("${l.text}", ${l.from})${l.landed ? ` -> ${l.landed}` : ''}`);
console.log(`  ${linkResults.filter((l) => l.result === 200).length} of ${linkResults.length} links answer 200`);
