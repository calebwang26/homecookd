// Unit tests for Parent Home's recordings on their way, read from the worker's live stage (TS run by
// Node's type stripping):
//   src/components/parent/jobsLogic.ts   'uploading' keeps the sending half of the bar short of full,
//                                        with "Still sending the video"; a live job is finished once
//                                        it's 'done' and its recipe is in the library; which finished
//                                        jobs still need their library id looked up,
//                                        and a job stopped anywhere is dropped
//   src/components/parent/stops.ts       the x's "Stopped · Undo": Undo in time stops nothing (but a
//                                        double tap on the x doesn't undo it), the stop runs once after
//                                        the wait (or at once when she leaves the app), a stop that
//                                        worked stays gone, a failed or timed-out one comes back
//   node scripts/test-parent-jobs.mjs
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = await import(pathToFileURL(join(root, 'src/components/parent/jobsLogic.ts')).href);
const S = await import(pathToFileURL(join(root, 'src/components/parent/stops.ts')).href);

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

test('every stage still going has its line; uploading says the video is still on its way', () => {
  for (const stage of ['uploading', 'queued', 'preparing', 'understanding', 'writing', 'indexing']) assert.ok(J.STAGE_HINT[stage], stage);
  assert.equal(J.STAGE_HINT.uploading, 'Still sending the video');
});

test('uploading: this phone’s own progress, else the server’s count; never a full sending half', () => {
  assert.deepEqual(J.uploadingView(0.42, 0, 3), { hint: 'Sending your videos · 42%', send: 0.42 });
  // The phone has sent it all but the worker hasn't seen it yet.
  assert.deepEqual(J.uploadingView(1, 3, 3), { hint: 'Still sending the video', send: 0.95 });
  assert.deepEqual(J.uploadingView(null, 1, 2), { hint: 'Still sending the video', send: 0.5 });
  assert.deepEqual(J.uploadingView(null, 2, 2), { hint: 'Still sending the video', send: 0.95 });
  // Nothing known: half way, not full.
  assert.equal(J.uploadingView(null, 0, 0).send, 0.5);
  assert.ok(J.uploadingView(0, 0, 1).send > 0);
});

test('a live job is finished once it’s done and its recipe is in the library', () => {
  const ids = new Set(['chicken-biryani-ab12']);
  const map = { rec1: 'chicken-biryani-ab12' };
  assert.equal(J.liveJobFinished({ stage: 'done', recipeId: 'rec1' }, map, ids, false), true);
  assert.equal(J.liveJobFinished({ stage: 'done', recipeId: 'rec1' }, map, ids, true), false, 'the send to the kid is still pending');
  assert.equal(J.liveJobFinished({ stage: 'done', recipeId: 'rec1' }, map, new Set(), false), false, 'not in the library yet');
  assert.equal(J.liveJobFinished({ stage: 'done', recipeId: 'rec2' }, map, ids, false), false, 'library id unknown');
  assert.equal(J.liveJobFinished({ stage: 'done' }, map, ids, false), false, 'no recipe');
  assert.equal(J.liveJobFinished({ stage: 'writing', recipeId: 'rec1' }, map, ids, false), false);
  assert.equal(J.liveJobFinished(undefined, map, ids, false), false);
});

test('only finished jobs with an unknown library id are looked up, once each', () => {
  const workers = [
    { stage: 'done', recipeId: 'a' },
    { stage: 'done', recipeId: 'a' },
    { stage: 'done', recipeId: 'b' },
    { stage: 'writing', recipeId: 'c' },
    { stage: 'done' },
  ];
  assert.deepEqual(J.recipeIdsToLookUp(workers, { b: 'dish-b' }), ['a']);
  assert.deepEqual(J.recipeIdsToLookUp([], {}), []);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const atest = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

await atest('the x: Undo in time stops nothing; otherwise the stop runs once and the row stays gone', async () => {
  let runs = 0;
  const run = async () => {
    runs += 1;
    return true;
  };
  S.stopSoon('a', run, 30);
  assert.equal(S.stopState('a'), 'waiting');
  S.stopSoon('a', run, 30); // a second tap while it waits
  assert.equal(S.undoStop('a'), false, 'a double tap on the x lands on Undo: ignored');
  assert.equal(S.stopState('a'), 'waiting');
  assert.equal(S.undoStop('a', Date.now() + S.UNDO_GUARD_MS), true);
  assert.equal(S.stopState('a'), null);
  await wait(60);
  assert.equal(runs, 0, 'undone: nothing stopped');

  S.stopSoon('b', run, 30);
  await wait(60);
  assert.equal(runs, 1);
  assert.equal(S.stopState('b'), 'gone');
  assert.equal(S.undoStop('b', Date.now() + S.UNDO_GUARD_MS), false, 'too late to undo');
  S.stopSoon('b', run, 10); // already gone: nothing more
  await wait(30);
  assert.equal(runs, 1);
});

await atest('a stop that fails comes back as it was; the background runs a waiting stop at once', async () => {
  let release;
  S.stopSoon('c', () => new Promise((r) => (release = r)), 10_000);
  S.flushStops();
  assert.equal(S.stopState('c'), 'stopping');
  assert.equal(S.undoStop('c', Date.now() + S.UNDO_GUARD_MS), false, 'no undo once it is running');
  S.flushStops(); // a second flush doesn't run it again
  release(false);
  await wait(0);
  assert.equal(S.stopState('c'), null, 'failed: the row comes back');

  S.stopSoon('d', async () => {
    throw new Error('offline');
  }, 10);
  await wait(30);
  assert.equal(S.stopState('d'), null, 'a throw counts as a failure');

  // Offline, Convex queues the mutation instead of failing it: the wait gives up, so the row comes back.
  await assert.rejects(S.inTime(new Promise(() => {}), 20), /no answer/);
  assert.equal(await S.inTime(Promise.resolve(7), 20), 7);
});

test('a job stopped anywhere (this phone or another) is dropped; a real failure is not', () => {
  assert.equal(J.liveJobCancelled({ stage: 'failed', error: 'Cancelled.' }), true);
  assert.equal(J.liveJobCancelled({ stage: 'failed', error: 'We couldn’t finish this recipe.' }), false);
  assert.equal(J.liveJobCancelled({ stage: 'writing' }), false);
  assert.equal(J.liveJobCancelled(undefined), false);
});

console.log(`\n${passed} passed`);
