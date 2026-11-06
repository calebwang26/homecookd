// The dish pages end to end in real Chrome against a real api: not the fake. A kid makes a card from a made-up dish with a test photo, saves it and asks Mom;
// Mom answers by voice with Chrome's fake audio device and sends; the kid reopens and sees her version. Models may be fake, so this checks states, never sentences
// a model wrote. Any request that fails and any CORS error in the console is a failure. Exits 1 on a failure. Made-up content only.
//
//   Locally (api/test/localApi.ts: real routes and Postgres, fake models and storage):
//     cd api && DATABASE_URL=postgres://postgres:t@localhost:15451/t npx tsx test/localApi.ts
//     cd web && NEXT_PUBLIC_DISH_URL=http://localhost:8792 NEXT_PUBLIC_DISH_UPLOADS=links npx next dev --port 3105
//     node web/scripts/qa/dish-api-e2e.mjs --base http://localhost:3105 --api http://localhost:8792 --out /path/to/shots
//   Against staging: the same site, built or served with NEXT_PUBLIC_DISH_URL set to the staging api and NEXT_PUBLIC_DISH_UPLOADS=links, and --api <staging api>.
//
// Flags: --base (the site), --api (what the site was built against; required), --out, --chrome, --width, --merge-s (how long to wait for her version, default 120).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = createRequire(import.meta.url)('playwright-core');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => {
    if (v.startsWith('--')) acc.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const trim = (u) => String(u).replace(/\/+$/, '');
if (!args.api) {
  console.error('--api is required: the api the site was built against.');
  process.exit(2);
}
const BASE = trim(args.base ?? 'http://localhost:3105');
const API = trim(args.api);
const OUT = path.resolve(String(args.out ?? path.join(tmpdir(), 'dish-api-e2e')));
const CHROME = String(args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PHONE = { width: Number(args.width ?? 390), height: 844 };
const MERGE_MS = Number(args['merge-s'] ?? 120) * 1000;
mkdirSync(OUT, { recursive: true });

// Made up, and a different dish each run, so runs can't be mistaken for each other.
const DISH = `blue lentil stew ${Math.floor(Math.random() * 9000) + 1000}`;
const KID = 'Testkid';
// A small real PNG: the page turns it into a JPEG on a canvas before it goes up.
const PHOTO = {
  name: 'test-photo.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGP8z4APMOGVGbHSAEEsAROxCnMTAAAAAElFTkSuQmCC', 'base64'),
};

const failures = [];
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok });
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures.push(detail === undefined ? name : `${name}: ${detail}`);
    console.log(`  ✗ ${name}${detail === undefined ? '' : `  (${detail})`}`);
  }
}

/** A URL with no query: links carry signatures, and tokens must never reach a log. */
const safe = (url) => url.split('?')[0];
const problems = []; // { who, what }
const ignored = []; // aborted by a navigation or a media element, which isn't a failure

function watch(page, who) {
  page.on('requestfailed', (req) => {
    const text = req.failure()?.errorText ?? 'failed';
    // A page leaving, or Chrome dropping a media range it no longer wants. A PUT is never let off.
    if (text.includes('ERR_ABORTED') && req.method() !== 'PUT') ignored.push(`${who} ${req.method()} ${safe(req.url())}`);
    else problems.push({ who, what: `${req.method()} ${safe(req.url())}: ${text}` });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push({ who, what: `${res.request().method()} ${safe(res.url())}: HTTP ${res.status()}` });
  });
  page.on('console', (m) => {
    const text = m.text();
    if (/CORS|Access-Control|blocked by/i.test(text)) problems.push({ who, what: `console: ${text.replaceAll(/\?[^\s'"]*/g, '?…')}` });
    else if (m.type() === 'error' && !/preload|Failed to load resource/.test(text)) problems.push({ who, what: `console error: ${text.slice(0, 200)}` });
  });
  page.on('pageerror', (e) => problems.push({ who, what: `page error: ${e.message.slice(0, 200)}` }));
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

async function phone(who, locale = 'en-US') {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, locale, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  watch(page, who);
  return page;
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

/** The api directly, from no browser, to read the state back. Its token stays in its body. */
async function api(route, body) {
  const res = await fetch(`${API}${route}`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${route} answered ${res.status} ${data?.error ?? ''}`);
  return data;
}

async function hold(page, locator, ms) {
  await page.waitForTimeout(700); // a sheet's spring is still settling when its button first shows
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // The first press opens the mic, and a let-go before it's open is dropped on purpose (QuestionScreen's NO_PROMPT_MS), so time
  // the hold from when it records. On the deployed site the mic can take longer to open than the hold itself.
  await page.waitForFunction((el) => el.getAttribute('aria-pressed') === 'true', await locator.elementHandle(), { timeout: 10_000 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Did this audio URL really play? Fetched the way <audio> does, then read by the element itself. */
const audioLoads = (page, url) =>
  page.evaluate(
    (u) =>
      new Promise((resolve) => {
        const a = new Audio(u);
        a.onloadedmetadata = () => resolve(true);
        a.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 15000);
      }),
    url,
  );

try {
  console.log(`Site ${BASE}, api ${API}`);

  // ── The kid ────────────────────────────────────────────────────────────────────────────────
  console.log('Kid');
  const kid = await phone('kid');
  await kid.goto(`${BASE}/miss`, { waitUntil: 'load' });
  await kid.getByLabel('The dish you miss').waitFor();
  await kid.getByLabel('The dish you miss').fill(DISH);
  await kid.locator('input[type="file"][accept="image/*"]').setInputFiles(PHOTO);
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByRole('heading', { name: 'What you need' }).waitFor({ timeout: 90_000 });
  const kidUrl = kid.url();
  const kidToken = new URL(kidUrl).searchParams.get('k');
  check('the address carries a kid token', /^[A-Za-z0-9]{22}$/.test(kidToken ?? ''));
  let { card } = await api('/dish/cards/get', { kidToken });
  check('the card was made from the dish and the photo', card.dish === DISH && card.photoUrls.length === 1 && card.status === 'draft', `${card.status}, ${card.photoUrls.length} photos`);
  check('the guess has ingredients and steps', card.guess.ingredients.length > 0 && card.guess.steps.length > 0);
  check('the photo can be read back with its link', (await kid.evaluate((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = u; }), card.photoUrls[0])) === true);
  await shot(kid, '1-kid-card');

  await kid.getByRole('button', { name: 'Save', exact: true }).click();
  await kid.getByRole('heading', { name: 'Get it on your phone.' }).waitFor();
  await shot(kid, '2-kid-saved');
  await kid.getByRole('button', { name: 'Not now' }).click();
  await kid.getByRole('dialog').waitFor({ state: 'detached' });

  await kid.locator('div').filter({ hasText: /^SaveAsk Mom$/ }).getByRole('button', { name: 'Ask Mom' }).click();
  const sheet = kid.getByRole('dialog');
  await sheet.getByRole('heading', { name: 'Ask Mom' }).waitFor();
  await sheet.getByLabel('Your name').fill(KID);
  await sheet.getByRole('button', { name: 'Copy link' }).click();
  await kid.waitForTimeout(1500);
  ({ card } = await api('/dish/cards/get', { kidToken }));
  check('the share asked her questions and marked it sent', card.asked.length > 0 && !!card.askedAt && card.status === 'asked', `${card.asked.length} asked, ${card.status}`);
  check('his name went with it', card.kidName === KID);
  const askToken = new URL(card.askUrl).searchParams.get('t');
  await shot(kid, '3-kid-asked');
  await kid.keyboard.press('Escape');

  // A Hindi phone: her page opens in English and asks for her language; past 8 s the peek says translating and the page peeks again.
  console.log('Mom in Hindi');
  const hi = await phone('mom-hi', 'hi-IN');
  await hi.goto(`${BASE}/a?t=${askToken}`, { waitUntil: 'load' });
  await hi.getByRole('heading', { level: 1 }).waitFor({ timeout: 30_000 });
  const hiPeek = (await api('/dish/ask/peek', { askToken, lang: 'hi' })).ask;
  check('a peek in her language says whether it is still translating', typeof hiPeek.translating === 'boolean', String(hiPeek.translating));
  check('translating and inLang never both', !(hiPeek.translating && hiPeek.inLang), `${hiPeek.translating}, ${hiPeek.inLang?.lang ?? null}`);
  await shot(hi, '3b-mom-hindi');
  await hi.context().close();

  // ── Mom ────────────────────────────────────────────────────────────────────────────────────
  console.log('Mom');
  const mom = await phone('mom');
  await mom.goto(`${BASE}/a?t=${askToken}`, { waitUntil: 'load' });
  await mom.getByRole('button', { name: `See ${KID}’s guess` }).click();
  await mom.getByRole('button', { name: 'Fix it with your voice' }).click();
  const mic = mom.getByRole('button', { name: 'Record your answer' });
  await mic.waitFor();
  await shot(mom, '4-mom-question');
  for (let i = 1; i <= card.asked.length; i += 1) {
    await hold(mom, mic, 1500);
    const { ask } = await waitFor(async () => {
      const a = await api('/dish/ask/peek', { askToken });
      return a.ask.answered.length >= i ? a : null;
    }, 20_000, `answer ${i} to land`);
    check(`answer ${i} landed, with a clip`, ask.clips.length === i && !!ask.clips[i - 1].audioUrl);
    if (i < card.asked.length) await mom.waitForTimeout(1300);
  }
  // Her last answer takes her on to Send by itself.
  await waitFor(async () => (await api('/dish/ask/peek', { askToken })).ask.finished, 20_000, 'her Send');
  check('her Send went through', true);
  await shot(mom, '5-mom-sent');

  // ── Her version ────────────────────────────────────────────────────────────────────────────
  console.log('Her version');
  card = await waitFor(async () => {
    const c = (await api('/dish/cards/get', { kidToken })).card;
    return c.version ? c : null;
  }, MERGE_MS, 'her version');
  check('her version landed', card.status === 'answered' && !card.merging, card.status);
  check('it says what her answer changed', [...card.version.ingredients, ...card.version.steps.flatMap((s) => s.lines)].some((x) => x.status === 'mom'));
  check('her clips came with it', card.answers.length > 0 && card.answers.every((a) => !!a.audioUrl && a.durationS > 0), `${card.answers.length} answers`);

  // ── The kid reopens ────────────────────────────────────────────────────────────────────────
  console.log('Kid reopens');
  const reopened = await phone('kid again');
  await reopened.goto(kidUrl, { waitUntil: 'load' });
  await reopened.getByText('From Mom’s kitchen').waitFor({ timeout: 30_000 });
  check('the kid sees her version', true);
  const hear = reopened.getByRole('button', { name: 'Hear Mom say it' });
  check('her clips can be played from the card', (await hear.count()) > 0);
  await hear.first().click();
  await reopened.waitForTimeout(800);
  check('tapping one plays it', (await reopened.locator('button[aria-pressed="true"]').count()) >= 1);
  check('her clip really loads from its link', (await audioLoads(reopened, card.answers[0].audioUrl)) === true);
  await shot(reopened, '6-kid-her-version');
  await reopened.locator('button[aria-pressed="true"]').first().click().catch(() => {});
} catch (e) {
  failures.push(`crashed: ${e.message.replaceAll(/[?&](k|t)=[A-Za-z0-9]{22}/g, '?…')}`);
  console.log(`  ✗ crashed: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
}

console.log('Requests and the console');
check('no request failed, and no CORS error', problems.length === 0, problems.map((p) => `[${p.who}] ${p.what}`).join(' | '));
if (ignored.length) console.log(`  (${ignored.length} aborted by a page leaving, not counted: ${[...new Set(ignored)].slice(0, 5).join(', ')})`);
writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ base: BASE, api: API, checks, failures, problems, ignored }, null, 2));
console.log(failures.length ? `\n${failures.length} failed` : '\nAll passed');
process.exit(failures.length ? 1 : 0);

async function waitFor(get, ms, what) {
  const start = Date.now();
  for (;;) {
    const got = await get();
    if (got) return got;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
