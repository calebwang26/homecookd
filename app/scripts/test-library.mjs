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
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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
globalThis.__hidden = [];
globalThis.__invalidations = 0;

const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const stubs = {
  react: stub('export const useCallback = (f) => f; export const useEffect = () => {}; export const useState = (v) => [v, () => {}]; export const useSyncExternalStore = (_s, get) => get();'),
  './bundled': stub('export const bundledLibrary = globalThis.__bundledLibrary; export const bundledRecipes = {};'),
  './deletes': stub('export const loadHiddenIds = () => globalThis.__hidden;'),
  './live/convex': stub('export const useLive = (_n, initial) => initial; export const invalidateConvexRecipes = () => { globalThis.__invalidations += 1; };'),
  './session': stub('export const useSession = () => ({ me: null, family: null, profiles: [] });'),
};
// Stubs for React & the modules that need Expo; the app's other siblings ('./http') resolve to .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (stubs[spec]) return { url: stubs[spec], shortCircuit: true };
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) {
      const p = join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`);
      if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});
const F = await import(pathToFileURL(join(root, 'src/lib/familyLibrary.ts')).href);
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

console.log(`\n${passed} passed`);
