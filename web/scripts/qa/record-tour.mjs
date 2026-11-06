// Records the lander's tour clips from the real web pages (the kid on /miss, Mom on /a, the kid's card after she
// answers) against the local /dish fake, at iPhone size. Each clip lands in --out as <name>/ (2x screenshots taken
// back to back, with an ffconcat list of how long each one showed); scripts/qa/tour-encode.sh turns them into
// public/media/app/web-*.mp4 and their posters. (Playwright's recordVideo and Chrome's screencast both capture
// the window at 1x, not the phone viewport at 2x.)
//
//   cd web && NEXT_PUBLIC_DISH_URL=http://localhost:8791 npm run build && npx --yes serve out -l 3105
//   node web/scripts/qa/record-tour.mjs --base http://localhost:3105 --out /tmp/tour
//
// A production build, not `next dev`, so Next's dev badge stays out of the clips.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startFake } from './dish-fake-server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => {
    if (v.startsWith('--')) acc.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const BASE = String(args.base ?? 'http://localhost:3105').replace(/\/+$/, '');
const OUT = path.resolve(String(args.out ?? '/tmp/tour'));
const CHROME = String(args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PHONE = { width: 390, height: 844 };
mkdirSync(OUT, { recursive: true });

const fake = await startFake({ port: 8791, site: BASE, mergeMs: 2500, translateMs: 1500 });
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
});

/** A phone that records itself with back-to-back screenshots; save(name) stops and writes <name>/. */
async function phone() {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const frames = [];
  let on = true;
  const loop = (async () => {
    while (on) {
      const t = Date.now() / 1000;
      const data = await page.screenshot({ type: 'jpeg', quality: 90 }).catch(() => null);
      if (data) frames.push({ data, t });
    }
  })();
  const save = async (name) => {
    await page.waitForTimeout(300);
    on = false;
    await loop;
    await ctx.close();
    const dir = path.join(OUT, name);
    mkdirSync(dir, { recursive: true });
    const list = ['ffconcat version 1.0'];
    frames.forEach((f, i) => {
      const file = `${String(i).padStart(5, '0')}.jpg`;
      writeFileSync(path.join(dir, file), f.data);
      const next = frames[i + 1]?.t ?? f.t + 0.1;
      list.push(`file ${file}`, `duration ${Math.max(0.001, next - f.t).toFixed(3)}`);
    });
    list.push(`file ${String(frames.length - 1).padStart(5, '0')}.jpg`);
    writeFileSync(path.join(dir, 'frames.ffconcat'), `${list.join('\n')}\n`);
  };
  return { page, ctx, save };
}

async function hold(page, locator, ms) {
  await page.waitForTimeout(600);
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction((el) => el.getAttribute('aria-pressed') === 'true', await locator.elementHandle(), { timeout: 10_000 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Scroll the page smoothly by `dy`, over `ms`. */
async function glide(page, dy, ms) {
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await page.waitForTimeout(16);
  }
}

try {
  // ── web-miss: the kid names the dish, gets tonight's version, then Ask Mom ──────────────────
  const k = await phone();
  const kid = k.page;
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  await kid.waitForTimeout(800);
  await kid.getByLabel('The dish you miss').click();
  await kid.keyboard.type('mom’s tomato egg', { delay: 70 });
  await kid.waitForTimeout(400);
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByRole('heading', { name: 'What you need' }).waitFor({ timeout: 15000 });
  await kid.waitForTimeout(1200);
  await glide(kid, 420, 1400);
  await kid.waitForTimeout(600);
  await kid.locator('div').filter({ hasText: /^SaveAsk Mom$/ }).getByRole('button', { name: 'Ask Mom' }).click();
  const sheet = kid.getByRole('dialog');
  await sheet.getByRole('heading', { name: 'Ask Mom' }).waitFor();
  await kid.waitForTimeout(500);
  await sheet.getByLabel('Your name').click();
  await kid.keyboard.type('Caleb', { delay: 80 });
  await kid.waitForTimeout(1500);
  await sheet.getByRole('button', { name: 'Copy link' }).click();
  await kid.waitForTimeout(900);
  const kidUrl = kid.url();
  const card = fake.cards.get(kidUrl.split('k=')[1]);
  await k.save('web-miss');

  // ── web-answer: Mom hears his note, sees his guess, answers by voice, her version fills in ──
  const m = await phone();
  const mom = m.page;
  await mom.goto(`${BASE}/a?t=${card.askToken}`, { waitUntil: 'networkidle' });
  await mom.getByRole('heading', { level: 1 }).waitFor();
  await mom.waitForTimeout(1500);
  await mom.getByRole('button', { name: 'See Caleb’s guess' }).click();
  await mom.getByText('Fix it with your voice').waitFor();
  await mom.waitForTimeout(1800);
  await mom.getByRole('button', { name: 'Fix it with your voice' }).click();
  const mic = mom.getByRole('button', { name: 'Record your answer' });
  await mic.waitFor();
  await hold(mom, mic, 1500);
  await mom.getByText('2 of 3').waitFor({ timeout: 10000 });
  await hold(mom, mic, 1200);
  await mom.getByText('3 of 3').waitFor({ timeout: 10000 });
  await hold(mom, mic, 1200);
  await mom.getByText('2 big spoons').waitFor({ timeout: 15000 });
  await mom.getByText('Sent to Caleb.').waitFor({ timeout: 15000 });
  await mom.waitForTimeout(1200);
  await m.save('web-answer');

  // ── web-version: the kid's card, now Mom's tomato egg in her words ──────────────────────────
  const v = await phone();
  const after = v.page;
  await after.goto(kidUrl, { waitUntil: 'networkidle' });
  await after.getByText('From Mom’s kitchen').waitFor({ timeout: 10000 });
  await after.waitForTimeout(1500);
  await glide(after, 380, 1600);
  await after.waitForTimeout(1500);
  await v.save('web-version');
  console.log(`Recorded web-miss, web-answer and web-version in ${OUT}`);
} catch (e) {
  console.error(`Recording failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await fake.close();
}
