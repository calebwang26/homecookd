// Unit tests for /dish/[id]'s view of a dish-ask card (src/lib/dishView.ts; TS run by Node's type stripping).
//   node scripts/test-dish.mjs
import assert from 'node:assert/strict';

const V = await import('../src/lib/dishView.ts');

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok   ${name}`);
};

const guess = { dish: 'braised pork', servings: '1', time: '~20 min', cost: '~$3', steps: [], ingredients: [{ name: 'pork belly', amount: '~1 lb', status: 'guessed', clip: null }] };
const version = { ...guess, ingredients: [{ name: 'dark soy sauce', amount: '2 big spoons', status: 'mom', clip: 'q1' }] };

test('the kid sees his guess until her version is written, then hers', () => {
  assert.equal(V.shownRecipe({ guess, version: null }), guess);
  assert.equal(V.shownRecipe({ guess, version }), version);
});

test('tags: her answer is "mom", our estimate or an unknown is "guess", what the kid said has none', () => {
  assert.equal(V.ingredientTag({ status: 'mom' }), 'mom');
  assert.equal(V.ingredientTag({ status: 'guessed' }), 'guess');
  assert.equal(V.ingredientTag({ status: 'unknown' }), 'guess');
  assert.equal(V.ingredientTag({ status: 'stated' }), null);
});

test('amounts: "~3 tbsp" reads "about 3 tbsp"; her words stay as they are', () => {
  assert.equal(V.amountText({ amount: '~3 tbsp', status: 'guessed' }), 'about 3 tbsp');
  assert.equal(V.amountText({ amount: '', status: 'unknown' }), '');
  assert.equal(V.amountText({ amount: '2 big spoons', status: 'mom' }), '2 big spoons');
  assert.equal(V.amountText({ amount: '4', status: 'stated' }), '4');
});

test('bold: **medium-high** splits out, empty pieces dropped', () => {
  assert.deepEqual(V.boldParts('Fry on **medium-high** until saucy'), [
    { text: 'Fry on ', bold: false },
    { text: 'medium-high', bold: true },
    { text: ' until saucy', bold: false },
  ]);
  assert.deepEqual(V.boldParts('**hot**'), [{ text: 'hot', bold: true }]);
});

test('clips: her first answer with a recording; a tip finds its own; no recording, no clip', () => {
  const card = {
    answers: [
      { id: 'q4', words: 'just words', english: null, audioUrl: null, durationS: 0 },
      { id: 'q1', words: 'Two big spoons', english: null, audioUrl: 'https://x/a.m4a', durationS: 12 },
    ],
  };
  assert.equal(V.firstClip(card).id, 'q1');
  assert.equal(V.clipFor(card, 'q1').durationS, 12);
  assert.equal(V.clipFor(card, 'q4'), null);
  assert.equal(V.clipFor(card, null), null);
  assert.equal(V.firstClip({ answers: [] }), null);
});

test('what the family calls her, in English on the kid side; Mom by default', () => {
  assert.equal(V.relationLabel('grandma'), 'Grandma');
  assert.equal(V.relationLabel('DAD'), 'Dad');
  assert.equal(V.relationLabel(null), 'Mom');
});

console.log(`\n${passed} passed`);
