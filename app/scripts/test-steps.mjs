// Unit tests for cook mode's short step words (src/components/recipe/steps.ts, kid QA round 2):
//   the substep fallback  an old recipe's instruction split into lines (sentences, "; ", ", then
//                         <verb>"), amounts / heat / times bolded, the sensory cue folded in as a last
//                         "Ready when …" line (never the cook's chatter or what the lines already say)
//   **bold** parsing      spans for <Txt>, a stray "**" never shows
//   step ingredients      the recipe's `uses` (matched to its ingredients) else the matched fallback;
//                         an amount in words ("half of the garlic") as its own line
//   every bundled recipe  its own substeps and the split fallback: nothing empty, no "**" on screen;
//                         timed substeps start inside their step, in order
//   following along       the bar's chapter starts, and the line lit while the video plays
//   node scripts/test-steps.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(pathToFileURL(join(root, 'src/components/recipe/steps.ts')).href);

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

const step = (instruction, sensory_cue = null, extra = {}) => ({ instruction, sensory_cue, ...extra });
const texts = (s) => S.stepSubsteps(s).map((l) => l.text);

test('sentences split; numbers with a dot never do', () => {
  assert.deepEqual(S.splitInstruction('Rinse the fish and pat it very dry. Add 1.5 cups of flour.'), [
    'Rinse the fish and pat it very dry.',
    'Add 1.5 cups of flour.',
  ]);
  assert.deepEqual(S.splitInstruction('  '), []);
  assert.deepEqual(S.splitInstruction(null), []);
  assert.deepEqual(S.splitInstruction('stir it'), ['Stir it.'], 'capitalized, ends in a stop');
});

test('"; " and ", then <verb>" split; ", then the <thing>" and conditions stay whole', () => {
  assert.deepEqual(S.splitInstruction('Heat the oil; add the onion, then stir until soft.'), ['Heat the oil.', 'Add the onion.', 'Stir until soft.']);
  assert.deepEqual(S.splitInstruction('Add the ginger, then the garlic.'), ['Add the ginger, then the garlic.']);
  assert.deepEqual(S.splitInstruction('If it is too thick, then add water.'), ['If it is too thick, then add water.']);
  assert.deepEqual(S.splitInstruction('Cut three deep slashes, and then rub salt over the skin.'), ['Cut three deep slashes.', 'Rub salt over the skin.']);
});

test('amounts, heat and times are bolded once', () => {
  assert.equal(S.boldAmounts('Simmer for 10 minutes on medium-high heat.'), 'Simmer for **10 minutes** on **medium-high heat**.');
  assert.equal(S.boldAmounts('Add 1.5 cups of flour and bake at 350°F.'), 'Add **1.5 cups** of flour and bake at **350°F**.');
  assert.equal(S.boldAmounts('Leave it about 6 minutes a side.'), 'Leave it about **6 minutes** a side.');
  assert.equal(S.boldAmounts('Already **bold** here, 2 cups.'), 'Already **bold** here, 2 cups.', 'a line with its own bold is left alone');
  assert.equal(S.boldAmounts('Add the eggs one by one.'), 'Add the eggs one by one.');
});

test('the sensory cue becomes a last "Ready when" line', () => {
  assert.deepEqual(texts(step('Heat the grill. Scrape the grate clean.', 'the grate shines with oil')), [
    'Heat the grill.',
    'Scrape the grate clean.',
    '**Ready when** the grate shines with oil.',
  ]);
  assert.equal(S.readyLine('until golden at the edges'), '**Ready when** golden at the edges.');
  assert.equal(S.readyLine('smells nutty'), '**Ready when** it smells nutty.');
  assert.equal(S.readyLine('The soju is done when you can’t smell alcohol'), 'The soju is done when you can’t smell alcohol.', 'a whole test stays as said');
  assert.equal(S.readyLine('So, the sauce coats the spoon.'), '**Ready when** the sauce coats the spoon.', 'filler in front goes');
});

test('the cook’s chatter, first person and repeats never become "Ready when"', () => {
  assert.equal(S.readyLine('when I pour water on it and it dances'), null, 'first person');
  assert.equal(S.readyLine('That’s pretty good. It’s a bit watery.'), null, 'a reaction');
  assert.equal(S.readyLine('It should look nice'), null, 'a hope');
  assert.equal(S.readyLine('the skin feels dry', 'Pat the skin until it feels dry.'), null, 'the lines already say it');
  assert.equal(S.readyLine(null), null);
  assert.equal(S.readyLine('That’s pretty good. / the glaze is thick and glossy'), '**Ready when** the glaze is thick and glossy.', 'the first real test of several remarks');
});

test('the recipe’s own substeps win over the split', () => {
  const own = step('A long instruction. With sentences.', 'golden', {
    substeps: [{ text: ' Dry the fish **very** well ', detail: ' Pat it inside and out. ' }, { text: '' }, { text: 'Salt it', detail: '' }],
  });
  assert.deepEqual(S.stepSubsteps(own), [
    { text: 'Dry the fish **very** well', detail: 'Pat it inside and out.', start_s: null },
    { text: 'Salt it', detail: null, start_s: null },
  ]);
  assert.deepEqual(texts(step('One line.', null, { substeps: [] })), ['One line.'], 'an empty list falls back');
  assert.deepEqual(texts(step('One line.', null, { substeps: null })), ['One line.']);
});

test('**bold** spans parse, a stray "**" never shows', () => {
  assert.deepEqual(S.parseBold('Simmer on **low** for **3 hours**.'), [
    { text: 'Simmer on ', bold: false },
    { text: 'low', bold: true },
    { text: ' for ', bold: false },
    { text: '3 hours', bold: true },
    { text: '.', bold: false },
  ]);
  assert.deepEqual(S.parseBold('**Ready when** golden'), [{ text: 'Ready when', bold: true }, { text: ' golden', bold: false }]);
  assert.deepEqual(S.parseBold('A stray ** mark'), [{ text: 'A stray  mark', bold: false }]);
  assert.deepEqual(S.parseBold(''), []);
  assert.equal(S.plainText('Add **2 tbsp** soy.'), 'Add 2 tbsp soy.');
});

const ing = (name, estimate, first_seen_s = null) => ({ name, feel: 'some', estimate, confidence: 'medium', first_seen_s });

test('step ingredients: the recipe’s `uses`, matched to its ingredients', () => {
  const ingredients = [ing('garlic', '~3 cloves'), ing('kosher salt', '~1 tbsp'), ing('soy sauce (for the glaze)', '~2 tbsp')];
  const uses = [
    { name: 'garlic', amount: 'half of the garlic' },
    { name: 'kosher salt', amount: null },
    { name: 'Soy Sauce (for the glaze)', amount: '~2 tbsp' },
    { name: 'garlic', amount: '~1 clove' },
    { name: '  ', amount: '~1' },
    { name: 'butter', amount: '~4 tbsp' },
  ];
  const rows = S.stepUses({ uses }, ingredients, () => assert.fail('the fallback is not needed'));
  assert.deepEqual(rows.map((r) => [r.name, r.estimate]), [
    ['garlic', 'half of the garlic'],
    ['kosher salt', 'unknown'],
    ['soy sauce (for the glaze)', '~2 tbsp'],
    ['butter', '~4 tbsp'],
  ], 'step amounts win, null is unknown, names match loosely, each once, a name not in the list still shows');
  assert.equal(rows[0].feel, 'some', 'the recipe’s ingredient is kept (the cook’s words stay with it)');
});

test('step ingredients: no `uses` falls back to the matched ingredients', () => {
  const fallback = [ing('honey', '~1 tbsp', 70), ing('Honey', '~1 tbsp', 90), ing('', '~1')];
  assert.deepEqual(
    S.stepUses({ uses: [{ name: 'water (for the glaze)', amount: '~2 tbsp' }, { name: 'water (for the pan)', amount: '~1 tsp' }] }, [], () => []).map((r) => r.name),
    ['water (for the glaze)', 'water (for the pan)'],
    'two waters stay two',
  );
  for (const uses of [undefined, null, [], [{ name: '', amount: '~1' }]]) {
    assert.deepEqual(S.stepUses({ uses }, [], () => fallback).map((r) => r.name), ['honey'], `uses = ${JSON.stringify(uses)}`);
  }
  assert.deepEqual(S.stepUses({ uses: [] }, [], () => []), [], 'a step that needs nothing shows nothing');
});

test('an amount in words reads as its own line; a measure is left to the overview’s line', () => {
  assert.deepEqual(S.wordAmount(ing('garlic', 'half of the garlic')), { amount: null, name: 'Half of the garlic' });
  assert.deepEqual(S.wordAmount(ing('water', 'a splash')), { amount: 'a splash', name: 'of water' });
  assert.deepEqual(S.wordAmount(ing('salt', 'a pinch of')), { amount: 'a pinch of', name: 'salt' });
  assert.deepEqual(S.wordAmount(ing('green onions (for garnish)', 'a few onions')), { amount: null, name: 'A few onions' });
  assert.equal(S.wordAmount(ing('flour', '~1.5 cups')), null);
  assert.equal(S.wordAmount(ing('flour', '½ cup')), null);
  assert.equal(S.wordAmount(ing('flour', 'unknown')), null);
  assert.equal(S.wordAmount(ing('flour', '')), null);
});

test('every bundled recipe reads as lines: its own substeps, and the split fallback', () => {
  const dir = join(root, 'assets/data/recipes');
  let steps = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const recipe = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const st of recipe.steps) {
      steps += 1;
      for (const [kind, lines] of [['own', S.stepSubsteps(st)], ['split', S.stepSubsteps({ ...st, substeps: null })]]) {
        const at = `${file} step ${st.order} (${kind})`;
        assert.ok(lines.length >= 1, `${at} has lines`);
        for (const l of lines) {
          const shown = S.plainText(l.text);
          assert.ok(shown.trim(), `${at}: an empty line`);
          assert.ok(!shown.includes('**'), `${at}: "**" on screen in ${l.text}`);
          if (kind === 'split') assert.ok(/[.!?…]["”’)]*$/.test(shown), `${at}: "${shown}" ends in a stop`);
        }
        if (kind === 'split') {
          const ready = lines.filter((l) => l.text.startsWith('**Ready when**'));
          assert.ok(ready.length <= 1, `${at}: one "Ready when" at most`);
          if (ready.length) assert.equal(lines.at(-1), ready[0], `${at}: "Ready when" comes last`);
        }
      }
    }
  }
  assert.ok(steps > 20, 'the bundled recipes were read');
});

test('every bundled timed substep starts inside its step, in order (the bar and the highlight use them)', () => {
  const dir = join(root, 'assets/data/recipes');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const recipe = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const st of recipe.steps) {
      const starts = S.lineStarts(S.stepSubsteps(st));
      if (!starts) continue;
      const at = `${file} step ${st.order}`;
      starts.forEach((t, i) => {
        assert.ok(t >= Math.floor(st.start_s) && t < st.end_s, `${at}: substep ${i + 1} at ${t} is inside ${st.start_s}-${st.end_s}`);
        if (i) assert.ok(t > starts[i - 1], `${at}: substep ${i + 1} starts after the one before`);
      });
    }
  }
});

test('following along: chapter starts and the line being said', () => {
  const st = { start_s: 63, end_s: 253 };
  const timedLines = S.stepSubsteps({ instruction: 'x', sensory_cue: null, substeps: [
    { text: 'Mix miso, soy and mirin.', start_s: 63 },
    { text: 'Add a splash of water.', start_s: 101 },
    { text: 'Stir in the honey.', start_s: 177 },
  ] });
  assert.deepEqual(timedLines.map((l) => l.start_s), [63, 101, 177]);
  assert.deepEqual(S.lineStarts(timedLines), [63, 101, 177]);
  assert.equal(S.activeLine(timedLines, 63, st), 0, 'the first line at the step start');
  assert.equal(S.activeLine(timedLines, 100.9, st), 0);
  assert.equal(S.activeLine(timedLines, 101, st), 1, 'the greatest start at or before now');
  assert.equal(S.activeLine(timedLines, 250, st), 2);
  assert.equal(S.activeLine(timedLines, null, st), -1, 'nothing playing: no line');
  assert.equal(S.activeLine(timedLines, 40, st), -1, 'before the step (a story’s voice): no line');
  assert.equal(S.activeLine(timedLines, 300, st), -1, 'after the step: no line');
  const one = S.stepSubsteps({ instruction: 'x', sensory_cue: null, substeps: [{ text: 'Only one.', start_s: 63 }] });
  assert.equal(S.lineStarts(one), null, 'one substep: no chapters');
  assert.equal(S.activeLine(one, 70, st), -1, 'one substep: nothing to follow');
  const untimed = S.stepSubsteps({ instruction: 'Mix it. Then bake it.', sensory_cue: null, substeps: null });
  assert.equal(S.lineStarts(untimed), null, 'the split fallback has no times');
  assert.equal(S.activeLine(untimed, 70, st), -1);
  const partly = S.stepSubsteps({ instruction: 'x', sensory_cue: null, substeps: [{ text: 'A.', start_s: 63 }, { text: 'B.' }, { text: 'C.', start_s: 120 }] });
  assert.equal(S.activeLine(partly, 110, st), 0, 'an untimed line is skipped, never lit');
  assert.equal(S.activeLine(partly, 130, st), 2);
});

console.log(`\n${passed} passed`);
