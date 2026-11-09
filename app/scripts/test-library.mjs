// Tests for the library's family dishes from Convex (src/lib/familyLibrary.ts + the store in
// src/lib/recipes.ts):
//   node scripts/test-library.mjs
// 1. familyEntries: only ready recipes with a library id and an https recipe.json, one per id, in
//    recipes.list order, with the cook's relation from the family's profiles.
// 2. mergeLibrary: the family's new dishes in front; a dish library.json already has stays its copy.
// 3. The store (showFamilyRecipes), with React, Convex and the bundled data stubbed (no network):
//    the family's dishes are listed and findable by id, their recipe.json loads from recipeJsonUrl
//    and is cached, Convex's recipe id cache is cleared when the list changes (only then), a
//    sign-out or another family clears them, and with no rows (the stub) the library is unchanged.
// 4. Stories and tips (convex/recipes.ts forViewer sends them only to the cook until she says yes;
//    recipe.json has them all): storiesShared, withheldIds and withoutStories, and in the store a
//    dish the cook kept to herself loads without them, her yes brings them back, the cook sees her
//    own, the next person on a shared phone waits for their own rows, a recipe loaded before the
//    list arrived loses them, and so does the bundled copy (offline, and the tips it lends).
// 5. Fail closed (storiesWithheld): while the signed-in person's rows haven't come (Convex slow,
//    unreachable or stubbed), a dish that isn't public loads without its stories and tips; when the
//    rows come, the copy kept that way is dropped, so a shared dish loads again with them; the next
//    person is stripped again until their rows come; a public library dish is never stripped.
// 6. Stories and tips from Convex (a family recipe.json is published without them,
//    pipeline/publish.py): withMemories puts recipes.list's memories back where they were, an older
//    row's go to the step they were told in, sharedMemories keeps unchanged ones, and in the store a
//    kid gets them only after the cook's yes, the cook gets hers, a recipe loaded before the list
//    arrived gets them once it does, and changed memories load the dish again.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const entry = (id, extra = {}) => ({
  id,
  title: `Dish ${id}`,
  cook_name: 'Mom',
  relation: 'Mom',
  poster_url: null,
  tags: [],
  sample: false,
  recipe_url: `https://storage.googleapis.com/bucket/${id}/recipe.json`,
  ...extra,
});
const BUNDLED = [entry('bundled-chili'), entry('bundled-fish', { cook_name: 'Dad', relation: 'Dad' })];
globalThis.__bundledLibrary = BUNDLED;
globalThis.__bundledRecipes = {};
globalThis.__hidden = [];
globalThis.__invalidations = 0;
globalThis.__session = null; // who useSession()/getSession() say is signed in

const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const stubs = {
  react: stub('export const useCallback = (f) => f; export const useEffect = () => {}; export const useState = (v) => [typeof v === \'function\' ? v() : v, () => {}]; export const useSyncExternalStore = (_s, get) => get();'),
  './bundled': stub('export const bundledLibrary = globalThis.__bundledLibrary; export const bundledRecipes = globalThis.__bundledRecipes;'),
  './deletes': stub('export const loadHiddenIds = () => globalThis.__hidden;'),
  './live/convex': stub('export const useLive = (_n, initial) => initial; export const invalidateConvexRecipes = () => { globalThis.__invalidations += 1; };'),
  './session': stub('export const getSession = () => globalThis.__session; export const useSession = () => globalThis.__session ?? { me: null, family: null, profiles: [] };'),
};
// Stubs for React & the modules that need Expo; the app's other siblings ('./http') resolve to .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (stubs[spec]) return { url: stubs[spec], shortCircuit: true };
    // '@/lib/format' and the like (components/recipe/text.ts): src/<path>.ts.
    if (spec.startsWith('@/') && existsSync(join(root, 'src', `${spec.slice(2)}.ts`))) return next(pathToFileURL(join(root, 'src', `${spec.slice(2)}.ts`)).href, ctx);
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) {
      const p = join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`);
      if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});
const F = await import(pathToFileURL(join(root, 'src/lib/familyLibrary.ts')).href);
const X = await import(pathToFileURL(join(root, 'src/components/recipe/text.ts')).href);
const R = await import(pathToFileURL(join(root, 'src/lib/recipes.ts')).href);

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

/** A recipes.list row as Convex returns it (plus the fields the library ignores). */
const row = (libraryId, extra = {}) => ({
  _id: `convex-${libraryId}`,
  _creationTime: 1,
  familyId: 'fam-1',
  cookId: 'person-grandma',
  cookName: 'Grandma',
  title: `Grandma's ${libraryId}`,
  status: 'ready',
  libraryId,
  recipeJsonUrl: `https://storage.googleapis.com/edible-media/${libraryId}/recipe.json`,
  coverUrl: `https://storage.googleapis.com/edible-media/${libraryId}/poster.jpg?v=3`,
  steps: [],
  memories: [],
  memoriesOptIn: false,
  ...extra,
});
const PEOPLE = [
  { name: 'grandma ', relation: 'Grandma (Aaji)' },
  { name: 'Leo', relation: null },
];
const ids = (list) => list.map((e) => e.id);
const lib = () => R.useLibrary().entries;

// ---------------------------------------------------------------------------------------------
// 1. familyEntries

await test('familyEntries: a ready row becomes a full library entry', () => {
  const [e] = F.familyEntries([row('recipe-abc')], PEOPLE);
  assert.deepEqual(e, {
    id: 'recipe-abc',
    title: "Grandma's recipe-abc",
    cook_name: 'Grandma',
    relation: 'Grandma (Aaji)', // the profile with her name (case and spaces aside)
    poster_url: 'https://storage.googleapis.com/edible-media/recipe-abc/poster.jpg?v=3',
    tags: [],
    sample: false,
    recipe_url: 'https://storage.googleapis.com/edible-media/recipe-abc/recipe.json',
  });
});

await test('familyEntries: processing, failed, no library id or no https recipe.json are left out', () => {
  const rows = [
    row('processing', { status: 'processing', libraryId: undefined, recipeJsonUrl: undefined, title: 'New recipe' }),
    row('failed', { status: 'failed' }),
    row('no-id', { libraryId: undefined }),
    row('blank-id', { libraryId: '   ' }),
    row('no-url', { recipeJsonUrl: undefined }),
    row('http-url', { recipeJsonUrl: 'http://storage.googleapis.com/edible-media/http-url/recipe.json' }),
    row('ok'),
  ];
  assert.deepEqual(ids(F.familyEntries(rows, PEOPLE)), ['ok']);
});

await test('familyEntries: one entry per library id (the first, newest, wins), in rows order', () => {
  const rows = [row('b', { title: 'Newer' }), row('a'), row('b', { _id: 'older', title: 'Older' }), row(' c ')];
  const out = F.familyEntries(rows, PEOPLE);
  assert.deepEqual(ids(out), ['b', 'a', 'c']);
  assert.equal(out[0].title, 'Newer');
});

await test('familyEntries: blank title, cook or cover fall back; no profile means no relation', () => {
  const [e] = F.familyEntries([row('x', { title: '  ', cookName: '', coverUrl: 'http://insecure/poster.jpg' })], PEOPLE);
  assert.equal(e.title, 'A family recipe');
  assert.equal(e.cook_name, 'Family');
  assert.equal(e.relation, '');
  assert.equal(e.poster_url, null);
  const [f] = F.familyEntries([row('y', { cookName: 'Dad', coverUrl: undefined })], PEOPLE);
  assert.equal(f.relation, '');
  assert.equal(f.poster_url, null);
  const [g] = F.familyEntries([row('z', { cookName: 'Leo' })], PEOPLE);
  assert.equal(g.relation, ''); // a profile with no relation
  assert.deepEqual(F.familyEntries([], PEOPLE), []);
});

// ---------------------------------------------------------------------------------------------
// 2. mergeLibrary

await test('mergeLibrary: no family dishes leaves the library as it was', () => {
  assert.deepEqual(F.mergeLibrary(BUNDLED, []), BUNDLED);
  assert.deepEqual(F.mergeLibrary([], []), []);
});

await test('mergeLibrary: new family dishes go first, in their order; a dish in both stays the base copy', () => {
  const family = [entry('new-1', { cook_name: 'Grandma' }), entry('bundled-chili', { title: 'Convex chili' }), entry('new-2')];
  const out = F.mergeLibrary(BUNDLED, family);
  assert.deepEqual(ids(out), ['new-1', 'new-2', 'bundled-chili', 'bundled-fish']);
  assert.equal(out.find((e) => e.id === 'bundled-chili').title, 'Dish bundled-chili');
  // Duplicates inside the family list are listed once.
  assert.deepEqual(ids(F.mergeLibrary([], [entry('a'), entry('a', { title: 'again' })])), ['a']);
});

// ---------------------------------------------------------------------------------------------
// 3. The store

await test('store: before any family rows the library is the bundled copy', () => {
  assert.deepEqual(ids(lib()), ['bundled-chili', 'bundled-fish']);
  R.showFamilyRecipes(null, null); // signed out, nothing yet: no change
  assert.deepEqual(ids(lib()), ['bundled-chili', 'bundled-fish']);
  assert.equal(globalThis.__invalidations, 0);
});

await test('store: the stub (key, no rows) keeps the library unchanged', () => {
  R.showFamilyRecipes('family-A', null, PEOPLE);
  assert.deepEqual(ids(lib()), ['bundled-chili', 'bundled-fish']);
});

await test('store: the family’s ready dishes are listed first and findable by id', () => {
  const before = globalThis.__invalidations;
  R.showFamilyRecipes('family-A', [row('recipe-new'), row('in-progress', { status: 'processing', libraryId: undefined }), row('bundled-chili')], PEOPLE);
  assert.deepEqual(ids(lib()), ['recipe-new', 'bundled-chili', 'bundled-fish']);
  assert.equal(R.getCachedEntry('recipe-new').cook_name, 'Grandma');
  assert.equal(R.getCachedEntry('bundled-chili').title, 'Dish bundled-chili'); // the base copy
  assert.equal(globalThis.__invalidations, before + 1);
});

await test('store: the same rows again change nothing (and keep Convex’s id cache)', () => {
  const before = globalThis.__invalidations;
  const list = lib();
  R.showFamilyRecipes('family-A', [row('recipe-new'), row('in-progress', { status: 'processing', libraryId: undefined }), row('bundled-chili')], PEOPLE);
  R.showFamilyRecipes('family-A', null, PEOPLE); // no new rows for the same family
  assert.equal(lib(), list);
  assert.equal(globalThis.__invalidations, before);
});

await test('store: a dish that finishes processing shows up, and the id cache is cleared', () => {
  const before = globalThis.__invalidations;
  R.showFamilyRecipes('family-A', [row('in-progress'), row('recipe-new'), row('bundled-chili')], PEOPLE);
  assert.deepEqual(ids(lib()), ['in-progress', 'recipe-new', 'bundled-chili', 'bundled-fish']);
  assert.equal(globalThis.__invalidations, before + 1);
});

await test('store: a family dish’s recipe.json loads from its recipeJsonUrl and is cached', async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return { ok: true, status: 200, json: async () => ({ id: 'recipe-new', title: 'Grandma’s dal', steps: [{ order: 1, title: 'Rinse', instruction: 'Rinse the dal.', start_s: 0, end_s: 10 }] }) };
  };
  try {
    const res = await R.fetchRecipe('recipe-new');
    assert.equal(res.source, 'remote');
    assert.equal(res.recipe.title, 'Grandma’s dal');
    assert.equal(asked.length, 1);
    assert.ok(asked[0].startsWith('https://storage.googleapis.com/edible-media/recipe-new/recipe.json?t='), asked[0]);
    assert.equal(R.getCachedRecipe('recipe-new').title, 'Grandma’s dal');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('store: library.json reloads keep the family dishes in front; one copy of a dish in both', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/library.json'), String(url));
    return { ok: true, status: 200, json: async () => [entry('public-pancakes'), entry('in-progress', { title: 'Public copy' })] };
  };
  try {
    await R.refreshLibrary();
  } finally {
    globalThis.fetch = realFetch;
  }
  const state = R.useLibrary();
  assert.equal(state.source, 'remote');
  assert.deepEqual(ids(state.entries), ['recipe-new', 'bundled-chili', 'public-pancakes', 'in-progress']);
  assert.equal(R.getCachedEntry('in-progress').title, 'Public copy');
});

await test('store: a hidden family dish isn’t listed', () => {
  globalThis.__hidden = ['recipe-new'];
  try {
    R.reapplyHidden();
    assert.deepEqual(ids(lib()), ['bundled-chili', 'public-pancakes', 'in-progress']);
  } finally {
    globalThis.__hidden = [];
    R.reapplyHidden();
  }
  assert.deepEqual(ids(lib()), ['recipe-new', 'bundled-chili', 'public-pancakes', 'in-progress']);
});

await test('store: another family (no rows yet) clears the old family’s dishes and caches', () => {
  const before = globalThis.__invalidations;
  R.showFamilyRecipes('family-B', null, PEOPLE);
  assert.deepEqual(ids(lib()), ['public-pancakes', 'in-progress']);
  assert.equal(R.getCachedEntry('recipe-new'), undefined);
  assert.equal(R.getCachedRecipe('recipe-new'), undefined);
  assert.equal(R.getCachedEntry('bundled-chili').title, 'Dish bundled-chili'); // a bundled id goes back to its bundled entry
  assert.equal(R.getCachedEntry('in-progress').title, 'Public copy'); // still library.json's
  assert.equal(globalThis.__invalidations, before + 1);
  R.showFamilyRecipes('family-B', [row('family-b-dish', { cookName: 'Leo' })], PEOPLE);
  assert.deepEqual(ids(lib()), ['family-b-dish', 'public-pancakes', 'in-progress']);
});

await test('store: signing out clears the family’s dishes', () => {
  R.showFamilyRecipes(null, null);
  assert.deepEqual(ids(lib()), ['public-pancakes', 'in-progress']);
  assert.equal(R.getCachedEntry('family-b-dish'), undefined);
  // Rows for nobody are ignored.
  R.showFamilyRecipes(null, [row('ghost')]);
  assert.deepEqual(ids(lib()), ['public-pancakes', 'in-progress']);
});

// ---------------------------------------------------------------------------------------------
// 4. Stories and tips

const story = { kind: 'story', text: 'Aaji learned this dal from her mother.', moment: { startS: 2, endS: 8 } };
/** A pipeline recipe.json with a story, a special moment, a step tip and the intro written from them. */
const fullRecipe = (id) => ({
  id,
  title: 'Aaji’s dal',
  cook: { name: 'Grandma', relation: 'Grandma (Aaji)' },
  intro: 'Aaji learned this dal from her mother in Pune.',
  servings: '4',
  total_time: '40 min',
  sample: false,
  source: null,
  tags: [],
  media: { video_url: null, audio_url: `https://storage.googleapis.com/edible-media/${id}/voice.m4a`, poster_url: null, duration_s: 60 },
  sessions: [],
  ingredients: [{ name: 'toor dal', feel: 'two handfuls', estimate: '~1 cup', confidence: 'medium', first_seen_s: 1 }],
  steps: [
    {
      order: 1,
      title: 'Rinse',
      instruction: 'Rinse the dal.',
      sensory_cue: 'the water runs clear',
      start_s: 0,
      end_s: 10,
      quote: 'Wash it until the water is clear.',
      wait_after: null,
      story_ids: ['s1'],
      special_ids: ['x1'],
      substeps: [{ text: 'Rinse it **3 times**' }],
      uses: [{ name: 'toor dal', amount: '~1 cup' }],
      tip: 'Warm water is faster.',
    },
    { order: 2, title: 'Boil', instruction: 'Boil it soft.', sensory_cue: null, start_s: 10, end_s: 40, quote: null, wait_after: null, story_ids: [], special_ids: [] },
  ],
  stories: [{ id: 's1', step: 1, start_s: 2, end_s: 8, title: 'Her mother’s kitchen', text: 'Aaji learned this dal from her mother.' }],
  special: [{ id: 'x1', step: 1, start_s: 5, end_s: 9, text: 'She rinses it by feel.', why: 'No measuring cup.' }],
  follow_up_questions: [{ id: 'q1', about_step: 2, question: 'How long does it boil?' }],
});

/** None of the cook's stories or tips are left, and everything else is. */
const assertWithheld = (r) => {
  assert.deepEqual(r.stories, []);
  assert.deepEqual(r.special, []);
  assert.equal(r.intro, '');
  for (const s of r.steps) {
    assert.equal(s.tip ?? null, null);
    assert.deepEqual(s.story_ids, []);
    assert.deepEqual(s.special_ids, []);
  }
  assert.equal(r.title, 'Aaji’s dal');
  assert.deepEqual(r.steps.map((s) => s.instruction), ['Rinse the dal.', 'Boil it soft.']);
  assert.equal(r.steps[0].quote, 'Wash it until the water is clear.');
  assert.equal(r.steps[0].sensory_cue, 'the water runs clear');
  assert.deepEqual(r.steps[0].substeps, [{ text: 'Rinse it **3 times**' }]);
  assert.deepEqual(r.steps[0].uses, [{ name: 'toor dal', amount: '~1 cup' }]);
  assert.equal(r.ingredients.length, 1);
  assert.equal(r.follow_up_questions.length, 1);
  assert.ok(r.media.audio_url);
};
/** The cook's stories and tips are all there. */
const assertShared = (r) => {
  assert.equal(r.stories.length, 1);
  assert.equal(r.special.length, 1);
  assert.equal(r.intro, 'Aaji learned this dal from her mother in Pune.');
  assert.equal(r.steps[0].tip, 'Warm water is faster.');
  assert.deepEqual(r.steps[0].story_ids, ['s1']);
  assert.deepEqual(r.steps[0].special_ids, ['x1']);
};
/** Runs `fn(asked)` with every fetch answered by `answer(url)` (it may throw: offline). */
const withBucket = async (answer, fn) => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const body = answer(String(url));
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    return await fn(asked);
  } finally {
    globalThis.fetch = realFetch;
  }
};
const dal = (id) => () => fullRecipe(id);

await test('storiesShared: the cook’s yes, or memories sent anyway (recipes.list sends those only to her)', () => {
  assert.equal(F.storiesShared({ memoriesOptIn: true, memories: [] }), true);
  assert.equal(F.storiesShared({ memoriesOptIn: true }), true);
  assert.equal(F.storiesShared({ memoriesOptIn: false, memories: [story] }), true); // the cook's own view
  assert.equal(F.storiesShared({ memoriesOptIn: false, memories: [] }), false); // anyone else's
  assert.equal(F.storiesShared({}), false);
  assert.equal(F.storiesShared({ memoriesOptIn: 'yes', memories: 'a story' }), false);
});

await test('withheldIds: the listed dishes whose stories this viewer may not see, one per id', () => {
  const rows = [
    row('kept'), // memoriesOptIn false, memories [] (a kid's view)
    row('said-yes', { memoriesOptIn: true }),
    row('cooks-own', { memories: [story] }),
    row('kept', { _id: 'older', memoriesOptIn: true }), // the newest row of an id decides, as for its entry
    row(' padded '),
    row('processing', { status: 'processing' }),
    row('no-url', { recipeJsonUrl: undefined }),
  ];
  assert.deepEqual([...F.withheldIds(rows)], ['kept', 'padded']);
  assert.deepEqual([...F.withheldIds([])], []);
});

await test('withoutStories: takes out stories, specials, tips, their ids and the intro; keeps the rest', () => {
  const full = R.normalizeRecipe(fullRecipe('dal'));
  assertShared(full);
  const bare = F.withoutStories(full);
  assertWithheld(bare);
  assertShared(full); // a copy: the recipe it was given is untouched
  assert.equal(F.withoutStories(bare), bare); // nothing left to take out: the same object
});

await test('stories: a family dish the cook kept to herself loads without its stories and tips', async () => {
  R.showFamilyRecipes('family-C:leo', [row('aaji-dal'), row('public-pancakes')], PEOPLE);
  assert.deepEqual(ids(lib()), ['aaji-dal', 'public-pancakes', 'in-progress']);
  await withBucket(dal('aaji-dal'), async (asked) => {
    const res = await R.fetchRecipe('aaji-dal');
    assert.ok(asked[0].startsWith('https://storage.googleapis.com/edible-media/aaji-dal/recipe.json?t='), asked[0]);
    assertWithheld(res.recipe);
    assertWithheld(R.getCachedRecipe('aaji-dal')); // cached without them
    // A dish library.json has too loads library.json's copy, without them as well.
    const pancakes = await R.fetchRecipe('public-pancakes');
    assert.ok(asked[1].startsWith('https://storage.googleapis.com/bucket/public-pancakes/recipe.json?t='), asked[1]);
    assertWithheld(pancakes.recipe);
  });
});

await test('stories: the cook’s yes reloads the dish with them, and a no takes them away again', async () => {
  const before = globalThis.__invalidations;
  R.showFamilyRecipes('family-C:leo', [row('aaji-dal', { memoriesOptIn: true, memories: [story] }), row('public-pancakes')], PEOPLE);
  assert.equal(globalThis.__invalidations, before + 1); // a change like any other
  assert.equal(R.getCachedRecipe('aaji-dal'), undefined); // the copy without them is gone
  assertWithheld(R.getCachedRecipe('public-pancakes')); // still withheld: still cached
  await withBucket(dal('aaji-dal'), async () => {
    assertShared((await R.fetchRecipe('aaji-dal')).recipe);
    assertShared(R.getCachedRecipe('aaji-dal'));
  });
  R.showFamilyRecipes('family-C:leo', [row('aaji-dal'), row('public-pancakes')], PEOPLE);
  assert.equal(R.getCachedRecipe('aaji-dal'), undefined);
  await withBucket(dal('aaji-dal'), async () => assertWithheld((await R.fetchRecipe('aaji-dal')).recipe));
});

await test('stories: the cook sees her own; the next person on the phone waits for their own rows', async () => {
  // Grandma signed in: recipes.list sends her the memories she hasn't shared.
  R.showFamilyRecipes('family-C:grandma', [row('aaji-dal', { memories: [story] })], PEOPLE);
  assert.deepEqual(ids(lib()), ['aaji-dal', 'public-pancakes', 'in-progress']);
  assert.equal(R.getCachedRecipe('aaji-dal'), undefined);
  await withBucket(dal('aaji-dal'), async () => assertShared((await R.fetchRecipe('aaji-dal')).recipe));
  assertShared(R.getCachedRecipe('aaji-dal'));
  // She hands the phone to Leo: her dishes, and her copy of them, go until his rows come.
  R.showFamilyRecipes('family-C:leo', null, PEOPLE);
  assert.deepEqual(ids(lib()), ['public-pancakes', 'in-progress']);
  assert.equal(R.getCachedRecipe('aaji-dal'), undefined);
  R.showFamilyRecipes('family-C:leo', [row('aaji-dal')], PEOPLE);
  await withBucket(dal('aaji-dal'), async () => assertWithheld((await R.fetchRecipe('aaji-dal')).recipe));
});

await test('stories: a recipe loaded before the family’s list arrived loses them once it does', async () => {
  R.showFamilyRecipes(null, null);
  // A deep link while nobody's list is in: nothing says to withhold them yet.
  await withBucket(dal('early-dal'), async () => assertShared((await R.fetchRecipe('early-dal')).recipe));
  assertShared(R.getCachedRecipe('early-dal'));
  R.showFamilyRecipes('family-C:leo', [row('early-dal')], PEOPLE);
  assert.equal(R.getCachedRecipe('early-dal'), undefined);
  await withBucket(dal('early-dal'), async () => assertWithheld((await R.fetchRecipe('early-dal')).recipe));
});

await test('stories: the bundled copy is withheld too, offline and when it lends its tips', async () => {
  globalThis.__bundledRecipes['bundled-dal'] = fullRecipe('bundled-dal');
  try {
    R.showFamilyRecipes('family-C:leo', [row('bundled-dal')], PEOPLE);
    assertWithheld(R.getCachedRecipe('bundled-dal')); // before anything loads
    const offline = () => {
      throw new Error('offline');
    };
    await withBucket(offline, async () => {
      const res = await R.fetchRecipe('bundled-dal');
      assert.equal(res.source, 'bundled');
      assertWithheld(res.recipe);
    });
    // The bucket's copy predates the short steps: it borrows substeps, uses and tips from the bundled one.
    const { substeps, uses, tip, ...first } = fullRecipe('bundled-dal').steps[0];
    assert.ok(substeps && uses && tip);
    const older = () => ({ ...fullRecipe('bundled-dal'), steps: [first, fullRecipe('bundled-dal').steps[1]] });
    await withBucket(older, async () => assertWithheld((await R.fetchRecipe('bundled-dal')).recipe));
    // With her yes the lent tip shows.
    R.showFamilyRecipes('family-C:leo', [row('bundled-dal', { memoriesOptIn: true })], PEOPLE);
    await withBucket(older, async () => assertShared((await R.fetchRecipe('bundled-dal')).recipe));
  } finally {
    delete globalThis.__bundledRecipes['bundled-dal'];
    R.showFamilyRecipes(null, null);
  }
});

// ---------------------------------------------------------------------------------------------
// 5. Fail closed

/** The session says `person` of `familyId` is signed in; returns their library key. */
const signIn = (familyId, person) => {
  globalThis.__session = { me: { id: person }, family: { id: familyId }, profiles: [] };
  return `${familyId}:${person}`;
};
let leo;

await test('fail closed: signed in, rows not come yet: a family dish loads without its stories', async () => {
  leo = signIn('family-D', 'leo');
  R.showFamilyRecipes(leo, null, PEOPLE); // recipes.list hasn't answered (slow, unreachable, the stub)
  assert.equal(R.storiesWithheld('secret-dal'), true);
  assert.equal(R.useStoriesWithheld('secret-dal'), true); // what the Share button reads
  await withBucket(dal('secret-dal'), async (asked) => {
    const res = await R.fetchRecipe('secret-dal'); // a deep link: only the conventional bucket path
    assert.ok(asked[0].startsWith(`${R.BUCKET_URL}/secret-dal/recipe.json?t=`), asked[0]);
    assertWithheld(res.recipe);
  });
  assertWithheld(R.getCachedRecipe('secret-dal')); // cached without them
  assertWithheld(R.useRecipe('secret-dal').recipe);
});

await test('fail closed: the rows come with her yes: the copy without them goes and they load again', async () => {
  R.showFamilyRecipes(leo, [row('secret-dal', { memoriesOptIn: true })], PEOPLE);
  assert.equal(R.storiesWithheld('secret-dal'), false);
  assert.equal(R.useStoriesWithheld('secret-dal'), false);
  assert.equal(R.getCachedRecipe('secret-dal'), undefined);
  await withBucket(dal('secret-dal'), async () => assertShared((await R.fetchRecipe('secret-dal')).recipe));
  assertShared(R.getCachedRecipe('secret-dal'));
});

await test('fail closed: the next person on the phone is stripped again until their rows come', async () => {
  const mia = signIn('family-D', 'mia');
  // The session is a step ahead of the library: Leo's rows don't count for Mia.
  assert.equal(R.storiesWithheld('secret-dal'), true);
  R.showFamilyRecipes(mia, null, PEOPLE);
  assert.equal(R.storiesWithheld('secret-dal'), true);
  assert.equal(R.getCachedRecipe('secret-dal'), undefined); // Leo's copy is gone
  await withBucket(dal('secret-dal'), async () => assertWithheld((await R.fetchRecipe('secret-dal')).recipe));
  assertWithheld(R.getCachedRecipe('secret-dal'));
  R.showFamilyRecipes(mia, [row('secret-dal', { memoriesOptIn: true })], PEOPLE);
  assert.equal(R.getCachedRecipe('secret-dal'), undefined);
  await withBucket(dal('secret-dal'), async () => assertShared((await R.fetchRecipe('secret-dal')).recipe));
  // Mia's own rows without the yes keep them.
  R.showFamilyRecipes(mia, [row('secret-dal')], PEOPLE);
  await withBucket(dal('secret-dal'), async () => assertWithheld((await R.fetchRecipe('secret-dal')).recipe));
});

await test('fail closed: signed in before any library screen passed the key: still stripped', async () => {
  R.showFamilyRecipes(null, null); // the library's state is nobody's (no useLibrary screen yet)
  signIn('family-D', 'leo');
  assert.equal(R.storiesWithheld('cold-dal'), true);
  await withBucket(dal('cold-dal'), async () => assertWithheld((await R.fetchRecipe('cold-dal')).recipe));
  assertWithheld(R.getCachedRecipe('cold-dal'));
});

await test('fail closed: the library a step ahead of the session (its own key waiting): still stripped', async () => {
  globalThis.__session = null; // the module's session lags a render behind
  R.showFamilyRecipes('family-G:zoe', null, PEOPLE);
  assert.equal(R.storiesWithheld('cold-dal'), true);
  await withBucket(dal('cold-dal'), async () => assertWithheld((await R.fetchRecipe('cold-dal')).recipe));
  assert.equal(R.storiesWithheld('public-pancakes'), false);
});

await test('fail closed: an empty list is an answer too (it ends the wait)', async () => {
  const k = signIn('family-E', 'kai');
  R.showFamilyRecipes(k, null, PEOPLE);
  await withBucket(dal('cold-dal'), async () => assertWithheld((await R.fetchRecipe('cold-dal')).recipe));
  R.showFamilyRecipes(k, [], PEOPLE); // the same (empty) list as while waiting: it still counts
  assert.equal(R.storiesWithheld('cold-dal'), false);
  assert.equal(R.getCachedRecipe('cold-dal'), undefined);
});

await test('fail closed: a public library dish is never stripped (waiting, the stub, signed out)', async () => {
  globalThis.__bundledRecipes['bundled-chili'] = fullRecipe('bundled-chili');
  try {
    const check = async () => {
      for (const id of ['public-pancakes', 'bundled-chili']) {
        assert.equal(R.storiesWithheld(id), false, id);
        assert.equal(R.useStoriesWithheld(id), false, id);
        await withBucket(dal(id), async () => assertShared((await R.fetchRecipe(id)).recipe));
        assertShared(R.getCachedRecipe(id));
      }
      assertShared(R.getCachedRecipe('bundled-chili')); // the bundled copy too
    };
    // Signed in, waiting for rows (or the stub, whose rows never come).
    R.showFamilyRecipes(signIn('family-F', 'ana'), null, PEOPLE);
    await check();
    // Signed out.
    globalThis.__session = null;
    R.showFamilyRecipes(null, null);
    await check();
  } finally {
    delete globalThis.__bundledRecipes['bundled-chili'];
    globalThis.__session = null;
    R.showFamilyRecipes(null, null);
  }
});

// ---------------------------------------------------------------------------------------------
// 6. Stories and tips from Convex

/** fullRecipe's stories and tips as Convex keeps them (convex/lib/recipeJson.ts). */
const MEMORIES = [
  { kind: 'story', text: 'Aaji learned this dal from her mother.', moment: { startS: 2, endS: 8 }, step: 1, id: 's1', title: 'Her mother’s kitchen' },
  { kind: 'tip', text: 'She rinses it by feel.', moment: { startS: 5, endS: 9 }, step: 1, id: 'x1', why: 'No measuring cup.' },
  { kind: 'tip', text: 'Warm water is faster.', moment: { startS: 0, endS: 10 }, step: 1 },
];
/** The recipe.json the pipeline publishes for a family dish: fullRecipe without_memories. */
const publicRecipe = (id) => F.withoutStories(R.normalizeRecipe(fullRecipe(id)));

await test('withMemories: Convex’s memories go back where the published file left them out', () => {
  const full = R.normalizeRecipe(fullRecipe('dal'));
  const bare = publicRecipe('dal');
  assertWithheld(bare);
  const back = F.withMemories(bare, MEMORIES);
  assert.deepEqual(back.stories, full.stories);
  assert.deepEqual(back.special, full.special);
  assert.deepEqual(
    back.steps.map((s) => [s.tip, s.story_ids, s.special_ids]),
    full.steps.map((s) => [s.tip ?? null, s.story_ids, s.special_ids]),
  );
  assert.deepEqual({ ...back, stories: [], special: [], steps: [] }, { ...full, intro: '', stories: [], special: [], steps: [] });
  assertWithheld(bare); // a copy: the recipe it was given is untouched
  assert.equal(F.withMemories(back, MEMORIES), back); // it has them now: the same object
  assert.equal(F.withMemories(full, MEMORIES), full); // a file that has its own keeps them
  assert.equal(F.withMemories(bare, []), bare);
});

await test('withMemories: an older row’s memories (no step or id) go to the step they were told in', () => {
  const old = [
    { kind: 'story', text: 'A story while it boils.', moment: { startS: 20, endS: 30 } },
    { kind: 'tip', text: 'Warm water is faster.', moment: { startS: 0, endS: 10 } },
    { kind: 'tip', text: 'She rinses it by feel.', moment: { startS: 5, endS: 9 } }, // step 1 has its tip already
    { kind: 'story', text: 'Before the first step.', moment: { startS: -3, endS: 0 } },
  ];
  const back = F.withMemories(publicRecipe('dal'), old);
  assert.deepEqual(
    back.stories.map((x) => [x.id, x.step, x.title, x.text]),
    [
      ['story-1', 2, '', 'A story while it boils.'],
      ['story-4', 1, '', 'Before the first step.'],
    ],
  );
  assert.deepEqual(back.steps.map((s) => s.tip), ['Warm water is faster.', null]);
  assert.deepEqual(back.special.map((x) => [x.id, x.step, x.why]), [['special-3', 1, '']]);
  assert.deepEqual(back.steps.map((s) => s.story_ids), [['story-4'], ['story-1']]);
  assert.deepEqual(back.steps[0].special_ids, ['special-3']);
});

await test('sharedMemories: by library id; unchanged ones keep their array, and nothing new keeps the map', () => {
  const rows = [row('a', { memories: MEMORIES }), row('b'), row('c', { memories: [story] }), row('p', { status: 'processing', memories: [story] })];
  const first = F.sharedMemories(rows);
  assert.deepEqual([...first.keys()], ['a', 'c']);
  const again = [row('a', { memories: MEMORIES.map((m) => ({ ...m })) }), row('b'), row('c', { memories: [{ ...story }] })];
  assert.equal(F.sharedMemories(again, first), first);
  const edited = F.sharedMemories([row('a', { memories: MEMORIES }), row('c', { memories: [{ ...story, text: 'New.' }] })], first);
  assert.notEqual(edited, first);
  assert.equal(edited.get('a'), first.get('a'));
  assert.notEqual(edited.get('c'), first.get('c'));
  assert.equal(F.sharedMemories([], new Map()).size, 0);
});

await test('store: a dish published without its stories gets Convex’s after the cook’s yes, not before', async () => {
  R.showFamilyRecipes('family-D:leo', [row('new-dal')], PEOPLE);
  await withBucket(() => publicRecipe('new-dal'), async () => assertWithheld((await R.fetchRecipe('new-dal')).recipe));
  R.showFamilyRecipes('family-D:leo', [row('new-dal', { memoriesOptIn: true, memories: MEMORIES })], PEOPLE);
  assert.equal(R.getCachedRecipe('new-dal'), undefined);
  await withBucket(() => publicRecipe('new-dal'), async () => {
    const shown = (await R.fetchRecipe('new-dal')).recipe;
    assert.equal(shown.stories[0].title, 'Her mother’s kitchen');
    assert.equal(shown.steps[0].tip, 'Warm water is faster.');
    assert.deepEqual(shown.steps[0].story_ids, ['s1']);
    assert.equal(R.getCachedRecipe('new-dal').special[0].why, 'No measuring cup.');
  });
  // She takes them back: they go, from the cached copy too.
  R.showFamilyRecipes('family-D:leo', [row('new-dal')], PEOPLE);
  assert.equal(R.getCachedRecipe('new-dal'), undefined);
  await withBucket(() => publicRecipe('new-dal'), async () => assertWithheld((await R.fetchRecipe('new-dal')).recipe));
});

await test('store: the cook gets her own back; a recipe loaded before the list gets them once it arrives', async () => {
  R.showFamilyRecipes(null, null);
  await withBucket(() => publicRecipe('early-new'), async () => assertWithheld((await R.fetchRecipe('early-new')).recipe));
  R.showFamilyRecipes('family-D:grandma', [row('early-new', { memories: MEMORIES })], PEOPLE);
  assert.equal(R.getCachedRecipe('early-new'), undefined); // the copy without them is gone
  await withBucket(() => publicRecipe('early-new'), async () => {
    assert.equal((await R.fetchRecipe('early-new')).recipe.stories.length, 1);
  });
  // A re-published dish (new memories) loads again; the same rows again change nothing.
  const cached = R.getCachedRecipe('early-new');
  R.showFamilyRecipes('family-D:grandma', [row('early-new', { memories: MEMORIES.map((m) => ({ ...m })) })], PEOPLE);
  assert.equal(R.getCachedRecipe('early-new'), cached);
  R.showFamilyRecipes('family-D:grandma', [row('early-new', { memories: [MEMORIES[0]] })], PEOPLE);
  assert.equal(R.getCachedRecipe('early-new'), undefined);
  await withBucket(() => publicRecipe('early-new'), async () => {
    const shown = (await R.fetchRecipe('early-new')).recipe;
    assert.equal(shown.stories.length, 1);
    assert.deepEqual(shown.special, []);
    assert.equal(shown.steps[0].tip, null);
  });
  R.showFamilyRecipes(null, null);
});

await test('store: while the rows are on their way the dish has none; they come with its stories', async () => {
  const grandma = signIn('family-E', 'grandma');
  try {
    R.showFamilyRecipes(grandma, null, PEOPLE); // signed in, recipes.list hasn't answered
    await withBucket(() => publicRecipe('waiting-dal'), async () => assertWithheld((await R.fetchRecipe('waiting-dal')).recipe));
    R.showFamilyRecipes(grandma, [row('waiting-dal', { memories: MEMORIES })], PEOPLE);
    assert.equal(R.getCachedRecipe('waiting-dal'), undefined);
    await withBucket(() => publicRecipe('waiting-dal'), async () => {
      assert.equal((await R.fetchRecipe('waiting-dal')).recipe.stories[0].title, 'Her mother’s kitchen');
    });
  } finally {
    globalThis.__session = null;
    R.showFamilyRecipes(null, null);
  }
});

// ---------------------------------------------------------------------------------------------
// 5. What the cook confirmed after the video (homie's follow-up questions, recipes.addedIngredients)

const CUMIN = { name: 'cumin seeds', said: 'a handful, at the start', step: 2, questionId: 'q1' };

await test('withAdded: her confirmed ingredients at the end of the list, once, with her words; nothing new: the same object', () => {
  const dal = R.normalizeRecipe(fullRecipe('dal'));
  const shown = F.withAdded(dal, [CUMIN, { name: 'Toor dal (yellow)', said: 'yes' }, { name: ' ' }, { ...CUMIN, said: 'again' }]);
  assert.deepEqual(shown.ingredients.map((i) => i.name), ['toor dal', 'cumin seeds'], 'a name the list has, a blank one and a repeat are not added');
  assert.deepEqual(shown.ingredients[1].confirmed, { said: 'a handful, at the start', step: 2 });
  assert.equal(dal.ingredients.length, 1, 'a copy: the recipe it was given is untouched');
  assert.equal(F.withAdded(shown, [CUMIN]), shown, 'already there: the same object');
  assert.equal(F.withAdded(dal, []), dal);
  assert.equal(F.withAdded(dal, [{ name: 'ghee' }]).ingredients[1].confirmed.said, null, 'no words: no note');
});

await test('ingredient lines: a confirmed one reads its name with her words after it', () => {
  const lines = X.ingredientLines(F.withAdded(R.normalizeRecipe(fullRecipe('dal')), [CUMIN]).ingredients);
  assert.deepEqual(lines[1], { amount: null, name: 'Cumin seeds', note: 'a handful, at the start' });
  assert.equal(X.spokenIngredient(lines[1]), 'Cumin seeds, a handful, at the start');
  assert.equal(lines[0].amount, '~1 cup', 'the others are as before');
});

await test('sharedAdded: by library id; unchanged ones keep their array, and nothing new keeps the map', () => {
  const first = F.sharedAdded([row('a', { addedIngredients: [CUMIN] }), row('b'), row('p', { status: 'processing', addedIngredients: [CUMIN] })]);
  assert.deepEqual([...first.keys()], ['a']);
  assert.equal(F.sharedAdded([row('a', { addedIngredients: [{ ...CUMIN }] })], first), first);
  assert.notEqual(F.sharedAdded([row('a', { addedIngredients: [{ ...CUMIN, said: 'two pinches' }] })], first).get('a'), first.get('a'));
});

await test('store: her yes shows up in the ingredient list for everyone, stories kept or not; the rows again change nothing', async () => {
  R.showFamilyRecipes('family-F:leo', [row('jeera-dal')], PEOPLE);
  await withBucket(() => publicRecipe('jeera-dal'), async () => assert.deepEqual((await R.fetchRecipe('jeera-dal')).recipe.ingredients.map((i) => i.name), ['toor dal']));
  R.showFamilyRecipes('family-F:leo', [row('jeera-dal', { addedIngredients: [CUMIN] })], PEOPLE);
  assert.equal(R.getCachedRecipe('jeera-dal'), undefined, 'loads again');
  await withBucket(() => publicRecipe('jeera-dal'), async () => {
    const shown = (await R.fetchRecipe('jeera-dal')).recipe;
    assert.deepEqual(shown.ingredients.map((i) => i.name), ['toor dal', 'cumin seeds']);
    assertWithheld({ ...shown, ingredients: shown.ingredients.slice(0, 1) }); // Leo still doesn't get the stories she kept
  });
  const cached = R.getCachedRecipe('jeera-dal');
  R.showFamilyRecipes('family-F:leo', [row('jeera-dal', { addedIngredients: [{ ...CUMIN }] })], PEOPLE);
  assert.equal(R.getCachedRecipe('jeera-dal'), cached);
  R.showFamilyRecipes(null, null);
});

await test('a retired sample finds nothing (an old link or heart), unless the family has a dish of that id', async () => {
  assert.equal(R.RETIRED_SAMPLES.size, 10);
  assert.equal(R.isRetiredSample('weed-steak', []), true);
  assert.equal(R.isRetiredSample('chicken-biryani', []), true);
  assert.equal(R.isRetiredSample('chicken-biryani', ['chicken-biryani']), false, 'a family dish is never refused');
  assert.equal(R.isRetiredSample('chili-abc123', []), false, 'any other id loads as before');
  assert.equal(await R.fetchRecipe('weed-steak'), null, 'no fetch, no recipe');
});

await test('the app ships no recipes: bundled.ts is empty and requires nothing (Caleb, Nov 8)', () => {
  // Every family starts with none and nothing crosses between families, offline too. assets/data is test fixtures only.
  const src = readFileSync(join(root, 'src/lib/bundled.ts'), 'utf8');
  assert.doesNotMatch(src, /require\(/, 'nothing from assets/data in the app');
  assert.match(src, /export const bundledLibrary: LibraryEntry\[\] = \[\];/);
  assert.match(src, /export const bundledRecipes: Record<string, Recipe> = \{\};/);
});

console.log(`\n${passed} passed`);
