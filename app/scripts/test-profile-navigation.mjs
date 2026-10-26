// Profile taps on the kid profile (kid QA Oct 21, Neil: "Clicking on profiles, but it doesn't work").
// Run against Expo web served from THIS checkout (another checkout's server tests its code, not yours).
// All API calls use isolated fixture data, never the live family.
//   node scripts/test-profile-navigation.mjs [url]   (default $APP_URL, else http://localhost:8081, the
//                                                     port AGENTS.md starts Expo web on)
// Three ways the phone can be signed in, each a fresh browser session with a fake device key:
//   own     Leo's own phone (device_profile_id = Leo)
//   shared  a family-code phone (deviceVia 'code', device_profile_id null), Leo picked on it
//   lent    Caleb's phone (device_profile_id = Caleb), Leo "cooking as" on it
// Screenshots go to $SHOTS_DIR (default /tmp) as profile-*.png.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.argv[2] || process.env.APP_URL || 'http://localhost:8081';
const shots = process.env.SHOTS_DIR || '/tmp';
const people = [
  { id: 'p-leo', name: 'Leo', role: 'learner', avatar_key: 'leo' },
  { id: 'p-dad', name: 'Dad', role: 'cook', avatar_key: 'dad', locked: true, has_phone: true },
  { id: 'p-mom', name: 'Mom', role: 'cook', avatar_key: 'mom' },
].map((p) => ({ ...p, relation: null }));
const caleb = { id: 'p-caleb', name: 'Caleb', role: 'cook', avatar_key: null, relation: null, has_phone: true };
const modes = {
  own: { via: 'person', device: 'p-leo', profiles: people },
  shared: { via: 'code', device: null, profiles: people },
  lent: { via: 'person', device: 'p-caleb', profiles: [...people, caleb] },
};
const errors = [];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

/** A fresh session signed in the `mode` way. `opened` lists each POST /threads as [other_id, x-profile-id]. */
async function session(mode) {
  const m = modes[mode];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const state = { page, ctx, opened: [], failOpening: false };
  page.on('pageerror', (e) => errors.push(`${mode}: ${e.message}`));
  await page.addInitScript((via) => {
    localStorage.setItem('homecookd.deviceKey', 'fixture-only-not-real');
    localStorage.setItem('homecookd.deviceVia', via);
    localStorage.setItem('homecookd.aiConsent.v1', '2026-10-25T00:00:00.000Z'); // said yes on "Before we start"
  }, m.via);
  await page.route('**/functions/v1/api/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname.split('/api')[1];
    let data = {};
    if (path === '/family') data = { family: { id: 'test-fixture', name: 'TEST family' }, profiles: m.profiles, device_profile_id: m.device };
    else if (path === '/table') data = { week_start: '2026-10-19', people: m.profiles.map((p) => ({ profile_id: p.id, lit: false })), pairs: [], recordings: [] };
    else if (path === '/threads' && method === 'POST') {
      const other = req.postDataJSON().other_id;
      state.opened.push([other, req.headers()['x-profile-id'] ?? null]);
      assert.equal(other, 'p-dad');
      if (state.failOpening)
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture connection failed. Try again.' }) });
      data = { id: 'fixture-thread', other: people[1] };
    } else if (path === '/threads') data = [];
    else if (path.includes('/messages')) data = [];
    else if (path.includes('/threads/')) data = { id: 'fixture-thread', kind: 'pair', members: [people[0], people[1]], other: people[1] };
    else if (path === '/favorites') data = { recipe_ids: [] };
    else if (path === '/unread') data = { total: 0 };
    else if (path === '/events') data = { ok: true, counted: false };
    else if (path.includes('/favorites') || path.includes('/questions') || path.includes('/stats') || path.includes('/cooking') || path.includes('/notes'))
      data = [];
    else return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture route absent' }) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return state;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
/** A screenshot once the sheet or the fade-in has finished moving. */
const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/profile-${name}.png` });
};
/** Kid Home (round 2: a portal, no table row), loaded once "Start cooking" is there. */
const home = async (page, path = '/kid/home?as=leo') => {
  await page.goto(base + path).catch((e) => {
    throw new Error(`No Expo web server at ${base} (${e.message.split('\n')[0]}). Start one from this checkout's app/ (npx expo start --web --port 8081) or pass its URL.`);
  });
  await button(page, 'Start cooking').waitFor({ timeout: 45000 });
};
/** "Leo ▾" -> "Who's in the kitchen?" -> Dad's tile: his sheet must offer his dishes and Message Dad. */
async function openDadSheet(page) {
  await button(page, 'Leo. Who’s in the kitchen?').click();
  await page.waitForURL('**/?pick=1');
  await page.getByRole('button', { name: /^Dad, / }).click();
  await button(page, 'Message Dad').waitFor({ timeout: 15000 });
  await page.getByText('Dad’s recipes', { exact: true }).waitFor();
}
/** Message Dad: the chat opens as Leo, and the chat's Back lands on Leo's kid Home. */
async function messageDadAsLeo(s, label) {
  const before = s.opened.length;
  await button(s.page, 'Message Dad').click();
  await s.page.waitForURL('**/chat/fixture-thread');
  assert.deepEqual(s.opened.slice(before), [['p-dad', 'p-leo']], `${label}: the chat opens as Leo`);
  await s.page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await s.page.waitForURL('**/kid/home');
  await s.page.getByText('Hi, Leo', { exact: true }).first().waitFor();
}

try {
  // --- Leo's own phone ------------------------------------------------------------------------
  {
    const s = await session('own');
    const { page } = s;
    await home(page);
    await shot(page, 'home');
    // The pill is Leo's face only (the title already says "Hi, Leo"); its label still names him.
    assert.equal(await page.getByText('Leo', { exact: true }).count(), 0, 'no second "Leo" beside "Hi, Leo"');

    await openDadSheet(page);
    await shot(page, 'own-dad-sheet');
    await messageDadAsLeo(s, 'own phone');
    console.log('ok own phone: gateway, Dad’s sheet, Message Dad, Back to Leo’s Home');

    // (The table row's face that opened Dad's chat left kid Home in round 2; Message Dad is that path now.)
    await home(page);
    await openDadSheet(page);
    s.failOpening = true;
    const before = s.opened.length;
    await button(page, 'Message Dad').click();
    await page.getByText('Fixture connection failed. Try again.', { exact: true }).waitFor();
    assert.ok(s.opened.length > before, 'it tried');
    await shot(page, 'error');
    s.failOpening = false;
    await page.waitForTimeout(2000); // the button's error state settles back
    assert.equal(await button(page, 'Message Dad').isEnabled(), true);
    await button(page, 'Message Dad').click();
    await page.waitForURL('**/chat/fixture-thread');
    console.log('ok own phone: a failed open reports the error and permits a retry');
    await s.ctx.close();
  }

  // --- A shared family-code phone (no person of its own), Leo picked --------------------------
  {
    const s = await session('shared');
    const { page } = s;
    await home(page);
    await openDadSheet(page);
    await shot(page, 'shared-dad-sheet');
    await messageDadAsLeo(s, 'shared phone');
    console.log('ok shared phone: Dad’s sheet has his dishes and Message Dad (was a dead end)');
    await s.ctx.close();
  }

  // --- Caleb's phone, lent to Leo -------------------------------------------------------------
  {
    const s = await session('lent');
    const { page } = s;
    await home(page);
    await page.getByText('Cooking as Leo', { exact: true }).waitFor();
    await openDadSheet(page);
    await messageDadAsLeo(s, 'lent phone');
    await page.getByText('Cooking as Leo', { exact: true }).waitFor();
    await shot(page, 'lent-after-back');
    console.log('ok lent phone: Message Dad stays Leo, Back lands on Leo’s kid Home (was Caleb’s)');

    await openDadSheet(page);
    await page.getByRole('link', { name: /^Open / }).first().click();
    await page.waitForURL('**/kid/recipes/**');
    console.log('ok lent phone: one of Dad’s dishes opens in Leo’s Recipes tab');
    await s.ctx.close();
  }

  assert.deepEqual(errors, []);
  console.log('ok no uncaught app errors');
} finally {
  await browser.close();
}
