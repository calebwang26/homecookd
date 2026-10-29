// Unit tests for Phase 5's two doors gate (TS run by Node's type stripping):
//   src/lib/doorsGate.ts   who sees the two doors after the language screen: a cook whose family has no recipes and
//                          no recordings yet, once per profile on this phone; never a kid, never an existing family
//                          (the TEST family App Review signs in to), and nothing until this phone's flag and both
//                          Convex lists have come
//   node scripts/test-doors.mjs
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { doorsDecision, doorsSeenKey } = await import(pathToFileURL(join(root, 'src/lib/doorsGate.ts')).href);

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

const mom = { id: 'p-mom', role: 'cook' };
const grandma = { id: 'p-grandma', role: 'cook' };
const leo = { id: 'p-leo', role: 'kid' };
const unseen = (p) => ({ profileId: p.id, seen: false });
const seenBy = (p) => ({ profileId: p.id, seen: true });
const biryani = { _id: 'r1', title: 'Chicken Biryani', status: 'ready', cookId: 'c-mom' };
const job = { _id: 'j1', stage: 'queued', cookId: 'c-mom' };

/** This phone's kv, as useDoorsGate reads and writes it. */
function phone() {
  const kv = new Map();
  return {
    read: (p) => ({ profileId: p.id, seen: kv.get(doorsSeenKey(p.id)) === '1' }),
    tap: (p) => kv.set(doorsSeenKey(p.id), '1'),
  };
}

test('a new cook sees the doors once: after any tap, never again on this phone', () => {
  const here = phone();
  assert.equal(doorsDecision({ me: mom, seen: here.read(mom), recipes: [], jobs: [] }), 'show');
  here.tap(mom);
  assert.equal(doorsDecision({ me: mom, seen: here.read(mom), recipes: [], jobs: [] }), 'skip');
});

test('a family with any recipe or any recording never sees them', () => {
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: [biryani], jobs: [] }), 'skip');
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: [], jobs: [job] }), 'skip');
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: [{ ...biryani, status: 'processing' }], jobs: [job] }), 'skip');
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: [{ ...biryani, status: 'failed' }], jobs: [] }), 'skip', 'a failed one counts too');
  // The TEST family's Grandma has no recipe of her own, but her family has Mom's Biryani: no doors for the reviewer.
  assert.equal(doorsDecision({ me: grandma, seen: unseen(grandma), recipes: [biryani], jobs: [] }), 'skip');
});

test('a kid never sees them, whatever the lists say', () => {
  assert.equal(doorsDecision({ me: leo, seen: unseen(leo), recipes: [], jobs: [] }), 'skip');
  assert.equal(doorsDecision({ me: leo, seen: null, recipes: null, jobs: null }), 'skip');
  assert.equal(doorsDecision({ me: null, seen: null, recipes: [], jobs: [] }), 'skip', 'nobody signed in');
});

test('"seen" is per profile on this phone', () => {
  const here = phone();
  assert.notEqual(doorsSeenKey(mom.id), doorsSeenKey(grandma.id));
  assert.equal(doorsSeenKey(mom.id), 'doors.seen.p-mom');
  here.tap(mom);
  assert.equal(doorsDecision({ me: mom, seen: here.read(mom), recipes: [], jobs: [] }), 'skip');
  assert.equal(doorsDecision({ me: grandma, seen: here.read(grandma), recipes: [], jobs: [] }), 'show', 'Grandma on the same phone still gets hers');
  // Mom's flag, read before the phone switched to Grandma, says nothing about Grandma: wait for hers.
  assert.equal(doorsDecision({ me: grandma, seen: here.read(mom), recipes: [], jobs: [] }), 'wait');
  assert.equal(doorsDecision({ me: grandma, seen: unseen(mom), recipes: [], jobs: [] }), 'wait');
});

test('nothing is decided before the flag and both lists have come (no flash over Home)', () => {
  assert.equal(doorsDecision({ me: mom, seen: null, recipes: [], jobs: [] }), 'wait', 'flag not read yet');
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: null, jobs: null }), 'wait', 'Convex not answered');
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: [], jobs: null }), 'wait', 'jobs not answered');
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: null, jobs: [] }), 'wait', 'recipes not answered');
  // One list already says the family has something, or she saw them already: no need to wait for the rest.
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: [biryani], jobs: null }), 'skip');
  assert.equal(doorsDecision({ me: mom, seen: unseen(mom), recipes: null, jobs: [job] }), 'skip');
  assert.equal(doorsDecision({ me: mom, seen: seenBy(mom), recipes: null, jobs: null }), 'skip');
});

console.log(`\n${passed} passed`);
