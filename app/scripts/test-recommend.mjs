// Unit tests for src/lib/holidays.ts + src/lib/recommend.ts + src/lib/search.ts (pure TS, run by
// Node's type stripping).
//   node scripts/test-recommend.mjs
// Uses the bundled library + recipes in assets/data as the family's real recipes, plus small
// hand-made libraries for the meal-by-meal plan and the hero's heading and line (heroWords).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The app imports siblings without an extension ('./holidays'); resolve them to .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) {
      const p = join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`);
      if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = await import(pathToFileURL(join(root, 'src/lib/holidays.ts')).href);
const R = await import(pathToFileURL(join(root, 'src/lib/recommend.ts')).href);
const S = await import(pathToFileURL(join(root, 'src/lib/search.ts')).href);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok  ${name}`);
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (iso) => new Date(iso); // no zone = local time, like the device clock

// ---- Holidays: every date the feedback lists, plus the rule-based ones computed for 2026-2027.
test('holiday dates 2026-2027', () => {
  const all = [...H.holidaysIn(2026), ...H.holidaysIn(2027)];
  const date = (id, year) => ymd(all.find((h) => h.id === id && h.date.getFullYear() === year).date);
  assert.equal(date('mid-autumn', 2026), '2026-09-25');
  assert.equal(date('halloween', 2026), '2026-10-31');
  assert.equal(date('diwali', 2026), '2026-11-08');
  assert.equal(date('thanksgiving', 2026), '2026-11-26');
  assert.equal(date('hanukkah', 2026), '2026-12-04');
  assert.equal(date('christmas', 2026), '2026-12-25');
  assert.equal(date('new-year', 2027), '2027-01-01');
  assert.equal(date('lunar-new-year', 2027), '2027-02-06');
  assert.equal(date('valentines', 2027), '2027-02-14');
  assert.equal(date('easter', 2027), '2027-03-28');
  assert.equal(date('mothers-day', 2027), '2027-05-09');
  assert.equal(date('fathers-day', 2027), '2027-06-20');
  assert.equal(date('mid-autumn', 2027), '2027-09-15');
  assert.equal(date('thanksgiving', 2027), '2027-11-25');
  // Known Easters, to check the computus beyond one year.
  assert.equal(ymd(H.easter(2026)), '2026-04-05');
  assert.equal(ymd(H.easter(2028)), '2028-04-16');
});

test('upcoming window', () => {
  const up = H.upcomingHolidays(at('2026-10-16T12:00'));
  assert.deepEqual(up.map((u) => [u.holiday.id, u.days]), [['halloween', 15]]);
  assert.deepEqual(H.upcomingHolidays(at('2026-12-20T09:00')).map((u) => u.holiday.id), ['christmas', 'new-year']);
  assert.equal(H.upcomingHolidays(at('2026-09-16T09:00'))[0].days, 9); // Mid-Autumn in 9 days
});

test('meal windows', () => {
  const m = (t) => R.mealAt(at(`2026-10-16T${t}`));
  assert.equal(m('04:59'), 'late');
  assert.equal(m('05:00'), 'breakfast');
  assert.equal(m('10:29'), 'breakfast');
  assert.equal(m('10:30'), 'lunch');
  assert.equal(m('14:59'), 'lunch');
  assert.equal(m('15:00'), 'dinner');
  assert.equal(m('20:59'), 'dinner');
  assert.equal(m('21:00'), 'late');
  assert.equal(R.seasonAt(at('2026-10-16T12:00')), 'fall');
  assert.equal(R.seasonAt(at('2027-01-10T12:00')), 'winter');
  assert.equal(R.seasonAt(at('2027-07-04T12:00')), 'summer');
});

test('word matching', () => {
  assert.ok(R.hasWord(R.normText('Auntie Lin’s Scallion Pancakes'), ['pancake']));
  assert.ok(R.hasWord(R.normText('Chicken Stir-Fry with Rice Noodles'), ['stir fry']));
  assert.ok(!R.hasWord(R.normText('toasted sesame oil'), ['toast']));
  assert.ok(!R.hasWord(R.normText('grandma'), ['ma']));
});

// ---- Against the real bundled family recipes.
const data = join(root, 'assets/data');
const lib = JSON.parse(readFileSync(join(data, 'library.json'), 'utf8'));
// Leo's family profiles (Mom, Dad, Grandma, Leo, Maya). Miles, Auntie Lin and the YouTube creators
// are not profiles, so they are not family.
const FAMILY = new Set(['mom', 'dad', 'grandma', 'leo', 'maya']);
const cands = lib.map((entry) => ({
  entry,
  recipe: JSON.parse(readFileSync(join(data, 'recipes', `${entry.id}.json`), 'utf8')),
  family: FAMILY.has(entry.cook_name.toLowerCase()),
}));
const ids = new Set(lib.map((e) => e.id));
const show = (iso) => {
  const r = R.recommend(at(iso), cands);
  const p = r.pick ? `${r.pick.heading}: ${r.pick.entry.title}` : 'no pick';
  console.log(`    ${iso}  ${p}`);
  if (r.pick) assert.ok(ids.has(r.pick.entry.id), 'picks only real recipes');
  return r;
};

test('real recipes at several dates and times', () => {
  // Friday Oct 16 2026.
  const breakfast = show('2026-10-16T08:00');
  assert.equal(breakfast.pick.kind, 'meal');
  assert.equal(breakfast.pick.heading, 'Breakfast idea');
  assert.equal(breakfast.pick.entry.id, 'dad-ginger-scallion-fish'); // Auntie Lin's pancakes: not family

  const lunch = show('2026-10-16T12:30');
  assert.equal(lunch.pick.heading, 'For lunch today');

  const dinner = show('2026-10-16T18:30');
  assert.equal(dinner.pick.heading, 'Tonight’s dinner');
  assert.equal(dinner.pick.entry.id, 'dad-ginger-scallion-fish'); // cookable tonight (~45 min)
  assert.ok(dinner.pick.entry.cook_name !== 'Gordon', 'family before YouTube');
  assert.ok(dinner.pick.entry.id !== 'grandma-red-braised-pork', 'an overnight braise is never tonight’s dinner');

  const late = show('2026-10-16T23:15');
  assert.equal(late.pick.heading, 'A late-night bite');

  // Sunday: the slow Sunday Chili, with a Sunday heading.
  const sunday = show('2026-10-18T18:30');
  assert.equal(sunday.pick.heading, 'Sunday dinner');
  assert.equal(sunday.pick.entry.id, 'dad-sunday-chili');

  // Lunar New Year: the whole fish is a real ingredient of Dad's fish.
  const lny = show('2027-02-01T18:00');
  assert.equal(lny.pick.kind, 'holiday');
  assert.equal(lny.pick.heading, 'For Lunar New Year');
  assert.equal(lny.pick.entry.id, 'dad-ginger-scallion-fish');

  // Father's Day: Dad's own dishes.
  const fd = show('2027-06-10T18:00');
  assert.equal(fd.pick.heading, 'For Father’s Day');
  assert.equal(fd.pick.entry.cook_name, 'Dad');

  // Mid-Autumn, 9 days out, no mooncakes in the family yet: a meal pick, never an invented dish.
  const ma = show('2026-09-16T19:00');
  assert.equal(ma.pick.kind, 'meal');

  // Mother's Day with no "Mom" cook in this family: just a meal (a Saturday).
  const md = show('2027-05-01T08:00');
  assert.equal(md.pick.kind, 'meal');
  assert.equal(md.pick.heading, 'Saturday breakfast');

  // Mid-Autumn with a real mooncake recipe in the family: it becomes the hero (at dinner).
  const moon = R.recommend(at('2026-09-20T15:30'), [
    ...cands,
    { entry: { ...lib[0], id: 'grandma-mooncakes', title: 'Grandma’s Lotus Mooncakes', cook_name: 'Grandma', relation: 'Grandma', tags: ['dessert'] }, family: true },
  ]);
  assert.equal(moon.pick.heading, 'For Mid-Autumn');
  assert.equal(moon.pick.entry.id, 'grandma-mooncakes');
});

const MEALS = { breakfast: '08:00', lunch: '12:30', dinner: '18:30', late: '23:15' };
const dayPicks = (date, list) => Object.fromEntries(Object.entries(MEALS).map(([m, t]) => [m, R.recommend(at(`${date}T${t}`), list).pick]));
// heroWords helpers (a family cook unless a test says otherwise).
const pickAt = (iso, extra = {}) => ({ kind: 'meal', entry: lib[0], meal: R.mealAt(at(iso)), heading: '', ...extra });
const words = (iso, input = {}) => R.heroWords({ now: at(iso), pick: pickAt(iso, input.pick), cook: 'Grandma', family: true, ...input });
const FRI = '2026-10-16T18:30'; // Friday dinner
const SUN = '2026-10-18T18:30'; // Sunday dinner

test('same window, same pick (no flicker); late night after midnight is still the evening before', () => {
  for (const [a, b] of [
    ['2026-10-16T15:00', '2026-10-16T16:59'], // weeknight dinner: stable until 5 pm, then per half hour
    ['2026-10-16T18:00', '2026-10-16T18:29'],
    ['2026-10-18T15:00', '2026-10-18T20:59'], // weekend dinner: the whole window
    ['2026-10-16T05:00', '2026-10-16T10:29'],
    ['2026-10-16T10:30', '2026-10-16T14:59'],
    ['2026-10-16T21:00', '2026-10-17T01:30'], // Friday 9 pm and Saturday 1:30 am: one late night
  ]) {
    assert.equal(R.recommend(at(a), cands).pick.entry.id, R.recommend(at(b), cands).pick.entry.id, `${a} vs ${b}`);
  }
  // A fresh Date for the same moment changes nothing (a caller may re-read the clock).
  assert.deepEqual(R.recommend(at('2026-10-16T18:30'), cands), R.recommend(at('2026-10-16T18:30'), cands));
  assert.equal(R.recommend(at('2026-10-17T01:30'), cands).pick.heading, 'A late-night bite');
});

const threeWeeks = (from) => Array.from({ length: 21 }, (_, i) => ymd(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)));

test('a big family: breakfast, lunch, dinner and late night pick different dishes, 3 weeks', () => {
  const everyone = cands.map((c) => ({ ...c, family: true })); // as if every cook were a profile
  for (const date of threeWeeks(new Date(2026, 10, 1))) {
    // November 2026, includes Diwali and Thanksgiving week
    const ids = Object.values(dayPicks(date, everyone)).map((x) => x.entry.id);
    assert.equal(new Set(ids).size, 4, `${date}: ${ids.join(', ')}`);
  }
});

test('family first: never a YouTube creator or a non-family cook while the family has recipes', () => {
  const isFamily = (e) => FAMILY.has(e.cook_name.toLowerCase());
  for (const start of [new Date(2026, 9, 12), new Date(2026, 10, 9), new Date(2027, 0, 25)]) {
    for (const date of threeWeeks(start)) {
      const p = dayPicks(date, cands);
      for (const [meal, x] of Object.entries(p)) assert.ok(isFamily(x.entry), `${date} ${meal}: ${x.entry.title} by ${x.entry.cook_name}`);
      // Two windows in a row never show the same dish while another family dish fits.
      assert.notEqual(p.breakfast.entry.id, p.lunch.entry.id, `${date} breakfast/lunch`);
      assert.notEqual(p.lunch.entry.id, p.dinner.entry.id, `${date} lunch/dinner`);
      assert.notEqual(p.dinner.entry.id, p.late.entry.id, `${date} dinner/late`);
    }
  }
  // Even with one family dish, it repeats before a stranger's dish is shown.
  const one = [...cands.filter((c) => !c.family), cands.find((c) => c.entry.id === 'dad-ginger-scallion-fish')];
  for (const meal of Object.keys(MEALS)) assert.equal(dayPicks('2026-10-16', one)[meal].entry.id, 'dad-ginger-scallion-fish', meal);
  // Only an overnight family dish: still the family's ("To make today"), never Gordon's.
  const slow = [...cands.filter((c) => !c.family), cands.find((c) => c.entry.id === 'grandma-red-braised-pork')];
  const b = R.recommend(at('2026-10-16T08:00'), slow).pick;
  assert.equal(b.entry.id, 'grandma-red-braised-pork');
  assert.equal(b.heading, 'To make today');
});

test('no family recipes yet: other cooks, credited honestly', () => {
  const strangers = cands.filter((c) => !c.family);
  for (const [meal, x] of Object.entries(dayPicks('2026-10-16', strangers))) {
    const c = strangers.find((y) => y.entry.id === x.entry.id);
    const w = R.heroWords({
      now: at(`2026-10-16T${MEALS[meal]}`),
      pick: x,
      cook: c.recipe.cook.name,
      family: false,
      credit: c.recipe.source,
      totalTime: c.recipe.total_time,
      recordedAt: '2026-10-15T10:00:00', // even when freshly recorded
      quote: 'Season it well.',
    });
    assert.ok(!/kitchen|recorded/i.test(w.chip.text) && !/kitchen|recorded/i.test(w.line?.text ?? ''), `${meal}: ${w.chip.text} / ${w.line?.text}`);
    assert.ok(!w.line?.quoted, 'a stranger’s words are never shown as if said to me');
    assert.ok(w.chip.text.startsWith('Recipe by '), w.chip.text);
  }
  const gordon = R.heroWords({ now: at(FRI), pick: pickAt(FRI), cook: 'Gordon', family: false, credit: 'Gordon Ramsay (YouTube)', recordedAt: '2026-10-11T10:00:00' });
  assert.deepEqual(gordon, { chip: { from: 'cook', text: 'Recipe by Gordon Ramsay on YouTube' }, line: null });
  assert.equal(R.heroWords({ now: at(FRI), pick: pickAt(FRI), cook: 'Miles', family: false }).chip.text, 'Recipe by Miles');
});

// A small mixed family library with one clear dish per meal, plus long and overnight dishes.
const dish = (id, title, cook, tags, total_time, extra = {}) => ({
  entry: { id, title, cook_name: cook, relation: cook, poster_url: null, tags, sample: false, recipe_url: '' },
  recipe: { id, title, cook: { name: cook, relation: cook }, total_time, source: null, tags, ingredients: [], steps: extra.steps ?? [], sessions: [] },
  family: true,
  ...extra.cand,
});
const mixed = [
  dish('eggs', 'Mom’s Tomato Eggs', 'Mom', ['breakfast', 'eggs'], '~15 min'),
  dish('noodles', 'Grandma’s Scallion Noodles', 'Grandma', ['noodles', 'quick'], '~25 min'),
  dish('beef', 'Dad’s Braised Beef', 'Dad', ['beef', 'braise'], '~1 hr 30 min'),
  dish('dumplings', 'Grandma’s Pan-Fried Dumplings', 'Grandma', ['snack', 'late night'], '~20 min'),
  dish('pork', 'Grandma’s Red-Braised Pork Belly', 'Grandma', ['pork', 'braise'], '~2 hrs, plus overnight'),
];

test('mixed library: each meal gets its own fitting dish', () => {
  for (const date of ['2026-10-14', '2026-10-15', '2026-10-17', '2026-10-18']) {
    const p = dayPicks(date, mixed);
    assert.equal(p.breakfast.entry.id, 'eggs', date);
    assert.equal(p.lunch.entry.id, 'noodles', date);
    assert.equal(p.dinner.entry.id, 'beef', date);
    assert.equal(p.late.entry.id, 'dumplings', date);
    assert.ok(Object.values(p).every((x) => x.entry.id !== 'pork'), 'overnight dishes are never for right now');
  }
});

// The founder's example: Dad's Sunday Chili, Dad's Grilled Fish, Grandma's Noodle Soup, Grandma's
// Red-Braised Pork Belly, Miles' Weed Steak (the real bundled recipes; Miles is not a profile).
const five = cands.filter((c) =>
  ['dad-sunday-chili', 'dad-ginger-scallion-fish', 'grandma-hand-pulled-noodle-soup', 'grandma-red-braised-pork', 'weed-steak'].includes(c.entry.id),
);

test('five-dish family: practical, never Miles, never the same dish two windows in a row', () => {
  for (const date of ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-20', '2026-10-24']) {
    const p = dayPicks(date, five);
    console.log(`    ${date}  ${Object.entries(p).map(([m, x]) => `${m}: ${x.heading} / ${x.entry.title}`).join(' | ')}`);
    assert.ok(Object.values(p).every((x) => x.entry.id !== 'grandma-red-braised-pork' && x.entry.id !== 'weed-steak'));
    assert.notEqual(p.breakfast.entry.id, p.lunch.entry.id, date);
    assert.notEqual(p.lunch.entry.id, p.dinner.entry.id, date);
    assert.notEqual(p.late.entry.id, p.dinner.entry.id, date);
  }
  assert.equal(dayPicks('2026-10-18', five).dinner.entry.id, 'dad-sunday-chili'); // Sunday: the slow one
  assert.notEqual(dayPicks('2026-10-16', five).dinner.entry.id, 'dad-sunday-chili'); // Friday 6:30 pm: not 4 hrs
  assert.notEqual(dayPicks('2026-10-17', five).dinner.entry.id, 'dad-sunday-chili'); // Saturday: not "Sunday" chili
});

const mins = (c) => R.minutesOf(c?.recipe?.total_time);
const byId = (list, id) => list.find((c) => c.entry.id === id);

test('a weeknight dinner is cookable tonight', () => {
  for (const list of [cands, mixed, five]) {
    const family = list.filter((c) => c.family);
    for (const date of threeWeeks(new Date(2026, 9, 12))) {
      if ([0, 6].includes(new Date(`${date}T12:00`).getDay())) continue;
      for (const t of ['15:30', '17:00', '18:30', '20:00']) {
        const pick = R.recommend(at(`${date}T${t}`), list).pick;
        if (pick.kind === 'holiday') continue;
        const m = mins(byId(list, pick.entry.id));
        // Never over 2.5 hrs while a shorter family dish exists.
        if (family.some((c) => (mins(c) ?? 0) <= 150 && !R.isOvernight(c))) assert.ok(m == null || m <= 150, `${date} ${t}: ${pick.entry.title} (${m} min)`);
      }
    }
  }
  // After 5 pm: something that finishes by about 9 pm (now + total_time), when the family has one.
  const at8 = R.recommend(at('2026-10-14T20:00'), mixed).pick; // Wednesday 8 pm
  assert.ok(mins(byId(mixed, at8.entry.id)) <= 60, `${at8.entry.title} would finish after 9 pm`);
  assert.equal(R.recommend(at('2026-10-14T18:30'), mixed).pick.entry.id, 'beef'); // 6:30 pm: 90 min is fine
  // Late night avoids both the 6:30 pm and the 8 pm dinner.
  const late = R.recommend(at('2026-10-14T23:00'), mixed).pick.entry.id;
  assert.ok(late !== 'beef' && late !== at8.entry.id, late);
});

test('a dish named for a day ("Sunday Chili") wins only on that day', () => {
  const named = (e) => R.normText(e.title).match(/ (sunday|monday|tuesday|wednesday|thursday|friday|saturday) /)?.[1];
  for (const list of [cands, cands.map((c) => ({ ...c, family: true }))]) {
    for (const date of threeWeeks(new Date(2026, 9, 12))) {
      const dayName = new Date(`${date}T12:00`).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      for (const [meal, x] of Object.entries(dayPicks(date, list))) {
        const n = named(x.entry);
        if (n) assert.equal(n, dayName, `${date} ${meal}: ${x.entry.title}`);
      }
    }
  }
});

test('what I cooked in the last 3 days steps aside', () => {
  const everyone = cands.map((c) => ({ ...c, family: true }));
  for (const iso of ['2026-10-16T18:30', '2026-10-16T12:30', '2026-10-18T18:30']) {
    const base = R.recommend(at(iso), everyone).pick.entry.id;
    const cooked = everyone.map((c) => (c.entry.id === base ? { ...c, cookedAt: '2026-10-16T08:00:00' } : c));
    assert.notEqual(R.recommend(at(iso), cooked).pick.entry.id, base, iso);
  }
});

test('headings', () => {
  const h = (iso, kind = 'meal') => R.heroHeading(at(iso), R.mealAt(at(iso)), kind);
  assert.equal(h('2026-10-16T08:00'), 'Breakfast idea');
  assert.equal(h('2026-10-16T12:30'), 'For lunch today');
  assert.equal(h('2026-10-16T18:30'), 'Tonight’s dinner');
  assert.equal(h('2026-10-16T23:15'), 'A late-night bite');
  assert.equal(h('2026-10-17T08:00'), 'Saturday breakfast');
  assert.equal(h('2026-10-18T12:30'), 'Sunday lunch');
  assert.equal(h('2026-10-18T18:30'), 'Sunday dinner');
  assert.equal(h('2026-10-16T08:00', 'any'), 'To make today');
  assert.equal(h('2026-10-16T18:30', 'any'), 'To make tonight');
  // Nothing fits breakfast (only an overnight braise): the heading only says when, never "Breakfast".
  const r = R.recommend(at('2026-10-16T08:00'), [mixed[4]]);
  assert.equal(r.pick.kind, 'any');
  assert.equal(r.pick.heading, 'To make today');
  assert.equal(R.recommend(at('2026-10-16T08:00'), []).pick, null);
});

test('total time in minutes', () => {
  assert.equal(R.minutesOf('~1 hr 15 min'), 75);
  assert.equal(R.minutesOf('30 minutes'), 30);
  assert.equal(R.minutesOf('~4 hrs'), 240);
  assert.equal(R.minutesOf('~20 mins'), 20);
  assert.equal(R.minutesOf('~2 hrs, plus overnight'), 120);
  assert.equal(R.minutesOf(null), null);
  assert.equal(R.minutesOf('a while'), null);
  assert.ok(R.isOvernight(mixed[4]));
});

// ---- The hero's line (heroWords): the strongest real signal, and nothing when data is missing.

test('line: the family just sent it', () => {
  const sentTue = { by: 'Dad', relation: 'Dad', at: '2026-10-13T10:00:00' };
  const withNote = words(FRI, { cook: 'Dad', sent: { ...sentTue, note: 'Made a big pot today and thought of you. Try it this Sunday.' } });
  assert.deepEqual(withNote.chip, { from: 'sender', text: 'Dad sent this Tuesday' });
  assert.deepEqual(withNote.line, { text: 'Made a big pot today and thought of you. Try it this Sunday.', quoted: true, signal: 'sent' });

  const noNote = words(FRI, { cook: 'Dad', sent: sentTue, history: { cooked: 0, lastCookedAt: null, cookedAny: true } });
  assert.equal(noNote.line.text, 'Make it and tell him how it went.');
  assert.equal(words(FRI, { sent: { by: 'Grandma', relation: 'Grandma', at: '2026-10-16T09:00:00' } }).chip.text, 'Grandma sent this today');
  assert.equal(words(FRI, { sent: { by: 'Mom', relation: 'Mom', at: '2026-10-15T09:00:00' } }).line.text, 'Make it and tell her how it went.');
  // No gendered relation: their name, never a guessed pronoun.
  assert.equal(words(FRI, { sent: { by: 'Miles', relation: null, at: '2026-10-15T09:00:00' } }).line.text, 'Make it and tell Miles how it went.');

  // Cooked since it was sent, sent too long ago, or the sender is unknown: not this signal.
  assert.notEqual(words(FRI, { sent: sentTue, history: { cooked: 1, lastCookedAt: '2026-10-14T19:00:00' } }).line?.signal, 'sent');
  const old = words(FRI, { sent: { ...sentTue, at: '2026-10-02T10:00:00' } });
  assert.equal(old.chip.from, 'cook');
  assert.equal(old.chip.text, 'From Grandma’s kitchen');
  assert.equal(words(FRI, { sent: { ...sentTue, by: '' } }).chip.from, 'cook');
});

test('line: holiday, fresh recording, my history, the time it takes, the cook’s words', () => {
  const halloween = H.holidaysIn(2026).find((x) => x.id === 'halloween');
  const hol = (iso, days) => words(iso, { pick: { kind: 'holiday', holiday: halloween, days } }).line;
  assert.equal(hol(FRI, 15).text, 'It’s in 15 days. Try a practice run tonight.');
  assert.equal(hol('2026-10-27T18:30', 4).text, 'It’s this Saturday. Try a practice run tonight.');
  assert.equal(hol('2026-10-30T18:30', 1).text, 'It’s tomorrow. Try a practice run tonight.');
  assert.notEqual(hol('2026-10-31T18:30', 0)?.signal, 'holiday'); // on the day: nothing to practise

  assert.equal(words(FRI, { recordedAt: '2026-10-15T10:00:00' }).line.text, 'Grandma recorded this yesterday.');
  assert.notEqual(words(FRI, { recordedAt: '2026-09-20T10:00:00' }).line?.signal, 'recorded');

  const fresh = { cooked: 0, lastCookedAt: null, cookedAny: true }; // cooks other dishes, never this one
  assert.equal(words(FRI, { history: fresh }).line.text, 'You haven’t made this one yet. Why not tonight?');
  assert.equal(words('2026-10-16T08:00', { history: fresh }).line.text, 'You haven’t made this one yet. Why not this morning?');
  assert.equal(words('2026-10-16T12:30', { history: fresh }).line.text, 'You haven’t made this one yet. Why not for lunch?');
  // A beginner who has cooked nothing yet: the time it takes instead (true of every dish otherwise).
  assert.equal(words(FRI, { history: { ...fresh, cookedAny: false }, totalTime: '~45 min' }).line.text, 'Quick enough for a weeknight: ~45 min.');
  assert.equal(words(FRI, { history: { cooked: 2, lastCookedAt: '2026-08-30T19:00:00' } }).line.text, 'You last made this in August. It’s been a while.');
  assert.equal(words(FRI, { history: { cooked: 1, lastCookedAt: '2025-12-24T19:00:00' } }).line.text, 'You last made this in December 2025. It’s been a while.');
  // Cooked recently: no history line; unknown history: never "you haven't made this".
  assert.notEqual(words(FRI, { history: { cooked: 3, lastCookedAt: '2026-10-10T19:00:00' } }).line?.signal, 'last-made');
  assert.equal(words(FRI, { history: null, quote: 'Cold water first, always.' }).line.signal, 'quote');

  assert.equal(words(SUN, { cook: 'Dad', totalTime: '~4 hrs' }).line.text, 'Made for a slow Sunday: ~4 hrs.');
  assert.equal(words(FRI, { totalTime: '30 minutes' }).line.text, 'Quick enough for a weeknight: ~30 minutes.');
  assert.equal(words('2026-10-16T12:30', { totalTime: '~25 min' }).line.text, 'Quick enough for lunch: ~25 min.');
  assert.equal(words('2026-10-16T23:15', { totalTime: '~20 min' }).line.text, 'Ready in ~20 min.');
  assert.equal(words(SUN, { totalTime: '~2 hrs, plus overnight', quote: 'Watch the color.' }).line.signal, 'quote');

  assert.deepEqual(words(FRI, { quote: '“Cold water first, always.”' }).line, { text: 'Cold water first, always.', quoted: true, signal: 'quote' });
  assert.equal(words(FRI, {}).line, null); // nothing true to say: the line is hidden
});

test('line: never placeholder text, whatever is missing', () => {
  const bad = /undefined|null|NaN|\{|\}|\s\.|\s{2}|From ’|^ sent|sent this $|\(|\)/;
  const opt = (xs) => [undefined, ...xs];
  let n = 0;
  for (const iso of ['2026-10-16T08:00', '2026-10-16T12:30', FRI, '2026-10-16T23:15', SUN, '2026-10-17T02:00'])
    for (const sent of opt([null, { by: '', at: '' }, { by: 'Dad', at: '2026-10-15T09:00:00', note: '' }, { by: 'Dad', at: 'not a date', note: null }]))
      for (const history of opt([null, { cooked: 0, lastCookedAt: null }, { cooked: 0, lastCookedAt: null, cookedAny: true }, { cooked: 2, lastCookedAt: 'garbage' }]))
        for (const totalTime of opt([null, '', 'unknown', '~45 min', '~3 hrs']))
          for (const quote of opt([null, '', '  ', '""']))
            for (const recordedAt of opt([null, '', 'garbage', '2026-10-15T10:00:00']))
              for (const [cook, family, credit] of [
                ['Grandma', true, null],
                ['', true, null],
                ['  ', true, null],
                ['Miles', false, null],
                ['Gordon', false, 'Gordon Ramsay (YouTube)'],
                ['', false, ''],
              ]) {
                const w = R.heroWords({ now: at(iso), pick: pickAt(iso), cook, family, credit, sent, history, totalTime, quote, recordedAt });
                // An empty chip is hidden; anything shown must be real words.
                assert.ok(w.chip.text === '' ? !cook.trim() : !bad.test(w.chip.text), `bad chip: "${w.chip.text}"`);
                if (w.line) assert.ok(w.line.text.trim() && !bad.test(w.line.text), `bad line: "${w.line.text}"`);
                // Family voice is for family cooks only.
                if (!family) assert.ok(!/kitchen|recorded/i.test(`${w.chip.text} ${w.line?.text ?? ''}`) && w.line?.signal !== 'quote', `family voice for ${cook}`);
                n++;
              }
  assert.ok(n > 1000);
});

// ---- Recipes-tab search (src/lib/search.ts).
test('recipe search', () => {
  const lib2 = [
    { id: 'a', title: 'Dad’s Sunday Chili', cook_name: 'Dad', relation: 'Dad', tags: ['comfort'] },
    { id: 'b', title: 'Hand-Pulled Noodle Soup', cook_name: 'Grandma', relation: 'Grandma', tags: ['noodles', 'soup'] },
    { id: 'c', title: 'Ginger Scallion Fish', cook_name: 'Dad', relation: 'Dad', tags: [] },
    { id: 'd', title: 'Crème Brûlée', cook_name: 'Auntie Lin', relation: 'Aunt', tags: ['dessert'] },
  ];
  const find = (q) => S.searchDishes(lib2, q).map((e) => e.id);
  assert.deepEqual(find(''), []);
  assert.deepEqual(find('   '), []);
  assert.deepEqual(find('dad'), ['a', 'c']);
  assert.deepEqual(find('dads chili'), ['a']);
  assert.deepEqual(find('Dad’s'), ['a']);
  assert.deepEqual(find('nood'), ['b']);
  assert.deepEqual(find('soup grandma'), ['b']);
  assert.deepEqual(find('creme'), ['d']);
  assert.deepEqual(find('aunt'), ['d']);
  assert.deepEqual(find('a'), ['d']); // word starts only: "Auntie"/"Aunt", not every "a"
  assert.deepEqual(find('fish dad'), ['c']);
  assert.deepEqual(find('pizza'), []);
  // A title hit ranks above a cook/tag hit.
  assert.deepEqual(S.searchDishes([{ id: 'x', title: 'Rice', cook_name: 'Soupy', relation: '', tags: [] }, { id: 'y', title: 'Soup', cook_name: 'Mom', relation: '', tags: [] }], 'soup').map((e) => e.id), ['y', 'x']);
});

console.log(`\n${passed} tests passed`);
