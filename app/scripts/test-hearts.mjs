// Unit tests for Hearts & kitchen (RETENTION-HANDOFF 3.5 + 3.6, PR 4) app logic, TS run by Node's type
// stripping:
//   src/lib/heartsCopy.ts    "♥ 4 · cooked 3 times", the faces row, the card's activity line beside it,
//                            "♥ 4 · Leo, Maya, Dad", the kitchen header line, "Leo hearted your Sunday
//                            Chili" rows
//   src/lib/heartsNote.ts    "Mom sees your hearts", once per profile, through HeartButton’s path (never a
//                            memorial cook, nor one GET /family hasn’t said is not memorial)
//   src/lib/dishStatsApi.ts  GET /dish-stats (batches of 50) & GET /hearts/recent, against a fake fetch
//   node scripts/test-hearts.mjs
// lib/storage is swapped for an in-memory map (same exports, same never-throw contract). No network:
// globalThis.fetch is never called; the api calls get a fake fetch. The family code here is a dummy.
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

// The app imports siblings without an extension ('./storage'); resolve them to .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === './storage') return { url: STORAGE_STUB, shortCircuit: true };
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) {
      const p = join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`);
      if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

globalThis.fetch = () => {
  throw new Error('network is off in tests');
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(root, p)).href);
const C = await load('src/lib/heartsCopy.ts');
const N = await load('src/lib/heartsNote.ts');
const D = await load('src/lib/dishStatsApi.ts');
const A = await load('src/lib/api.ts');
const K = await load('src/lib/kitchenCounts.ts');
const R = await load('src/lib/heartReason.ts');
const E = await load('src/lib/aws/errors.ts');
const { wordsFor } = await load('src/lib/words/words.ts');
const kv = globalThis.__kv;

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    throw e;
  }
};

// As GET /family gives them since PR 4 (memorial read apart, false for everyone here).
const P = {
  dad: { id: 'p-dad', name: 'Dad', role: 'cook', avatar_key: 'dad', memorial: false },
  mom: { id: 'p-mom', name: 'Mom', role: 'cook', avatar_key: 'mom', memorial: false },
  gran: { id: 'p-gran', name: 'Grandma', role: 'cook', avatar_key: null, memorial: false },
  leo: { id: 'p-leo', name: 'Leo', role: 'learner', avatar_key: 'leo', memorial: false },
  maya: { id: 'p-maya', name: 'Maya', role: 'learner', avatar_key: null, memorial: false },
  sam: { id: 'p-sam', name: 'Sam', role: 'learner', avatar_key: null, memorial: false },
};
const family = [P.dad, P.mom, P.gran, P.leo, P.maya, P.sam];
const stat = (hearts = [], cooked = []) => ({
  hearts: { count: hearts.length, by: hearts.map(([profile_id, at]) => ({ profile_id, at })) },
  cooked: { count: cooked.reduce((n, c) => n + c[1], 0), by: cooked.map(([profile_id, count, last_at]) => ({ profile_id, count, last_at })) },
});
const entry = (id, cook, extra = {}) => ({ id, title: id, cook_name: cook, relation: cook, poster_url: null, tags: [], sample: false, recipe_url: 'x', ...extra });

// --- heartsCopy ------------------------------------------------------------------------------

await test('dishStatsText: "♥ 4 · cooked 3 times", each zero part hidden, nothing when both are zero', () => {
  const s = stat(
    [['p-leo', '2026-10-10T10:00:00Z'], ['p-maya', '2026-10-11T10:00:00Z'], ['p-mom', '2026-10-12T10:00:00Z'], ['p-sam', '2026-10-13T10:00:00Z']],
    [['p-leo', 2, '2026-10-09T10:00:00Z'], ['p-maya', 1, '2026-10-05T10:00:00Z']],
  );
  assert.equal(C.dishStatsText(s), '♥ 4 · cooked 3 times');
  assert.deepEqual(C.dishStatsParts(s), { hearts: 4, made: 'cooked 3 times', label: '4 hearts, cooked 3 times' });
  assert.equal(C.dishStatsText(stat([['p-leo', '2026-10-10T10:00:00Z']])), '♥ 1');
  assert.equal(C.dishStatsParts(stat([['p-leo', '2026-10-10T10:00:00Z']])).label, '1 heart');
  assert.equal(C.dishStatsText(stat([], [['p-leo', 1, '2026-10-09T10:00:00Z']])), 'cooked once');
  assert.equal(C.dishStatsText(stat([], [['p-leo', 2, '2026-10-09T10:00:00Z']]), 'baked'), 'baked twice');
  assert.equal(C.dishStatsText(stat()), null);
  assert.equal(C.dishStatsParts(null), null);
  assert.equal(C.dishStatsParts(undefined), null);
  assert.equal(C.dishStatsParts({ hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } }), null, "the server's zeros");
});

await test('statFaces: who cooked or hearted, newest first, each once, only people still in the family', () => {
  const s = stat(
    [['p-leo', '2026-10-10T10:00:00Z'], ['p-maya', '2026-10-12T10:00:00Z'], ['p-gone', '2026-10-16T10:00:00Z']],
    [['p-leo', 2, '2026-10-14T10:00:00Z'], ['p-mom', 1, '2026-10-01T10:00:00Z'], ['p-sam', 0, '2026-10-15T10:00:00Z']],
  );
  const f = C.statFaces(s, family);
  // Leo's latest is his cook on the 14th; Sam's 0-count row and the removed person never show.
  assert.deepEqual(f.shown.map((p) => p.name), ['Leo', 'Maya', 'Mom']);
  assert.equal(f.more, 0);
  const capped = C.statFaces(s, family, 2);
  assert.deepEqual([capped.shown.map((p) => p.name), capped.more], [['Leo', 'Maya'], 1]);
  assert.deepEqual(C.statFaces(null, family), { shown: [], more: 0 });
});

await test('dishStatsLabel & facesThatFit: the card line stays one line; the label always says who', () => {
  const s = stat(
    [['p-maya', '2026-10-15T10:00:00Z'], ['p-dad', '2026-10-13T10:00:00Z']],
    [['p-leo', 2, '2026-10-14T10:00:00Z'], ['p-maya', 1, '2026-10-11T10:00:00Z']],
  );
  assert.equal(C.dishStatsLabel(s, family), '2 hearts, cooked 3 times. Maya, Leo, Dad');
  const four = stat([['p-sam', '2026-10-16T10:00:00Z'], ...s.hearts.by.map((h) => [h.profile_id, h.at])], [['p-leo', 2, '2026-10-14T10:00:00Z']]);
  assert.equal(C.dishStatsLabel(four, family, 'baked'), '3 hearts, baked twice. Sam, Maya, Leo and 1 more');
  assert.equal(C.dishStatsLabel(stat([['p-gone', '2026-10-15T10:00:00Z']]), family), '1 heart', 'nobody left to name');
  assert.equal(C.dishStatsLabel(stat(), family), null);

  // 20 pt faces overlap by 6: 1 face = 20, 2 = 34, 3 = 48; "+N" adds 6 + 9 a character.
  assert.deepEqual(C.CARD_FACES, { max: 3, size: 20 });
  assert.equal(C.facesThatFit(200, 3), 3);
  assert.equal(C.facesThatFit(48, 3), 3, 'exactly room for three');
  assert.equal(C.facesThatFit(47, 3), 1, 'not three (48), not two + "+1" (58): one + "+2" (44)');
  assert.equal(C.facesThatFit(58, 5), 2, '2 faces + "+3"');
  assert.equal(C.facesThatFit(200, 9), 3, 'never more than 3, then "+6"');
  assert.equal(C.facesThatFit(20, 1), 1);
  assert.equal(C.facesThatFit(43, 3), 0, 'one face + "+2" is 44: none rather than a partial row');
  assert.equal(C.facesThatFit(0, 2), 0, 'before anything is measured');
  assert.equal(C.facesThatFit(-30, 2), 0, 'words wider than the row');
  assert.equal(C.facesThatFit(200, 0), 0);
  assert.equal(C.facesThatFit(200, 4, 20, 1), 1, 'a smaller cap');
});

await test('cardActivityLine: says who cooked it unless the drawn faces show them all; a cook is never "opened it"', () => {
  // Dad's Sunday Chili: Leo cooked it twice, Maya once; Maya also opened it twice, Sam 3 times, Mom
  // (a cook) 5 times; Dad (me) opened and cooked his own dish.
  const a = {
    cooked: [
      { profile: P.maya, at: '2026-10-11T10:00:00Z', note: null },
      { profile: P.leo, at: '2026-10-14T10:00:00Z', note: null },
      { profile: P.leo, at: '2026-10-09T10:00:00Z', note: null },
      { profile: P.dad, at: '2026-10-15T10:00:00Z', note: null },
    ],
    viewed: [
      { profile: P.maya, count: 2 },
      { profile: P.sam, count: 3 },
      { profile: P.mom, count: 5 },
      { profile: P.dad, count: 9 },
    ],
  };
  const me = { meId: P.dad.id, statCooked: 3 };
  const cookedLine = { text: 'Leo and Maya cooked it', done: true };
  // The stat says "cooked 3 times" but a 390-pt card had no room for faces: the line still says who.
  assert.deepEqual(C.cardActivityLine(a, { ...me, faceIds: [] }), cookedLine, 'no faces drawn');
  assert.deepEqual(C.cardActivityLine(a, me), cookedLine, 'before anything is measured');
  assert.deepEqual(C.cardActivityLine(a, { ...me, faceIds: [P.leo.id, P.sam.id] }), cookedLine, "Maya's face didn't fit");
  assert.deepEqual(C.cardActivityLine(a, { ...me, statCooked: 0, faceIds: [P.leo.id, P.maya.id] }), cookedLine, 'the stat line does not say cooked');
  // Every cook's face is drawn and the stat says cooked: the next true thing, never "Maya opened it twice".
  assert.deepEqual(C.cardActivityLine(a, { ...me, faceIds: [P.maya.id, P.leo.id, P.sam.id] }), { text: 'Sam opened it 3 times' });
  const onlyCooksOpened = { ...a, viewed: a.viewed.filter((v) => v.profile.id !== P.sam.id) };
  assert.equal(C.cardActivityLine(onlyCooksOpened, { ...me, faceIds: [P.leo.id, P.maya.id] }), null, 'falls through to sent / facts');
  // Without the stat line at all, opened never names someone who cooked it either.
  assert.deepEqual(C.cardActivityLine({ cooked: [], viewed: a.viewed }, { meId: P.dad.id }), { text: 'Sam opened it 3 times' });
  assert.deepEqual(C.cardActivityLine({ cooked: [], viewed: [{ profile: P.maya, count: 1 }] }, { meId: P.dad.id }), { text: 'Maya opened it once' });
  // Her own cooking & opening aren't news; a cook opening it isn't counted; "baked" for breads.
  assert.equal(C.cardActivityLine({ cooked: [a.cooked[3]], viewed: [a.viewed[2], a.viewed[3]] }, { meId: P.dad.id }), null);
  assert.deepEqual(C.cardActivityLine({ cooked: [a.cooked[1]], viewed: [] }, { meId: P.dad.id, verb: 'baked' }), { text: 'Leo baked it', done: true });
  assert.equal(C.cardActivityLine({ cooked: [], viewed: [] }, { meId: P.dad.id }), null);
});

await test('heartNames: "♥ 4 · Leo, Maya, Dad" on her recipe page, newest first, then +N', () => {
  const s = stat([['p-maya', '2026-10-13T10:00:00Z'], ['p-leo', '2026-10-12T10:00:00Z'], ['p-dad', '2026-10-11T10:00:00Z'], ['p-sam', '2026-10-10T10:00:00Z']]);
  assert.deepEqual(C.heartNames(s, family), { count: 4, names: 'Maya, Leo, Dad +1', label: '4 hearts, from Maya, Leo, Dad and Sam' });
  assert.deepEqual(C.heartNames(stat([['p-leo', '2026-10-12T10:00:00Z']]), family), { count: 1, names: 'Leo', label: '1 heart, from Leo' });
  // Someone who left the family: neither named nor counted, so the number and the names agree.
  assert.deepEqual(C.heartNames(stat([['p-gone', '2026-10-12T10:00:00Z'], ['p-leo', '2026-10-11T10:00:00Z']]), family).count, 1);
  assert.equal(C.heartNames(stat([], [['p-leo', 1, '2026-10-09T10:00:00Z']]), family), null);
  assert.equal(C.heartNames(null, family), null);
});

await test('kitchenLine: "You can cook 4 of Grandma’s 7", the keeper line, and a quiet start', () => {
  assert.equal(C.kitchenLine({ cookName: 'Grandma', total: 7, cooked: 4, complete: false }), 'You can cook 4 of Grandma’s 7');
  assert.equal(C.kitchenLine({ cookName: 'Grandma', total: 7, cooked: 7, complete: true }), 'Keeper of Grandma’s kitchen');
  assert.equal(C.kitchenLine({ cookName: 'Grandma', total: 7, cooked: 0, complete: false }), 'Grandma’s 7 dishes');
  assert.equal(C.kitchenLine({ cookName: 'Grandma', total: 1, cooked: 0 }), 'Grandma’s dish');
  assert.equal(C.kitchenLine({ cookName: 'Grandma', total: 1, cooked: 1 }), 'Keeper of Grandma’s kitchen');
  assert.equal(C.kitchenLine({ cookName: 'James', total: 3, cooked: 1 }), 'You can cook 1 of James’ 3');
  assert.equal(C.kitchenLine({ cookName: 'Grandma', total: 0, cooked: 0 }), null);
  assert.equal(C.kitchenLine(null), null);
  // Straight from kitchenCounts.ts: samples and YouTube never count, so they never reach the line.
  const entries = [
    entry('g1', 'Grandma'), entry('g2', 'Grandma'), entry('g3', 'Grandma', { sample: true }), entry('y1', 'Gordon', { relation: 'YouTube' }),
  ];
  const counts = K.kitchenCounts(entries, family, { g1: { cooked: 2 } }, P.leo.id);
  assert.equal(C.kitchenLine(K.kitchenFor(counts, 'Grandma')), 'You can cook 1 of Grandma’s 2');
  assert.equal(C.kitchenLine(K.kitchenFor(counts, 'Gordon')), null);
  const done = K.kitchenCounts(entries, family, { g1: { cooked: 1 }, g2: { cooked: 3 } }, P.leo.id);
  assert.equal(C.kitchenLine(K.kitchenFor(done, 'grandma')), 'Keeper of Grandma’s kitchen');
  assert.equal(C.KITCHEN_DOTS_MAX, 12);
});

await test('heartUpdates: my dishes only, never me, minus cleared rows, newest first, 3 at most', () => {
  const recent = [
    { profile_id: 'p-leo', recipe_id: 'dad-chili', at: '2026-10-15T09:00:00Z' },
    { profile_id: 'p-maya', recipe_id: 'dad-chili', at: '2026-10-16T09:00:00Z' },
    { profile_id: 'p-dad', recipe_id: 'dad-chili', at: '2026-10-16T10:00:00Z' }, // me
    { profile_id: 'p-leo', recipe_id: 'mom-dal', at: '2026-10-16T11:00:00Z' }, // not mine
    { profile_id: 'p-gone', recipe_id: 'dad-rice', at: '2026-10-16T12:00:00Z' }, // left the family
    { profile_id: 'p-mom', recipe_id: 'dad-rice', at: '2026-10-14T09:00:00Z' },
    { profile_id: 'p-gran', recipe_id: 'dad-rice', at: '2026-10-13T09:00:00Z' },
  ];
  const mine = ['dad-chili', 'dad-rice'];
  const rows = C.heartUpdates(recent, family, mine, { meId: 'p-dad' });
  assert.deepEqual(rows.map((r) => [r.who.name, r.recipeId]), [['Maya', 'dad-chili'], ['Leo', 'dad-chili'], ['Mom', 'dad-rice']]);
  assert.equal(rows[0].key, 'heart:p-maya:dad-chili:2026-10-16T09:00:00Z');
  const cleared = C.heartUpdates(recent, family, mine, { meId: 'p-dad', dismissed: [rows[0].key] });
  assert.deepEqual(cleared.map((r) => r.who.name), ['Leo', 'Mom', 'Grandma']);
  // Hearting again after an un-heart is a new time, so a new row even if the old one was cleared.
  const again = C.heartUpdates([{ ...recent[1], at: '2026-10-17T08:00:00Z' }], family, mine, { meId: 'p-dad', dismissed: [rows[0].key] });
  assert.equal(again.length, 1);
  assert.equal(C.heartUpdateTitle('Leo', 'Sunday Chili'), 'Leo hearted your Sunday Chili');
  assert.equal(C.heartUpdateTitle('Leo', ' '), 'Leo hearted your recipe');
  assert.deepEqual(C.heartUpdates([], family, mine), []);
});

await test('mixInHearts: hearts never push a question or a new phone behind "See all"', () => {
  const SHOWN = 3; // UpdatesCard's visible rows besides the live ones
  const row = (kind, key, at) => ({ kind, key, at });
  const needsAnswer = (u) => u.kind === 'ask' || u.kind === 'move';
  // One open question, then three quick hearts after it.
  const ask = row('ask', 'q1', '2026-10-17T09:00:00Z');
  const hearts = [
    row('heart', 'h3', '2026-10-17T09:03:00Z'),
    row('heart', 'h2', '2026-10-17T09:02:00Z'),
    row('heart', 'h1', '2026-10-17T09:01:00Z'),
  ];
  const mixed = C.mixInHearts([ask], hearts, needsAnswer);
  assert.ok(mixed.slice(0, SHOWN).some((u) => u.key === 'q1'), 'the question stays in the visible 3');
  assert.deepEqual(mixed.map((u) => u.key), ['q1', 'h3', 'h2', 'h1']);
  // Someone on a new phone and a family question stay above the hearts too.
  const move = row('move', 'm1', '2026-10-10T09:00:00Z');
  const family = row('ask', 'f1', '2026-10-11T09:00:00Z');
  assert.deepEqual(C.mixInHearts([move, ask, family], hearts, needsAnswer).map((u) => u.key), ['m1', 'q1', 'f1', 'h3', 'h2', 'h1']);
  // Below the last question, hearts and "made" rows mix by time (newest first).
  const madeOld = row('made', 'made-old', '2026-10-16T09:00:00Z');
  const madeNew = row('made', 'made-new', '2026-10-17T10:00:00Z');
  assert.deepEqual(C.mixInHearts([madeNew, ask, madeOld], hearts, needsAnswer).map((u) => u.key), ['made-new', 'q1', 'h3', 'h2', 'h1', 'made-old']);
  // Nothing needs an answer: purely by time.
  assert.deepEqual(C.mixInHearts([madeNew, madeOld], hearts, needsAnswer).map((u) => u.key), ['made-new', 'h3', 'h2', 'h1', 'made-old']);
  assert.deepEqual(C.mixInHearts([ask], [], needsAnswer), [ask]);
});

await test('copy never assumes a gender, speaks for the cook, or uses guilt words', () => {
  const lines = [
    C.dishStatsText(stat([['p-leo', '2026-10-10T10:00:00Z']], [['p-leo', 3, '2026-10-09T10:00:00Z']])),
    C.heartNames(stat([['p-leo', '2026-10-10T10:00:00Z']]), family).label,
    C.kitchenLine({ cookName: 'Grandma', total: 7, cooked: 0 }),
    C.kitchenLine({ cookName: 'Grandma', total: 7, cooked: 3 }),
    C.kitchenLine({ cookName: 'Grandma', total: 7, cooked: 7 }),
    C.heartUpdateTitle('Leo', 'Sunday Chili'),
    N.heartsNoteText('Mom'),
  ].join(' | ');
  assert.doesNotMatch(lines, /\b(he|she|him|her|his|hers)\b/i);
  assert.doesNotMatch(lines, /\b(lost|expired|broken|missed|miss|only|still|yet|behind|last chance)\b/i);
  assert.doesNotMatch(lines, /\b(loves?|proud|misses|wants|happy)\b/i);
});

// --- heartsNote ------------------------------------------------------------------------------

await test('heartsNote: "Mom sees your hearts", once per profile, only for another family cook’s dish', async () => {
  kv.clear();
  N.resetHeartsNoteForTests();
  const tap = (over = {}) => N.takeHeartsNote({ meId: P.leo.id, cook: P.mom, wasOn: false, ok: true, ...over });
  assert.equal(await tap({ wasOn: true }), null, 'un-heart');
  assert.equal(await tap({ ok: false }), null, 'not saved');
  assert.equal(await tap({ cook: null }), null, 'a library cook who is not in the family');
  assert.equal(await tap({ cook: { ...P.leo } }), null, 'my own dish');
  assert.equal(await tap({ cook: { ...P.gran, memorial: true } }), null, 'memorial: never addressed as present');
  assert.equal(await tap({ cook: { id: P.gran.id, name: 'Grandma' } }), null, 'memorial unknown (older server): waits');
  assert.equal(await tap({ cook: { ...P.gran, memorial: null } }), null, 'memorial unknown (null): waits');
  assert.equal(await tap({ meId: null }), null, 'nobody picked');
  assert.equal(await N.heartsNoteSeen(P.leo.id), false, 'none of those used it up');

  const [a, b] = await Promise.all([tap(), tap({ cook: P.dad })]);
  assert.deepEqual([a, b], ['Mom sees your hearts', null], 'a double tap shows one');
  assert.equal(await tap({ cook: P.dad }), null, 'once per profile, whichever cook');
  assert.ok(kv.get('hearts.toastSeen.p-leo'));
  // Another person on the same phone gets their own.
  assert.equal(await tap({ meId: P.maya.id, cook: P.dad }), 'Dad sees your hearts');
  // A restart (fresh memory) still remembers it from storage.
  N.resetHeartsNoteForTests();
  assert.equal(await tap(), null);
  assert.equal(await N.heartsNoteSeen(P.leo.id), true);
  assert.equal(N.heartsNoteKey('p-leo'), 'hearts.toastSeen.p-leo');
});

await test('heartsNote through HeartButton’s path: the dish’s cook from the family list, a memorial cook never', async () => {
  kv.clear();
  N.resetHeartsNoteForTests();
  // Exactly what HeartButton passes: getCachedEntry(recipeId) and the session's profiles.
  const tap = (entry, profiles = family, over = {}) => N.takeHeartsNoteFor({ meId: P.leo.id, entry, profiles, wasOn: false, ok: true, ...over });
  const memorialGran = family.map((p) => (p.id === P.gran.id ? { ...p, memorial: true } : p));
  // A family loaded before the server sent the flag (or cached from then): nobody is known not memorial.
  const unknown = family.map(({ memorial: _m, ...p }) => p);

  assert.equal(await tap(entry('gran-dumplings', 'Grandma'), memorialGran), null, 'memorial Grandma: no "Grandma sees your hearts"');
  assert.equal(await tap(entry('gran-dumplings', 'grandma '), memorialGran), null, 'matched the way cookProfile() matches');
  assert.equal(await tap(entry('dad-chili', 'Dad'), unknown), null, 'memorial unknown: no note');
  assert.equal(await tap(entry('yt-1', 'Gordon', { relation: 'YouTube' })), null, 'a YouTube cook is nobody in the family');
  assert.equal(await tap(entry('leo-toast', 'Leo')), null, 'my own dish');
  assert.equal(await tap(undefined), null, 'a dish the library has not loaded');
  assert.equal(await N.heartsNoteSeen(P.leo.id), false, 'none of those used it up');
  assert.equal(N.heartsNoteCook(entry('gran-dumplings', ' GRANDMA'), memorialGran)?.memorial, true);

  // The memorial cook's dish doesn't use up the note: the next living cook's dish shows it.
  assert.equal(await tap(entry('dad-chili', 'Dad'), memorialGran), 'Dad sees your hearts');
  assert.equal(await tap(entry('mom-dal', 'Mom'), memorialGran), null, 'once');
  // Samples are hearts the cook sees too (hearts.ts counts them).
  assert.equal(await tap(entry('mom-dal', 'Mom', { sample: true }), family, { meId: P.maya.id }), 'Mom sees your hearts');
});

// --- dishStatsApi ----------------------------------------------------------------------------

/** A fake fetch: answers with `reply(url, init)` (a Response or a plain value = 200 JSON) and records calls. */
function fakeFetch(reply) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, method: init.method });
    const out = await reply(new URL(String(url)), init);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}
const statsFor = (ids) => Object.fromEntries(ids.map((id) => [id, { hearts: { count: 1, by: [{ profile_id: 'p-leo', at: 'x' }] }, cooked: { count: 0, by: [] } }]));

await test('fetchDishStats: my ids in batches of 50, as the acting person, merged; nothing asked for none', async () => {
  A.setApiAuth({ deviceKey: null, code: 'DUMMY-CODE', profileId: 'p-dad' });
  const f = fakeFetch((u) => statsFor(u.searchParams.get('ids').split(',')));
  assert.deepEqual(await D.fetchDishStats([], { fetch: f.fetch }), {});
  assert.deepEqual(await D.fetchDishStats(['Bad Id', ''], { fetch: f.fetch }), {});
  assert.equal(f.calls.length, 0);

  const ids = Array.from({ length: 120 }, (_, i) => `dad-${i}`);
  const out = await D.fetchDishStats([...ids, 'dad-3', 'Not Valid'], { fetch: f.fetch });
  assert.equal(Object.keys(out).length, 120);
  assert.deepEqual(f.calls.map((c) => new URL(c.url).searchParams.get('ids').split(',').length), [50, 50, 20]);
  assert.ok(f.calls.every((c) => c.url.startsWith(`${A.API_URL}/dish-stats?ids=`) && c.method === 'GET'));
  assert.deepEqual(
    [f.calls[0].headers['x-family-code'], f.calls[0].headers['x-profile-id'], f.calls[0].headers['x-device-key']],
    ['DUMMY-CODE', 'p-dad', undefined],
  );
  // A device key wins over the code; an explicit profile id wins over the current one.
  A.setApiAuth({ deviceKey: 'dummy-key', code: 'DUMMY-CODE', profileId: 'p-dad' });
  const g = fakeFetch(() => ({}));
  await D.fetchDishStats(['dad-1'], { fetch: g.fetch, profileId: 'p-mom' });
  assert.deepEqual([g.calls[0].headers['x-device-key'], g.calls[0].headers['x-family-code'], g.calls[0].headers['x-profile-id']], ['dummy-key', undefined, 'p-mom']);
});

await test('fetchDishStats: a server without the route (404) is nothing to show; errors throw with the server’s words', async () => {
  A.setApiAuth({ deviceKey: null, code: 'DUMMY-CODE', profileId: 'p-dad' });
  const missing = fakeFetch(() => new Response(JSON.stringify({ error: 'No route for GET /dish-stats' }), { status: 404 }));
  assert.deepEqual(await D.fetchDishStats(['dad-1'], { fetch: missing.fetch }), {});
  const bad = fakeFetch(() => new Response(JSON.stringify({ error: 'ids: at most 50' }), { status: 400 }));
  await assert.rejects(D.fetchDishStats(['dad-1'], { fetch: bad.fetch }), (e) => e instanceof D.DishStatsError && e.status === 400 && e.message === 'ids: at most 50');
  const down = { fetch: async () => { throw new TypeError('offline'); } };
  await assert.rejects(D.fetchDishStats(['dad-1'], down), (e) => e instanceof D.DishStatsError && e.status === 0);
  A.setApiAuth({ deviceKey: null, code: null, profileId: null });
  await assert.rejects(D.fetchDishStats(['dad-1'], { fetch: missing.fetch }), (e) => e instanceof D.DishStatsError && e.message === 'Not signed in');
});

await test('fetchHeartsRecent: the server default, or since as ISO; junk dates fall back; only arrays come back', async () => {
  A.setApiAuth({ deviceKey: null, code: 'DUMMY-CODE', profileId: 'p-dad' });
  const rows = [{ profile_id: 'p-leo', recipe_id: 'dad-chili', at: '2026-10-16T09:00:00Z' }];
  const f = fakeFetch(() => rows);
  assert.deepEqual(await D.fetchHeartsRecent(null, { fetch: f.fetch }), rows);
  await D.fetchHeartsRecent(new Date('2026-10-10T00:00:00Z'), { fetch: f.fetch });
  await D.fetchHeartsRecent('2026-10-12T08:00:00-07:00', { fetch: f.fetch });
  await D.fetchHeartsRecent('not a date', { fetch: f.fetch });
  assert.deepEqual(
    f.calls.map((c) => c.url.replace(A.API_URL, '')),
    ['/hearts/recent', '/hearts/recent?since=2026-10-10T00%3A00%3A00.000Z', '/hearts/recent?since=2026-10-12T15%3A00%3A00.000Z', '/hearts/recent'],
  );
  assert.deepEqual(await D.fetchHeartsRecent(null, { fetch: fakeFetch(() => ({ nope: 1 })).fetch }), []);
  assert.deepEqual(await D.fetchHeartsRecent(null, { fetch: fakeFetch(() => new Response('{}', { status: 404 })).fetch }), []);
});

await test('cleanIds & batches', () => {
  assert.deepEqual(D.cleanIds([' a ', 'b', 'a', 'B', '', 'c-1']), ['a', 'b', 'c-1']);
  assert.deepEqual(D.batches(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(D.batches([]), []);
  assert.equal(D.DISH_STATS_BATCH, 50);
});

await test("a heart that didn't save says the api's reason, in her language, when there is one (Nov 7)", () => {
  const aws = (status, code, kind) => new E.AwsError('x', { status, code, kind });
  // Caleb's build-12 heart: POST /v1/favorites 404, the sample library not on production yet.
  assert.equal(R.heartFailureReason(aws(404, 'not_found', 'refused')), 'That isn’t here anymore.');
  assert.notEqual(R.heartFailureReason(aws(404, 'not_found', 'refused'), wordsFor('es')), 'That isn’t here anymore.', 'in her language');
  // Worth another tap: "Try again" (null).
  for (const e of [aws(503, 'unavailable', 'unavailable'), aws(0, 'network', 'network'), aws(500, 'server_error', 'server'), aws(429, 'rate_limited', 'refused')])
    assert.equal(R.heartFailureReason(e), null, e.code);
  // Before AWS: the server's message on a 4xx ApiError.
  assert.equal(R.heartFailureReason(new A.ApiError('Not in your family.', 403, 'http')), 'Not in your family.');
  assert.equal(R.heartFailureReason(new A.ApiError('Offline', 0, 'network')), null);
  assert.equal(R.heartFailureReason(new A.ApiError('Boom', 502, 'http')), null);
  assert.equal(R.heartFailureReason(null), null);
  assert.equal(R.heartFailureReason(new Error('no one signed in')), null);
});

console.log(`\n${passed} passed`);
