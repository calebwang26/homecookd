// Unit tests for Month in the kitchen's app logic (TS run by Node's type stripping):
//   src/lib/recapApi.ts             months, the Home card's month, reading the server's slides (story
//                                   order, unknown or malformed slides dropped), the teaser line, the
//                                   opened flag per person per month, the Home card's remembered
//                                   answer, and GET /recap's own fetch
//   src/components/recap/story.ts   taps & buttons (next, back, done), progress bars, slide colours,
//                                   numbers in a title, and the clip the "voices" slide plays
//   node scripts/test-recap.mjs
// lib/storage is swapped for an in-memory map; '@/...' imports resolve to src/; fetch is a fake.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');

const STORAGE_STUB =
  'data:text/javascript,' +
  encodeURIComponent(`
const m = (globalThis.__kv ??= new Map());
export async function kvGet(k) { return m.has(k) ? m.get(k) : null; }
export async function kvSet(k, v) { if (v == null) m.delete(k); else m.set(k, String(v)); }
export async function kvGetJson(k) { const r = m.get(k); if (!r) return null; try { return JSON.parse(r); } catch { return null; } }
export function kvSetJson(k, v) { return kvSet(k, v == null ? null : JSON.stringify(v)); }
`);

const asTs = (p) => (existsSync(`${p}.ts`) ? `${p}.ts` : existsSync(join(p, 'index.ts')) ? join(p, 'index.ts') : null);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === './storage' || spec === '@/lib/storage') return { url: STORAGE_STUB, shortCircuit: true };
    let p = null;
    if (spec.startsWith('@/')) p = asTs(join(src, spec.slice(2)));
    else if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) p = asTs(join(dirname(fileURLToPath(ctx.parentURL)), spec));
    return p ? next(pathToFileURL(p).href, ctx) : next(spec, ctx);
  },
});

const R = await import(pathToFileURL(join(src, 'lib/recapApi.ts')).href);
const S = await import(pathToFileURL(join(src, 'components/recap/story.ts')).href);
const M = await import(pathToFileURL(join(src, 'lib/missHome.ts')).href);
const A = await import(pathToFileURL(join(src, 'lib/api.ts')).href);
const kv = globalThis.__kv;

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
};
const local = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

// ---- months & the Home card
await test('previousMonth, monthName & the title, across the year end', () => {
  assert.equal(R.previousMonth(local(2026, 11, 1)), '2026-10');
  assert.equal(R.previousMonth(local(2027, 1, 3)), '2026-12');
  assert.equal(R.previousMonth(local(2026, 3, 31)), '2026-02'); // never skips a short month
  assert.equal(R.monthName('2026-10'), 'October');
  assert.equal(R.monthName('2026-13'), '');
  assert.equal(R.recapTitle('2026-11'), 'Your November in the kitchen');
  assert.equal(R.monthKey(local(2026, 7, 4)), '2026-07');
});

await test('monthOrPrevious: a link\'s month, else last month', () => {
  const now = local(2026, 12, 2);
  assert.equal(R.monthOrPrevious('2026-10', now), '2026-10');
  for (const bad of [undefined, null, '', '2026-1', '2026-13', 'october', 202610]) assert.equal(R.monthOrPrevious(bad, now), '2026-11', String(bad));
});

await test('cardMonth: last month on the 1st-7th only; the first edition is Dec 1 for November', () => {
  assert.equal(R.FIRST_MONTH, '2026-11');
  assert.equal(R.cardMonth(local(2026, 12, 1, 0)), '2026-11');
  assert.equal(R.cardMonth(local(2026, 12, 7, 23)), '2026-11');
  assert.equal(R.cardMonth(local(2026, 12, 8, 0)), null);
  assert.equal(R.cardMonth(local(2026, 12, 20)), null);
  // October isn't an edition: no card on Nov 1-7 (TODO(caleb) in recapApi.ts).
  assert.equal(R.cardMonth(local(2026, 11, 1, 0)), null);
  assert.equal(R.cardMonth(local(2026, 11, 7, 23)), null);
  assert.equal(R.cardMonth(local(2026, 10, 3)), null); // September
  assert.equal(R.cardMonth(local(2027, 1, 5)), '2026-12');
});

// ---- the slides
const photo = (n, extra = {}) => ({ message_id: `m${n}`, photo_url: `https://signed.example/p${n}.jpg?t=1`, recipe_id: 'dad-chili', at: `2026-10-0${n}T19:00:00Z`, ...extra });
const kidRecap = () => ({
  month: '2026-10',
  role: 'learner',
  slides: [
    { type: 'cover', title: 'Your October in the kitchen' },
    { type: 'cooked', title: 'You cooked 3 family dishes', value: 3, photos: [photo(1), photo(2)] },
    { type: 'most_made', title: "Most made: Dad's Sunday Chili, twice", value: 2, recipe_id: 'dad-chili', cook_id: 'p-dad' },
    { type: 'voices', title: '2 minutes of family voices', value: 2, seconds: 125, clip: { recipe_id: 'mom-soup', cook_id: 'p-mom', start_s: 300, plays: 2 } },
    { type: 'hearts_left', title: 'Hearts you left: 2', value: 2 },
    { type: 'then_now', title: 'Then & now', photos: [photo(1), photo(2)] },
    { type: 'close', title: 'See you at the table in November.' },
  ],
});

await test('readRecap keeps a full kid recap exactly, in order', () => {
  const r = R.readRecap(kidRecap());
  assert.deepEqual(r, kidRecap());
});

await test('readRecap: cover first & close last, unknown or malformed slides dropped', () => {
  const raw = kidRecap();
  raw.slides = [
    raw.slides[6], // close sent first
    { type: 'cookbook_offer', title: 'Print your book' }, // a newer server's slide
    raw.slides[1],
    { type: 'hearts_left', title: 'Hearts you left: 2' }, // no value
    { type: 'most_made', title: 'Most made', value: 2, recipe_id: 'dad-chili' }, // no cook
    { type: 'then_now', title: 'Then & now', photos: [photo(1), photo(2, { photo_url: null })] }, // one photo unsigned
    { type: 'voices', title: '2 minutes', value: 2, seconds: 125, clip: { recipe_id: 'x', cook_id: 'p-mom', start_s: 'soon', plays: 2 } },
    raw.slides[0],
    raw.slides[0], // a second cover
    null,
    'cover',
  ];
  const r = R.readRecap(raw);
  assert.deepEqual(r.slides.map((s) => s.type), ['cover', 'cooked', 'voices', 'close']);
  assert.equal(r.slides[2].clip.start_s, null); // a bad start becomes "unknown", not a guess
});

await test('readRecap: photos without a real URL are left out; Then & now needs both', () => {
  const raw = kidRecap();
  raw.slides[1].photos = [photo(1), photo(2, { photo_url: '' }), photo(3, { photo_url: 'file:///tmp/x.jpg' }), { photo_url: 'https://x/y.jpg' }];
  raw.slides[5].photos = [photo(1)];
  const r = R.readRecap(raw);
  assert.deepEqual(r.slides.find((s) => s.type === 'cooked').photos.map((p) => p.message_id), ['m1']);
  assert.equal(r.slides.some((s) => s.type === 'then_now'), false);
});

await test('readRecap: the cook\'s faces keep the server\'s order, each once, and never a count (no rankings)', () => {
  const cook = {
    month: '2026-10',
    role: 'cook',
    slides: [
      { type: 'cover', title: 'Your October in the kitchen' },
      {
        type: 'dishes_cooked',
        title: 'Your dishes were cooked 5 times',
        value: 5,
        // First cook of the month first (Maya once, then Leo three times); an older server's counts.
        faces: [{ profile_id: 'p-maya', count: 1 }, { profile_id: 'p-leo', count: 3 }, { profile_id: 'p-maya' }, { count: 2 }, null, { profile_id: '' }],
      },
      { type: 'close', title: 'See you at the table in November.' },
    ],
  };
  const faces = R.readRecap(cook).slides.find((s) => s.type === 'dishes_cooked').faces;
  assert.deepEqual(faces, [{ profile_id: 'p-maya' }, { profile_id: 'p-leo' }]);
  // No faces at all is still a slide (another cook made the dish): the number shows alone.
  cook.slides[1].faces = undefined;
  assert.deepEqual(R.readRecap(cook).slides[1].faces, []);
});

await test('readRecap: empty when nothing but cover & close is left, or the answer is junk', () => {
  assert.deepEqual(R.readRecap({ empty: true }), { empty: true });
  assert.deepEqual(R.readRecap({ month: '2026-10', role: 'cook', slides: [{ type: 'cover', title: 'x' }, { type: 'close', title: 'y' }] }), { empty: true });
  for (const junk of [null, undefined, 'x', 42, [], { month: '2026-10' }, { month: 'Oct', slides: kidRecap().slides }]) {
    assert.deepEqual(R.readRecap(junk), { empty: true }, JSON.stringify(junk));
  }
  assert.equal(R.readRecap({ ...kidRecap(), role: 'admin' }).role, 'learner');
  assert.equal(R.isEmptyRecap(null), true);
  assert.equal(R.isEmptyRecap(R.readRecap(kidRecap())), false);
});

await test('recapTeaser: the first content slide\'s own words', () => {
  assert.equal(R.recapTeaser(R.readRecap(kidRecap())), 'You cooked 3 family dishes');
  const cook = { month: '2026-10', role: 'cook', slides: [{ type: 'cover', title: 'c' }, { type: 'answered', title: 'Questions you answered: 3', value: 3 }, { type: 'close', title: 'x' }] };
  assert.equal(R.recapTeaser(R.readRecap(cook)), 'Questions you answered: 3');
  const postcardsOnly = { month: '2026-10', role: 'learner', slides: [{ type: 'then_now', title: 'Then & now', photos: [photo(1), photo(2)] }] };
  assert.equal(R.recapTeaser(R.readRecap(postcardsOnly)), 'Your first postcard beside your latest');
  assert.equal(R.recapTeaser({ empty: true }), null);
});

// ---- opened, per person per month
await test('opened: per person per month, stored on the phone, and a mounted card hears it at once', async () => {
  kv.clear();
  const heard = [];
  const off = R.onRecapOpened((key) => heard.push(key));
  assert.equal(await R.isRecapOpened('p-leo', '2026-10'), false);
  await R.markRecapOpened('p-leo', '2026-10');
  await R.markRecapOpened('p-leo', '2026-10'); // twice: told once
  assert.equal(await R.isRecapOpened('p-leo', '2026-10'), true);
  assert.equal(await R.isRecapOpened('p-leo', '2026-11'), false);
  assert.equal(await R.isRecapOpened('p-maya', '2026-10'), false);
  assert.deepEqual(heard, ['recap.opened.p-leo.2026-10']);
  assert.equal(kv.get('recap.opened.p-leo.2026-10'), '1');
  off();
  await R.markRecapOpened('p-maya', '2026-10');
  assert.deepEqual(heard, ['recap.opened.p-leo.2026-10']);
});

await test('the Home card\'s answer: per person per month, at once from memory, from storage on a later launch; a failure is never kept', async () => {
  kv.clear();
  assert.equal(R.recapCardNow('p-zoe', '2026-10'), undefined);
  assert.equal(await R.recapCardStored('p-zoe', '2026-10'), undefined); // nothing yet: Home asks
  const recap = R.readRecap(kidRecap());
  const card = { teaser: R.recapTeaser(recap) };
  assert.ok(card.teaser);
  assert.deepEqual(await R.rememberRecapCard('p-zoe', '2026-10', recap), card);
  assert.deepEqual(R.recapCardNow('p-zoe', '2026-10'), card); // a Home drawn again has it at once
  assert.equal(kv.get('recap.card.p-zoe.2026-10'), JSON.stringify(card));
  assert.equal(await R.rememberRecapCard('p-zoe', '2026-09', { empty: true }), 'empty');
  assert.equal(R.recapCardNow('p-zoe', '2026-09'), 'empty');
  assert.equal(kv.get('recap.card.p-zoe.2026-09'), 'empty');
  assert.equal(R.recapCardNow('p-max', '2026-10'), undefined); // per person
  // A later launch: only this phone's storage has it (and then memory does too).
  kv.set('recap.card.p-sam.2026-10', JSON.stringify({ teaser: 'You cooked 3 family dishes' }));
  kv.set('recap.card.p-sam.2026-11', 'empty');
  kv.set('recap.card.p-sam.2026-12', '{not json');
  assert.equal(R.recapCardNow('p-sam', '2026-10'), undefined);
  assert.deepEqual(await R.recapCardStored('p-sam', '2026-10'), { teaser: 'You cooked 3 family dishes' });
  assert.deepEqual(R.recapCardNow('p-sam', '2026-10'), { teaser: 'You cooked 3 family dishes' });
  assert.equal(await R.recapCardStored('p-sam', '2026-11'), 'empty');
  assert.equal(await R.recapCardStored('p-sam', '2026-12'), undefined); // junk: asked again, never a guess
  // Opened wins, from memory or from storage.
  await R.markRecapOpened('p-zoe', '2026-10');
  assert.equal(R.recapCardNow('p-zoe', '2026-10'), 'opened');
  kv.set('recap.opened.p-sam.2027-01', '1');
  kv.set('recap.card.p-sam.2027-01', JSON.stringify({ teaser: 'Hearts you left: 5' }));
  assert.equal(await R.recapCardStored('p-sam', '2027-01'), 'opened');
  assert.equal(R.recapCardNow('p-sam', '2027-01'), 'opened');
});

// ---- GET /recap
await test('recapApi.get: the phone\'s headers, the month in the query, slides read; errors in words', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  let reply = () => new Response(JSON.stringify(kidRecap()), { status: 200 });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    return reply();
  };
  try {
    A.setApiAuth({ deviceKey: null, code: null, profileId: null });
    await assert.rejects(R.recapApi.get('2026-10'), (e) => e instanceof R.RecapError && e.status === 0);
    assert.equal(calls.length, 0, 'no person: no call');

    A.setApiAuth({ deviceKey: 'dk-test', code: null, profileId: 'p-leo' });
    A.setApiTimeZone('America/New_York');
    const r = await R.recapApi.get('2026-10');
    assert.equal(r.slides.length, 7);
    assert.equal(calls[0].url, `${A.API_URL}/recap?month=2026-10`);
    assert.deepEqual(calls[0].headers, { accept: 'application/json', 'x-profile-id': 'p-leo', 'x-device-key': 'dk-test', 'x-tz': 'America/New_York' });

    // No zone from the api client (the web ?as= dev aid): no x-tz either.
    A.setApiTimeZone(null);
    A.setApiAuth({ deviceKey: null, code: 'FAMILY-CODE', profileId: 'p-mom' });
    reply = () => new Response(JSON.stringify({ empty: true }), { status: 200 });
    assert.deepEqual(await R.recapApi.get('2026-11'), { empty: true });
    assert.equal(calls[1].headers['x-family-code'], 'FAMILY-CODE');
    assert.equal(calls[1].headers['x-device-key'], undefined);
    assert.equal('x-tz' in calls[1].headers, false);

    reply = () => new Response(JSON.stringify({ error: 'month must be YYYY-MM' }), { status: 400 });
    await assert.rejects(R.recapApi.get('2026-11'), (e) => e.status === 400 && e.message === 'month must be YYYY-MM');
    // The library unreachable: an error (the screen offers Try again and never marks the month opened).
    reply = () => new Response(JSON.stringify({ error: 'Can’t reach the family recipes right now. Try again.' }), { status: 503 });
    await assert.rejects(R.recapApi.get('2026-11'), (e) => e.status === 503 && /Try again/.test(e.message));
    reply = () => { throw new TypeError('network down'); };
    await assert.rejects(R.recapApi.get('2026-11'), (e) => e.status === 0 && /reach your family/.test(e.message));
  } finally {
    globalThis.fetch = realFetch;
    A.setApiAuth({ deviceKey: null, code: null, profileId: null });
    A.setApiTimeZone(null);
  }
});

// ---- the story
await test('stepStory: next, back, and done past the last slide', () => {
  assert.deepEqual(S.stepStory(0, 5, 1), { index: 1, done: false });
  assert.deepEqual(S.stepStory(3, 5, 1), { index: 4, done: false });
  assert.deepEqual(S.stepStory(4, 5, 1), { index: 4, done: true });
  assert.deepEqual(S.stepStory(0, 5, -1), { index: 0, done: false });
  assert.deepEqual(S.stepStory(2, 5, -1), { index: 1, done: false });
  assert.deepEqual(S.stepStory(9, 5, -1), { index: 3, done: false }); // clamped first
  assert.deepEqual(S.stepStory(0, 0, 1), { index: 0, done: true });
  assert.deepEqual(S.stepStory(0, 1, 1), { index: 0, done: true });
});

await test('tapDirection: the left third goes back, the rest forward; bars fill up to this slide', () => {
  assert.equal(S.tapDirection(10, 390), -1);
  assert.equal(S.tapDirection(129, 390), -1);
  assert.equal(S.tapDirection(130, 390), 1);
  assert.equal(S.tapDirection(380, 390), 1);
  assert.equal(S.tapDirection(10, 0), 1);
  assert.deepEqual([0, 1, 2, 3].map((b) => S.barFilled(b, 2)), [true, true, true, false]);
});

await test('every slide type has a Hearth tone; cover & close are dark with light controls', () => {
  const types = ['cover', 'cooked', 'most_made', 'voices', 'hearts_left', 'then_now', 'dishes_cooked', 'most_loved', 'postcards', 'answered', 'close'];
  assert.deepEqual(Object.keys(S.SLIDE_TONES).sort(), [...types].sort());
  for (const t of types) {
    const tone = S.SLIDE_TONES[t];
    for (const k of ['bg', 'fg', 'soft', 'accent', 'barOn', 'barOff']) assert.ok(tone[k], `${t}.${k}`);
    assert.notEqual(tone.bg, tone.fg, t);
  }
  assert.equal(S.SLIDE_TONES.cover.dark, true);
  assert.equal(S.SLIDE_TONES.close.dark, true);
  assert.equal(S.SLIDE_TONES.cooked.dark, false);
});

await test('titleParts: numbers & the heart carry the accent; the words stay exactly as sent', () => {
  assert.deepEqual(S.titleParts('Hearts you left: 5'), [{ text: 'Hearts you left: ', accent: false }, { text: '5', accent: true }]);
  const loved = S.titleParts('Most loved: Winter Soup (♥ 12)');
  assert.equal(loved.map((p) => p.text).join(''), 'Most loved: Winter Soup (♥ 12)');
  assert.deepEqual(loved.filter((p) => p.accent).map((p) => p.text), ['♥', '12']);
  assert.deepEqual(S.titleParts('Then & now'), [{ text: 'Then & now', accent: false }]);
  assert.deepEqual(S.titleParts('40 minutes of family voices')[0], { text: '40', accent: true });
});

await test('photos, tilts & hearts: at most 4 photos, 1.5 degrees at most; hearts drawn match the number', () => {
  const list = [1, 2, 3, 4, 5].map((n) => photo(n));
  assert.deepEqual(S.photosShown(list).map((p) => p.message_id), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(S.tiltOf(0, 1), 0);
  assert.deepEqual([0, 1, 2].map((i) => S.tiltOf(i, 3)), [-1.5, 1.5, -1.5]);
  // Up to 12, one little heart per heart; past that, one big heart (never 12 hearts for "20").
  assert.deepEqual([0, 3, 12, 13, 20, -2, 2.7].map(S.heartsShown), [0, 3, 12, 0, 0, 0, 2]);
  assert.deepEqual([0, 3, 12, 13, 20, -2].map(S.oneBigHeart), [false, false, false, true, true, false]);
});

// ---- the voices slide's clip
const step = (order, start_s, end_s, quote) => ({ order, title: `Step ${order}`, instruction: '', sensory_cue: null, start_s, end_s, quote, wait_after: null, story_ids: [], special_ids: [] });
const story = (id, start_s, end_s, text) => ({ id, step: 1, start_s, end_s, title: id, text });
const recipe = (id, cook, extra = {}) => ({
  id, title: `Title ${id}`, cook: { name: cook, relation: cook }, intro: '', servings: null, total_time: null, sample: false, source: null, tags: [],
  media: { video_url: null, audio_url: `https://bucket/${id}/voice.m4a`, poster_url: null, duration_s: 900 },
  sessions: [], ingredients: [], steps: [], stories: [], special: [], follow_up_questions: [], ...extra,
});
const family = [{ id: 'p-mom', name: 'Mom', role: 'cook' }, { id: 'p-dad', name: 'Dad', role: 'cook' }, { id: 'p-leo', name: 'Leo', role: 'learner' }];

await test('findVoiceClip: the moment where the most-played clip started, her words verbatim; never a guess', () => {
  const soup = recipe('mom-soup', 'Mom', {
    stories: [story('s1', 300, 340, 'My mother made this every winter.')],
    steps: [step(1, 10, 40, 'Just a handful of ginger.'), step(2, 100, 220, 'Low heat, you have to wait.')],
  });
  const pool = M.clipPool([soup, recipe('dad-sample', 'Dad', { sample: true, steps: [step(1, 0, 30, 'synthetic')] })], family, 'p-leo');
  const at = (start_s, extra = {}) => S.findVoiceClip(pool, { recipe_id: 'mom-soup', cook_id: 'p-mom', start_s, plays: 2, ...extra });
  assert.equal(at(300).words, 'My mother made this every winter.');
  assert.deepEqual([at(300).start_s, at(300).end_s, at(300).url], [300, 340, 'https://bucket/mom-soup/voice.m4a']);
  assert.equal(at(10.9).words, 'Just a handful of ginger.'); // the player floors the start
  assert.equal(at(130).words, 'Low heat, you have to wait.'); // inside step 2 (capped at 60 s: 100-160)
  assert.equal(at(200), null); // past the capped range: no guessed moment
  assert.equal(at(null), null);
  assert.equal(at(300, { cook_id: 'p-dad' }), null);
  assert.equal(S.findVoiceClip(pool, { recipe_id: 'dad-sample', cook_id: 'p-dad', start_s: 0, plays: 1 }), null); // a sample isn't her voice
  assert.equal(S.findVoiceClip(pool, null), null);
});

console.log(`\n${passed} passed`);
