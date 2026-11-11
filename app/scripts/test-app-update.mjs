// The "Update homecookd" popup's machine and rules (src/lib/appUpdate.ts), under Node with fakes (no network):
//   every state × event; versions (1.10 > 1.9, unknown never offers); Apple's lookup answer (ours only); the lookup
//   never throws and gives up at its timeout; "Later" for 7 days or until a newer store version; whole launches through
//   the real machine: a newer store version offers the popup, TestFlight / App Review builds and odd answers never do,
//   one lookup per launch, and nothing waits on it. When the popup is up (popupShows): every input, and scenes against
//   the real sheet coordinator (lib/sheets): it never presents over another sheet and gives way to any that waits.
//   Its wiring in components/update/AppUpdatePopup and both Homes, read from the source.
//   node scripts/test-app-update.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});
const U = await import(pathToFileURL(join(root, 'src/lib/appUpdate.ts')).href);
const M = await import(pathToFileURL(join(root, 'src/lib/machine.ts')).href);
const C = await import(pathToFileURL(join(root, 'src/lib/sheets/coordinator.ts')).href);
const src = (p) => readFileSync(join(root, p), 'utf8');

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 10, 20);
// Apple's answer for homecookd on Nov 10 (trimmed): https://itunes.apple.com/lookup?id=6825621614
const apple = (version, trackId = 6825621614) => ({ resultCount: 1, results: [{ trackId, bundleId: 'com.salik.homecookd', version }] });

await test('every state × event', () => {
  const m = U.appUpdateMachine;
  const expected = {
    idle: { check: 'asking', skip: 'none' },
    asking: { newer: 'offered', snoozed: 'later', same: 'none', failed: 'none' },
    offered: { later: 'later' },
    later: {},
    none: {},
  };
  assert.deepEqual([...m.states].sort(), Object.keys(expected).sort());
  assert.deepEqual([...m.events].sort(), [...U.APP_UPDATE_EVENTS].sort());
  for (const st of m.states) for (const e of m.events) assert.equal(m.transition(st, e), expected[st][e] ?? null, `${st} --${e}-->`);
});

await test('versions: part by part, a missing part is 0; anything not like 1.2.3 is unknown', () => {
  const p = U.parseVersion;
  assert.deepEqual([p('1.1.0'), p('1.10'), p(' 2.0.1 '), p('1.2.3.4')], [[1, 1, 0], [1, 10], [2, 0, 1], [1, 2, 3, 4]]);
  for (const bad of [null, undefined, '', '1.1.0-beta', 'v1.1', '1..1', '1.2.3.4.5', 'a3f9c2e1d0', 110, '1.1.']) assert.equal(p(bad), null, String(bad));
  const c = (a, b) => Math.sign(U.compareVersions(p(a), p(b)));
  assert.deepEqual([c('1.10', '1.9'), c('1.1', '1.1.0'), c('1.1.1', '1.1.0'), c('1.1.0', '1.2'), c('2.0', '1.99.99')], [1, 0, 1, -1, 1]);
});

await test("Apple's answer: our app's version only", () => {
  assert.equal(U.storeVersionFrom(apple('1.1.0')), '1.1.0');
  assert.equal(U.storeVersionFrom(apple('1.1.0', 123)), null, 'another app');
  assert.equal(U.storeVersionFrom(apple('1.1.0-rc')), null);
  assert.equal(U.storeVersionFrom({ resultCount: 0, results: [] }), null, 'not in this store');
  for (const junk of [null, 'html', {}, { results: 'x' }, { results: [null] }]) assert.equal(U.storeVersionFrom(junk), null);
  assert.equal(U.LOOKUP_URL, 'https://itunes.apple.com/lookup?id=6825621614');
  assert.equal(U.APP_STORE_URL, 'https://apps.apple.com/app/id6825621614');
});

await test('the lookup never throws: offline, a 500, bad JSON, slow -> null', async () => {
  const urls = [];
  const ok = async (url) => (urls.push(url), new Response(JSON.stringify(apple('1.2.0'))));
  assert.equal(await U.lookupStoreVersion(ok), '1.2.0');
  assert.deepEqual(urls, [U.LOOKUP_URL]);
  assert.equal(await U.lookupStoreVersion(async () => new Response('down', { status: 500 })), null);
  assert.equal(await U.lookupStoreVersion(async () => new Response(JSON.stringify(apple('1.2.0')), { status: 503 })), null, 'a refusal with a body that looks right');
  assert.equal(await U.lookupStoreVersion(async () => new Response('<html>')), null);
  assert.equal(await U.lookupStoreVersion(async () => { throw new TypeError('Network request failed'); }), null);
  // Slow: the fetch only ends when it's aborted; the lookup gives up at its timeout.
  const slow = (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const t0 = Date.now();
  assert.equal(await U.lookupStoreVersion(slow, 30), null);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(U.LOOKUP_TIMEOUT_MS, 5000);
});

await test('"Later": the same store version for 7 days; a newer one, or 7 days on, offers again', () => {
  const s = { version: '1.2.0', at: NOW };
  assert.equal(U.SNOOZE_MS, 7 * DAY);
  assert.equal(U.snoozed(s, '1.2.0', NOW + 6 * DAY), true);
  assert.equal(U.snoozed(s, '1.2.0', NOW + 7 * DAY), false, '7 days on');
  assert.equal(U.snoozed(s, '1.2.1', NOW + DAY), false, 'a newer store version');
  assert.equal(U.snoozed(s, '1.1.9', NOW + DAY), true, 'an older one (the lookup lagging) stays hidden');
  assert.equal(U.snoozed(s, '1.2.0', NOW - DAY), false, 'the clock moved back');
  for (const junk of [null, {}, { version: 'x', at: NOW }, { version: '1.2.0', at: 'yesterday' }]) assert.equal(U.snoozed(junk, '1.2.0', NOW), false);
});

await test('what the answer means: newer, same (TestFlight and App Review builds too), failed, snoozed', () => {
  const e = U.lookupEvent;
  assert.equal(e('1.2.0', '1.1.0', null, NOW), 'newer');
  assert.equal(e('1.1.0', '1.1.0', null, NOW), 'same');
  assert.equal(e('1.1.0', '1.1.1', null, NOW), 'same', 'a TestFlight or App Review build is newer than the store');
  assert.equal(e(null, '1.1.0', null, NOW), 'failed');
  assert.equal(e('1.2.0', null, null, NOW), 'failed');
  assert.equal(e('1.2.0', 'a3f9c2e1d0', null, NOW), 'failed', 'a fingerprint runtime version is unknown');
  assert.equal(e('1.2.0', '1.1.0', { version: '1.2.0', at: NOW - DAY }, NOW), 'snoozed');
});

/** A launch: a fresh machine held as the card holds it, and a fake phone. */
function launch(o = {}) {
  const held = M.holdMachine(U.appUpdateMachine, 'idle');
  let lookups = 0;
  const deps = {
    ios: o.ios ?? true,
    own: 'own' in o ? o.own : '1.1.0',
    lookup: async () => {
      lookups += 1;
      if (o.lookup) return o.lookup();
      return 'store' in o ? o.store : '1.2.0';
    },
    snooze: async () => (o.snooze instanceof Error ? Promise.reject(o.snooze) : (o.snooze ?? null)),
    now: () => o.now ?? NOW,
  };
  return { held, deps, lookups: () => lookups, run: () => U.runCheck(held.send, deps) };
}

await test('a launch with a newer store version: the popup, then "Later" hides it', async () => {
  const l = launch();
  assert.equal(await l.run(), '1.2.0');
  assert.equal(l.held.now(), 'offered');
  assert.equal(l.held.send('later'), true);
  assert.equal(l.held.now(), 'later');
  assert.equal(l.held.send('later'), false, 'twice does nothing');
});

await test('never a popup: not an iPhone, own version unknown, TestFlight, same, offline, a throwing lookup', async () => {
  const cases = [
    [{ ios: false }, 0],
    [{ own: null }, 0],
    [{ own: 'a3f9c2e1d0' }, 0],
    [{ own: '1.3.0' }, 1], // TestFlight / App Review: newer than the store
    [{ store: '1.1.0' }, 1],
    [{ store: null }, 1], // offline, slow, bad JSON
    [{ lookup: () => Promise.reject(new Error('boom')) }, 1],
  ];
  for (const [o, lookups] of cases) {
    const l = launch(o);
    assert.equal(await l.run(), null, JSON.stringify(o));
    assert.equal(l.held.now(), 'none', JSON.stringify(o));
    assert.equal(l.lookups(), lookups, `${JSON.stringify(o)}: lookups`);
  }
});

await test('"Later" across launches: hidden for the same version, back after 7 days or for a newer version', async () => {
  const said = { version: '1.2.0', at: NOW };
  const hidden = launch({ snooze: said, now: NOW + DAY });
  assert.equal(await hidden.run(), null);
  assert.equal(hidden.held.now(), 'later');
  const weekOn = launch({ snooze: said, now: NOW + 8 * DAY });
  assert.equal(await weekOn.run(), '1.2.0');
  assert.equal(weekOn.held.now(), 'offered');
  const newer = launch({ snooze: said, store: '1.3.0', now: NOW + DAY });
  assert.equal(await newer.run(), '1.3.0');
  assert.equal(newer.held.now(), 'offered');
  const unreadable = launch({ snooze: new Error('storage') });
  assert.equal(await unreadable.run(), '1.2.0', 'a "Later" that can\'t be read is no "Later"');
});

await test('one lookup per launch, and nothing waits on it', async () => {
  let answer;
  const l = launch({ lookup: () => new Promise((r) => (answer = r)) });
  const first = l.run();
  assert.equal(l.held.now(), 'asking', 'asking at once; the launch goes on');
  assert.equal(await l.run(), null, 'a second Home in the same launch asks nothing');
  answer('1.2.0');
  assert.equal(await first, '1.2.0');
  assert.equal(await l.run(), null);
  assert.equal(l.lookups(), 1);
  assert.equal(l.held.now(), 'offered');
});

await test('each event is in the machine history (for a report)', async () => {
  M.clearMachineHistory();
  const l = launch();
  await l.run();
  l.held.send('later');
  assert.deepEqual(M.machineHistory().appUpdate.map((s) => [s.event, s.from, s.to]), [
    ['check', 'idle', 'asking'],
    ['newer', 'asking', 'offered'],
    ['later', 'offered', 'later'],
  ]);
});

const STATES = ['idle', 'asking', 'offered', 'later', 'none'];
const BLOOMS = ['none', 'playing', 'revealing', 'done'];

await test('when the popup is up: every input (state, screen, launch bloom, sheets up and held, up a moment ago)', () => {
  let n = 0;
  for (const wasUp of [false, true])
    for (const state of STATES)
      for (const homeOnScreen of [false, true])
        for (const bloom of BLOOMS)
          for (const sheetsUp of [0, 1, 2])
            for (const sheetsHeld of [0, 1]) {
              const got = U.popupShows(wasUp, { state, homeOnScreen, bloom, sheetsUp, sheetsHeld });
              const at = JSON.stringify({ wasUp, state, homeOnScreen, bloom, sheetsUp, sheetsHeld });
              // Never: before the offer, off its Home, over the launch bloom, or while a sheet waits to present.
              if (state !== 'offered' || !homeOnScreen || bloom === 'playing' || bloom === 'revealing' || sheetsHeld > 0) assert.equal(got, false, at);
              // Otherwise it comes up only when no sheet is up, and once up, the sheets up (its own) never take it down.
              else assert.equal(got, wasUp || sheetsUp === 0, at);
              n += 1;
            }
  assert.equal(n, 480);
});

/**
 * The popup on a Home as the app runs it, against the real sheet coordinator: each render decides `up`
 * (popupShows), and its BottomSheet turns that into the sheet's move (showEventFor, moveSheet), as BottomSheet's
 * layout effect does. `presentedOver` lists any moment it presented while another sheet's Modal was up.
 */
function popupOnHome() {
  const s = { up: false, sheet: 'hidden', state: 'offered', home: true, bloom: 'done', presentedOver: [] };
  s.render = () => {
    for (let i = 0; i < 4; i += 1) {
      const next = U.popupShows(s.up, { state: s.state, homeOnScreen: s.home, bloom: s.bloom, sheetsUp: C.upCount(), sheetsHeld: C.heldCount() });
      if (next === s.up) return s.up;
      s.up = next;
      const event = next ? C.showEventFor('popup') : 'hide';
      if (event === 'show' && C.upCount('popup') > 0) s.presentedOver.push(C.upCount('popup'));
      s.sheet = C.moveSheet('popup', s.sheet, event) ?? s.sheet;
    }
    throw new Error('popupShows never settled');
  };
  /** Its close finished: the commit that unmounts its Modal. */
  s.gone = () => {
    if (s.sheet === 'closing') {
      s.sheet = 'hidden';
      C.modalGone('popup');
    }
  };
  return s;
}
/** Another sheet ("Dad is on a new phone", the push ask), moved as BottomSheet moves it. */
function otherSheet(id) {
  const o = { state: 'hidden' };
  o.show = () => (o.state = C.moveSheet(id, o.state, C.showEventFor(id)) ?? o.state);
  o.settle = () => (o.state = C.moveSheet(id, o.state, 'settled') ?? o.state);
  o.hide = () => (o.state = C.moveSheet(id, o.state, 'hide') ?? o.state);
  o.gone = () => {
    o.state = 'hidden';
    C.modalGone(id);
  };
  return o;
}
const resetSheets = () => {
  for (const id of ['popup', 'move', 'push']) C.forgetSheet(id);
};

await test('a launch: not over the launch bloom; up once it has gone and no sheet is up; Later takes it down', () => {
  resetSheets();
  const p = popupOnHome();
  p.bloom = 'playing';
  assert.equal(p.render(), false);
  p.bloom = 'revealing';
  assert.equal(p.render(), false);
  p.bloom = 'done';
  assert.equal(p.render(), true);
  assert.equal(p.sheet, 'open');
  assert.equal(p.render(), true, 'its own Modal up never takes it down');
  p.state = 'later';
  assert.equal(p.render(), false);
  assert.equal(p.sheet, 'closing');
  p.gone();
  assert.equal(C.upCount(), 0);
  resetSheets();
});

await test('"Dad is on a new phone" is up first: the popup waits, and comes up after it has gone', () => {
  resetSheets();
  const move = otherSheet('move');
  move.show();
  assert.equal(move.state, 'open');
  const p = popupOnHome();
  assert.equal(p.render(), false);
  move.hide();
  assert.equal(p.render(), false, 'still going away');
  move.gone();
  assert.equal(p.render(), true);
  assert.deepEqual(p.presentedOver, []);
  resetSheets();
});

await test('a sheet that wants to present while the popup is up: the popup gives way, then comes back; nothing saved', () => {
  resetSheets();
  const p = popupOnHome();
  assert.equal(p.render(), true);
  const move = otherSheet('move');
  move.show();
  assert.equal(move.state, 'held', 'held behind the popup, never over it');
  assert.equal(p.render(), false, 'the popup goes');
  assert.equal(p.sheet, 'closing');
  assert.equal(p.state, 'offered', 'giving way is not a "Later"');
  p.gone();
  move.settle();
  assert.equal(move.state, 'open');
  assert.equal(p.render(), false, 'not over it');
  move.hide();
  move.gone();
  assert.equal(p.render(), true, 'back once it has gone');
  assert.deepEqual(p.presentedOver, []);
  resetSheets();
});

await test('two at once (the push ask and the popup in one commit): whichever is held, the popup is the one that waits', () => {
  for (const pushFirst of [true, false]) {
    resetSheets();
    const p = popupOnHome();
    const push = otherSheet('push');
    if (pushFirst) push.show();
    p.render();
    if (!pushFirst) push.show();
    p.render();
    assert.equal(push.state === 'open' || push.state === 'held', true, `${pushFirst}: the push ask is on its way`);
    assert.equal(p.up, false, `${pushFirst}: the popup is down`);
    if (push.state === 'held') {
      p.gone();
      push.settle();
    }
    assert.equal(push.state, 'open');
    assert.deepEqual(p.presentedOver, []);
  }
  // The popup decided it was up, and in the same commit the push ask presented first: the popup's sheet is held.
  resetSheets();
  const p = popupOnHome();
  const push = otherSheet('push');
  p.up = U.popupShows(false, { state: 'offered', homeOnScreen: true, bloom: 'done', sheetsUp: 0, sheetsHeld: 0 });
  push.show();
  p.sheet = C.moveSheet('popup', p.sheet, C.showEventFor('popup'));
  assert.equal([p.up, p.sheet].join(), 'true,held');
  assert.equal(p.render(), false, 'held itself, it gives way');
  assert.equal(p.sheet, 'hidden', 'dropped unseen, no Modal');
  assert.equal(C.heldCount(), 0);
  push.hide();
  push.gone();
  assert.equal(p.render(), true, 'up after the push ask');
  resetSheets();
});

await test('a push or a link opens another screen over Home: the popup goes, and is back on Home', () => {
  resetSheets();
  const p = popupOnHome();
  assert.equal(p.render(), true);
  p.home = false;
  assert.equal(p.render(), false);
  p.gone();
  p.home = true;
  assert.equal(p.render(), true);
  assert.equal(p.state, 'offered');
  resetSheets();
});

await test('heldCount: a sheet waiting to present counts; open, closing and hidden ones do not', () => {
  resetSheets();
  const a = otherSheet('move');
  const b = otherSheet('push');
  a.show();
  assert.equal(C.heldCount(), 0);
  b.show();
  assert.equal([b.state, C.heldCount()].join(), 'held,1');
  a.hide();
  assert.equal(C.heldCount(), 1);
  a.gone();
  b.settle();
  assert.equal(C.heldCount(), 0);
  resetSheets();
});

await test('the popup in the app: a centred BottomSheet driven by popupShows, no timer, Later on the glass, a drop saves nothing', () => {
  const pop = src('src/components/update/AppUpdatePopup.tsx');
  assert.match(pop, /<BottomSheet\s[^>]*visible=\{up\}/);
  assert.match(pop, /placement="center"/);
  assert.match(pop, /popupShows\(up, \{[^}]*homeOnScreen[^}]*bloom[^}]*sheetsUp[^}]*sheetsHeld/);
  assert.match(pop, /const homeOnScreen = useIsFocused\(\);/);
  assert.match(pop, /const bloom = useLaunchPhase\(\);/);
  assert.match(pop, /const sheetsUp = useSheetsUp\(\);/);
  assert.match(pop, /const sheetsHeld = useSheetsHeld\(\);/);
  assert.match(pop, /onClose=\{later\}/, 'a tap on the glass is Later');
  assert.match(pop, /onDropped=\{\(\) => \{\}\}/, 'a drop is not a Later');
  assert.match(pop, /TODO\(caleb\)/);
  assert.doesNotMatch(pop, /setTimeout|setInterval|whenSheetsClosed|afterClose/, 'no timer');
  const sheet = src('src/components/ui/BottomSheet.tsx');
  assert.match(sheet, /<BlurView intensity=\{GLASS_BLUR\} tint="light"/, 'blurred glass, no grey-out');
  assert.match(sheet, /accessibilityViewIsModal/);
});

await test('both Homes: the popup over them, and their own layout as before (no card in it)', () => {
  for (const home of ['src/app/parent/home.tsx', 'src/app/kid/home.tsx']) {
    const h = src(home);
    assert.equal(h.match(/<AppUpdatePopup \/>/g)?.length, 1, home);
    assert.doesNotMatch(h, /AppUpdateCard|styles\.update\b/, home);
  }
  assert.equal(existsSync(join(root, 'src/components/update/AppUpdateCard.tsx')), false);
});

console.log(`\n${passed} passed`);
