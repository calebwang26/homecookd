// The "Update homecookd" card's machine and rules (src/lib/appUpdate.ts), under Node with fakes (no network):
//   every state × event; versions (1.10 > 1.9, unknown never offers); Apple's lookup answer (ours only); the lookup
//   never throws and gives up at its timeout; "Later" for 7 days or until a newer store version; whole launches through
//   the real machine: a newer store version offers the card, TestFlight / App Review builds and odd answers never do,
//   one lookup per launch, and nothing waits on it.
//   node scripts/test-app-update.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

await test('a launch with a newer store version: the card, then "Later" hides it', async () => {
  const l = launch();
  assert.equal(await l.run(), '1.2.0');
  assert.equal(l.held.now(), 'offered');
  assert.equal(l.held.send('later'), true);
  assert.equal(l.held.now(), 'later');
  assert.equal(l.held.send('later'), false, 'twice does nothing');
});

await test('never a card: not an iPhone, own version unknown, TestFlight, same, offline, a throwing lookup', async () => {
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

console.log(`\n${passed} passed`);
