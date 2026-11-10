// Routing + logging check for the lander's home page (ROUTE_GATE in src/lib/audience-gate.ts; the
// beacons in src/lib/audience-route.ts).
//
//   node scripts/qa/route-check.mjs                              # against the dev server (localhost:3000)
//   node scripts/qa/route-check.mjs --url http://localhost:4173  # against `npm run perf -- --serve`
//   node scripts/qa/route-check.mjs --only beacon                # just the cases whose name has "beacon"
//
// Every case runs in a fresh browser context (empty storage) unless it says otherwise. It checks
// which version opens (by the canonical link: /learn = kid, else parent), the final address (aud,
// from and via stripped; utm_*, for and the hash kept), the saved pick, window.__hcRoute, and the
// /web-events beacons (intercepted, never sent): one per page load, with the right payload, and
// none under automation without ?log=1. Exits 1 with the reasons when anything fails.
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = req('playwright')); }
catch { ({ chromium } = createRequire('/Users/calebwang/.npm/_npx/e41f203b7505f1fb/node_modules/')('playwright')); }

const argv = process.argv.slice(2);
const urlAt = argv.indexOf('--url');
const BASE = (urlAt >= 0 && argv[urlAt + 1] ? argv[urlAt + 1] : 'http://localhost:3000').replace(/\/+$/, '');
const PORT = new URL(BASE).port || '80';
// a non-local host name for the same server, so the automation guard (navigator.webdriver) is
// tested on its own (localhost is skipped anyway)
const ALIAS = `http://homecookd.test:${PORT}`;

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SNAPCHAT = `${IPHONE} Snapchat/12.70.0.31 (like Safari/8618.1.15.10.15, panda)`;
const FACEBOOK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22A3354 [FBAN/FBIOS;FBAV/480.0.0.42.110;FBBV/650000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.0;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]';

const failures = [];
const skipped = [];
let passed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); }
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [`--host-resolver-rules=MAP homecookd.test 127.0.0.1`],
});

/** A fresh context whose /web-events beacons are recorded and answered locally. */
async function fresh(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const beacons = [];
  await ctx.route('**/web-events*', async (route) => {
    const r = route.request();
    let body = null;
    try { body = JSON.parse(r.postData() ?? 'null'); } catch { body = r.postData(); }
    beacons.push({ url: r.url(), method: r.method(), type: r.headers()['content-type'] ?? '', body });
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, beacons, errors };
}

/** Wait until the page at `path` has run its gate and hydrated (the dev server may compile first). */
async function settle(page, path, ms = 1500, timeout = 90000) {
  await page.waitForFunction(
    (p) => location.pathname === p && document.readyState !== 'loading' && !!window.__hcRoute && !!window.__homecookdHydrated,
    path,
    { timeout, polling: 100 },
  );
  await page.waitForTimeout(ms); // room for a late or second beacon
}

async function state(page) {
  return page.evaluate(() => {
    const canon = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
    let saved = null;
    try { saved = localStorage.getItem('homecookd.aud'); } catch { /* blocked */ }
    return {
      path: location.pathname,
      search: location.search,
      hash: location.hash,
      version: /\/learn\/?$/.test(canon) ? 'kid' : 'parent',
      saved,
      route: window.__hcRoute ?? null,
      hidden: document.documentElement.style.visibility === 'hidden',
    };
  });
}

const noRouteParams = (search) => !/[?&](aud|from|via)=/.test(search);

/** The hero's H1 (its aria-label), the switch button and the final CTA's "Take a look" peek link. */
async function heroOf(page) {
  return page.evaluate(() => {
    const top = document.getElementById('top');
    const sw = top?.querySelector('a[href*="via=hero"]');
    const peek = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Take a look');
    return {
      h1: top?.querySelector('h1')?.getAttribute('aria-label') ?? '',
      switchText: sw?.textContent?.trim() ?? '',
      switchHref: sw?.getAttribute('href') ?? '',
      peekHref: peek?.getAttribute('href') ?? '',
    };
  });
}

/** Visit `path` in a fresh context; expect to settle on `expect` (a pathname). */
async function visit(path, expect, opts = {}, prep) {
  const t = await fresh(opts);
  if (prep) await prep(t);
  await t.page.goto(BASE + path, { waitUntil: 'commit' });
  await settle(t.page, expect);
  return { ...t, s: await state(t.page) };
}

const onlyAt = argv.indexOf('--only');
const ONLY = onlyAt >= 0 ? argv[onlyAt + 1] : null; // --only <text>: run the cases whose name has it

async function run(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  console.log(`\n${name}`);
  try { await fn(); } catch (e) { check('ran without throwing', false, e.message.split('\n')[0]); }
}

try {
  console.log(`route-check: ${BASE}`);

  await run('/ → parent, no redirect, signal default', async () => {
    const { ctx, s, beacons, errors } = await visit('/', '/');
    check('stays on /', s.path === '/');
    check('parent version', s.version === 'parent', s.version);
    check('signal default', s.route?.signal === 'default', s.route?.signal);
    check('nothing saved', s.saved === null, s.saved);
    check('not hidden', !s.hidden);
    check('no beacon without ?log=1 (localhost + automation)', beacons.length === 0, `${beacons.length} sent`);
    check('no page errors', errors.length === 0, errors.join(' | '));
    const hero = await heroOf(ctx.pages()[0]);
    check('hero H1 is the parent headline', hero.h1 === "Record it once. They'll cook it forever.", hero.h1);
    check('hero switch "Here to learn the recipes?" → /learn?aud=kid&via=hero', /^Here to learn the recipes\?/.test(hero.switchText) && hero.switchHref === '/learn?aud=kid&via=hero', `${hero.switchText} → ${hero.switchHref}`);
    check('"Take a look" peek → /learn, no aud (nothing saved)', hero.peekHref === '/learn', hero.peekHref);
    await ctx.close();
  });

  await run('/learn → the kid hero with "Are you the cook?" back to /', async () => {
    const { ctx, page } = await visit('/learn', '/learn');
    const hero = await heroOf(page);
    check('hero H1 is the kid headline', /^Cook it like .+ does\.$/.test(hero.h1), hero.h1);
    check('hero switch "Are you the cook?" → /?aud=parent&via=hero', /^Are you the cook\?/.test(hero.switchText) && hero.switchHref === '/?aud=parent&via=hero', `${hero.switchText} → ${hero.switchHref}`);
    check('"Take a look" peek → /teach (never routed), no aud', hero.peekHref === '/teach', hero.peekHref);
    await ctx.close();
  });

  await run('/r keeps its own params (the gate only runs on /, /learn, /teach)', async () => {
    const t = await fresh();
    await t.page.goto(BASE + '/r?fixture=demo&from=Mom&aud=kid', { waitUntil: 'load' });
    await t.page.waitForTimeout(1500);
    const r = await t.page.evaluate(() => {
      let saved = null;
      try { saved = localStorage.getItem('homecookd.aud'); } catch { /* blocked */ }
      return { search: location.search, route: window.__hcRoute ?? null, saved };
    });
    check('from and aud left in the URL', /from=Mom/.test(r.search) && /aud=kid/.test(r.search), r.search);
    check('no routing record, nothing saved', r.route === null && r.saved === null, JSON.stringify(r));
    await t.ctx.close();
  });

  await run('/?aud=kid → /learn, params stripped, kid saved', async () => {
    const { ctx, s } = await visit('/?aud=kid', '/learn');
    check('lands on /learn', s.path === '/learn');
    check('kid version', s.version === 'kid', s.version);
    check('aud/from/via stripped', s.search === '', s.search);
    check('signal aud', s.route?.signal === 'aud', s.route?.signal);
    check('saved kid', s.saved === 'kid', s.saved);
    await ctx.close();
  });

  await run('/?aud=parent&from=app → parent, signal link', async () => {
    const { ctx, s } = await visit('/?aud=parent&from=app', '/');
    check('stays on /', s.path === '/');
    check('parent version', s.version === 'parent');
    check('signal link', s.route?.signal === 'link', s.route?.signal);
    check('stripped', s.search === '', s.search);
    check('saved parent', s.saved === 'parent', s.saved);
    await ctx.close();
  });

  await run('/learn?aud=kid&from=app (a recipe link) → stays on /learn', async () => {
    const { ctx, s } = await visit('/learn?aud=kid&from=app', '/learn');
    check('stays on /learn', s.path === '/learn');
    check('kid version', s.version === 'kid');
    check('signal link', s.route?.signal === 'link', s.route?.signal);
    check('saved kid', s.saved === 'kid', s.saved);
    check('stripped', s.search === '', s.search);
    await ctx.close();
  });

  await run('/teach?aud=parent&from=app (a "teach me" request) → stays on /teach', async () => {
    const { ctx, s } = await visit('/teach?aud=parent&from=app', '/teach');
    check('stays on /teach', s.path === '/teach');
    check('parent version', s.version === 'parent');
    check('signal link', s.route?.signal === 'link', s.route?.signal);
    check('saved parent', s.saved === 'parent', s.saved);
    await ctx.close();
  });

  await run('/?from=r (no aud) → parent, signal link', async () => {
    const { ctx, s } = await visit('/?from=r', '/');
    check('parent version', s.version === 'parent');
    check('signal link', s.route?.signal === 'link', s.route?.signal);
    check('nothing saved', s.saved === null, s.saved);
    await ctx.close();
  });

  const saveKid = async ({ page }) => {
    await page.goto(`${BASE}/learn`, { waitUntil: 'commit' });
    await page.evaluate(() => localStorage.setItem('homecookd.aud', 'kid'));
  };

  await run('saved kid visiting / → /learn, signal saved', async () => {
    const { ctx, s } = await visit('/', '/learn', {}, saveKid);
    check('lands on /learn', s.path === '/learn');
    check('kid version', s.version === 'kid');
    check('signal saved', s.route?.signal === 'saved', s.route?.signal);
    await ctx.close();
  });

  await run('saved kid visiting /?aud=parent → parent (the aud param wins)', async () => {
    const { ctx, s } = await visit('/?aud=parent', '/', {}, saveKid);
    check('stays on /', s.path === '/');
    check('signal aud', s.route?.signal === 'aud', s.route?.signal);
    check('pick now parent', s.saved === 'parent', s.saved);
    await ctx.close();
  });

  await run('Snapchat in-app browser visiting / → /learn, signal snapchat', async () => {
    const { ctx, s } = await visit('/', '/learn', { userAgent: SNAPCHAT, viewport: { width: 390, height: 844 } });
    check('lands on /learn', s.path === '/learn');
    check('kid version', s.version === 'kid');
    check('signal snapchat', s.route?.signal === 'snapchat', s.route?.signal);
    check('app snapchat', s.route?.app === 'snapchat', s.route?.app);
    check('nothing saved (Snapchat is not a pick)', s.saved === null, s.saved);
    await ctx.close();
  });

  await run('Snapchat with a saved parent pick → parent (saved beats Snapchat)', async () => {
    const { ctx, s } = await visit('/', '/', { userAgent: SNAPCHAT }, async ({ page }) => {
      await page.goto(`${BASE}/learn`, { waitUntil: 'commit' });
      await page.evaluate(() => localStorage.setItem('homecookd.aud', 'parent'));
    });
    check('stays on /', s.path === '/');
    check('signal saved', s.route?.signal === 'saved', s.route?.signal);
    await ctx.close();
  });

  await run('Facebook in-app browser visiting / → parent, app facebook', async () => {
    const { ctx, s } = await visit('/', '/', { userAgent: FACEBOOK });
    check('stays on /', s.path === '/');
    check('parent version', s.version === 'parent');
    check('signal default', s.route?.signal === 'default', s.route?.signal);
    check('app facebook', s.route?.app === 'facebook', s.route?.app);
    await ctx.close();
  });

  await run('/learn?aud=kid&via=hero (the hero switch) → switch, ui hero', async () => {
    const { ctx, s } = await visit('/learn?aud=kid&via=hero', '/learn');
    check('stays on /learn', s.path === '/learn');
    check('signal switch', s.route?.signal === 'switch', s.route?.signal);
    check('ui hero', s.route?.ui === 'hero', s.route?.ui);
    check('saved kid', s.saved === 'kid', s.saved);
    check('stripped', s.search === '', s.search);
    await ctx.close();
  });

  await run('/?aud=parent&via=footer (switching back) → parent, ui footer', async () => {
    const { ctx, s } = await visit('/?aud=parent&via=footer', '/', {}, saveKid);
    check('stays on /', s.path === '/');
    check('signal switch', s.route?.signal === 'switch', s.route?.signal);
    check('ui footer', s.route?.ui === 'footer', s.route?.ui);
    check('pick now parent', s.saved === 'parent', s.saved);
    await ctx.close();
  });

  await run('Back after a hero switch → / and stays on the parent page', async () => {
    const { ctx, page } = await visit('/', '/');
    const hero = page.locator('a[href^="/learn?aud=kid&via=hero"]').first();
    // the page Back returns to: if it comes back from the bfcache, the gate legitimately doesn't re-run
    await page.evaluate(() => addEventListener('pageshow', (e) => { if (e.persisted) window.__bf = true; }));
    const found = (await hero.count()) > 0 && (await hero.isVisible());
    check('the hero switch button is on the page and visible', found);
    if (!found) { await ctx.close(); return; }
    await hero.click();
    await settle(page, '/learn', 500);
    const mid = await state(page);
    check('tapping the hero switch opens /learn', mid.path === '/learn' && mid.version === 'kid');
    check('switch saved kid', mid.saved === 'kid', mid.saved);
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForFunction(() => location.pathname === '/' && document.readyState !== 'loading', null, { timeout: 60000 });
    await page.waitForTimeout(2500); // a redirect would have happened by now
    const s = await state(page);
    check('back on /', s.path === '/', s.path);
    const bf = await page.evaluate(() => window.__bf === true);
    check('the gate saw a Back visit (or the page came back from the bfcache)', s.route?.back === true || bf, JSON.stringify({ back: s.route?.back, bf }));
    check('still the parent page', s.version === 'parent', s.version);
    check('not hidden', !s.hidden);
    await ctx.close();
  });

  await run('utm_*, for and the hash survive; only aud/from/via go', async () => {
    const { ctx, s } = await visit('/?aud=kid&from=app&for=dad&utm_source=snap&utm_campaign=fall#questions', '/learn');
    check('lands on /learn', s.path === '/learn');
    check('aud/from/via gone', noRouteParams(s.search), s.search);
    check('utm_source kept', /[?&]utm_source=snap(&|$)/.test(s.search), s.search);
    check('utm_campaign kept', /[?&]utm_campaign=fall(&|$)/.test(s.search), s.search);
    check('for kept', /[?&]for=dad(&|$)/.test(s.search), s.search);
    check('hash kept', s.hash === '#questions', s.hash);
    check('signal link', s.route?.signal === 'link', s.route?.signal);
    await ctx.close();
  });

  // ---------- beacons (?log=1 opts in on localhost and under automation) ----------
  const one = (beacons, label) => {
    check(`${label}: exactly one beacon`, beacons.length === 1, `${beacons.length} sent${beacons.length ? `: ${JSON.stringify(beacons.map((b) => b.body))}` : ''}`);
    return beacons[0] ?? { body: {} };
  };

  await run('beacon: /?log=1 → land parent default', async () => {
    const { ctx, beacons } = await visit('/?log=1', '/');
    const b = one(beacons, '/');
    check('POST to /web-events', b.method === 'POST' && /\/web-events$/.test(new URL(b.url ?? 'http://x').pathname), b.url);
    check('text/plain', /text\/plain/.test(b.type), b.type);
    const p = b.body;
    check('event land', p.event === 'land', p.event);
    check('aud parent', p.aud === 'parent', p.aud);
    check('signal default', p.signal === 'default', p.signal);
    check('path /', p.path === '/', p.path);
    check('host localhost', p.host === new URL(BASE).hostname, p.host);
    check('no ui, no app', p.ui === undefined && p.app === undefined, JSON.stringify(p));
    await ctx.close();
  });

  await run('beacon: /?aud=kid&log=1&utm_* → one land from /learn, none from the redirecting /', async () => {
    const { ctx, beacons } = await visit('/?aud=kid&log=1&utm_source=snap&utm_campaign=fall', '/learn', {}, undefined);
    const p = one(beacons, 'redirect').body;
    check('event land', p.event === 'land', p.event);
    check('aud kid', p.aud === 'kid', p.aud);
    check('signal aud', p.signal === 'aud', p.signal);
    check('path /learn', p.path === '/learn', p.path);
    check('utm_source + utm_campaign', p.utm_source === 'snap' && p.utm_campaign === 'fall', `${p.utm_source} ${p.utm_campaign}`);
    await ctx.close();
  });

  await run('beacon: /learn?aud=kid&via=hero&log=1 → switch ui hero', async () => {
    const { ctx, beacons } = await visit('/learn?aud=kid&via=hero&log=1', '/learn');
    const p = one(beacons, 'switch').body;
    check('event switch', p.event === 'switch', p.event);
    check('aud kid (the version it opened)', p.aud === 'kid', p.aud);
    check('no arrival in a fresh tab, so no signal', p.signal === undefined, p.signal);
    check('ui hero', p.ui === 'hero', p.ui);
    await ctx.close();
  });

  await run('beacon: a switch keeps where the tab came from (ad → switch)', async () => {
    const { ctx, page, beacons } = await visit('/?aud=parent&utm_source=fb&utm_campaign=moms&log=1', '/');
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    await page.evaluate(() => { location.href = '/learn?aud=kid&via=hero&log=1'; });
    await settle(page, '/learn');
    check('two beacons (land, switch)', beacons.length === 2 && beacons[0].body.event === 'land' && beacons[1].body.event === 'switch', JSON.stringify(beacons.map((b) => b.body.event)));
    const p = beacons[1]?.body ?? {};
    check('switch carries the arrival signal aud', p.signal === 'aud', p.signal);
    check('switch carries the arrival utm_*', p.utm_source === 'fb' && p.utm_campaign === 'moms', `${p.utm_source} ${p.utm_campaign}`);
    await ctx.close();
  });

  // The hero's "See it work" link was cut (Caleb, Oct 18), so the only hero tap is the CTA.
  // "Get the app now" opens the App Store (#480), so the tap's beacon has to go out as the page leaves the site
  // (sendBeacon). Apple's page is answered locally here, never fetched.
  await run('beacon: tapping the hero "Get the app now" (the App Store) → tap cta', async () => {
    const { ctx, page, beacons } = await visit('/?log=1', '/');
    await ctx.route('https://apps.apple.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>App Store (stub)</title>' }));
    check('no "See it work" link in the hero', (await page.locator('#top a[href="#see-it-work"]').count()) === 0);
    const before = beacons.length;
    await page.locator('#top a[href^="https://apps.apple.com/"]').first().click();
    await page.waitForTimeout(800);
    const taps = beacons.slice(before).map((b) => b.body);
    check('the tap left for the App Store', page.url().startsWith('https://apps.apple.com/'), page.url());
    check('one tap', taps.length === 1 && taps[0]?.event === 'tap', JSON.stringify(taps));
    check('ui cta, aud parent, signal default', taps[0]?.ui === 'cta' && taps[0]?.aud === 'parent' && taps[0]?.signal === 'default', JSON.stringify(taps));
    await ctx.close();
  });

  await run('beacon: /?aud=parent&via=hero&log=1 (from the kid page) → switch parent', async () => {
    const { ctx, beacons } = await visit('/?aud=parent&via=hero&log=1', '/', {}, saveKid);
    const p = one(beacons, 'switch back').body;
    check('event switch', p.event === 'switch', p.event);
    check('aud parent', p.aud === 'parent', p.aud);
    check('ui hero', p.ui === 'hero', p.ui);
    await ctx.close();
  });

  await run('beacon: Snapchat /?log=1 → land kid snapchat', async () => {
    const { ctx, beacons } = await visit('/?log=1', '/learn', { userAgent: SNAPCHAT });
    const p = one(beacons, 'snapchat').body;
    check('aud kid, signal snapchat, app snapchat', p.aud === 'kid' && p.signal === 'snapchat' && p.app === 'snapchat', JSON.stringify(p));
    await ctx.close();
  });

  await run('beacon: Facebook /?log=1 → land parent default, app facebook', async () => {
    const { ctx, beacons } = await visit('/?log=1', '/', { userAgent: FACEBOOK });
    const p = one(beacons, 'facebook').body;
    check('aud parent, signal default, app facebook', p.aud === 'parent' && p.signal === 'default' && p.app === 'facebook', JSON.stringify(p));
    await ctx.close();
  });

  await run('beacon: Back after a switch sends nothing for the Back visit', async () => {
    const { ctx, page, beacons } = await visit('/?log=1', '/');
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    await page.evaluate(() => { location.href = '/learn?aud=kid&via=hero&log=1'; });
    await settle(page, '/learn');
    const before = beacons.length;
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForFunction(() => location.pathname === '/' && document.readyState !== 'loading', null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    check('two beacons before Back (land, switch)', before === 2 && beacons[0].body.event === 'land' && beacons[1].body.event === 'switch', JSON.stringify(beacons.map((b) => b.body.event)));
    check('none for the Back visit', beacons.length === before, `${beacons.length - before} more`);
    await ctx.close();
  });

  // ---------- the automation guard on a non-local host ----------
  // The page is opened as homecookd.test (so only navigator.webdriver can hold the beacon back) and
  // every request is answered by the real server: the dev server refuses unknown hosts otherwise.
  const proxied = async () => {
    const t = await fresh();
    await t.ctx.route(`${ALIAS}/**`, async (route) => {
      const r = route.request();
      if (/\/web-events/.test(r.url())) return route.fallback();
      const res = await route.fetch({ url: BASE + r.url().slice(ALIAS.length), headers: { ...r.headers(), host: new URL(BASE).host } });
      await route.fulfill({ response: res });
    });
    return t;
  };
  await run(`automation guard on a non-local host (${ALIAS})`, async () => {
    const quiet = await proxied();
    await quiet.page.goto(`${ALIAS}/`, { waitUntil: 'commit' });
    try {
      await settle(quiet.page, '/', 1500, 25000);
    } catch {
      // next dev refuses its HMR socket to any host but localhost, and the page never hydrates
      skipped.push('automation guard on a non-local host: the dev server only hydrates on localhost; run against the static build (npm run perf -- --serve, then --url http://localhost:4173)');
      console.log('  - skipped (the dev server only hydrates on localhost)');
      await quiet.ctx.close();
      return;
    }
    check('navigator.webdriver, no ?log=1 → nothing sent', quiet.beacons.length === 0, `${quiet.beacons.length} sent`);
    await quiet.ctx.close();
    const loud = await proxied();
    await loud.page.goto(`${ALIAS}/?log=1`, { waitUntil: 'commit' });
    await settle(loud.page, '/');
    const p = one(loud.beacons, 'alias ?log=1').body;
    check('host recorded', p.host === 'homecookd.test', p.host);
    await loud.ctx.close();
  });
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped` : ''}.`);
for (const s of skipped) console.log(`  - ${s}`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
