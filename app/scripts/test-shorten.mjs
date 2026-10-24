// Tests for cook mode's short steps (pipeline/shorten.py output) in the app:
//   node scripts/test-shorten.mjs
// 1. src/lib/recipes.ts withBundledShortSteps: a fetched recipe without substeps borrows them from its
//    bundled copy (with its tidied step titles) when every step is the same step (instruction &
//    times), and keeps its own otherwise.
// 2. fetchRecipe wiring, with a stubbed bucket fetch (no network).
// 3. The bundled recipes in assets/data: every step has 2-5 short substeps, uses that name real
//    ingredients, and no placeholders.
// 4. Substep start_s (pipeline/align.py): on recipes with audio every substep has whole-second start_s on
//    the recording, the first = step.start_s, strictly increasing, all before step.end_s; none without audio.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'assets/data/recipes');
const bundled = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8'))]),
);
globalThis.__bundled = bundled;

const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const stubs = {
  react: stub('export const useCallback = (f) => f; export const useEffect = () => {}; export const useState = (v) => [v, () => {}]; export const useSyncExternalStore = (_s, get) => get();'),
  './bundled': stub('export const bundledLibrary = []; export const bundledRecipes = globalThis.__bundled;'),
  './deletes': stub('export const loadHiddenIds = () => [];'),
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
const R = await import(pathToFileURL(join(root, 'src/lib/recipes.ts')).href);

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
};

const clone = (x) => JSON.parse(JSON.stringify(x));
/** The bucket's copy today: same recipe, no short fields. */
const bare = (r) => ({ ...clone(r), steps: r.steps.map(({ substeps, uses, tip, ...s }) => s) });

const steak = bundled['weed-steak'];

await test('match: fetched recipe takes substeps, uses & tip from the bundled copy', () => {
  const remote = R.normalizeRecipe(bare(steak));
  assert.ok(remote.steps.every((s) => !s.substeps));
  const out = R.withBundledShortSteps(remote, steak);
  assert.equal(out.steps.length, steak.steps.length);
  out.steps.forEach((s, i) => {
    assert.deepEqual(s.substeps, steak.steps[i].substeps);
    assert.deepEqual(s.uses, steak.steps[i].uses);
    assert.equal(s.tip, steak.steps[i].tip);
    assert.equal(s.title, steak.steps[i].title);
    assert.equal(s.instruction, remote.steps[i].instruction); // everything else stays the bucket's
    assert.equal(s.start_s, remote.steps[i].start_s);
  });
  // Instructions compare without case or extra spaces, a title renamed in the bundle still matches (and
  // wins), and the bundled copy's step order is by `order`.
  const shuffled = { ...clone(steak), steps: [...clone(steak).steps].reverse() };
  const loud = {
    ...remote,
    steps: remote.steps.map((s, i) => ({ ...s, title: i === 7 ? 'Add the oil' : s.title, instruction: `  ${s.instruction.toUpperCase()} ` })),
  };
  const out2 = R.withBundledShortSteps(loud, shuffled);
  assert.deepEqual(out2.steps[0].substeps, steak.steps[0].substeps);
  assert.equal(out2.steps[7].title, steak.steps[7].title); // the bundle's tidied title
});

await test('mismatch: a different instruction, time or step count keeps the fetched recipe as is', () => {
  const remote = R.normalizeRecipe(bare(steak));
  const edited = { ...remote, steps: remote.steps.map((s, i) => (i === 3 ? { ...s, instruction: `${s.instruction} Then rest it.` } : s)) };
  assert.equal(R.withBundledShortSteps(edited, steak), edited);
  const moved = { ...remote, steps: remote.steps.map((s, i) => (i === 3 ? { ...s, end_s: s.end_s + 30 } : s)) };
  assert.equal(R.withBundledShortSteps(moved, steak), moved);
  const fewer = { ...remote, steps: remote.steps.slice(0, -1) };
  assert.equal(R.withBundledShortSteps(fewer, steak), fewer);
  assert.equal(R.withBundledShortSteps(remote, undefined), remote);
  assert.equal(R.withBundledShortSteps(remote, bare(steak)), remote); // bundled copy has none either
  const empty = { ...remote, steps: [] };
  assert.equal(R.withBundledShortSteps(empty, steak), empty);
});

await test('already present: a fetched recipe with its own substeps is never overwritten', () => {
  const remote = R.normalizeRecipe(clone(steak));
  remote.steps[0].substeps = [{ text: 'The bucket’s own line.', detail: null }];
  const out = R.withBundledShortSteps(remote, steak);
  assert.equal(out, remote);
  assert.equal(out.steps[0].substeps[0].text, 'The bucket’s own line.');
});

await test('fetchRecipe: a bucket recipe without substeps comes back with the bundled ones', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => bare(steak) });
  try {
    const res = await R.fetchRecipe('weed-steak');
    assert.equal(res.source, 'remote');
    assert.deepEqual(res.recipe.steps.map((s) => s.substeps), steak.steps.map((s) => s.substeps));
    assert.deepEqual(res.recipe.steps.map((s) => s.uses), steak.steps.map((s) => s.uses));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('bundled data: short substeps, real ingredient names, no placeholders', () => {
  const ids = Object.keys(bundled);
  assert.ok(ids.length >= 10, `${ids.length} bundled recipes`);
  for (const id of ids) {
    const r = bundled[id];
    const names = new Set(r.ingredients.map((i) => i.name));
    for (const s of r.steps) {
      const at = `${id} step ${s.order}`;
      assert.ok(Array.isArray(s.substeps) && s.substeps.length >= 2 && s.substeps.length <= 5, `${at}: ${s.substeps?.length} substeps`);
      for (const x of s.substeps) {
        const visible = x.text.replace(/\*\*/g, '');
        assert.ok(visible.trim() && visible.length <= 70, `${at}: ${visible.length} chars: ${x.text}`);
        assert.equal(x.text.split('**').length % 2, 1, `${at}: unbalanced ** in ${x.text}`);
        assert.ok(!/[[\]]|ask \w+:|TBD/i.test(`${x.text} ${x.detail ?? ''}`), `${at}: placeholder in ${x.text}`);
      }
      assert.ok(Array.isArray(s.uses), `${at}: no uses`);
      for (const u of s.uses) {
        assert.ok(names.has(u.name), `${at}: uses ${u.name}, not an ingredient`);
        assert.ok(!u.amount || !/[[\]?]|unknown/i.test(u.amount), `${at}: placeholder amount ${u.amount}`);
      }
      assert.ok(s.tip === null || (typeof s.tip === 'string' && s.tip.length <= 160 && !/[[\]]/.test(s.tip)), `${at}: tip ${s.tip}`);
    }
  }
});

await test('bundled data: substep start_s splits each recorded step in order', () => {
  let recorded = 0;
  for (const [id, r] of Object.entries(bundled)) {
    const audio = Boolean(r.media?.audio_url);
    recorded += audio ? 1 : 0;
    for (const s of r.steps) {
      const at = `${id} step ${s.order}`;
      const starts = s.substeps.map((x) => x.start_s);
      if (!audio) {
        assert.ok(starts.every((t) => t == null), `${at}: start_s without audio`);
        continue;
      }
      assert.ok(starts.every(Number.isInteger), `${at}: start_s ${starts}`);
      assert.equal(starts[0], s.start_s, `${at}: first start_s ${starts[0]} != ${s.start_s}`);
      starts.slice(1).forEach((t, i) => assert.ok(t > starts[i], `${at}: not increasing ${starts}`));
      assert.ok(starts.at(-1) < s.end_s, `${at}: ${starts.at(-1)} not before end ${s.end_s}`);
    }
  }
  assert.ok(recorded >= 5, `${recorded} recorded recipes`);
});

console.log(`\n${passed} passed`);
