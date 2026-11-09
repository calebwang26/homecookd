// Mom's answer page (/a) in the states that went wrong (docs/agents/STATE-MACHINES.md, decision 3), in real
// Chrome against the local fake of /dish/* (started here in-process). One run per state:
//   denied     the mic is refused: "Turn on the microphone", Try again on the mic
//   reload     Try again on a refused mic reloads the page (Safari keeps "Don't Allow" until then)
//   hung       the browser's mic prompt never answers
//   in-app     an Instagram in-app browser that refuses the mic
//   refused    every saved answer comes back 415 (a lasting refusal)
//   finish     her Send comes back 503
// Each checks what the page does TODAY (--expect today, the default) or after decision 3 (--expect fixed).
//
//   cd web && NEXT_PUBLIC_DISH_URL=http://localhost:8791 npx next dev --port 3105
//   node web/scripts/qa/mom-failures-e2e.mjs --base http://localhost:3105 --out /tmp/mom-failures [--expect today|fixed] [--only denied,hung]
//   (--uploads links, with the site built with NEXT_PUBLIC_DISH_UPLOADS=links, for the new api's contract)
//
// The mic is the test-only init script in synthetic-mic.mjs. Exits 1 on a failure.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { startFake } from './dish-fake-server.mjs';
import { micInit } from './synthetic-mic.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => {
    if (v.startsWith('--')) acc.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const BASE = String(args.base ?? 'http://localhost:3105').replace(/\/+$/, '');
const OUT = path.resolve(String(args.out ?? '/tmp/mom-failures'));
const CHROME = String(args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const UPLOADS = String(args.uploads ?? 'raw');
const EXPECT = String(args.expect ?? 'today');
const ONLY = args.only ? String(args.only).split(',') : null;
const INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0';
mkdirSync(OUT, { recursive: true });

const { chromium } = createRequire(path.join(process.cwd(), 'web/package.json'))('playwright-core');
let failures = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : ` (${detail})`}`);
  if (!ok) failures++;
}

const fake = await startFake({ port: Number(args.port ?? 8791), site: BASE, mergeMs: 1500, translateMs: 500, uploads: UPLOADS });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

/** A fresh card asked of Mom with three questions; her page's address. */
async function askUrl() {
  const made = await fetch(`${fake.base}/dish/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: BASE },
    body: JSON.stringify({ dish: 'tomato egg', relation: 'mom', kidName: 'Leo' }),
  }).then((r) => r.json());
  const ask = (questions) =>
    fetch(`${fake.base}/dish/cards/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: BASE },
      body: JSON.stringify({ kidToken: made.kidToken, questions }),
    });
  await ask([
    { id: 'q1', text: 'How much ketchup?' },
    { id: 'q2', text: 'Do you add sugar?' },
    { id: 'q3', text: 'How long do the eggs cook?' },
  ]);
  return { url: `${BASE}/a?t=${fake.cards.get(made.kidToken).askToken}`, kidToken: made.kidToken };
}

async function momPage({ mic, ua }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-US', ...(ua ? { userAgent: ua } : {}) });
  await ctx.addInitScript(micInit(mic));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

/** Her page, past the voice note and the guess, on question 1. */
async function toQuestions(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'See Leo’s guess' }).click();
  await page.getByRole('button', { name: 'Fix it with your voice' }).click();
  await page.getByText('1 of 3').waitFor();
}

const mic = (page) => page.getByRole('button', { name: 'Record your answer' });
const tryAgain = (page) => page.getByRole('button', { name: 'Try again' });
const back = (page) => page.getByRole('button', { name: 'Back' });
const skip = (page) => page.getByRole('button', { name: /^(Skip this one|Next|Done)$/ });
/** Skip even while it's hidden (data-hidden: busy phases hide and disable it). */
const skipAny = (page) => page.getByRole('button', { name: /^(Skip this one|Next|Done)$/, includeHidden: true });
const label = (page) => page.getByRole('status').innerText();
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

async function holdMic(page, ms = 1500) {
  const box = await mic(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const runs = {
  async denied() {
    const page = await momPage({ mic: 'denied' });
    await toQuestions(page, (await askUrl()).url);
    await mic(page).click();
    await page.getByText('Turn on the microphone for this page, then try again.').waitFor({ timeout: 5000 });
    await shot(page, 'denied');
    check('the blocked line', (await label(page)) === 'Turn on the microphone for this page, then try again.');
    check('Try again on the mic', (await tryAgain(page).count()) === 1);
    check('Back works', await back(page).isEnabled());
    check('Skip works', (await skip(page).count()) === 1 && (await skip(page).isEnabled()));
    return page;
  },

  async reload() {
    const page = await momPage({ mic: 'denied' });
    await toQuestions(page, (await askUrl()).url);
    await page.getByRole('button', { name: 'Skip this one' }).click(); // to question 2, so "back to her question" is visible
    await page.getByText('2 of 3').waitFor();
    await mic(page).click();
    await page.getByText('Turn on the microphone for this page, then try again.').waitFor({ timeout: 5000 });
    await Promise.all([page.waitForEvent('load'), tryAgain(page).click()]);
    await page.waitForLoadState('networkidle');
    if (EXPECT === 'today') {
      // Pinned: the reload starts her page over at the kid's voice note (decision 3 fixes it).
      await page.getByRole('button', { name: 'See Leo’s guess' }).waitFor({ timeout: 10000 });
      await shot(page, 'reload');
      check('today: the reload starts her over at the intro', (await page.getByRole('button', { name: 'See Leo’s guess' }).count()) === 1);
      return page;
    }
    await page.getByText('2 of 3').waitFor({ timeout: 10000 });
    check('fixed: the reload comes back to her question', (await page.getByText('2 of 3').count()) === 1);
    await page.evaluate(() => ((window).__noReload = true));
    await mic(page).click();
    await page.getByText('Turn on the microphone for this page, then try again.').waitFor({ timeout: 5000 });
    await tryAgain(page).click();
    await page.getByText(/still off for this page/).waitFor({ timeout: 5000 });
    await shot(page, 'reload');
    check('fixed: a second refusal explains instead of reloading', await page.evaluate(() => (window).__noReload === true));
    check('fixed: Skip still works', await skip(page).isEnabled());
    return page;
  },

  async hung() {
    const page = await momPage({ mic: 'hung' });
    await toQuestions(page, (await askUrl()).url);
    await mic(page).click();
    await page.waitForTimeout(EXPECT === 'fixed' ? 9500 : 3000);
    await shot(page, 'hung');
    if (EXPECT === 'today') {
      // Pinned: the prompt never answers, and she's stuck with Back and Skip disabled (decision 3 fixes it).
      check('today: still "Hold to talk"', (await label(page)) === 'Hold to talk');
      check('today: Back disabled', await back(page).isDisabled());
      check('today: Skip hidden and disabled', (await skip(page).count()) === 0 && (await skipAny(page).isDisabled()));
    } else {
      check('fixed: the wait gives up into the blocked line', (await label(page)) === 'Turn on the microphone for this page, then try again.');
      check('fixed: Back works', await back(page).isEnabled());
      check('fixed: Skip works', await skip(page).isEnabled());
    }
    return page;
  },

  async 'in-app'() {
    const page = await momPage({ mic: 'denied', ua: INSTAGRAM_UA });
    await toQuestions(page, (await askUrl()).url);
    await mic(page).click();
    await page.getByText('Open this link in Safari or Chrome to answer.').waitFor({ timeout: 5000 });
    await shot(page, 'in-app');
    check('the open-elsewhere line', (await label(page)) === 'Open this link in Safari or Chrome to answer.');
    check('no mic', (await mic(page).count()) === 0 && (await tryAgain(page).count()) === 0);
    check('Back works', await back(page).isEnabled());
    if (EXPECT === 'today') {
      check('today: no Skip (decision 3 adds it)', (await skip(page).count()) === 0);
    } else {
      check('fixed: Skip works', (await skip(page).count()) === 1 && (await skip(page).isEnabled()));
      check('fixed: a Copy link way out', (await page.getByRole('button', { name: /Copy link/ }).count()) === 1);
    }
    return page;
  },

  async refused() {
    const page = await momPage({ mic: 'synthetic' });
    await toQuestions(page, (await askUrl()).url);
    fake.setAnswerStatus(415);
    try {
      await holdMic(page);
      await page.getByText('That didn’t save. Try again.').waitFor({ timeout: 10000 });
      check('a refused answer: "That didn’t save. Try again."', (await label(page)) === 'That didn’t save. Try again.');
      await holdMic(page);
      await page.waitForTimeout(2500);
      await shot(page, 'refused');
      if (EXPECT === 'today') {
        // Pinned: the same refusal again, and again: a loop with no way past but Skip (decision 3 fixes it).
        check('today: the second refusal says the same', (await label(page)) === 'That didn’t save. Try again.');
      } else {
        check('fixed: the second refusal offers Skip instead of a loop', (await label(page)) !== 'That didn’t save. Try again.' && (await skip(page).isEnabled()));
      }
      check('still on question 1', (await page.getByText('1 of 3').count()) === 1);
    } finally {
      fake.setAnswerStatus(null);
    }
    return page;
  },

  async finish() {
    const page = await momPage({ mic: 'synthetic' });
    const { url, kidToken } = await askUrl();
    await toQuestions(page, url);
    fake.setFailingFinish(true);
    try {
      await holdMic(page);
      await page.getByText('2 of 3').waitFor({ timeout: 10000 });
      await page.waitForTimeout(900);
      await holdMic(page);
      await page.getByText('3 of 3').waitFor({ timeout: 10000 });
      await page.waitForTimeout(900);
      await holdMic(page);
      if (EXPECT === 'today') {
        // Pinned: her Send failed, yet the page goes on to "Sent" once the fill wait ends (decision 3 fixes it).
        await page.getByText('Sent to Leo.').waitFor({ timeout: 60000 });
        await shot(page, 'finish');
        check('today: "Sent to Leo." though her Send failed', (await page.getByText('Sent to Leo.').count()) >= 1);
      } else {
        await page.getByText(/Send didn.t go through/).waitFor({ timeout: 15000 });
        await shot(page, 'finish');
        check('fixed: a failed Send says so, with Try again', (await tryAgain(page).count()) >= 1);
        check('the server has no finished ask', !fake.cards.get(kidToken).finishedAt);
        fake.setFailingFinish(false);
        await tryAgain(page).click();
        await page.getByText('Sent to Leo.').waitFor({ timeout: 60000 });
        check('fixed: Try again sends it, and only then "Sent to Leo."', !!fake.cards.get(kidToken).finishedAt);
        return page;
      }
      check('the server has no finished ask', !fake.cards.get(kidToken).finishedAt);
    } finally {
      fake.setFailingFinish(false);
    }
    return page;
  },
};

for (const [name, run] of Object.entries(runs)) {
  if (ONLY && !ONLY.includes(name)) continue;
  console.log(`${name} (${EXPECT})`);
  try {
    const page = await run();
    check('no page errors', page.errors.length === 0, page.errors.join('; '));
    await page.context().close();
  } catch (e) {
    check(`${name} ran`, false, e.message.split('\n')[0]);
  }
}

await browser.close();
await fake.close?.();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
