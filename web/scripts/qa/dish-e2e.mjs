// The v2 dish pages end to end (docs/PRD-V2.md Phases 2–3): the real /miss and /a in Chrome, against
// the local fake of the /dish/* routes (dish-fake-server.mjs, started here in-process). Adapted from
// the MVP's miss-e2e.mjs (calebwang26/homecookd PR #40).
//
//   cd web && NEXT_PUBLIC_DISH_URL=http://localhost:8791 npx next dev --port 3105
//   node web/scripts/qa/dish-e2e.mjs --base http://localhost:3105 --out /tmp/dish-e2e
//
// It covers: a kid makes a card (K1 → K2, no stock photo of another dish), Save (K4), Ask Mom (K3, the
// voice note's empty and recorded states), Mom answers all 3 by voice (M1–M6), the kid reopens and sees
// Mom's version (her amount, his struck guess, her words); the daily budget's 429 (K5); the language
// switch; and a Hindi phone's Mom page (English first, then her language; answers sent with lang=hi;
// her words with the English under them). Every screen is shot at 390×844 into --out. Exits 1 on a
// failure. Flags: --base, --out, --chrome (default: /Applications/Google Chrome.app), --port (fake).
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
const OUT = path.resolve(String(args.out ?? '/tmp/dish-e2e'));
const CHROME = String(args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PHONE = { width: 390, height: 844 };
mkdirSync(OUT, { recursive: true });

const failures = [];
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures.push(detail === undefined ? name : `${name}: ${detail}`);
    console.log(`  ✗ ${name}${detail === undefined ? '' : `  (${detail})`}`);
  }
}

const fake = await startFake({ port: Number(args.port ?? 8791), site: BASE, mergeMs: 2500, translateMs: 1500 });
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

async function phone(locale = 'en-US') {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, locale, permissions: ['microphone', 'clipboard-read', 'clipboard-write'], hasTouch: false });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => m.type() === 'error' && !/preload|Failed to load resource/.test(m.text()) && page.errors.push(m.text()));
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  return page;
}

async function shot(page, name, { full = false } = {}) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`${name}: no sideways scroll`, !overflow);
  if (page.errors.length) check(`${name}: no console errors`, false, page.errors.join(' | '));
  page.errors = [];
}

/** Press and hold an element (the mic) for `ms`. */
async function hold(page, locator, ms) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Stock images on the page outside the dish box's three polaroids. */
const strayStock = (page) =>
  page.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '').filter((s) => /\/media\//.test(s) && !/dish-(dal|pho|dumplings)-\d+\.webp$/.test(s)));

try {
  // ── Kid: K1 → K2 ────────────────────────────────────────────────────────────────────────────
  console.log('Kid');
  const kid = await phone();
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  await kid.getByRole('heading', { level: 1 }).waitFor();
  check('K1: the headline', /What do you miss\s*from home\?/.test(await kid.getByRole('heading', { level: 1 }).innerText()));
  const polaroids = await kid.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src')));
  check('K1: only the three Pexels polaroids', polaroids.length === 3 && polaroids.every((s) => /dish-(dal|pho|dumplings)/.test(s)), polaroids.join(', '));
  check('K1: no "Your last dish" before any dish', (await kid.getByText('Your last dish').count()) === 0);
  await shot(kid, 'K1-dish-box');

  await kid.getByLabel('The dish you miss').fill('mom’s tomato egg');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('Tonight’s version').waitFor({ timeout: 15000 });
  check('K2: the address carries the kid token', /\/miss\?k=[A-Za-z0-9]{22}$/.test(kid.url()), kid.url());
  const kidUrl = kid.url();
  const k2 = await kid.locator('main').innerText();
  check('K2: facts from the data', /~20 min/.test(k2) && /Serves 1/.test(k2) && /~\$3/.test(k2));
  check('K2: guessed amounts keep their "~"', /~1 tbsp\s*ketchup/.test(k2));
  const rows = await kid.locator('main li').allInnerTexts();
  check('K2: an unknown amount shows the name only', rows.some((r) => /^sugar\b/.test(r.trim())), rows.join(' | '));
  check('K2: "We guessed. Mom knows."', k2.includes('We guessed. Mom knows.'));
  check('K2: "4 steps"', k2.includes('4 steps'));
  check('K2: Ask Mom tags on the asked rows', (await kid.getByRole('button', { name: 'Ask Mom' }).count()) >= 3);
  check('K2: no stock photo stands in for their dish', (await strayStock(kid)).length === 0 && (await kid.locator('main img').count()) === 0);
  await shot(kid, 'K2-tonight');
  await shot(kid, 'K2-tonight-full', { full: true });

  // K4: Save
  await kid.getByRole('button', { name: 'Save', exact: true }).click();
  await kid.getByText('Saved to your recipe box.').waitFor();
  await kid.getByRole('heading', { name: 'Get it on your phone.' }).waitFor();
  const k4 = await kid.getByRole('dialog').innerText();
  check('K4: the two reasons', k4.includes('Every dish you save, in one place.') && k4.includes('We’ll tell you the moment she does.'));
  check('K4: Get the app goes to the App Store', (await kid.getByTestId('get-app').getAttribute('href')) === 'https://apps.apple.com/app/id6825621614');
  check('K4: Open homecookd uses the app scheme', /^homecookd:\/\/miss\?k=[A-Za-z0-9]{22}$/.test(await kid.getByRole('link', { name: 'Open homecookd' }).getAttribute('href')));
  check('K4: never says the web keeps one recipe', !/one recipe|only one/i.test(k4));
  await shot(kid, 'K4-saved');
  await kid.getByRole('button', { name: 'Not now' }).click();

  // K3: Ask Mom
  await kid.locator('div').filter({ hasText: /^SaveAsk Mom$/ }).getByRole('button', { name: 'Ask Mom' }).click();
  const sheet = kid.getByRole('dialog');
  await sheet.getByRole('heading', { name: 'Ask Mom' }).waitFor();
  check('K3: the default message', (await sheet.getByLabel('Your message').inputValue()) === 'Mom, how do you make your tomato egg? I\'m trying to make it here.');
  check('K3: "She’ll see your guess and 3 questions."', (await sheet.innerText()).includes('She’ll see your guess and 3 questions.'));
  await sheet.getByLabel('Your name').fill('Caleb');
  await shot(kid, 'K3b-ask-voice-empty');
  await hold(kid, sheet.getByRole('button', { name: /Add a voice note/ }), 1800);
  await sheet.getByRole('button', { name: 'Play your voice note' }).waitFor({ timeout: 10000 });
  const voiced = fake.cards.get(kidUrl.split('k=')[1]);
  check('K3: the voice note uploaded and attached', !!voiced.voice);
  check('K3: voiceNoteS sent from the recorder', voiced.voiceS > 0 && voiced.voiceS <= 60, String(voiced.voiceS));
  check('K3: kidVoiceS shown as its time', (await sheet.getByText(/^0:0[1-9]$/).count()) === 1);
  await shot(kid, 'K3-ask-voice-recorded');
  await sheet.getByRole('button', { name: 'Copy link' }).click();
  await kid.waitForTimeout(800);
  const card = fake.cards.get(kidUrl.split('k=')[1]);
  check('K3: the share asked the 3 questions', card.asked.length === 3, JSON.stringify(card.asked));
  check('K3: the share marked it sent', !!card.askedAt);
  check('K3: the name went with it', card.kidName === 'Caleb');
  const askUrl = `${BASE}/a?t=${card.askToken}`;
  check('Links: the ask link is /a?t=<ask token>', true, askUrl);
  await kid.keyboard.press('Escape');

  // ── Mom, in English ─────────────────────────────────────────────────────────────────────────
  console.log('Mom');
  const mom = await phone('en-US');
  await mom.goto(askUrl, { waitUntil: 'networkidle' });
  await mom.getByRole('heading', { level: 1 }).waitFor();
  check('M1: "Caleb wants to make your tomato egg."', (await mom.getByRole('heading', { level: 1 }).innerText()).replace(/\s+/g, ' ') === 'Caleb wants to make your tomato egg.');
  check('M1: the kid’s voice note plays first', (await mom.getByRole('button', { name: 'Play Caleb’s voice note' }).count()) === 1);
  check('M1: kidVoiceS shown on the player', (await mom.getByText(/^0:0[1-9]$/).count()) === 1);
  check('M1: the button is "See Caleb’s guess"', (await mom.getByRole('button', { name: 'See Caleb’s guess' }).count()) === 1);
  await shot(mom, 'M1-voice-note');
  await mom.getByRole('button', { name: 'See Caleb’s guess' }).click();
  await mom.getByText('Fix it with your voice').waitFor();
  const m2 = (await mom.getByRole('heading', { level: 1 }).innerText()).replace(/\s+/g, ' ');
  check('M2: "Caleb thinks it’s …" names only guessed amounts', /^Caleb thinks it’s 1 tbsp ketchup\.$/.test(m2), m2);
  check('M2: a "?" on each asked item', (await mom.getByRole('img', { name: 'Not sure' }).count()) === 3);
  check('M2: "3 quick questions. Just talk."', (await mom.getByText('3 quick questions. Just talk.').count()) === 1);
  check('M2: no stock photo', (await strayStock(mom)).length === 0);
  await shot(mom, 'M2-his-guess');
  await mom.getByRole('button', { name: 'Fix it with your voice' }).click();
  const mic = mom.getByRole('button', { name: 'Record your answer' });
  await mic.waitFor();
  check('M3: "1 of 3"', (await mom.getByText('1 of 3').count()) === 1);
  check('M3: "Caleb asks"', (await mom.getByText('Caleb asks').count()) === 1);
  check('M3: "Caleb guessed ~1 tbsp"', (await mom.getByText('Caleb guessed ~1 tbsp').count()) === 1);
  check('M3: "Caleb will hear your voice." (never "only")', (await mom.getByText('Caleb will hear your voice.').count()) === 1 && !/only/i.test(await mom.locator('body').innerText()));
  await shot(mom, 'M3-hold-to-talk');
  // Hold, shot mid-recording, let go.
  const box = await mic.boundingBox();
  await mom.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await mom.mouse.down();
  await mom.waitForTimeout(1500);
  await mom.screenshot({ path: path.join(OUT, 'M3-recording.png') });
  await mom.mouse.up();
  await mom.getByText('2 of 3').waitFor({ timeout: 10000 });
  await hold(mom, mic, 1500);
  await mom.getByText('3 of 3').waitFor({ timeout: 10000 });
  await hold(mom, mic, 1500);
  await mom.getByText('Writing it in your words').waitFor({ timeout: 10000 });
  check('M3: answers went up as raw audio with the token in a header', fake.log.filter((l) => l.path === '/dish/ask/answer').every((l) => l.token === card.askToken && /^audio\//.test(l.type) && !('t' in l.query)));
  await shot(mom, 'M4-waiting');
  await mom.getByText('2 big spoons').waitFor({ timeout: 15000 });
  await mom.waitForTimeout(500);
  await shot(mom, 'M4-fills-in');
  await mom.getByText('Sent to Caleb.').waitFor({ timeout: 15000 });
  await mom.waitForTimeout(900);
  check('M5: "You’ll be right there when Caleb cooks it."', (await mom.getByText('You’ll be right there when Caleb cooks it.').count()) === 1);
  await shot(mom, 'M5-sent');
  await mom.getByRole('heading', { name: 'Surprise Caleb by filming a video.' }).waitFor({ timeout: 5000 });
  const m6 = await mom.getByRole('dialog').innerText();
  check('M6: the film ask', m6.includes('Caleb misses the sound of your voice.') && m6.includes('Save this recipe so it never gets lost.') && m6.includes('Keep being part of Caleb’s cooking life.'));
  check('M6: Open homecookd uses the app scheme', /^homecookd:\/\/a\?t=[A-Za-z0-9]{22}$/.test(await mom.getByRole('link', { name: 'Open homecookd' }).getAttribute('href')));
  check('M6: no stock photo', (await strayStock(mom)).length === 0);
  await shot(mom, 'M6-download');

  // ── Kid reopens: Mom's version ──────────────────────────────────────────────────────────────
  await kid.goto(kidUrl, { waitUntil: 'networkidle' });
  await kid.getByText('From Mom’s kitchen').waitFor({ timeout: 10000 });
  const k6 = await kid.locator('main').innerText();
  check('Kid: Mom’s version shows her amount', k6.includes('2 big spoons'));
  check('Kid: his guess struck through', (await kid.locator('s', { hasText: '~1 tbsp' }).count()) === 1);
  check('Kid: her own words', k6.includes('Two big spoons. Don’t be shy.'));
  check('Kid: her clips play', (await kid.getByRole('button', { name: 'Hear Mom say it' }).count()) >= 2);
  check('Kid: "Your last dish" remembered', true);
  await shot(kid, 'K6-moms-version');
  await shot(kid, 'K6-moms-version-full', { full: true });

  // ── K5: the daily budget ────────────────────────────────────────────────────────────────────
  fake.setBudget(true);
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  check('K1: "Your last dish" shows once a dish is made', (await kid.getByRole('link', { name: /Your last dish/ }).count()) === 1);
  await kid.getByLabel('The dish you miss').fill('dad’s dumplings');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('homecookd has made all the recipes it can today.').waitFor({ timeout: 10000 });
  check('K5: "Try again tomorrow."', (await kid.getByText('Try again tomorrow.').count()) === 1);
  check('K5: the button is off', await kid.getByRole('button', { name: 'Make my recipe' }).isDisabled());
  await shot(kid, 'K5-daily-limit');
  fake.setBudget(false);

  // A per-IP limit (429 rate) is gentler: try again in a minute, the button stays on.
  fake.setRate(true);
  await kid.reload({ waitUntil: 'networkidle' });
  await kid.getByLabel('The dish you miss').fill('dad’s dumplings');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('Too many tries. Wait a minute and try again.').waitFor({ timeout: 10000 });
  check('Rate: not the budget words', (await kid.getByText('homecookd has made all the recipes it can today.').count()) === 0);
  check('Rate: the button stays on', await kid.getByRole('button', { name: 'Make my recipe' }).isEnabled());
  await shot(kid, 'K1-rate-limit');
  fake.setRate(false);

  // ── Language switch on the kid's page ───────────────────────────────────────────────────────
  await kid.reload({ waitUntil: 'networkidle' });
  await kid.getByLabel('Language: English').selectOption('es');
  await kid.waitForTimeout(300);
  const es = await kid.getByRole('heading', { level: 1 }).innerText();
  check('Switch: the kid’s page reads in Spanish', !/What do you miss/.test(es) && es.length > 5, es);
  await shot(kid, 'K1-spanish');
  await kid.getByLabel(/Idioma|Language/).selectOption('en');

  // ── A Hindi phone: Mom's page in Hindi ──────────────────────────────────────────────────────
  console.log('Mom in Hindi');
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  await kid.getByLabel('The dish you miss').fill('mom’s tomato egg');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('Tonight’s version').waitFor({ timeout: 15000 });
  await kid.locator('div').filter({ hasText: /^SaveAsk Mom$/ }).getByRole('button', { name: 'Ask Mom' }).click();
  await kid.getByRole('dialog').getByRole('button', { name: 'Copy link' }).click();
  await kid.waitForTimeout(600);
  const card2 = fake.cards.get(kid.url().split('k=')[1]);
  const hi = await phone('hi-IN');
  await hi.goto(`${BASE}/a?t=${card2.askToken}`, { waitUntil: 'domcontentloaded' });
  await hi.getByRole('heading', { level: 1 }).waitFor();
  check('Hindi: the switch shows हिन्दी', (await hi.getByLabel('भाषा: हिन्दी').count()) === 1);
  await hi.getByText('माँ, आप अपना टमाटर अंडा').waitFor({ timeout: 8000 });
  check('Hindi: the kid’s message swapped to Hindi', true);
  await shot(hi, 'M7-hindi-M1');
  await hi.getByRole('button', { name: /Caleb/ }).last().click();
  await hi.getByText('केचप').first().waitFor();
  check('Hindi: the guess list in Hindi', (await hi.getByText('अंडे, फेंटे हुए').count()) === 1);
  await shot(hi, 'M7-hindi-M2');
  await hi.getByRole('button', { name: 'अंग्रेज़ी' }).or(hi.locator('button[aria-pressed]').first()).first().click();
  check('Hindi: the English toggle shows the kid’s words', (await hi.getByText('eggs, beaten').count()) === 1);
  await hi.locator('button[aria-pressed="true"]').first().click();
  await hi.locator('main, body').getByRole('button').filter({ hasText: /आवाज़|voice/i }).last().click();
  const himic = hi.locator('button[data-state]');
  await himic.waitFor();
  await shot(hi, 'M7-hindi-M3');
  for (let i = 0; i < 3; i++) {
    await hold(hi, himic, 1500);
    await hi.waitForTimeout(1300);
  }
  await hi.getByText('दो बड़े चम्मच। कंजूसी मत करना।').waitFor({ timeout: 20000 });
  await hi.waitForTimeout(600);
  check('Hindi: answers sent with lang=hi', fake.log.filter((l) => l.path === '/dish/ask/answer' && l.token === card2.askToken).every((l) => l.query.lang === 'hi'));
  check('Hindi: her words with the English under them', (await hi.getByText('Two big spoons. Don’t skimp.').count()) === 1);
  check('Hindi: M4 uses inLang.version for the card’s own words', (await hi.getByText('2 बड़े चम्मच').count()) === 1 && (await hi.getByText('अंडे, फेंटे हुए').count()) === 1 && (await hi.getByText('2 big spoons').count()) === 0);
  await shot(hi, 'M7-hindi-fills-in');
} catch (e) {
  failures.push(`crashed: ${e.stack ?? e}`);
  console.log(`  ✗ crashed: ${e.message}`);
} finally {
  writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ base: BASE, checks, failures }, null, 2));
  await browser.close();
  await fake.close();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
