// Unit tests for "Who is it for?" (src/components/record/who.ts): each kid a toggle, "Everyone" ticks
// them all, who gets the recipe and the button's words. TS run by Node's type stripping.
//   node scripts/test-who.mjs
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = await import(pathToFileURL(join(root, 'src/components/record/who.ts')).href);

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

const caleb = { id: 'k-caleb', name: 'Caleb' };
const serene = { id: 'k-serene', name: 'Serene' };
const leo = { id: 'k-leo', name: 'Leo' };
const grandpa = { id: 'c-grandpa', name: 'Grandpa' };
const kids = [caleb, serene];
const others = [grandpa, caleb, serene];

test('tap Caleb, tap Serene: both ticked; tap Caleb again: only Serene', () => {
  let who = W.toggleKid([], caleb.id);
  who = W.toggleKid(who, serene.id);
  assert.deepEqual(W.whoTo(who, kids, others).picked, [caleb, serene]);
  who = W.toggleKid(who, caleb.id);
  assert.deepEqual(who, [serene.id]);
  assert.deepEqual(W.whoTo(who, kids, others), { picked: [serene], everyone: false, recipients: [serene], label: 'Serene' });
});

test('"Everyone" ticks every kid, and again clears them', () => {
  const all = W.toggleEveryone([caleb.id], kids, others);
  assert.deepEqual(all, [caleb.id, serene.id]);
  assert.deepEqual(W.whoTo(all, kids, others), { picked: [caleb, serene], everyone: true, recipients: others, label: 'everyone' });
  assert.deepEqual(W.toggleEveryone(all, kids, others), []);
  // Ticking each kid by hand is everyone too.
  assert.equal(W.isEveryone(W.toggleKid([caleb.id], serene.id), kids, others), true);
});

test('nobody ticked: it only goes to her recipes', () => {
  assert.deepEqual(W.whoTo([], kids, others), { picked: [], everyone: false, recipients: [], label: null });
});

test('labels name every kid ticked, in the chips’ order', () => {
  assert.equal(W.whoTo([serene.id, caleb.id], [caleb, serene, leo], [...others, leo]).label, 'Caleb & Serene');
  assert.equal(W.namesLabel(['Caleb', 'Serene', 'Leo']), 'Caleb, Serene & Leo');
  assert.equal(W.namesLabel([]), '');
});

test('"Everyone" is a chip only with two kids or more, or with no kids at all', () => {
  assert.equal(W.showEveryone(kids, others), true);
  assert.equal(W.showEveryone([caleb], [grandpa, caleb]), false);
  assert.equal(W.isEveryone([caleb.id], [caleb], [grandpa, caleb]), false);
  // No kids: "Everyone" alone stands for the rest of the family.
  assert.equal(W.showEveryone([], [grandpa]), true);
  assert.equal(W.showEveryone([], []), false);
  const all = W.toggleEveryone([], [], [grandpa]);
  assert.deepEqual(W.whoTo(all, [], [grandpa]), { picked: [], everyone: true, recipients: [grandpa], label: 'everyone' });
});

test('first pick: the draft, then Everyone, then who asked, then the first kid', () => {
  assert.deepEqual(W.firstWho(kids, others), [caleb.id]);
  assert.deepEqual(W.firstWho(kids, others, { requestFrom: serene.id }), [serene.id]);
  assert.deepEqual(W.firstWho(kids, others, { requestFrom: 'someone-else' }), [caleb.id]);
  assert.deepEqual(W.firstWho(kids, others, { everyone: true }), [caleb.id, serene.id]);
  // The sheet's ticks carry over to Send, even none; ids that aren't kids are dropped.
  assert.deepEqual(W.firstWho(kids, others, { picked: [serene.id, grandpa.id], requestFrom: caleb.id }), [serene.id]);
  assert.deepEqual(W.firstWho(kids, others, { picked: [] }), []);
  assert.deepEqual(W.firstWho([], [grandpa]), [W.EVERYONE]);
  assert.deepEqual(W.firstWho([], []), []);
});

test('a finished recording (the done view, a resend after a crash) goes to the sheet\'s pick, not to the cook', () => {
  const mom = { id: 'c-mom', name: 'Mom' };
  const profiles = [mom, grandpa, caleb, serene];
  const learners = [caleb, serene];
  const none = { forKids: null, requestFrom: null, everyone: false };
  // The sheet ticked Serene.
  let to = W.doneTo(mom.id, profiles, learners, { ...none, forKids: [serene.id] });
  assert.deepEqual(to.recipients, [serene]);
  assert.equal(to.label, 'Serene');
  assert.equal(to.nobody, false);
  // Everyone: the rest of the family, never herself.
  to = W.doneTo(mom.id, profiles, learners, { ...none, everyone: true });
  assert.equal(to.everyone, true);
  assert.deepEqual(to.recipients, [grandpa, caleb, serene]);
  assert.deepEqual(to.picked, [caleb, serene]);
  // No pick saved but a kid asked for it.
  assert.deepEqual(W.doneTo(mom.id, profiles, learners, { ...none, requestFrom: caleb.id }).recipients, [caleb]);
  // Alone in the family: nobody to send to.
  assert.equal(W.doneTo(mom.id, [mom], [], none).nobody, true);
});

console.log(`\n${passed} passed`);
