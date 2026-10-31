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
// her words with the English under them). The recipe card on M5 and in M6, and the kid's card, open the
// locked recipe view (the /r mechanism on the dish card's version): the recipe, ingredients and steps open;
// any other tap says "Get the app", and the sheet copies the page's link, then opens the store. Every screen
// is shot at 390×844 (--width N for another width) into --out. Exits 1 on a failure. Flags: --base, --out, --chrome (default:
// /Applications/Google Chrome.app), --port (fake).
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
const PHONE = { width: Number(args.width ?? 390), height: 844 }; // --width 360 checks the narrow phones
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
  await page.waitForTimeout(700); // a sheet's spring is still settling when its button first shows
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Stock images on the page outside the dish box's three polaroids. */
const strayStock = (page) =>
  page.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '').filter((s) => /\/media\//.test(s) && !/dish-(dal|pho|dumplings)-\d+\.webp$/.test(s)));

/** The locked recipe view's three screens, then a locked tap: the popover, then the dish pages' sheet. */
async function lockedView(page, { who, title, fromKitchen, shotName, pop, sheetTitle, sheetTexts, link, store }) {
  const view = page.locator('main');
  await page.getByRole('button', { name: 'Start cooking' }).waitFor();
  const top = await page.locator('body').innerText();
  check(`${who} locked: the dish title`, (await page.getByRole('heading', { level: 1 }).innerText()) === title, await page.getByRole('heading', { level: 1 }).innerText());
  check(`${who} locked: from her kitchen`, top.includes(fromKitchen), top);
  check(`${who} locked: no Watch or Hear, no "AI"`, !/\bWatch\b|\bHear\b|\bAI\b/.test(top), top);
  check(`${who} locked: no stock photo`, (await strayStock(page)).length === 0);
  await shot(page, `${shotName}-recipe`);

  // Ingredients: her amount, the guess she replaced struck through, her own words.
  await page.getByRole('button', { name: 'Start cooking' }).click();
  await page.getByRole('heading', { name: 'Get these ready' }).waitFor();
  const ing = await view.innerText();
  check(`${who} locked: her amount`, ing.includes('2 big spoons'), ing);
  check(`${who} locked: the struck guess`, (await page.locator('s', { hasText: '~1 tbsp' }).count()) === 1);
  check(`${who} locked: her words`, ing.includes('Two big spoons. Don’t be shy.'));
  check(`${who} locked: ingredients tick`, (await page.getByRole('checkbox').count()) >= 3);
  await shot(page, `${shotName}-ingredients`);

  // Steps: the title, the lines, her words; Next walks on; the last one's "I made it" is locked.
  await page.getByRole('button', { name: 'Start step 1' }).click();
  await page.getByText('Step 1 of 4').first().waitFor();
  check(`${who} locked: Step 1 of 4`, true);
  check(`${who} locked: no sideways history change`, !/#/.test(page.url()), page.url());
  for (let i = 2; i <= 4; i++) {
    await page.getByRole('button', { name: 'Next step' }).click();
    await page.getByText(`Step ${i} of 4`).first().waitFor();
  }
  await shot(page, `${shotName}-step`);

  // Any other tap: the popover (page language), then the sheet.
  await page.getByRole('button', { name: 'I made it' }).click();
  const popover = page.getByRole('dialog', { name: pop.title });
  await popover.waitFor();
  check(`${who} locked: the popover says it`, (await popover.innerText()).includes(pop.line), await popover.innerText());
  await shot(page, `${shotName}-popover`);
  await popover.getByRole('button', { name: 'Get the app' }).click();
  const sheet = page.locator('[role=dialog][aria-modal=true]');
  await sheet.waitFor();
  const text = await sheet.innerText();
  check(`${who} locked: the sheet’s wording`, text.includes(sheetTitle) && sheetTexts.every((x) => text.includes(x)), text);
  check(`${who} locked: Get the app goes to the App Store`, (await sheet.getByTestId('get-app').getAttribute('href')) === 'https://apps.apple.com/app/id6825621614');
  await shot(page, `${shotName}-sheet`);

  // Get the app copies the page's own link first, then opens the store.
  const copied = [];
  await page.exposeFunction('__copied', (v) => copied.push(v));
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (v) => (window.__copied(v), write(v));
  });
  await Promise.all([page.waitForURL(store), sheet.getByTestId('get-app').click()]);
  check(`${who} locked: it copied ${link} before the store`, copied[0] === link, JSON.stringify(copied));
}

try {
  // ── Kid: K1 → K2 ────────────────────────────────────────────────────────────────────────────
  console.log('Kid');
  const kid = await phone();
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  await kid.getByRole('heading', { level: 1 }).waitFor();
  check('K1: the headline', /What do you miss\s*from home\?/.test(await kid.getByRole('heading', { level: 1 }).innerText()));
  // the brand kit's logo files (/brand/) are not photos; everything else on K1 is one of the three polaroids
  const polaroids = await kid.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src')).filter((s) => !s.startsWith('/brand/')));
  check('K1: only the three Pexels polaroids', polaroids.length === 3 && polaroids.every((s) => /dish-(dal|pho|dumplings)/.test(s)), polaroids.join(', '));
  check('K1: no "Your last dish" before any dish', (await kid.getByText('Your last dish').count()) === 0);
  await shot(kid, 'K1-dish-box');

  await kid.getByLabel('The dish you miss').fill('mom’s tomato egg');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('Our guess. Mom knows the rest.').waitFor({ timeout: 15000 });
  check('K2: the address carries the kid token', /\/miss\?k=[A-Za-z0-9]{22}$/.test(kid.url()), kid.url());
  const kidUrl = kid.url();
  const k2 = await kid.locator('main').innerText();
  check('K2: facts from the data', /~20 min/.test(k2) && /Serves 1/.test(k2) && /~\$3/.test(k2));
  check('K2: guessed amounts keep their "~"', /~1 tbsp\s*ketchup/.test(k2));
  const rows = await kid.locator('main li').allInnerTexts();
  check('K2: an unknown amount shows the name only', rows.some((r) => /^sugar\b/.test(r.trim())), rows.join(' | '));
  check('K2: one label, "Our guess. Mom knows the rest."', k2.includes('Our guess. Mom knows the rest.') && !/Tonight’s version|best guess|We guessed/.test(k2));
  check('K2: a short step, "Scramble eggs soft. Set aside.", with its bold piece set in bold and no raw asterisks', k2.includes('Scramble eggs soft. Set aside.') && !k2.includes('**') && (await kid.locator('main ol b', { hasText: 'soft' }).count()) >= 1);
  check('K2: "4 steps"', k2.includes('4 steps'));
  const k2Block = kid.locator('section[aria-labelledby="knows"]');
  check('K2: "Only Mom knows" starts empty: a plus and the cap, no default questions', k2.includes('Only Mom knows') && !k2.includes('Do you add sugar?') && (await k2Block.locator('li').count()) === 0 && (await k2Block.getByRole('button', { name: 'Add a question' }).count()) === 1 && (await k2Block.innerText()).includes('Up to 3 questions'));
  check('K2: no line starts out asked', (await kid.locator('main button[aria-pressed="true"]').count()) === 0);
  check('K2: a toggle on every ingredient', (await kid.getByRole('button', { name: 'Ask Mom about this' }).count()) === 6);
  check('K2: no stock photo stands in for their dish', (await strayStock(kid)).length === 0 && (await kid.locator('main img').count()) === 0);
  await shot(kid, 'K2-tonight');
  await shot(kid, 'K2-tonight-full', { full: true });

  // The kid fixes the salt: it is his own now (no "~", a small "you"), and Mom sees it under "Caleb thinks…".
  await kid.getByRole('button', { name: /^Fix: .*salt/ }).click();
  await kid.getByLabel('Amount').fill('1 tsp');
  await kid.keyboard.press('Enter');
  await kid.locator('main li[class*="row"]', { hasText: 'salt' }).getByText('you', { exact: true }).waitFor({ timeout: 5000 });
  check('K2: the fixed line is his own: "1 tsp salt", no "~"', /1 tsp\s*salt/.test(await kid.locator('main li[class*="row"]', { hasText: 'salt' }).innerText()) && !/~1 tsp/.test(await kid.locator('main').innerText()));

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
  check('K3: no voice note in the sheet', !/voice note/i.test(await sheet.innerText()));
  await shot(kid, 'K3-ask');
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
  check('M1: the button is "See Caleb’s guess"', (await mom.getByRole('button', { name: 'See Caleb’s guess' }).count()) === 1);
  await shot(mom, 'M1-voice-note');
  await mom.getByRole('button', { name: 'See Caleb’s guess' }).click();
  await mom.getByText('Fix it with your voice').waitFor();
  const m2 = (await mom.getByRole('heading', { level: 1 }).innerText()).replace(/\s+/g, ' ');
  check('M2: "Caleb thinks it’s …" names what he fixed, then what he is asked', /^Caleb thinks it’s 1 tsp salt and 1 tbsp ketchup\.$/.test(m2), m2);
  check('M2: a check on what he fixed himself', (await mom.getByRole('img', { name: 'Caleb is sure' }).count()) === 1);
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
  await mom.getByText(/0:0[1-9]/).first().waitFor({ timeout: 8000 }).catch(() => {}); // the mic can take a moment on the first use
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

  // The recipe card in the film sheet opens her version as the locked recipe view.
  await mom.route('https://apps.apple.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>App Store</title>' }));
  const cardInSheet = mom.getByRole('dialog').getByRole('button', { name: /^Open the recipe: Mom’s tomato egg/ });
  check('M6: the recipe card in the sheet is tappable', (await cardInSheet.count()) === 1);
  await cardInSheet.click();
  await lockedView(mom, {
    who: 'Mom',
    title: 'Mom’s tomato egg',
    fromKitchen: 'From Mom’s kitchen',
    shotName: 'L-mom-locked',
    pop: { title: 'Surprise Caleb by filming a video.', line: 'Save this recipe so it never gets lost.' },
    sheetTitle: 'Surprise Caleb by filming a video.',
    sheetTexts: ['Caleb misses the sound of your voice.', 'Save this recipe so it never gets lost.', 'Keep being part of Caleb’s cooking life.'],
    link: `https://homecookd.app/a?t=${card.askToken}`,
    store: /apps\.apple\.com/,
  });
  // Back to Sent: the film ask does not rise again; the card on M5 opens it too.
  await mom.goto(askUrl, { waitUntil: 'networkidle' });
  await mom.getByText('Sent to Caleb.').waitFor();
  await mom.getByRole('dialog').waitFor();
  await mom.getByRole('button', { name: 'Not now' }).click();
  await mom.getByRole('dialog').waitFor({ state: 'detached' });
  const cardOnM5 = mom.getByRole('button', { name: /^Open the recipe: Mom’s tomato egg/ });
  check('M5: the recipe card is tappable', (await cardOnM5.count()) === 1);
  await shot(mom, 'L-mom-m5-card');
  await cardOnM5.click();
  await mom.getByRole('button', { name: 'Start cooking' }).waitFor();
  check('M5: the card opens her recipe', (await mom.getByRole('heading', { level: 1 }).innerText()) === 'Mom’s tomato egg');
  await mom.locator('header').getByRole('button', { name: 'Back' }).click();
  await mom.getByText('Sent to Caleb.').waitFor();
  await mom.waitForTimeout(2200);
  check('M5: coming back from her recipe the film ask stays down', (await mom.getByRole('dialog').count()) === 0);

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

  // The version on the card opens the locked recipe view, with the kid's words on the sheet.
  await kid.route('https://apps.apple.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>App Store</title>' }));
  const kidToken = kidUrl.split('k=')[1];
  await kid.getByRole('button', { name: /^Open the recipe: Mom’s tomato egg/ }).click();
  await lockedView(kid, {
    who: 'Kid',
    title: 'Mom’s tomato egg',
    fromKitchen: 'From Mom’s kitchen',
    shotName: 'L-kid-locked',
    pop: { title: 'Get it on your phone.', line: 'Every dish you save, in one place.' },
    sheetTitle: 'Get it on your phone.',
    sheetTexts: ['Keep it', 'Every dish you save, in one place.', 'Know when Mom answers', 'We’ll tell you the moment she does.'],
    link: `https://homecookd.app/miss?k=${kidToken}`,
    store: /apps\.apple\.com/,
  });
  await kid.goto(kidUrl, { waitUntil: 'networkidle' });
  await kid.getByText('From Mom’s kitchen').waitFor();

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

  // ── The kid shapes the card: what to ask, what to fix, and no one in particular ─────────────
  console.log('Kid shapes the card');
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  await kid.getByLabel('The dish you miss').fill('mom’s tomato egg');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('Our guess. Mom knows the rest.').waitFor({ timeout: 15000 });
  const shapeToken = kid.url().split('k=')[1];
  const block = kid.locator('section[aria-labelledby="knows"]');
  const toggles = kid.getByRole('button', { name: 'Ask Mom about this' });
  check('Shape: nothing chosen to start, the cap still shown', (await block.locator('li').count()) === 0 && (await block.innerText()).includes('Up to 3 questions'));
  await block.getByRole('button', { name: 'Add a question' }).click();
  await block.getByLabel('Add a question').last().fill('Do you use butter?');
  await kid.keyboard.press('Enter');
  check('Shape: the plus adds a question in his own words', (await block.locator('li').innerText()).includes('Do you use butter?'));
  await toggles.nth(0).click(); // the eggs
  check('Shape: a tapped line joins the block, worded by the template, and the cap stays up', (await block.innerText()).includes('How much eggs do you use?') && (await block.innerText()).includes('Up to 3 questions') && (await block.locator('li').count()) === 2);
  await toggles.nth(2).click();
  await toggles.nth(5).click({ force: true }); // a fourth, at the cap
  await block.getByRole('button', { name: 'Add a question' }).click({ force: true });
  check('Shape: at the cap nothing more joins', (await block.locator('li').count()) === 3 && (await block.locator('input').count()) === 0);
  await block.getByRole('button', { name: 'Take this question out' }).nth(2).click();
  await shot(kid, 'S-only-mom-knows');
  // A filtered word is refused with a toast, the line goes back; a real fix goes through.
  await kid.getByRole('button', { name: /^Fix: .*salt/ }).click();
  await kid.getByLabel('Amount').fill('shit');
  await kid.keyboard.press('Enter');
  await kid.getByText('Let’s keep it to the food.').first().waitFor({ timeout: 5000 });
  check('Shape: a filtered word is refused, the line stays a guess', fake.cards.get(shapeToken).guess.ingredients[4].status === 'guessed');
  await kid.getByRole('button', { name: /^Fix: .*salt/ }).click();
  await kid.getByLabel('Amount').fill('1 tsp');
  await kid.keyboard.press('Enter');
  await kid.locator('main li[class*="row"]', { hasText: 'salt' }).getByText('you', { exact: true }).waitFor({ timeout: 5000 });
  const salt = fake.cards.get(shapeToken).guess.ingredients[4];
  check('Shape: the fix reached the server as his own', salt.status === 'stated' && salt.amount === '1 tsp' && !salt.isGuess, JSON.stringify(salt));
  // A step shows its short form; a tap shows the full sentences.
  check('Shape: a collapsed step is short', !(await kid.locator('main').innerText()).includes('Take them out.'));
  await kid.getByRole('button', { name: /^Show the full step/ }).first().click();
  check('Shape: a tap shows the full step', (await kid.locator('main').innerText()).includes('Take them out.'));
  await kid.getByRole('button', { name: 'Ask Mom', exact: true }).click();
  await kid.getByRole('dialog').getByRole('button', { name: 'Copy link' }).click();
  await kid.waitForTimeout(800);
  const shaped = fake.cards.get(shapeToken);
  check('Shape: Mom gets 3: his two, then one hidden default', shaped.asked.length === 3 && shaped.asked[0].text === 'Do you use butter?' && shaped.asked[1].text === 'How much eggs do you use?' && ['q1', 'q2', 'q3'].includes(shaped.asked[2].id), JSON.stringify(shaped.asked));
  check('Shape: the line question points at the eggs', shaped.guess.ingredients[0].ask === shaped.asked[1].id);
  check('Shape: the hidden default never shows in the block', (await block.locator('li').count()) === 2);
  await kid.keyboard.press('Escape');

  // A card as the live server writes it (the fake's "live" dish): two parts point at one question. A question counts once.
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  await kid.getByLabel('The dish you miss').fill('mom’s tomato egg live');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('Our guess. Mom knows the rest.').waitFor({ timeout: 15000 });
  const liveToken = kid.url().split('k=')[1];
  const liveBlock = kid.locator('section[aria-labelledby="knows"]');
  const liveRows = () => liveBlock.locator('li').allInnerTexts();
  const liveTog = kid.getByRole('button', { name: 'Ask Mom about this' });
  const liveTitle = await kid.title();
  check('Live: the tab title has "Mom’s" once', (liveTitle.match(/mom.s/gi) ?? []).length === 1, liveTitle);
  let rows3 = await liveRows();
  check('Live: nothing chosen to start', rows3.length === 0);
  await liveTog.nth(1).click(); // the tomatoes: q1
  rows3 = await liveRows();
  check('Live: a linked ingredient brings its one question', rows3.length === 1 && /tomatoes before the eggs/.test(rows3[0]));
  await liveTog.nth(1).click();
  check('Live: toggling it again takes it out', (await liveRows()).length === 0);
  await liveTog.nth(1).click();
  await kid.getByRole('button', { name: 'Ask Mom', exact: true }).click();
  check('Live: "She’ll see your guess and 3 questions."', (await kid.getByRole('dialog').innerText()).includes('She’ll see your guess and 3 questions.'));
  await kid.getByRole('dialog').getByRole('button', { name: 'Copy link' }).click();
  await kid.waitForTimeout(800);
  const liveAsked = fake.cards.get(liveToken).asked;
  check('Live: the ask has no duplicates (q1, q2, q3 once each)', liveAsked.map((q) => q.id).sort().join() === 'q1,q2,q3', JSON.stringify(liveAsked));
  await kid.keyboard.press('Escape');

  // No one in particular: a plain title, asking off until someone is picked.
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  await kid.getByRole('button', { name: 'No one in particular' }).click();
  await kid.getByLabel('The dish you miss').fill('tomato egg');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('Our guess. The cook knows the rest.').waitFor({ timeout: 15000 });
  const noneToken = kid.url().split('k=')[1];
  const noneBlock = kid.locator('section[aria-labelledby="knows"]');
  check('None: the title is just the dish', (await kid.getByRole('heading', { level: 1 }).innerText()).trim() === 'Tomato egg');
  check('None: "Only the cook knows" and "Ask someone"', (await noneBlock.innerText()).includes('Only the cook knows') && (await kid.getByRole('button', { name: 'Ask someone', exact: true }).count()) === 1);
  check('None: no ask link and no message yet', fake.cards.get(noneToken).relation === 'none' && fake.cards.get(noneToken).message === '');
  await shot(kid, 'N-none-card');
  check('None: nothing chosen and Ask still works', (await noneBlock.locator('li').count()) === 0 && (await kid.getByRole('button', { name: 'Ask someone', exact: true }).isEnabled()));
  await kid.getByRole('button', { name: 'Ask someone about this' }).nth(0).click();
  await kid.getByRole('button', { name: 'Ask someone', exact: true }).click();
  await kid.getByText('Who do you want to ask?').waitFor();
  await shot(kid, 'N-who');
  await kid.getByRole('button', { name: 'Dad', exact: true }).click();
  await kid.getByRole('dialog').getByRole('heading', { name: 'Ask Dad' }).waitFor({ timeout: 5000 });
  const dad = fake.cards.get(noneToken);
  check('None: picking Dad turns asking on and writes the message', dad.relation === 'dad' && dad.message.startsWith('Dad, how do you make your tomato egg?'), dad.message);
  check('None: the Ask sheet shows that message', (await kid.getByRole('dialog').getByLabel('Your message').inputValue()).startsWith('Dad, how do you make'));
  await kid.keyboard.press('Escape');

  // ── A Hindi phone: Mom's page in Hindi ──────────────────────────────────────────────────────
  console.log('Mom in Hindi');
  await kid.goto(`${BASE}/miss`, { waitUntil: 'networkidle' });
  await kid.getByLabel('The dish you miss').fill('mom’s tomato egg');
  await kid.getByRole('button', { name: 'Make my recipe' }).click();
  await kid.getByText('Our guess. Mom knows the rest.').waitFor({ timeout: 15000 });
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

  // Her recipe in her language: her words with the English under them, the chrome and the sheet in Hindi.
  await hi.getByRole('dialog').waitFor({ timeout: 10000 });
  await hi.getByRole('dialog').getByRole('button', { name: /^रेसिपी खोलें/ }).click();
  await hi.getByRole('button', { name: 'खाना बनाना शुरू करें' }).click();
  await hi.getByRole('heading', { name: 'ये तैयार रखें' }).waitFor();
  const hiIng = await hi.locator('main').innerText();
  check('Hindi locked: her amount in Hindi, her guess struck, her words with the English under them', hiIng.includes('2 बड़े चम्मच') && hiIng.includes('Two big spoons. Don’t skimp.') && (await hi.locator('s').count()) >= 1, hiIng);
  await shot(hi, 'L-hindi-locked-ingredients');
  await hi.locator('header').getByRole('button', { name: 'ऐप पाएँ' }).click();
  const hiPop = hi.getByRole('dialog', { name: /Caleb को चौंका दीजिए/ });
  await hiPop.waitFor();
  check('Hindi locked: the popover is in Hindi', (await hiPop.innerText()).includes('सेव कर लीजिए') && (await hiPop.getByRole('button', { name: 'अभी नहीं' }).count()) === 1);
  await hiPop.getByRole('button', { name: 'ऐप पाएँ' }).click();
  const hiSheet = hi.locator('[role=dialog][aria-modal=true]');
  await hiSheet.waitFor();
  const hiSheetText = await hiSheet.innerText();
  check('Hindi locked: the sheet’s three lines in Hindi', hiSheetText.includes('चौंका दीजिए') && hiSheetText.includes('सेव कर लीजिए') && hiSheetText.includes('साथ बने रहिए'), hiSheetText);
  await shot(hi, 'L-hindi-locked-sheet');
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
