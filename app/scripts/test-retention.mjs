// Unit tests for the retention build's app logic (TS run by Node's type stripping):
//   src/lib/missHome.ts       "I miss home" clip pool, the no-repeat pick, the per-profile play log
//   src/lib/kitchenCounts.ts  "Grandma's kitchen, 4 of 7", the cook's mirror line, "I made it" milestones
//   src/lib/tz.ts             the x-tz value (read fresh: it follows a flight home)
//   src/lib/push.ts           when the push explainer may show (v2's two moments even on the first
//                             launch), the OS answer, tap routing, Convex's copy of the token,
//                             sign-out that never waits on the network, the message push noted for
//                             the double tap
//   src/lib/media.ts          the 'heard' measure: once per play of a cook's voice, only from 3 s
//   src/lib/touches.ts        PR 7's little touches: cook mode's step dots,
//                             the hand-drawn strike, the new-message double tap, its baseline and
//                             when it stays quiet (a message push said it, a chat is open)
//   node scripts/test-retention.mjs
// Uses the bundled library in assets/data (every family dish there is a sample, so nothing may count)
// plus small hand-made recipes for the real-recording cases. lib/storage is swapped for an in-memory
// map so the play log runs without AsyncStorage. For push.ts, 'expo', 'expo-constants' and
// 'react-native' are tiny stubs reading globalThis.__env, and its lazy require() of expo-device and
// expo-notifications goes to a global require() that hands out fakes (an ES module has no require of
// its own, so the global one is what it finds). For media.ts, 'expo-audio' hands out a fake player
// whose status updates the test sends, and 'react' / 'expo-video' are inert (no hook runs here).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// In-memory stand-in for src/lib/storage.ts (same exports, same never-throw contract).
const STORAGE_STUB =
  'data:text/javascript,' +
  encodeURIComponent(`
const m = (globalThis.__kv ??= new Map());
export async function kvGet(k) { return m.has(k) ? m.get(k) : null; }
export async function kvSet(k, v) { if (v == null) m.delete(k); else m.set(k, String(v)); }
export async function kvGetJson(k) { const r = m.get(k); if (!r) return null; try { return JSON.parse(r); } catch { return null; } }
export function kvSetJson(k, v) { return kvSet(k, v == null ? null : JSON.stringify(v)); }
`);

const stub = (src) => 'data:text/javascript,' + encodeURIComponent(src);
const STUBS = {
  './storage': STORAGE_STUB,
  expo: stub('export function isRunningInExpoGo() { return !!globalThis.__env.expoGo; } export function useEventListener() {}'),
  'expo-audio': stub(`export function createAudioPlayer(url) {
    const p = { url, isLoaded: true, fns: [], currentTime: 0,
      addListener(_e, fn) { this.fns.push(fn); return { remove() {} }; },
      seekTo(t) { this.currentTime = t; return Promise.resolve(); },
      play() {}, pause() {}, remove() {},
      emit(st) { for (const f of this.fns) f({ isLoaded: true, duration: 600, didJustFinish: false, ...st }); } };
    (globalThis.__players ??= []).push(p);
    return p;
  }`),
  'expo-video': stub('export function useVideoPlayer() { return null; }'),
  react: stub('const none = () => {}; export const useCallback = (f) => f; export const useEffect = none; export const useRef = (v) => ({ current: v }); export const useState = (v) => [v, none]; export const useSyncExternalStore = (_s, g) => g(); export const useReducer = (r, a, init) => [init ? init(a) : a, () => {}];'),
  'expo-constants': stub(`export default {
    get easConfig() { const id = globalThis.__env.projectId; return id ? { projectId: id } : null; },
    get expoConfig() { return { extra: {} }; },
  };`),
  'react-native': stub(
    'export const Platform = { get OS() { return globalThis.__env.os; } };' +
      // lib/media's background listener (video only; nothing here sends the app away).
      'export const AppState = { addEventListener() { return { remove() {} }; } };',
  ),
};

// The app imports siblings without an extension ('./storage'); resolve them to .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (STUBS[spec]) return { url: STUBS[spec], shortCircuit: true };
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) {
      const p = join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`);
      if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(root, 'src/lib/missHome.ts')).href);
const K = await import(pathToFileURL(join(root, 'src/lib/kitchenCounts.ts')).href);
const T = await import(pathToFileURL(join(root, 'src/lib/tz.ts')).href);
const U = await import(pathToFileURL(join(root, 'src/lib/touches.ts')).href);
const kv = globalThis.__kv;

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-18T18:00:00Z');
const lib = JSON.parse(readFileSync(join(root, 'assets/data/library.json'), 'utf8'));

// The family: two cooks, two kids (me = Leo), plus a profile who happens to share a YouTube creator's name.
const P = {
  mom: { id: 'p-mom', name: 'Mom', role: 'cook' },
  grandma: { id: 'p-grandma', name: 'Grandma', role: 'cook' },
  dad: { id: 'p-dad', name: 'Dad', role: 'learner' }, // records too, but signed up as a learner
  leo: { id: 'p-leo', name: 'Leo', role: 'learner' },
  maya: { id: 'p-maya', name: 'Maya', role: 'learner' },
  gordon: { id: 'p-gordon', name: 'Gordon', role: 'cook' },
};
const family = [P.mom, P.grandma, P.dad, P.leo, P.maya, P.gordon];

const entry = (id, cook_name, extra = {}) => ({ id, title: id, cook_name, relation: cook_name, poster_url: null, tags: [], sample: false, recipe_url: '', ...extra });
const step = (order, start_s, end_s, quote) => ({ order, title: `Step ${order}`, instruction: '', sensory_cue: null, start_s, end_s, quote, wait_after: null, story_ids: [], special_ids: [] });
const story = (id, start_s, end_s, text) => ({ id, step: 1, start_s, end_s, title: id, text });
const recipe = (id, cook, extra = {}) => ({
  id,
  title: `Title ${id}`,
  cook: { name: cook, relation: cook },
  intro: '',
  servings: null,
  total_time: null,
  sample: false,
  source: null,
  tags: [],
  media: { video_url: null, audio_url: `https://bucket/${id}/voice.m4a`, poster_url: null, duration_s: 900 },
  sessions: [],
  ingredients: [],
  steps: [],
  stories: [],
  special: [],
  follow_up_questions: [],
  ...extra,
});

// ---- tz
await test('deviceTimeZone: the runtime zone, read fresh each time (a flight home), odd answers fall back', () => {
  const tz = T.deviceTimeZone();
  assert.equal(tz, Intl.DateTimeFormat().resolvedOptions().timeZone || T.DEFAULT_TZ);
  assert.equal(T.DEFAULT_TZ, 'America/Los_Angeles');
  const real = Intl.DateTimeFormat;
  const zoneIs = (timeZone) => {
    Intl.DateTimeFormat = function () {
      return { resolvedOptions: () => ({ timeZone }) };
    };
  };
  try {
    zoneIs('Asia/Tokyo');
    assert.equal(T.deviceTimeZone(), 'Asia/Tokyo');
    zoneIs('Europe/London');
    assert.equal(T.deviceTimeZone(), 'Europe/London', 'never the zone from before');
    zoneIs('');
    assert.equal(T.deviceTimeZone(), T.DEFAULT_TZ);
    zoneIs('x'.repeat(65));
    assert.equal(T.deviceTimeZone(), T.DEFAULT_TZ, 'the server takes at most 64 characters');
  } finally {
    Intl.DateTimeFormat = real;
  }
});

// ---- missHome: the pool
const momSoup = recipe('mom-soup', 'Mom', {
  stories: [story('s1', 300, 340, '  My mother made this every winter.  '), story('s2', 500, 500, 'zero length'), story('s3', 600, 650, '   ')],
  steps: [
    step(1, 10, 40, 'Just a handful of ginger.'),
    step(2, 100, 220, 'Low heat, you have to wait.'), // 120 s: capped at 60
    step(3, 230, 260, null),
    step(4, 880, 990, 'Taste it now.'), // past the 900 s recording: clamped
  ],
});
const grandmaPork = recipe('grandma-pork', 'grandma', {
  stories: [story('s1', 50, 70, 'We ate this at New Year.')],
  steps: [step(1, 0, 20, 'Sugar first, until it is amber.')],
});
const excluded = [
  recipe('mom-sample', 'Mom', { sample: true, steps: [step(1, 0, 10, 'synthetic words')] }),
  recipe('mom-silent', 'Mom', { media: { video_url: null, audio_url: null, poster_url: null, duration_s: 100 }, steps: [step(1, 0, 10, 'no audio')] }),
  recipe('gordon-gnocchi', 'Gordon', { cook: { name: 'Gordon', relation: 'YouTube' }, steps: [step(1, 0, 10, 'a stranger')] }),
  recipe('gordon-two', 'Gordon', { source: 'Gordon Ramsay (YouTube)', steps: [step(1, 0, 10, 'a stranger')] }),
  recipe('leo-eggs', 'Leo', { steps: [step(1, 0, 10, 'my own voice')] }),
  recipe('miles-steak', 'Miles', { steps: [step(1, 0, 10, 'not in this family')] }),
];
const pool = M.clipPool([momSoup, ...excluded, grandmaPork, momSoup], family, P.leo.id);

await test('clipPool: only family cooks’ real recordings, stories first, words verbatim', () => {
  assert.deepEqual(
    pool.map((c) => c.key),
    ['mom-soup#story-s1', 'grandma-pork#story-s1', 'mom-soup#step-1', 'mom-soup#step-2', 'mom-soup#step-4', 'grandma-pork#step-1'],
  );
  const s1 = pool[0];
  assert.equal(s1.kind, 'story');
  assert.equal(s1.words, 'My mother made this every winter.');
  assert.deepEqual([s1.start_s, s1.end_s], [300, 340]);
  assert.equal(s1.cookId, 'p-mom');
  assert.equal(s1.cookName, 'Mom');
  assert.equal(s1.url, 'https://bucket/mom-soup/voice.m4a');
  assert.equal(s1.recipeTitle, 'Title mom-soup');
  assert.equal(pool[1].cookId, 'p-grandma'); // 'grandma' matches 'Grandma'
});

await test('clipPool: clips are at most 60 s and inside the recording', () => {
  const by = Object.fromEntries(pool.map((c) => [c.key, c]));
  assert.deepEqual([by['mom-soup#step-2'].start_s, by['mom-soup#step-2'].end_s], [100, 160]);
  assert.deepEqual([by['mom-soup#step-4'].start_s, by['mom-soup#step-4'].end_s], [880, 900]);
  for (const c of pool) assert.ok(c.end_s > c.start_s && c.end_s - c.start_s <= M.CLIP_MAX_S, c.key);
});

await test('clipPool: empty without family recordings (the bundled library is all samples)', () => {
  const bundled = lib.map((e) => JSON.parse(readFileSync(join(root, 'assets/data/recipes', `${e.id}.json`), 'utf8')));
  const profiles = [{ id: 'd', name: 'Dad' }, { id: 'g', name: 'Grandma' }, { id: 'a', name: 'Auntie Lin' }, { id: 'me', name: 'Leo' }];
  const everyDish = lib.map((e) => e.id); // as if this family had published every dish
  assert.deepEqual(M.clipPool(bundled, profiles, 'me'), []);
  assert.deepEqual(M.missHomeEntries(lib, profiles, 'me', everyDish), []);
  // A real recording by someone who is in the family does count, once this family published it. (Every bundled
  // dish is a sample since Nov 7, Uncle Ray's Swordfish Steak included, so this one stands in for a family's own.)
  const real = lib.map((e) => (e.id === 'weed-steak' ? { ...e, sample: false } : e));
  assert.deepEqual(M.missHomeEntries(real, [...profiles, { id: 'm', name: 'Uncle Ray' }], 'me', everyDish).map((e) => e.id), ['weed-steak']);
  // ...but not when it's my own.
  assert.deepEqual(M.missHomeEntries(real, [{ id: 'm', name: 'Uncle Ray' }], 'm', everyDish), []);
  // The bundle is all samples now: the same family sees none of it.
  assert.deepEqual(M.missHomeEntries(lib, [...profiles, { id: 'm', name: 'Uncle Ray' }], 'me', everyDish), []);
});

await test('missHome: only THIS family\'s recordings play, never a same-named cook\'s from another family', () => {
  // Another family's real "Mom" recording matches this family's Mom by name in the shared library.
  const entries = [entry('mom-soup', 'Mom'), entry('other-mom-stew', 'Mom'), entry('grandma-pork', 'Grandma')];
  const ours = new Set(['mom-soup', 'grandma-pork']);
  assert.deepEqual(M.missHomeEntries(entries, family, P.leo.id, ours).map((e) => e.id), ['mom-soup', 'grandma-pork']);
  const otherStew = recipe('other-mom-stew', 'Mom', { stories: [story('s1', 0, 20, 'A stranger’s story.')] });
  const scoped = M.clipPool([momSoup, otherStew, grandmaPork], family, P.leo.id, ours);
  assert.equal(scoped.some((c) => c.recipeId === 'other-mom-stew'), false);
  assert.deepEqual([...new Set(scoped.map((c) => c.recipeId))], ['mom-soup', 'grandma-pork']);
  // No list yet (an older server, offline before the table answers): no clips, so no pill.
  assert.deepEqual(M.missHomeEntries(entries, family, P.leo.id, null), []);
  assert.deepEqual(M.missHomeEntries(entries, family, P.leo.id, []), []);
  assert.deepEqual(M.clipPool([momSoup], family, P.leo.id, null), []);
});

await test('missHomeEntries: no samples, no YouTube (even with a namesake profile), not mine', () => {
  const entries = [entry('a', 'Mom'), entry('b', 'Mom', { sample: true }), entry('c', 'Gordon', { relation: 'YouTube' }), entry('d', 'Leo'), entry('e', 'Stranger')];
  assert.deepEqual(M.missHomeEntries(entries, family, P.leo.id, ['a', 'b', 'c', 'd', 'e']).map((e) => e.id), ['a']);
});

// ---- missHome: the pick
const seq = (...xs) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

await test('clipPool: a memorial cook’s clips stay in the pool', () => {
  const nana = { id: 'p-nana', name: 'Nana', role: 'cook', memorial: true };
  const nanaBuns = recipe('nana-buns', 'Nana', { stories: [story('s1', 5, 25, 'Your grandpa loved these.')], steps: [step(1, 30, 50, 'Knead until it feels like an earlobe.')] });
  const keys = M.clipPool([nanaBuns], [...family, nana], P.leo.id).map((c) => [c.key, c.cookId]);
  assert.deepEqual(keys, [['nana-buns#story-s1', 'p-nana'], ['nana-buns#step-1', 'p-nana']]);
  assert.deepEqual(M.missHomeEntries([entry('nana-buns', 'Nana')], [...family, nana], P.leo.id, ['nana-buns']).map((e) => e.id), ['nana-buns']);
});

await test('pickClip: fresh stories first, then fresh steps, at random among them', () => {
  assert.equal(M.pickClip(pool, [], () => 0).key, 'mom-soup#story-s1');
  assert.equal(M.pickClip(pool, [], () => 0.99).key, 'grandma-pork#story-s1');
  assert.equal(M.pickClip(pool, ['mom-soup#story-s1'], () => 0).key, 'grandma-pork#story-s1');
  const steps = new Set();
  for (let r = 0; r < 1; r += 0.05) steps.add(M.pickClip(pool, ['mom-soup#story-s1', 'grandma-pork#story-s1'], () => r).kind);
  assert.deepEqual([...steps], ['step']);
  assert.equal(M.pickClip([], [], Math.random), null);
  // rand() === 1, a negative value, NaN or Infinity never indexes past the ends.
  assert.ok(M.pickClip(pool, [], () => 1));
  assert.ok(M.pickClip(pool, [], () => -0.5));
  assert.equal(M.pickClip(pool, [], () => NaN).key, 'mom-soup#story-s1');
  assert.equal(M.pickClip(pool, [], () => Infinity).key, 'mom-soup#story-s1');
  assert.equal(M.pickClip(pool, ['mom-soup#story-s1', 'grandma-pork#story-s1'], () => NaN).key, 'mom-soup#step-1');
});

await test('pickClip: never a clip from the last 7 days while another is fresh', () => {
  for (let played = 0; played < pool.length; played++) {
    const recent = pool.slice(0, played).map((c) => c.key);
    for (let r = 0; r < 1; r += 0.01) {
      const c = M.pickClip(pool, recent, () => r);
      assert.ok(!recent.includes(c.key), `${c.key} repeated with ${played} played`);
    }
  }
});

await test('pickClip: "Another" never replays the clip on screen; all heard -> the oldest listen', () => {
  assert.equal(M.pickClip(pool, [], () => 0, 'mom-soup#story-s1').key, 'grandma-pork#story-s1');
  const all = pool.map((c) => c.key); // oldest first
  assert.equal(M.pickClip(pool, all, () => 0).key, all[0]);
  assert.equal(M.pickClip(pool, all, () => 0, all[0]).key, all[1]);
  // Keys no longer in the pool (a recipe was removed) are skipped.
  assert.equal(M.pickClip(pool, ['gone#step-1', ...all], () => 0).key, all[0]);
  // One clip only: it plays again rather than nothing.
  assert.equal(M.pickClip(pool.slice(0, 1), [pool[0].key], () => 0, pool[0].key).key, pool[0].key);
});

// ---- missHome: the play log (storage stub)
await test('play log: per profile, 7-day window, one entry per clip, oldest first', async () => {
  kv.clear();
  await M.rememberPlayed('kid-a', 'x#step-1', NOW - 8 * DAY);
  await M.rememberPlayed('kid-a', 'y#step-1', NOW - 3 * DAY);
  await M.rememberPlayed('kid-a', 'z#story-s1', NOW - 2 * DAY);
  await M.rememberPlayed('kid-a', 'x#step-1', NOW - 1 * DAY);
  assert.deepEqual(await M.loadRecentKeys('kid-a', NOW), ['y#step-1', 'z#story-s1', 'x#step-1']);
  assert.deepEqual(await M.loadRecentKeys('kid-b', NOW), []);
  assert.ok(kv.has('missHome.played.kid-a'));
  // Exactly 7 days old is out; garbage rows are ignored.
  const log = [{ key: 'old', at: NOW - 7 * DAY }, { key: 'ok', at: NOW - 7 * DAY + 1 }, { nope: 1 }, null, { key: 'future', at: NOW + DAY }];
  assert.deepEqual(M.recentKeys(log, NOW), ['ok']);
  assert.deepEqual(M.prunePlayLog('not a log', NOW), []);
});

await test('a week of "Another": every clip once before any repeat, then the oldest first', async () => {
  kv.clear();
  const rand = seq(0.42, 0.07, 0.9, 0.5, 0.31, 0.77, 0.12);
  const heard = [];
  let current = null;
  for (let i = 0; i < pool.length * 2; i++) {
    const at = NOW + i * 60_000; // a tap a minute
    const clip = M.pickClip(pool, await M.loadRecentKeys('kid-a', at), rand, current);
    heard.push(clip.key);
    current = clip.key;
    await M.rememberPlayed('kid-a', clip.key, at);
  }
  const firstRound = heard.slice(0, pool.length);
  assert.equal(new Set(firstRound).size, pool.length);
  assert.deepEqual(firstRound.slice(0, 2).sort(), ['grandma-pork#story-s1', 'mom-soup#story-s1']); // stories first
  assert.deepEqual(heard.slice(pool.length), firstRound); // then in the order they were heard
  // Eight days later everything is fresh again.
  const later = await M.loadRecentKeys('kid-a', NOW + 8 * DAY);
  assert.deepEqual(later, []);
});

// ---- kitchenCounts
const library = [
  entry('g1', 'Grandma'),
  entry('m1', 'Mom'),
  entry('g2', 'Grandma'),
  entry('g-sample', 'Grandma', { sample: true }),
  entry('g3', 'grandma'),
  entry('m2', 'Mom'),
  entry('gordon-1', 'Gordon', { relation: 'YouTube' }),
  entry('leo-1', 'Leo'),
  entry('miles-1', 'Miles'),
  entry('dad-1', 'Dad'),
  entry('g1', 'Grandma'), // listed twice
];
const stats = { g1: { cooked: 2 }, g3: { cooked: 1 }, 'g-sample': { cooked: 5 }, 'gordon-1': { cooked: 3 }, 'leo-1': { cooked: 1 }, 'miles-1': { cooked: 1 }, m1: { cooked: 0 }, 'dad-1': { cooked: 1 } };

await test('kitchenCounts: per family cook, real recordings only, cooks first', () => {
  const counts = K.kitchenCounts(library, family, stats, P.leo.id);
  assert.deepEqual(
    counts.map((k) => [k.cookName, k.cooked, k.total, k.complete]),
    [
      ['Mom', 0, 2, false],
      ['Grandma', 2, 3, false],
      ['Dad', 1, 1, true],
    ],
  );
  const g = counts[1];
  assert.equal(g.cookId, 'p-grandma');
  assert.deepEqual(g.recipeIds, ['g1', 'g2', 'g3']);
  assert.deepEqual(g.cookedIds, ['g1', 'g3']);
});

await test('kitchenCounts: samples and YouTube never count; the bundled library has nothing to count', () => {
  const profiles = [{ id: 'd', name: 'Dad', role: 'cook' }, { id: 'g', name: 'Grandma', role: 'cook' }, { id: 'me', name: 'Leo', role: 'learner' }, { id: 'y', name: 'Gordon', role: 'cook' }];
  const everything = Object.fromEntries(lib.map((e) => [e.id, { cooked: 3 }]));
  assert.deepEqual(K.kitchenCounts(lib, profiles, everything, 'me'), []);
  assert.equal(K.countableEntry({ sample: false, relation: 'YouTube' }), false);
  assert.equal(K.countableEntry({ sample: true, relation: 'Dad' }), false);
  assert.equal(K.countableEntry({ sample: false, relation: 'Dad' }), true);
});

await test('kitchenFor and earnsStamp', () => {
  const counts = K.kitchenCounts(library, family, stats, P.leo.id);
  assert.equal(K.kitchenFor(counts, ' grandma ').cookId, 'p-grandma');
  assert.equal(K.kitchenFor(counts, 'Gordon'), null);
  assert.equal(K.kitchenFor(counts, null), null);
  const stamp = (id) => K.earnsStamp(library.find((e) => e.id === id), family, stats, P.leo.id);
  assert.equal(stamp('g1'), true);
  assert.equal(stamp('g2'), false); // not cooked yet
  assert.equal(stamp('g-sample'), false);
  assert.equal(stamp('gordon-1'), false);
  assert.equal(stamp('leo-1'), false); // my own
  assert.equal(stamp('miles-1'), false); // not a family profile
});

await test('cookMirror + mirrorLine: "Leo can cook 4 of your 7. Maya, 2."', () => {
  const mine = [1, 2, 3, 4, 5, 6, 7].map((n) => entry(`d${n}`, 'Dad')).concat(entry('d-sample', 'Dad', { sample: true }));
  const by = (...rows) => ({ cooked: { count: rows.length, by: rows.map(([profile_id, count]) => ({ profile_id, count, last_at: '' })) } });
  const dish = {
    d1: by(['p-leo', 1], ['p-maya', 2], ['p-mom', 1]),
    d2: by(['p-leo', 3]),
    d3: by(['p-leo', 1], ['p-maya', 1]),
    d4: by(['p-leo', 1], ['p-dad', 9]), // Dad is me: never counted
    d5: by(['p-grandma', 0]), // a zero row is no cook
    'd-sample': by(['p-leo', 1], ['p-maya', 1]),
  };
  const m = K.cookMirror(mine, dish, family, P.dad.id);
  assert.equal(m.total, 7);
  assert.deepEqual(m.people.map((p) => [p.name, p.cooked]), [['Leo', 4], ['Maya', 2], ['Mom', 1]]); // kids first
  assert.equal(K.mirrorLine(m), 'Leo can cook 4 of your 7. Maya, 2. Mom, 1.');
  assert.equal(K.mirrorLine({ total: 7, people: [{ profileId: 'p-leo', name: 'Leo', cooked: 4 }, { profileId: 'p-maya', name: 'Maya', cooked: 2 }] }), 'Leo can cook 4 of your 7. Maya, 2.');
});

await test('cookMirror reads GET /dish-stats exactly as the server sends it (hearts, zeros and all)', () => {
  // The shape of buildDishStats() in supabase/functions/api/retention.ts (handoff 2.2), as JSON.
  const fromServer = JSON.parse(JSON.stringify({
    d1: {
      hearts: { count: 2, by: [{ profile_id: 'p-maya', at: '2026-10-12T10:00:00Z' }, { profile_id: 'p-leo', at: '2026-10-10T10:00:00Z' }] },
      cooked: { count: 3, by: [{ profile_id: 'p-leo', count: 2, last_at: '2026-10-09T10:00:00Z' }, { profile_id: 'p-maya', count: 1, last_at: '2026-10-05T10:00:00Z' }] },
    },
    d2: { hearts: { count: 1, by: [{ profile_id: 'p-mom', at: '2026-10-11T10:00:00Z' }] }, cooked: { count: 0, by: [] } },
  }));
  const m = K.cookMirror([entry('d1', 'Dad'), entry('d2', 'Dad')], fromServer, family, P.dad.id);
  assert.deepEqual(m, { total: 2, people: [{ profileId: 'p-leo', name: 'Leo', cooked: 1 }, { profileId: 'p-maya', name: 'Maya', cooked: 1 }] });
  assert.equal(K.mirrorLine(m), 'Leo can cook 1 of your 2. Maya, 1.'); // a heart alone is not a cook
});

await test('cookMirror never counts a remembered (memorial) person (guardrail 2)', () => {
  const by = (...rows) => ({ cooked: { count: rows.length, by: rows.map(([profile_id, count]) => ({ profile_id, count, last_at: '' })) } });
  const dish = { d1: by(['p-leo', 1], ['p-grandma', 2]), d2: by(['p-grandma', 1]) };
  const remembered = family.map((p) => (p.id === 'p-grandma' ? { ...p, memorial: true } : p));
  const m = K.cookMirror([entry('d1', 'Dad'), entry('d2', 'Dad')], dish, remembered, P.dad.id);
  assert.deepEqual(m.people.map((p) => [p.name, p.cooked]), [['Leo', 1]]);
  assert.equal(K.mirrorLine(m), 'Leo can cook 1 of your 2.');
  // Only Grandma had cooked any: nothing to say, so the line hides.
  assert.equal(K.mirrorLine(K.cookMirror([entry('d2', 'Dad')], dish, remembered, P.dad.id)), null);
  // Not memorial (false or unknown): counted as before.
  assert.deepEqual(K.cookMirror([entry('d2', 'Dad')], dish, family.map((p) => ({ ...p, memorial: false })), P.dad.id).people.map((p) => p.name), ['Grandma']);
});

await test('mirrorLine: all, both, one recipe, and quiet when nothing to say', () => {
  const ppl = (...xs) => xs.map(([name, cooked]) => ({ profileId: name, name, cooked }));
  assert.equal(K.mirrorLine({ total: 7, people: ppl(['Leo', 7], ['Maya', 7]) }), 'Leo can cook all 7 of yours. Maya, all 7.');
  assert.equal(K.mirrorLine({ total: 2, people: ppl(['Leo', 2], ['Maya', 1]) }), 'Leo can cook both of yours. Maya, 1.');
  assert.equal(K.mirrorLine({ total: 1, people: ppl(['Leo', 1], ['Maya', 1]) }), 'Leo can cook your recipe. Maya too.');
  assert.equal(K.mirrorLine({ total: 7, people: [] }), null);
  assert.equal(K.mirrorLine({ total: 0, people: ppl(['Leo', 1]) }), null);
  assert.equal(K.mirrorLine(K.cookMirror([entry('s', 'Dad', { sample: true })], { s: { cooked: { by: [{ profile_id: 'p-leo', count: 2 }] } } }, family, P.dad.id)), null);
  assert.equal(K.mirrorLine(K.cookMirror([entry('x', 'Dad')], {}, family, P.dad.id)), null);
});

await test('madeItMilestone: 1st, 5th, 10th family dish; only a first cook of a counted dish', () => {
  const lib12 = Array.from({ length: 12 }, (_, i) => entry(`m${i + 1}`, 'Mom')).concat(entry('s', 'Mom', { sample: true }), entry('y', 'Gordon', { relation: 'YouTube' }), entry('mine', 'Leo'));
  const cookedFirst = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i + 1}`, { cooked: 1 }]));
  const at = (before, recipeId) => K.madeItMilestone({ entries: lib12, profiles: family, meId: P.leo.id, before, recipeId });
  assert.deepEqual(at({}, 'm1'), { kind: 'first', title: 'Your first family dish', dishes: 1 });
  assert.equal(at(cookedFirst(1), 'm2'), null);
  assert.equal(at(cookedFirst(4), 'm5').title, '5 family dishes');
  assert.equal(at(cookedFirst(9), 'm10').title, '10 family dishes');
  assert.equal(at(cookedFirst(10), 'm11'), null);
  assert.equal(at(cookedFirst(3), 'm1'), null); // cooked it before: no milestone
  assert.equal(at({}, 's'), null); // sample
  assert.equal(at({}, 'y'), null); // YouTube
  assert.equal(at({}, 'mine'), null); // my own dish
  assert.equal(at({}, 'nope'), null); // not in the library
  // Samples and YouTube in the stats never add to the count.
  assert.equal(at({ s: { cooked: 1 }, y: { cooked: 2 }, mine: { cooked: 1 } }, 'm1').kind, 'first');
});

await test('madeItMilestone: completing a cook’s set is "Keeper of …’s kitchen"', () => {
  const lib5 = [entry('g1', 'Grandma'), entry('g2', 'Grandma'), entry('g3', 'Grandma'), entry('m1', 'Mom'), entry('m2', 'Mom'), entry('d1', 'Dad')];
  const at = (before, recipeId) => K.madeItMilestone({ entries: lib5, profiles: family, meId: P.leo.id, before, recipeId });
  assert.deepEqual(at({ g1: { cooked: 1 }, g2: { cooked: 4 } }, 'g3'), { kind: 'keeper', title: 'Keeper of Grandma’s kitchen', cookId: 'p-grandma', cookName: 'Grandma' });
  // Completing a set outranks the 5th dish.
  assert.equal(at({ g1: { cooked: 1 }, g2: { cooked: 1 }, m1: { cooked: 1 }, d1: { cooked: 1 } }, 'g3').kind, 'keeper');
  // A one-dish kitchen: the count wins when it has something to say, else the keeper.
  assert.equal(at({}, 'd1').kind, 'first');
  assert.deepEqual(at({ g1: { cooked: 1 } }, 'd1'), { kind: 'keeper', title: 'Keeper of Dad’s kitchen', cookId: 'p-dad', cookName: 'Dad' });
  assert.equal(at({ g1: { cooked: 1 } }, 'g2'), null); // 2 of 3, 2nd dish overall
});

await test('madeItTitle: a milestone only when the `cooked` event was saved (offline: the usual title)', () => {
  const lib = [entry('g1', 'Grandma'), entry('g2', 'Grandma')];
  const before = { g1: { cooked: 1 } };
  const milestone = K.madeItMilestone({ entries: lib, profiles: family, meId: P.leo.id, before, recipeId: 'g2' });
  assert.equal(milestone.kind, 'keeper');
  assert.equal(K.madeItTitle(milestone, true, 'You made it'), 'Keeper of Grandma’s kitchen');
  // The event failed: nothing was counted, so no keeper (it stays reachable on the next cook).
  assert.equal(K.madeItTitle(milestone, false, 'You made it'), 'You made it');
  assert.equal(K.madeItTitle(milestone, false, 'Grandma will love this'), 'Grandma will love this');
  assert.deepEqual(K.madeItMilestone({ entries: lib, profiles: family, meId: P.leo.id, before, recipeId: 'g2' }), milestone);
  assert.equal(K.madeItTitle(null, true, 'You made it'), 'You made it');
});

// ---- push: a fresh copy of the module per launch / per phone (its caches are per run)
const PERM = {
  undetermined: { granted: false, status: 'undetermined', canAskAgain: true },
  granted: { granted: true, status: 'granted', canAskAgain: true },
  provisional: { granted: false, status: 'undetermined', canAskAgain: true, ios: { status: 3 } }, // iOS quiet delivery
  deniedOnce: { granted: false, status: 'denied', canAskAgain: true }, // Android 13+ after the first "Don't allow"
  deniedForGood: { granted: false, status: 'denied', canAskAgain: false },
};
// The expo-notifications members push.ts uses; every call reads the current globalThis.__env.
const env = () => globalThis.__env;
const FAKE_NOTIFICATIONS = {
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler(h) {
    env().handler = h;
  },
  async setNotificationChannelAsync() {
    env().channels++;
  },
  async getPermissionsAsync() {
    return env().perm;
  },
  async requestPermissionsAsync() {
    env().prompts++;
    env().perm = env().answer;
    return env().perm;
  },
  async getExpoPushTokenAsync({ projectId }) {
    if (env().tokenFails) throw new Error('no token');
    return { data: `ExponentPushToken[${projectId}]` };
  },
  addNotificationResponseReceivedListener(fn) {
    env().listener = fn;
    return { remove: () => (env().listener = null) };
  },
  getLastNotificationResponse() {
    return env().last ?? null;
  },
  clearLastNotificationResponse() {
    env().last = null;
  },
};
globalThis.require = (id) => {
  if (id === 'expo-device' && !env().noExpoDevice) return { isDevice: env().isDevice };
  if (id === 'expo-notifications' && !env().noNotifications) return FAKE_NOTIFICATIONS;
  throw new Error(`Cannot find module '${id}'`);
};

let launches = 0;
const pushUrlHref = pathToFileURL(join(root, 'src/lib/push.ts')).href;
/** A new launch on a phone described by `over` (default: an iPhone build with a projectId). */
const launch = (over = {}) => {
  globalThis.__env = { os: 'ios', expoGo: false, projectId: 'proj-1', isDevice: true, perm: PERM.undetermined, answer: PERM.granted, prompts: 0, channels: 0, ...over };
  return import(`${pushUrlHref}?launch=${++launches}`);
};
const notFirstLaunch = () => kv.set('push.firstLaunchAt', String(NOW - 10 * DAY));
const registrations = () => {
  const calls = [];
  const register = async (token, platform) => void calls.push([token, platform]);
  return { calls, register };
};

await test('push: no explainer and no OS prompt without a real push build', async () => {
  const cases = {
    web: { os: 'web' },
    'Expo Go on Android': { os: 'android', expoGo: true },
    'no EAS projectId': { projectId: undefined },
    'blank projectId': { projectId: '  ' },
    'iOS Simulator': { isDevice: false },
    'expo-device missing': { noExpoDevice: true },
    'expo-notifications not installed': { noNotifications: true },
  };
  for (const [name, over] of Object.entries(cases)) {
    kv.clear();
    notFirstLaunch();
    const P = await launch(over);
    const { calls, register } = registrations();
    assert.equal(P.pushSupported(), false, name);
    assert.equal(await P.getPushPermission(), 'unsupported', name);
    assert.equal(await P.shouldAskPush('kid-first-made', 'kid-a', NOW), false, name);
    assert.equal(await P.requestAndRegister({ register }), 'unsupported', name);
    assert.equal(await P.syncRegistration({ register }), false, name);
    assert.deepEqual(calls, [], name);
    assert.equal(env().prompts, 0, name);
  }
  // A real iPhone, and an Android build outside Expo Go, can.
  assert.equal((await launch()).pushSupported(), true);
  assert.equal((await launch({ os: 'android' })).pushSupported(), true);
});

await test('push: the kid moments never on the first launch; the next launch may ask', async () => {
  kv.clear();
  const first = await launch();
  for (const kind of ['kid-first-made', 'kid-first-question']) {
    assert.equal(await first.shouldAskPush(kind, 'kid-a', NOW), false, kind); // the whole first run
  }
  assert.ok(kv.has('push.firstLaunchAt'));
  const second = await launch();
  for (const kind of ['kid-first-made', 'kid-first-question', 'cook-first-send']) {
    assert.equal(await second.shouldAskPush(kind, 'kid-a', NOW), true, kind);
  }
  assert.equal(await second.shouldAskPush('kid-first-made', null, NOW), false); // nobody picked yet
  assert.equal(await second.shouldAskPush('kid-first-made', '', NOW), false);
});

await test('push: v2’s two moments and the cook’s first send ask even on the first launch, and keep the other rules', async () => {
  // A new cook films and sends on her first day (build 11 phone run, Nov 3: never asked).
  const V2 = ['kid-card-saved', 'cook-craving-sent', 'cook-first-send'];
  kv.clear();
  const first = await launch();
  assert.equal(await first.shouldAskPush('kid-first-made', 'kid-a', NOW), false); // the old ones still wait
  for (const kind of V2) assert.equal(await first.shouldAskPush(kind, 'kid-a', NOW), true, kind);
  assert.ok(kv.has('push.firstLaunchAt'), 'the launch is still noted');
  // The 30-day "Not now", nobody picked, and an OS that already answered still hold on the first launch.
  await first.snoozePushAsk('kid-a', NOW);
  for (const kind of V2) {
    assert.equal(await first.shouldAskPush(kind, 'kid-a', NOW + DAY), false, kind);
    assert.equal(await first.shouldAskPush(kind, 'kid-a', NOW + 30 * DAY), true, kind);
    assert.equal(await first.shouldAskPush(kind, null, NOW), false, kind);
  }
  kv.clear();
  const answered = await launch({ perm: PERM.deniedForGood });
  for (const kind of V2) assert.equal(await answered.shouldAskPush(kind, 'kid-a', NOW), false, kind);
  kv.clear();
  const sim = await launch({ isDevice: false });
  for (const kind of V2) assert.equal(await sim.shouldAskPush(kind, 'kid-a', NOW), false, kind);
  // Whose words: the craving link is the cook's moment, the card the kid's.
  assert.equal(first.pushAskWho('cook-craving-sent'), 'cook');
  assert.equal(first.pushAskWho('kid-card-saved'), 'kid');
  assert.equal(first.pushAskWho('cook-first-send'), 'cook');
  assert.equal(first.pushAskWho('kid-first-made'), 'kid');
});

await test('push: "Not now" means no ask for this profile for 30 days', async () => {
  kv.clear();
  notFirstLaunch();
  const P = await launch();
  await P.snoozePushAsk('kid-a', NOW);
  assert.equal(kv.get('push.askedAt.kid-a'), String(NOW));
  assert.equal(await P.shouldAskPush('kid-first-question', 'kid-a', NOW + 29 * DAY), false);
  assert.equal(await P.shouldAskPush('kid-first-question', 'kid-a', NOW + 30 * DAY - 1), false);
  assert.equal(await P.shouldAskPush('kid-first-question', 'kid-a', NOW + 30 * DAY), true);
  assert.equal(await P.shouldAskPush('cook-first-send', 'cook-b', NOW), true); // another profile on this phone
  kv.set('push.askedAt.kid-c', 'garbage');
  assert.equal(await P.shouldAskPush('kid-first-made', 'kid-c', NOW), true);
});

await test('push: once the OS has answered, never ask again (even an Android first "no")', async () => {
  const expect = { undetermined: 'undetermined', granted: 'granted', provisional: 'granted', deniedOnce: 'denied', deniedForGood: 'denied' };
  for (const [name, want] of Object.entries(expect)) {
    kv.clear();
    notFirstLaunch();
    const P = await launch({ os: name === 'deniedOnce' ? 'android' : 'ios', perm: PERM[name] });
    assert.equal(await P.getPushPermission(), want, name);
    assert.equal(await P.shouldAskPush('kid-first-made', 'kid-a', NOW), want === 'undetermined', name);
  }
});

await test('push: Yes -> the OS prompt -> the token reaches register; anything else snoozes', async () => {
  // Allowed: registered with the token for this platform, and sign-out can remove it.
  kv.clear();
  let P = await launch();
  let r = registrations();
  assert.equal(await P.requestAndRegister({ register: r.register, profileId: 'kid-a' }), 'registered');
  assert.deepEqual(r.calls, [['ExponentPushToken[proj-1]', 'ios']]);
  assert.equal(env().prompts, 1);
  assert.equal(kv.get('push.token'), 'ExponentPushToken[proj-1]');
  assert.equal(kv.has('push.askedAt.kid-a'), false);
  const removed = [];
  await P.unregister({ remove: async (token) => void removed.push(token) });
  await new Promise((resolve) => setImmediate(resolve)); // the server call runs in the background
  assert.deepEqual(removed, ['ExponentPushToken[proj-1]']);
  assert.equal(kv.has('push.token'), false);

  // The OS said no: 'denied', nothing registered, and the explainer waits 30 days.
  kv.clear();
  P = await launch({ os: 'android', answer: PERM.deniedOnce });
  r = registrations();
  const before = Date.now();
  assert.equal(await P.requestAndRegister({ register: r.register, profileId: 'kid-a' }), 'denied');
  assert.deepEqual(r.calls, []);
  assert.equal(env().channels, 1); // the Android channel exists before the prompt
  assert.ok(Number(kv.get('push.askedAt.kid-a')) >= before);

  // Said no for good before: no OS prompt at all.
  kv.clear();
  P = await launch({ perm: PERM.deniedForGood });
  assert.equal(await P.requestAndRegister({ register: registrations().register, profileId: 'kid-a' }), 'denied');
  assert.equal(env().prompts, 0);

  // Allowed but the server call fails: 'failed' (syncRegistration retries later), still snoozed.
  kv.clear();
  P = await launch({ perm: PERM.granted });
  const failing = async () => {
    throw new Error('offline');
  };
  assert.equal(await P.requestAndRegister({ register: failing, profileId: 'kid-a' }), 'failed');
  assert.equal(env().prompts, 0);
  assert.ok(kv.has('push.askedAt.kid-a'));
  r = registrations();
  assert.equal(await P.syncRegistration({ register: r.register, key: '1|kid-a' }), true);
  assert.equal(await P.syncRegistration({ register: r.register, key: '1|kid-a' }), true); // same person: sent once
  assert.equal(r.calls.length, 1);
  // The same person with a new key on this phone (signed in again; the old key is revoked, and the
  // server's row still points at it): registers again (PushBridge keys on credentialVersion|person).
  assert.equal(await P.syncRegistration({ register: r.register, key: '2|kid-a' }), true);
  assert.equal(r.calls.length, 2);
  assert.equal(await P.syncRegistration({ register: r.register, key: '2|kid-a' }), true);
  assert.equal(r.calls.length, 2);

  // No token: 'failed'.
  kv.clear();
  P = await launch({ tokenFails: true });
  assert.equal(await P.requestAndRegister({ register: registrations().register }), 'failed');
});

await test('push: sign-out never waits on the network (leaveFamily awaits only this, then forget)', async () => {
  // A slow or captive network: the server call never settles. unregister still resolves at once,
  // with the token gone from this phone, and the server was asked (in the background).
  kv.clear();
  let P = await launch();
  assert.equal(await P.requestAndRegister({ register: registrations().register, profileId: 'kid-a' }), 'registered');
  const asked = [];
  const hang = (token) => {
    asked.push(token);
    return new Promise(() => {});
  };
  const late = new Promise((resolve) => setTimeout(() => resolve('waited'), 200));
  assert.equal(await Promise.race([P.unregister({ remove: hang }).then(() => 'done'), late]), 'done');
  assert.equal(kv.has('push.token'), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, ['ExponentPushToken[proj-1]']);

  // Offline (rejects) or a throwing remove: still resolves, and nothing escapes as an unhandled
  // rejection (Node would fail this run).
  for (const remove of [async () => Promise.reject(new Error('offline')), () => {
    throw new Error('boom');
  }]) {
    kv.clear();
    P = await launch();
    await P.requestAndRegister({ register: registrations().register, profileId: 'kid-a' });
    await P.unregister({ remove });
    assert.equal(kv.has('push.token'), false);
  }
  await new Promise((resolve) => setTimeout(resolve, 10));

  // No token on this phone (push never set up): nothing is sent.
  kv.clear();
  P = await launch();
  const none = [];
  await P.unregister({ remove: async (token) => void none.push(token) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(none, []);
});

await test('push: Convex gets the token too (as whom, with the zone), and loses it on sign-out, never in the way', async () => {
  kv.clear();
  const P = await launch();
  const sent = [];
  const tz = T.deviceTimeZone();
  P.setConvexPush({
    register: async (...args) => void sent.push(['register', ...args]),
    unregister: async (token) => void sent.push(['unregister', token]),
  });
  const r = registrations();
  assert.equal(await P.requestAndRegister({ register: r.register, profileId: 'kid-a' }), 'registered');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, [['register', 'ExponentPushToken[proj-1]', 'ios', tz, 'kid-a']]);
  assert.ok(tz.length > 0);
  // A sync for someone new on this phone: once per token and key, like the api's.
  assert.equal(await P.syncRegistration({ register: r.register, key: '1|cook-b', profileId: 'cook-b' }), true);
  assert.equal(await P.syncRegistration({ register: r.register, key: '1|cook-b', profileId: 'cook-b' }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent.slice(1), [['register', 'ExponentPushToken[proj-1]', 'ios', tz, 'cook-b']]);
  assert.equal(r.calls.length, 2);
  // Sign-out: Convex is told too, in the background.
  await P.unregister({ remove: async () => {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent.at(-1), ['unregister', 'ExponentPushToken[proj-1]']);

  // A Convex that hangs, fails or throws never holds up registering or signing out.
  const late = () => new Promise((resolve) => setTimeout(() => resolve('waited'), 200));
  for (const sink of [
    { register: () => new Promise(() => {}), unregister: () => new Promise(() => {}) },
    { register: async () => Promise.reject(new Error('offline')), unregister: async () => Promise.reject(new Error('offline')) },
    {
      register: () => {
        throw new Error('boom');
      },
      unregister: () => {
        throw new Error('boom');
      },
    },
  ]) {
    kv.clear();
    const Q = await launch();
    Q.setConvexPush(sink);
    const q = registrations();
    assert.equal(await Promise.race([Q.requestAndRegister({ register: q.register, profileId: 'kid-a' }), late()]), 'registered');
    assert.equal(q.calls.length, 1, 'the api still got it');
    assert.equal(await Promise.race([Q.unregister({ remove: async () => {} }).then(() => 'done'), late()]), 'done');
    assert.equal(kv.has('push.token'), false);
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
});

await test('pushUrl: only our own in-app routes', async () => {
  const P = await launch();
  assert.equal(P.pushUrl({ url: '/chat/t1' }), '/chat/t1');
  assert.equal(P.pushUrl({ url: '/recap?month=2026-10' }), '/recap?month=2026-10');
  for (const url of ['//evil.example/x', 'https://evil.example', 'homecookd://chat/t1', 'chat/t1', '/\\evil.example', '', 42, null, `/${'x'.repeat(300)}`]) {
    assert.equal(P.pushUrl({ url }), null, String(url));
  }
  assert.equal(P.pushUrl(null), null);
  assert.equal(P.pushUrl(undefined), null);
});

await test('addTapListener: the cold-start tap, later taps, never twice, never outside the app', async () => {
  const P = await launch();
  const tap = (id, url, action = FAKE_NOTIFICATIONS.DEFAULT_ACTION_IDENTIFIER) => ({ actionIdentifier: action, notification: { request: { identifier: id, content: { data: { url } } } } });
  env().last = tap('n1', '/chat/t1');
  const opened = [];
  const off = P.addTapListener({ push: (href) => opened.push(href) });
  assert.deepEqual(opened, ['/chat/t1']); // the tap that launched the app
  assert.equal(env().last, null);
  env().listener(tap('n1', '/chat/t1')); // the same tap again through the listener
  env().listener(tap('n2', '/recipe/r1'));
  env().listener(tap('n3', 'https://evil.example'));
  env().listener(tap('n4', '/chat/t2', 'reply')); // not a plain tap
  assert.deepEqual(opened, ['/chat/t1', '/recipe/r1']);
  off();
  assert.equal(env().listener, null);
  // Without push support it does nothing and returns a no-op.
  const W = await launch({ os: 'web' });
  assert.equal(typeof W.addTapListener({ push: () => assert.fail('no taps on web') }), 'function');
});

await test("media: a cook's voice logs 'heard' once per play from 3 s; voice notes and short plays never", async () => {
  const A = await import(pathToFileURL(join(root, 'src/lib/media.ts')).href);
  const heard = [];
  A.setHeardListener((p) => heard.push(p));
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const player = () => globalThis.__players.at(-1);
    const play = async (clip) => {
      A.playClip(clip);
      await new Promise((resolve) => setImmediate(resolve));
      now += 1000; // past the seek grace, so time updates count
    };
    const tag = { recipe_id: 'dad-sunday-chili', cook_id: 'p-dad' };

    // Plays to its end: one event, the whole range, from where it started.
    await play({ url: 'u1', start_s: 40, end_s: 60, heard: tag });
    player().emit({ currentTime: 45 });
    player().emit({ currentTime: 60 });
    assert.deepEqual(heard, [{ ...tag, duration_s: 20, start_s: 40 }]);
    player().emit({ currentTime: 61 }); // nothing more from the same play
    assert.equal(heard.length, 1);

    // Stopped at 2 s: under the floor, nothing.
    await play({ url: 'u1', start_s: 0, end_s: 30, heard: tag });
    player().emit({ currentTime: 2 });
    A.stopAudio();
    assert.equal(heard.length, 1);

    // Paused and resumed: still one play, measured to where it was stopped.
    const story = { url: 'u1', start_s: 100, end_s: 160, heard: tag };
    await play(story);
    player().emit({ currentTime: 104 });
    A.pauseAudio();
    player().emit({ currentTime: 104 });
    A.playClip(story); // resume, not a new play
    player().emit({ currentTime: 112 });
    A.stopAudio();
    assert.deepEqual(heard.at(-1), { ...tag, duration_s: 12, start_s: 100 });
    assert.equal(heard.length, 2);

    // Another clip while one plays: the first is reported then.
    await play({ url: 'u1', start_s: 200, end_s: 260, heard: tag });
    player().emit({ currentTime: 207 });
    await play({ url: 'u1', start_s: 300, end_s: 310, heard: { recipe_id: 'r2', cook_id: null } });
    assert.deepEqual(heard.at(-1), { ...tag, duration_s: 7, start_s: 200 });

    // A voice note (no `heard`) never logs, however long it plays.
    const before = heard.length;
    await play({ url: 'voice-note.m4a', start_s: 0, end_s: null });
    player().emit({ currentTime: 30 });
    A.stopAudio();
    assert.equal(heard.length, before, 'the r2 clip was replaced before 3 s; the voice note never counts');
  } finally {
    Date.now = realNow;
    A.setHeardListener(null);
  }
});

// ---- touches (PR 7; the brand row's clock moods went with the pot, Oct 30: the egg logo keeps one face)
await test('potDotLayout: pots as big as 16 pt, never under 10; too many steps keep the bars', () => {
  assert.deepEqual(U.potDotLayout(263, 8), { size: 16, gap: 6 }, '375 pt phone, 8 steps');
  const thirteen = U.potDotLayout(263, 13);
  assert.ok(thirteen && thirteen.size >= 10 && thirteen.size <= 16, 'the longest bundled recipe (13 steps) gets pots');
  assert.ok(13 * thirteen.size + 12 * thirteen.gap <= 263, 'and they fit');
  const seventeen = U.potDotLayout(263, 17);
  assert.ok(seventeen && seventeen.gap === 4 && 17 * seventeen.size + 16 * 4 <= 263, 'tighter gaps before giving up');
  assert.equal(U.potDotLayout(263, 30), null, '30 steps: bars');
  assert.equal(U.potDotLayout(0, 8), null, 'not measured yet');
  assert.equal(U.potDotLayout(263, 0), null, 'no steps');
  for (let n = 1; n <= 40; n++) {
    const l = U.potDotLayout(263, n);
    if (l) assert.ok(l.size >= U.POT_MIN && l.size <= U.POT_MAX && n * l.size + (n - 1) * l.gap <= 263, `fits at ${n}`);
  }
});

await test('strikeStrokes: one pen line per text line, through the middle, overshooting a little; stable per seed', () => {
  const lines = [
    { x: 0, y: 0, width: 180, height: 21 },
    { x: 0, y: 21, width: 64, height: 21 },
  ];
  const a = U.strikeStrokes(lines, 3, 6);
  assert.equal(a.length, 2);
  assert.deepEqual(U.strikeStrokes(lines, 3, 6), a, 'the same row draws the same line every time');
  assert.notDeepEqual(U.strikeStrokes(lines, 4, 6), a, 'another row, another hand');
  for (const [i, s] of a.entries()) {
    const nums = s.d.match(/-?\d+(\.\d+)?/g).map(Number);
    const [x0, y0] = nums;
    const [x1, y1] = nums.slice(-2);
    const l = lines[i];
    assert.ok(x0 < l.x + 6 && x0 >= l.x + 6 - 3.1, 'starts just before the words');
    assert.ok(x1 > l.x + 6 + l.width && x1 <= l.x + 6 + l.width + 3.1, 'ends just past them');
    const mid = l.y + 6 + l.height * 0.55;
    assert.ok(Math.abs(y0 - mid) < 2 && Math.abs(y1 - mid) < 2, 'through the middle of the letters');
    assert.ok(y1 <= y0, 'a slight rise, left to right');
    assert.ok(s.length >= x1 - x0, 'the dash covers the whole stroke');
  }
  assert.deepEqual(U.strikeStrokes([{ x: 0, y: 0, width: 2, height: 21 }]), [], 'nothing on an empty line');
});

await test('blockLines: one line per line height across the text box (web, no onTextLayout)', () => {
  assert.deepEqual(U.blockLines(120, 21, 21), [{ x: 0, y: 0, width: 120, height: 21 }]);
  const two = U.blockLines(240, 43, 21);
  assert.equal(two.length, 2);
  assert.equal(two[1].y, 21.5);
  assert.deepEqual(U.blockLines(0, 21, 21), []);
});

await test('buzzForUnread: two taps only when the count read for the same person goes up while the app is open', () => {
  const a = (total) => ({ owner: 'p-leo', total });
  assert.equal(U.buzzForUnread(null, a(3), true), false, 'never for what was waiting when the app opened');
  assert.equal(U.buzzForUnread(a(1), a(2), true), true, 'a new message');
  assert.equal(U.buzzForUnread(a(2), a(2), true), false);
  assert.equal(U.buzzForUnread(a(3), a(1), true), false, 'read elsewhere');
  assert.equal(U.buzzForUnread(a(1), a(2), false), false, 'a read that lands with the app away: the push is the note');
  assert.equal(U.buzzForUnread({ owner: 'p-mom', total: 0 }, a(2), true), false, 'someone else picked up the phone');
  assert.equal(U.buzzForUnread(a(0), { owner: null, total: 1 }, true), false);
});

await test('unreadSeenAfter: coming back to the app never taps for what landed while it was away', () => {
  const a = (total) => ({ owner: 'p-leo', total });
  // The UnreadProvider's own steps: a read taps against the baseline, then keeps it only in front.
  let seen = null;
  const read = (n, appState = 'active') => {
    const next = a(n);
    const buzz = U.buzzForUnread(seen, next, appState === 'active');
    seen = U.unreadSeenAfter(appState, next);
    return buzz;
  };
  const appState = (s) => {
    seen = U.unreadSeenAfter(s, seen);
  };
  assert.equal(read(1), false, 'cold start: a silent baseline');
  appState('inactive');
  appState('background');
  assert.equal(seen, null, 'leaving the foreground forgets the baseline');
  assert.equal(read(1, 'background'), false);
  assert.equal(seen, null, 'a read that lands while away is not a baseline');
  appState('active');
  assert.equal(read(2), false, 'Grandma wrote while Leo was away; tapping her push opens the app: no tap');
  assert.equal(read(3), true, 'a later message with the app open taps');
  appState('inactive'); // the notification shade, a system prompt
  appState('active');
  assert.equal(read(3), false, 'back from the shade: a silent baseline again');
  assert.equal(read(4), true);
  assert.equal(U.unreadSeenAfter('active', a(4)).total, 4, 'in front, the baseline stays');
});

await test('tapStillDue: one message, one signal (a message push already said it, an open chat shows it)', () => {
  const a = (total) => ({ owner: 'p-leo', total });
  const base = { due: a(2), seen: a(2), active: true, pushAt: null, now: NOW, path: '/kid/home' };
  const due = (over) => U.tapStillDue({ ...base, ...over });
  assert.equal(due({}), true, 'pushes off, on Home: the taps are the note');
  assert.equal(due({ pushAt: NOW - 2_000 }), false, 'the push landed during the wait: its banner and sound were the note');
  assert.equal(due({ pushAt: NOW - 14_000 }), false, 'the push came before the poll saw the count');
  assert.equal(due({ pushAt: NOW - U.PUSH_COVERS_MS - 1 }), true, 'an older push was for an older message');
  assert.equal(due({ path: '/chat/t-grandma' }), false, 'a chat is open: its messages land on screen (its push stays quiet there too)');
  assert.equal(due({ seen: a(1) }), false, 'the open chat marked it read during the wait');
  assert.equal(due({ seen: a(3) }), true, 'another message landed during the wait: still one double tap');
  assert.equal(due({ seen: null }), false, 'the app left the front during the wait');
  assert.equal(due({ active: false }), false);
  assert.equal(due({ seen: { owner: 'p-mom', total: 5 } }), false, 'someone else picked up the phone');
  assert.ok(U.TAP_WAIT_MS > 0 && U.TAP_WAIT_MS < U.PUSH_COVERS_MS);
});

await test('push: a message push with the app open is noted for the double tap, shown or kept quiet', async () => {
  kv.clear();
  notFirstLaunch();
  const P = await launch();
  await P.initPush((url) => url === '/chat/t-open');
  const h = env().handler;
  assert.ok(h, 'the foreground handler is set');
  const arrive = (data) => h.handleNotification({ request: { content: { data } } });
  assert.equal(P.lastMessagePushAt(), null);
  assert.deepEqual(await arrive({ kind: 'recap', url: '/recap' }), { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false });
  assert.equal(P.lastMessagePushAt(), null, 'the recap is not a message');
  await arrive({ kind: 'reaction', url: '/chat/t-1' });
  await arrive({ kind: 'table_nudge', url: '/kid/home' });
  assert.equal(P.lastMessagePushAt(), null, 'reactions and nudges never count as unread');
  const before = Date.now();
  await arrive({ kind: 'message', url: '/chat/t-1' });
  assert.ok(P.lastMessagePushAt() >= before, 'a message, shown with its banner');
  const quiet = await arrive({ kind: 'postcard', url: '/chat/t-open' });
  assert.equal(quiet.shouldPlaySound, false, 'its chat is on screen: kept quiet');
  assert.ok(P.lastMessagePushAt() >= before, 'and still noted, so the poll does not tap for it either');
  for (const kind of ['question', 'recipe']) {
    const fresh = await launch();
    await fresh.initPush();
    await env().handler.handleNotification({ request: { content: { data: { kind, url: '/recipe/r-1' } } } });
    assert.equal(typeof fresh.lastMessagePushAt(), 'number', kind);
  }
});

await test('push: an ask waits for any open sheet, and a share-sheet send asks too', async () => {
  // iOS won't present the ask's Modal over another sheet's (the craving sheet, the share sheet), so
  // the host only shows it with no sheet up; the share sheet's family row asks like Send does.
  const read = (f) => readFileSync(join(root, f), 'utf8');
  const host = read('src/components/push/PushAskSheet.tsx');
  assert.match(host, /const sheetsUp = useSheetsUp\(\);/);
  assert.match(host, /if \(ask && ask !== shown && sheetsUp === 0\) setShown\(ask\);/);
  // Which sheets are up is the coordinator's (lib/sheets/coordinator.ts; scripts/test-sheets.mjs runs it).
  assert.match(read('src/components/ui/BottomSheet.tsx'), /export \{ useSheetsUp \} from '@\/lib\/sheets\/coordinator';/);
  assert.match(read('src/components/share/sendRecipe.ts'), /askAfterSend\(to\);/);
  assert.match(read('src/lib/messaging.ts'), /export function askAfterSend\(sentTo: string\[\] \| 'everyone'\)/);
});

await test('sheets: no entering/exiting/layout animation inside a sheet (iOS freeze, Copy link, Nov 8)', async () => {
  // Reanimated's layout animations run in the native mounting layer. Inside a sheet's Modal on iOS, Copy link's
  // spinner left mid-fade and the screen stopped redrawing while the app kept running. Sheets fade with Appear.
  const read = (f) => readFileSync(join(root, f), 'utf8');
  const layoutAnim = /\b(entering|exiting|layout)=\{/;
  for (const f of [
    'src/components/share/RoundTarget.tsx',
    'src/components/share/ShareSheet.tsx',
    'src/components/share/ExternalRow.tsx',
    'src/components/profiles/AddFamilySheet.tsx',
    'src/components/profiles/AddPhonelessSheet.tsx',
    'src/components/profiles/MoveRequestPrompt.tsx',
    'src/components/messages/MembersSheet.tsx',
    'src/components/messages/AskSheet.tsx',
    'src/components/record/PreRecordSheet.tsx',
    'src/components/record/LanguagePicker.tsx',
    'src/components/ui/BottomSheet.tsx',
  ]) assert.doesNotMatch(read(f), layoutAnim, f);
  const updates = read('src/components/parent/UpdatesCard.tsx');
  const sheet = updates.slice(updates.indexOf('<BottomSheet'), updates.indexOf('</BottomSheet>'));
  assert.ok(sheet.length > 0);
  assert.doesNotMatch(sheet, layoutAnim, 'UpdatesCard: the all-updates sheet');
  assert.match(read('src/components/ui/BottomSheet.tsx'), /<ToastViewport position="top" inSheet sheetId=\{sheetId\} \/>/);
  assert.match(read('src/components/ui/Toast.tsx'), /\{inSheet \? \(\n\s+<Appear key=\{t\.id\}/);
});

await test('push: a recording that sends itself from the done screen asks like Send does', async () => {
  // v2's phone recording never opens the Send screen (DoneView sends it), so the cook was never asked
  // (build 11 phone run, Nov 3; build 6 too).
  const done = readFileSync(join(root, 'src/components/record/DoneView.tsx'), 'utf8');
  assert.match(done, /goHome\(\);\n[\s\S]{0,400}askForPushSoon\(\{ kind: 'cook-first-send', profileId: who\.id/);
  assert.match(done, /if \(who && \(!lent \|\| lent\.id === who\.id\)\)/, 'never on a lent phone');
});

console.log(`\n${passed} tests passed`);
