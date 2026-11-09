// Unit tests for PR 5's app logic (TS run by Node's type stripping):
//   src/lib/sundayTable.ts  "This week at the table": the faces, a chat's pair & its "6 weeks", the
//                           one-time milestone and its remembered-once flag, junk responses
//   src/lib/missHome.ts     the "I miss home" sheet's moves: nextClip (open, "Another") & the clip it
//                           hands the Hear player (tagged `heard`)
//   src/lib/tableApi.ts     the shared store when a shared phone switches people mid-request, and
//                           `failed` when no table comes
//   node scripts/test-table.mjs
// lib/storage is swapped for an in-memory map, as in scripts/test-retention.mjs. For tableApi, React,
// React Native, expo-router, lib/api, lib/session & lib/tz are small stand-ins and fetch is faked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STORAGE_STUB =
  'data:text/javascript,' +
  encodeURIComponent(`
const m = (globalThis.__kv ??= new Map());
export async function kvGet(k) { return m.has(k) ? m.get(k) : null; }
export async function kvSet(k, v) { if (v == null) m.delete(k); else m.set(k, String(v)); }
export async function kvGetJson(k) { const r = m.get(k); if (!r) return null; try { return JSON.parse(r); } catch { return null; } }
export function kvSetJson(k, v) { return kvSet(k, v == null ? null : JSON.stringify(v)); }
`);

const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const STUBS = {
  react: stub('export const useCallback = (f) => f; export const useEffect = () => {}; export const useSyncExternalStore = (_s, get) => get(); export const useReducer = (r, a, init) => [init ? init(a) : a, () => {}];'),
  'react-native': stub('export const AppState = { addEventListener: () => ({ remove() {} }) };'),
  'expo-router': stub('export const useIsFocused = () => true;'),
  './api': stub(`globalThis.__auth ??= { key: 'device-key', code: null, profileId: null };
if (!('__tz' in globalThis)) globalThis.__tz = 'America/Los_Angeles';
export const API_URL = 'https://api.test';
export function getApiAuth() { return { ...globalThis.__auth }; }
export function getApiTimeZone() { return globalThis.__tz; }`),
  './session': stub('export const useSession = () => ({ me: globalThis.__me ?? null });'),
  './tz': stub("export const deviceTimeZone = () => 'America/Los_Angeles';"),
};

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === './storage') return { url: STORAGE_STUB, shortCircuit: true };
    if (STUBS[spec]) return { url: STUBS[spec], shortCircuit: true };
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) {
      const p = join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`);
      if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(pathToFileURL(join(root, 'src/lib/sundayTable.ts')).href);
const M = await import(pathToFileURL(join(root, 'src/lib/missHome.ts')).href);
const T = await import(pathToFileURL(join(root, 'src/lib/tableApi.ts')).href);
const kv = globalThis.__kv;

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
};

const P = {
  mom: { id: 'p-mom', name: 'Mom', role: 'cook', avatar_key: 'mom' },
  dad: { id: 'p-dad', name: 'Dad', role: 'cook', avatar_key: null },
  gran: { id: 'p-gran', name: 'Grandma', role: 'cook', avatar_key: null },
  leo: { id: 'p-leo', name: 'Leo', role: 'learner', avatar_key: 'leo' },
  maya: { id: 'p-maya', name: 'Maya', role: 'learner', avatar_key: null },
};
// The session's order (profile sort): a kid first, to show cooks still come first.
const family = [P.leo, P.mom, P.maya, P.dad, P.gran];
const table = {
  week_start: '2026-10-12',
  people: [
    { profile_id: 'p-mom', lit: true },
    { profile_id: 'p-dad', lit: false },
    { profile_id: 'p-leo', lit: true },
    { profile_id: 'p-maya', lit: false },
  ],
  pairs: [
    { kid_id: 'p-leo', cook_id: 'p-mom', weeks: 6, ember_until: null, lit_this_week: true },
    { kid_id: 'p-leo', cook_id: 'p-dad', weeks: null, ember_until: '2026-10-19T07:00:00.000Z', lit_this_week: false },
    { kid_id: 'p-leo', cook_id: 'p-gran', weeks: 0, ember_until: null, lit_this_week: false },
  ],
};

// --- the faces -----------------------------------------------------------------------------------

await test('tableFaces: cooks first, then kids, me included; lit only from the table', () => {
  const faces = S.tableFaces(family, table, 'p-leo');
  assert.deepEqual(
    faces.map((f) => [f.profile.name, f.lit, f.isMe]),
    [
      ['Mom', true, false],
      ['Dad', false, false],
      ['Grandma', false, false], // not in the table yet: simply unlit
      ['Leo', true, true],
      ['Maya', false, false],
    ],
  );
});

await test('tableFaces: hidden without a table, or with nobody but me', () => {
  assert.deepEqual(S.tableFaces(family, null, 'p-leo'), []);
  assert.deepEqual(S.tableFaces(family, undefined, 'p-leo'), []);
  assert.deepEqual(S.tableFaces([P.leo], table, 'p-leo'), []);
  assert.equal(S.tableFaces([P.leo, P.mom], table, null).length, 2); // no one picked: everyone, no "me"
});

await test('tableFaces: the whole family by default; a max cuts the list, and I am never the one cut', () => {
  const cooks = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `Cook ${i}`, role: 'cook', avatar_key: null }));
  assert.equal(S.tableFaces([P.leo, ...cooks], table, 'p-leo').length, 10);
  const faces = S.tableFaces([P.leo, ...cooks], table, 'p-leo', S.TABLE_MAX_FACES);
  assert.equal(faces.length, S.TABLE_MAX_FACES);
  assert.deepEqual(faces.map((f) => f.profile.id), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'p-leo']);
  assert.equal(S.tableFaces([P.leo, ...cooks], table, 'c3', S.TABLE_MAX_FACES).at(3).isMe, true);
  assert.equal(S.tableFaces(family, table, 'p-leo', 3).at(-1).profile.id, 'p-leo');
});

await test('the row\'s "+N" counts the whole family, not just the first 8 (a family of 12)', () => {
  const big = [
    P.leo,
    ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `Cook ${i}`, role: 'cook', avatar_key: null })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, name: `Kid ${i}`, role: 'learner', avatar_key: null })),
  ];
  const faces = S.tableFaces(big, table, 'p-leo');
  assert.equal(faces.length, 12);
  // The kid Home on a 375-pt phone (327 pt / 56 = 5 cells): 4 faces + "+8", me among the 4.
  const kid = S.fitFaces(faces, Math.floor(327 / 56));
  assert.equal(kid.shown.length, 4);
  assert.equal(kid.more, 8);
  assert.equal(kid.shown.length + kid.more, big.length, 'everyone is a face or in the "+N"');
  assert.equal(kid.shown.some((f) => f.isMe), true);
  // The cook Home's big cells (327 / 68 = 4): 3 faces + "+9".
  const cook = S.fitFaces(faces, Math.floor(327 / 68));
  assert.deepEqual([cook.shown.length, cook.more], [3, 9]);
  // However wide the screen, 8 cells at most ("up to 8 faces"): 7 faces + "+5".
  const wide = S.fitFaces(faces, Math.floor(1200 / 48));
  assert.deepEqual([wide.shown.length, wide.more], [7, 5]);
  assert.deepEqual(S.fitFaces(faces.slice(0, 8), 25), { shown: faces.slice(0, 8), more: 0 });
});

await test('tableFaces: a memorial person is not on the row, and not in the "+N" either', () => {
  const memorialFamily = [P.leo, { ...P.gran, memorial: true }, { ...P.mom, memorial: false }, P.dad];
  // Even lit by a server that says so, Grandma isn't a face (guardrails 2 & 7: no standing unlit face).
  const litGran = { ...table, people: [...table.people, { profile_id: 'p-gran', lit: true }] };
  for (const t of [table, litGran]) {
    assert.deepEqual(
      S.tableFaces(memorialFamily, t, 'p-leo').map((f) => [f.profile.name, S.canTapFace(f)]),
      [
        ['Mom', true],
        ['Dad', true], // no flag from the server: as before, a face like any other
        ['Leo', false], // me
      ],
    );
  }
  // A big family: "+N" counts only the people the row is about.
  const cooks = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Cook ${i}`, role: 'cook', avatar_key: null }));
  const big = [P.leo, { ...P.gran, memorial: true }, ...cooks];
  const fit = S.fitFaces(S.tableFaces(big, table, 'p-leo'), Math.floor(327 / 56));
  assert.deepEqual([fit.shown.length, fit.more], [4, 4]);
  assert.equal(fit.shown.length + fit.more, big.length - 1, 'everyone but Grandma is a face or in the "+N"');
  assert.equal(fit.shown.some((f) => f.profile.id === 'p-gran'), false);
  // Me and a memorial person alone: nobody here but me, so no row.
  assert.deepEqual(S.tableFaces([P.leo, { ...P.gran, memorial: true }], table, 'p-leo'), []);
});

await test('canTapFace: never my own face; a memorial face built by hand is still not a button', () => {
  assert.equal(S.canTapFace({ isMe: true, profile: {} }), false);
  assert.equal(S.canTapFace({ isMe: false, profile: { memorial: true } }), false);
  assert.equal(S.canTapFace({ isMe: false, profile: { memorial: false } }), true);
  assert.equal(S.canTapFace({ isMe: false, profile: {} }), true);
});

await test('fitFaces: one row; when 8 don\'t fit, slots - 1 faces and a "+N", never cutting me', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ profile: { id: `f${i}`, name: `F${i}`, role: 'cook' }, lit: false, isMe: i === 7 }));
  const all = S.fitFaces(eight, 8);
  assert.equal(all.shown.length, 8);
  assert.equal(all.more, 0);
  // A 390-pt phone: 342 pt / 48 = 7 cells -> 6 faces + "+2", me kept in the last face cell.
  const seven = S.fitFaces(eight, Math.floor(342 / 48));
  assert.deepEqual(seven.shown.map((f) => f.profile.id), ['f0', 'f1', 'f2', 'f3', 'f4', 'f7']);
  assert.equal(seven.more, 2);
  assert.equal(seven.shown.length + 1, 7); // the "+2" takes the 7th cell
  assert.deepEqual(S.fitFaces(eight.slice(0, 3), 7), { shown: eight.slice(0, 3), more: 0 });
  // Never fewer than 2 cells (a face and the "+N"), whatever the width.
  const tiny = S.fitFaces(eight, 0);
  assert.equal(tiny.shown.length, 1);
  assert.equal(tiny.shown[0].isMe, true);
  assert.equal(tiny.more, 7);
  assert.deepEqual(S.fitFaces([], 7), { shown: [], more: 0 });
});

await test('litIds: the flames for "Who\'s in the kitchen?" tiles', () => {
  assert.deepEqual([...S.litIds(table)], ['p-mom', 'p-leo']);
  assert.deepEqual([...S.litIds(null)], []);
});

// --- a chat's pair & its count -------------------------------------------------------------------

await test('pairWith finds the pair from either side, never a pair I am not in', () => {
  assert.equal(S.pairWith(table, 'p-leo', 'p-mom').weeks, 6);
  const momSide = { ...table, pairs: [{ ...table.pairs[0] }] };
  assert.equal(S.pairWith(momSide, 'p-mom', 'p-leo').weeks, 6);
  assert.equal(S.pairWith(table, 'p-leo', 'p-maya'), null); // two kids: no pair
  assert.equal(S.pairWith(table, 'p-maya', 'p-mom'), null); // not my pair (the server never sends one)
  assert.equal(S.pairWith(table, 'p-leo', 'p-leo'), null);
  assert.equal(S.pairWith(null, 'p-leo', 'p-mom'), null);
  assert.equal(S.pairWith(table, null, 'p-mom'), null);
});

await test('weeksOf / weeksLabel: a count only when there is one (no 0, nothing during an ember)', () => {
  assert.equal(S.weeksLabel(S.weeksOf(S.pairWith(table, 'p-leo', 'p-mom'))), '6 weeks');
  assert.equal(S.weeksOf(S.pairWith(table, 'p-leo', 'p-dad')), null); // ember
  assert.equal(S.weeksOf(S.pairWith(table, 'p-leo', 'p-gran')), null); // 0
  assert.equal(S.weeksOf(null), null);
  assert.equal(S.weeksLabel(1), '1 week');
  assert.equal(S.weeksLabel(52), '52 weeks');
  for (const bad of [0, -1, null, undefined, NaN, Infinity]) assert.equal(S.weeksLabel(bad), null);
});

// --- the milestone -------------------------------------------------------------------------------

const at = (weeks, milestone) => ({ kid_id: 'p-leo', cook_id: 'p-mom', weeks, ember_until: null, lit_this_week: true, milestone });

await test('milestoneOf: only 4, 12, 26 or 52, and only while weeks is that number', () => {
  assert.equal(S.milestoneOf(at(12, 12)), 12);
  assert.equal(S.milestoneOf(at(4, 4)), 4);
  assert.equal(S.milestoneOf(at(13, 12)), null); // moved on
  assert.equal(S.milestoneOf(at(5, 5)), null); // not a milestone
  assert.equal(S.milestoneOf(at(null, 12)), null); // ember
  assert.equal(S.milestoneOf(at(12)), null);
  assert.equal(S.milestoneOf(null), null);
  assert.equal(S.milestoneTitle(12, 'Mom'), '12 weeks at the table with Mom');
  assert.equal(S.milestoneTitle(4, ' Leo '), '4 weeks at the table with Leo');
  assert.equal(S.milestoneTitle(4, ''), '4 weeks at the table');
});

await test('claimMilestone: one burst at a time per person, pair & milestone; seen once it has played, then never', async () => {
  kv.clear();
  assert.equal(await S.claimMilestone('p-leo', at(12, 12)), 12);
  assert.equal(await S.claimMilestone('p-leo', at(12, 12)), null); // held: a double effect, a second header
  assert.equal(kv.get('table.milestone.p-leo.p-leo.p-mom.12'), undefined); // not remembered until it plays
  await S.milestoneSeen('p-leo', at(12, 12), 12);
  assert.ok(kv.get('table.milestone.p-leo.p-leo.p-mom.12'));
  S.releaseMilestone('p-leo', at(12, 12), 12); // a late unmount after it played changes nothing
  assert.equal(await S.claimMilestone('p-leo', at(12, 12)), null);
  // Mom has her own burst for the same pair.
  assert.equal(await S.claimMilestone('p-mom', at(12, 12)), 12);
  // The next milestone is new.
  assert.equal(await S.claimMilestone('p-leo', at(26, 26)), 26);
  // Nothing to claim without a person or a milestone.
  assert.equal(await S.claimMilestone(null, at(4, 4)), null);
  assert.equal(await S.claimMilestone('p-leo', at(5, 5)), null);
  assert.equal(await S.claimMilestone('p-leo', null), null);
});

await test('claimMilestone: a chat closed before the burst finished leaves it for next time', async () => {
  kv.clear();
  const pair = { ...at(4, 4), kid_id: 'p-nia', cook_id: 'p-dad' };
  assert.equal(await S.claimMilestone('p-nia', pair), 4);
  S.releaseMilestone('p-nia', pair, 4); // a quick back tap during the 2 s hold
  assert.equal(kv.get('table.milestone.p-nia.p-nia.p-dad.4'), undefined);
  assert.equal(await S.claimMilestone('p-nia', pair), 4); // the next open plays it
  await S.milestoneSeen('p-nia', pair, 4);
  assert.equal(await S.claimMilestone('p-nia', pair), null);
});

await test('claimMilestone remembers across launches (storage), even with a fresh module', async () => {
  kv.clear();
  kv.set('table.milestone.p-maya.p-maya.p-dad.4', '2026-10-01T00:00:00.000Z'); // seen on an earlier launch
  assert.equal(await S.claimMilestone('p-maya', { ...at(4, 4), kid_id: 'p-maya', cook_id: 'p-dad' }), null);
});

await test('asTable keeps a well-formed response and refuses junk', () => {
  assert.deepEqual(S.asTable(table), table);
  assert.equal(S.asTable(null), null);
  assert.equal(S.asTable({ error: 'No route for GET /table' }), null);
  assert.equal(S.asTable('<html>'), null);
  const messy = S.asTable({ week_start: '2026-10-12', people: [{ profile_id: 'a', lit: 'yes' }, null, { lit: true }], pairs: [{ kid_id: 'k' }, table.pairs[0]] });
  assert.deepEqual(messy.people, [{ profile_id: 'a', lit: false }]);
  assert.deepEqual(messy.pairs, [table.pairs[0]]);
});

await test('asTable & familyRecordings: this family\'s recordings, none from an older server', () => {
  const withRec = S.asTable({ ...table, recordings: ['mom-dal', 7, '', null, 'dad-chili'] });
  assert.deepEqual(withRec.recordings, ['mom-dal', 'dad-chili']);
  assert.deepEqual([...S.familyRecordings(withRec)], ['mom-dal', 'dad-chili']);
  assert.equal('recordings' in S.asTable(table), false, 'an older server: no list');
  assert.equal(S.familyRecordings(S.asTable(table)).size, 0, 'no list: nothing plays');
  assert.equal(S.familyRecordings(null).size, 0);
});

// --- "I miss home": the sheet's moves ----------------------------------------------------------------

const NOW = Date.parse('2026-10-18T18:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const clip = (key, kind = 'step') => ({
  key, kind, recipeId: key.split('#')[0], recipeTitle: 'Sunday Dal', cookId: 'p-mom', cookName: 'Mom',
  url: 'https://bucket.test/mom-dal/voice.m4a', start_s: 10, end_s: 30, words: 'A pinch, then taste.',
});
const pool = [clip('mom-dal#story-s1', 'story'), clip('mom-dal#step-1'), clip('mom-dal#step-2'), clip('mom-dal#step-3')];
const first = () => 0; // rand: always the first candidate

await test('nextClip: opens on a story, remembers it, and "Another" never repeats while others remain', async () => {
  kv.clear();
  const seen = [];
  let current = null;
  for (let i = 0; i < pool.length; i++) {
    const c = await M.nextClip(pool, 'p-leo', { current, rand: first, now: NOW + i * 1000 });
    seen.push(c.key);
    current = c.key;
  }
  assert.equal(seen[0], 'mom-dal#story-s1'); // stories first
  assert.equal(new Set(seen).size, pool.length); // every clip once
  assert.deepEqual(await M.loadRecentKeys('p-leo', NOW + 10_000), seen);
  // Everything heard this week: the one heard longest ago, never the clip on screen.
  const again = await M.nextClip(pool, 'p-leo', { current, rand: first, now: NOW + 10_000 });
  assert.equal(again.key, seen[0]);
  assert.notEqual(again.key, current);
});

await test('nextClip: a clip heard 7+ days ago is fresh again; the log is per person', async () => {
  kv.clear();
  await M.nextClip(pool, 'p-leo', { rand: first, now: NOW - 8 * DAY }); // the story, a week+ ago
  const c = await M.nextClip(pool, 'p-leo', { rand: first, now: NOW });
  assert.equal(c.key, 'mom-dal#story-s1');
  assert.equal((await M.nextClip(pool, 'p-maya', { rand: first, now: NOW })).key, 'mom-dal#story-s1'); // Maya's own log
});

await test('nextClip: one clip only plays again; an empty pool is null and remembers nothing', async () => {
  kv.clear();
  const one = [clip('mom-dal#step-1')];
  assert.equal((await M.nextClip(one, 'p-leo', { now: NOW })).key, 'mom-dal#step-1');
  assert.equal((await M.nextClip(one, 'p-leo', { current: 'mom-dal#step-1', now: NOW + 1 })).key, 'mom-dal#step-1');
  assert.equal(await M.nextClip([], 'p-leo', { now: NOW }), null);
  assert.equal(kv.get('missHome.played.p-leo') === undefined, false);
  kv.clear();
  await M.nextClip([], 'p-leo', { now: NOW });
  assert.equal(kv.size, 0);
});

await test('missHomeAudioClip: the range for the Hear player, its own key, tagged heard with the cook', () => {
  assert.deepEqual(M.missHomeAudioClip(pool[0]), {
    url: 'https://bucket.test/mom-dal/voice.m4a',
    start_s: 10,
    end_s: 30,
    key: 'missHome:mom-dal#story-s1',
    heard: { recipe_id: 'mom-dal', cook_id: 'p-mom' },
  });
  assert.equal(M.missHomeAudioClip(null), null);
});

// --- the shared table when a shared phone switches people ----------------------------------------

/** fetch, answered by hand: each GET /table waits until the test settles it. */
const pending = [];
globalThis.fetch = (url, init) =>
  new Promise((resolve, reject) => {
    pending.push({ url, person: init.headers['x-profile-id'] ?? null, headers: init.headers, resolve, reject });
  });
const answer = (i, tableBody) => pending[i].resolve(new Response(JSON.stringify(tableBody), { status: 200 }));
const tableFor = (who) => ({ week_start: '2026-10-12', people: [{ profile_id: who, lit: true }], pairs: [] });
const settle = () => new Promise((r) => setTimeout(r, 0));
const shown = (me) => {
  globalThis.__me = me ? { id: me } : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React is a stand-in here: this just reads the store
  return T.useTable().table;
};

await test('tableApi: asks as the person passed in (x-profile-id), not whoever the api client points at', async () => {
  pending.length = 0;
  globalThis.__auth.profileId = 'p-mom'; // the client already moved on to Mom
  const p = T.refreshTable('p-leo', { force: true });
  assert.equal(pending[0].url, 'https://api.test/table');
  assert.equal(pending[0].person, 'p-leo');
  assert.equal(pending[0].headers['x-device-key'], 'device-key');
  assert.equal(pending[0].headers['x-tz'], 'America/Los_Angeles');
  answer(0, tableFor('p-leo'));
  assert.deepEqual((await p).people, [{ profile_id: 'p-leo', lit: true }]);
  T.refreshTable(null, { force: true }); // nobody picked: faces only, no x-profile-id
  assert.equal(pending[1].person, null);
  answer(1, tableFor('nobody'));
  await settle();
});

await test('tableApi: no x-tz while the api client sends none (the web ?as= dev aid)', async () => {
  pending.length = 0;
  globalThis.__tz = null;
  const p = T.refreshTable('p-leo', { force: true });
  assert.equal('x-tz' in pending[0].headers, false);
  answer(0, tableFor('p-leo'));
  await p;
  globalThis.__tz = 'America/Los_Angeles';
});

await test('tableApi: a late answer for the person before never replaces the new person\'s table', async () => {
  pending.length = 0;
  const maya = T.refreshTable('p-maya', { force: true }); // Maya asks...
  const dad = T.refreshTable('p-dad', { force: true }); // ...and hands the phone to Dad
  answer(1, tableFor('p-dad'));
  await dad;
  assert.deepEqual(shown('p-dad').people, [{ profile_id: 'p-dad', lit: true }]);
  answer(0, tableFor('p-maya')); // Maya's answer arrives last
  await maya;
  assert.deepEqual(shown('p-dad').people, [{ profile_id: 'p-dad', lit: true }], 'Dad keeps his row');
  // A later failure for Maya doesn't blank Dad's row either.
  pending.length = 0;
  const again = T.refreshTable('p-maya', { force: true });
  const back = T.refreshTable('p-dad', { force: true });
  answer(1, tableFor('p-dad'));
  await back;
  pending[0].reject(new TypeError('Network request failed'));
  await again;
  assert.deepEqual(shown('p-dad').people, [{ profile_id: 'p-dad', lit: true }]);
});

await test('tableApi: the earlier person\'s answer landing first is dropped, then the new one lands', async () => {
  pending.length = 0;
  const a = T.refreshTable('p-leo', { force: true });
  const b = T.refreshTable('p-gran', { force: true });
  answer(0, tableFor('p-leo'));
  await a;
  assert.equal(shown('p-gran'), null, 'nothing for Grandma yet, and never Leo\'s table');
  answer(1, tableFor('p-gran'));
  await b;
  assert.deepEqual(shown('p-gran').people, [{ profile_id: 'p-gran', lit: true }]);
  // Fresh for 10 s: asking again reuses it without a call.
  const n = pending.length;
  assert.deepEqual((await T.refreshTable('p-gran')).people, [{ profile_id: 'p-gran', lit: true }]);
  assert.equal(pending.length, n);
});

await test('tableApi: `failed` only once an ask ends with no table (the kid Home stops holding room for the row)', async () => {
  pending.length = 0;
  const read = (me) => {
    globalThis.__me = { id: me };
    // eslint-disable-next-line react-hooks/rules-of-hooks -- React is a stand-in here: this just reads the store
    const { table: t, failed } = T.useTable();
    return { people: t?.people ?? null, failed };
  };
  const first = T.refreshTable('p-new', { force: true });
  assert.deepEqual(read('p-new'), { people: null, failed: false }, 'still on its way: not failed');
  pending[0].reject(new TypeError('Network request failed')); // offline at first launch
  await first;
  assert.deepEqual(read('p-new'), { people: null, failed: true });
  const back = T.refreshTable('p-new', { force: true }); // back online
  answer(1, tableFor('p-new'));
  await back;
  assert.deepEqual(read('p-new'), { people: [{ profile_id: 'p-new', lit: true }], failed: false });
  const later = T.refreshTable('p-new', { force: true }); // a later failure keeps the table: not failed
  pending[2].resolve(new Response(JSON.stringify({ error: 'Not here' }), { status: 404 }));
  await later;
  assert.deepEqual(read('p-new'), { people: [{ profile_id: 'p-new', lit: true }], failed: false });
  // An older server without the route (404) for someone new, or junk: failed.
  const old = T.refreshTable('p-old', { force: true });
  pending[3].resolve(new Response(JSON.stringify({ error: 'Not here' }), { status: 404 }));
  await old;
  assert.deepEqual(read('p-old'), { people: null, failed: true });
  const junk = T.refreshTable('p-junk', { force: true });
  answer(4, { hello: 'proxy page' });
  await junk;
  assert.deepEqual(read('p-junk'), { people: null, failed: true });
});

console.log(`\n${passed} passed`);
