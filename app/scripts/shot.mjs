// Screenshot an app route from the Expo web dev server at iPhone size, for comparing against the
// design bible renders in docs/design/hearth-bible/renders/.
//
//   node scripts/shot.mjs <route> <out.png> [--scroll 600] [--wait 1500] [--base http://localhost:8090]
//   node scripts/shot.mjs "/kid/home?as=leo" /tmp/kid-home.png
//
// Uses the installed Google Chrome through playwright-core (no browser download). 390x844 @2x.
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const scroll = Number(opt('scroll', '0'));
const extraWait = Number(opt('wait', '1200'));
const base = opt('base', process.env.SHOT_BASE || 'http://localhost:8090');
const [route = '/', out = 'shot.png'] = args;

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + route, { waitUntil: 'networkidle', timeout: 120_000 });
// Expo web renders into #root; wait until something is painted there and fonts are ready.
await page.waitForFunction(() => {
  const r = document.getElementById('root');
  return !!r && r.innerText.trim().length > 0;
}, null, { timeout: 60_000 }).catch(() => {});
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
if (scroll) {
  await page.evaluate((y) => {
    // Scroll the first scrollable element (RN ScrollView on web) and the window.
    const els = Array.from(document.querySelectorAll('div')).filter((d) => {
      const s = getComputedStyle(d);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight + 10;
    });
    if (els[0]) els[0].scrollTop = y;
    window.scrollTo(0, y);
  }, scroll);
}
await page.waitForTimeout(extraWait);
await page.screenshot({ path: out });
await browser.close();
if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 8).join('\n'));
console.log(out);
