// Unit tests for Parent Home's recordings on their way, read from the worker's live stage (TS run by
// Node's type stripping):
//   src/components/parent/jobsLogic.ts   'uploading' keeps the sending half of the bar short of full,
//                                        with "Still sending the video", unless this phone's upload gave
//                                        up ("Some videos didn't send"); a live job is finished once
//                                        it's 'done' and its recipe is in the library; which finished
//                                        jobs still need their library id looked up,
//                                        and a job stopped anywhere is dropped
//   src/components/parent/stops.ts       the x's "Stopped · Undo": Undo in time stops nothing (but a
//                                        double tap on the x doesn't undo it), the stop runs once after
//                                        the wait (or at once when she leaves the app), a stop that
//                                        worked stays gone, a failed or timed-out one comes back
//   src/components/record/jobRetry.ts    every send gets its Convex job: jobs.create again with a
//                                        backoff until Convex lists it, then the row says it failed
//   node scripts/test-parent-jobs.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// '@/…' and extensionless imports (jobsLogic reads its words from src/lib/words: a folder's index.ts too).
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    if (base && !/\.[a-z]+$/.test(base) && existsSync(join(base, 'index.ts'))) return next(pathToFileURL(join(base, 'index.ts')).href, ctx);
    return next(spec, ctx);
  },
});
const J = await import(pathToFileURL(join(root, 'src/components/parent/jobsLogic.ts')).href);
const S = await import(pathToFileURL(join(root, 'src/components/parent/stops.ts')).href);
const R = await import(pathToFileURL(join(root, 'src/components/record/jobRetry.ts')).href);

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
  for (const stage of ['uploading', 'queued', 'preparing', 'understanding', 'writing', 'indexing']) assert.ok(J.stageHint(stage), stage);
  assert.equal(J.stageHint('uploading'), 'Still sending the video');
});

test('uploading: a phone whose own upload gave up says so, never "Sending your videos · 0%" (on 1.1 the live stage is uploading from the start)', () => {
  // CI journey 4 (run 42852281034): every try was refused, the job's local_state went 'failed', and the row still read "Sending your videos · 0%".
  assert.deepEqual(J.uploadingRow('failed', 0, 0, 1), { failed: true, hint: 'Some videos didn’t send · send them again' });
  assert.deepEqual(J.uploadingRow('failed', null, 0, 3), { failed: true, hint: 'Some videos didn’t send · send them again' }, 'after a restart too');
  assert.deepEqual(J.uploadingRow('uploading', 0.42, 0, 3), { failed: false, hint: 'Sending your videos · 42%', send: 0.42 });
  assert.deepEqual(J.uploadingRow('uploaded', 1, 0, 3), { failed: false, ...J.uploadingView(1, 0, 3) }, 'sent, the worker just hasn\'t seen it');
  assert.deepEqual(J.uploadingRow(undefined, null, 1, 2), { failed: false, ...J.uploadingView(null, 1, 2) }, 'a row with no stored state (another phone\'s)');
});

test('the row uses it: ProcessingRow\'s live-stage uploading branch shows a failed upload, and clearing it marks the job gone', () => {
  const row = readFileSync(join(root, 'src/components/parent/ProcessingRow.tsx'), 'utf8');
  const from = row.indexOf("if (worker.stage === 'uploading') {");
  const branch = row.slice(from, row.indexOf('return { ...ok, hint: stageHint(worker.stage, t)', from));
  assert.ok(from > 0 && branch.length > 0, 'the live uploading branch');
  assert.match(branch, /uploadingRow\(job\.local_state,/, 'the live uploading branch asks uploadingRow with the stored state');
  assert.match(branch, /if \(row\.failed\) return \{ \.\.\.problem, hint: row\.hint, uploadFailed: true \};/, 'and returns the failed row');
  const home = readFileSync(join(root, 'src/components/parent/PendingRecipes.tsx'), 'utf8');
  const at = home.indexOf("if (action === 'remove') {");
  const remove = home.slice(at, home.indexOf('removeJob(job.job_id);', at));
  assert.ok(at > 0 && remove.length > 0, 'the remove action');
  assert.match(remove, /markGone\(job\.job_id\);/, 'a cleared row\'s live job is stopped and not listed again');
});

test('Send again (Caleb, Nov 10): the failed row says it didn\'t send and offers the button, or says plainly its videos are gone', () => {
  const v = { hint: 'Some videos didn’t send · send them again', problem: true, uploadFailed: true };
  assert.deepEqual(J.sendAgainRow(v, 'send', 'offer'), { ...v, hint: 'Your videos didn’t send', again: 'offer' });
  assert.deepEqual(J.sendAgainRow(v, 'send', 'sending'), { ...v, hint: 'Your videos didn’t send', again: 'sending' });
  assert.deepEqual(J.sendAgainRow(v, 'send', 'error'), { ...v, hint: 'Your videos didn’t send', again: 'error' });
  assert.deepEqual(J.sendAgainRow(v, 'gone', 'offer'), { ...v, hint: 'Your videos didn’t send, and they’re not on this phone any more', again: null }, 'no button that can\'t work');
  // Both of describeJob's failed-upload rows are marked, so Home can offer it on either.
  const row = readFileSync(join(root, 'src/components/parent/ProcessingRow.tsx'), 'utf8');
  assert.equal((row.match(/uploadFailed: true/g) ?? []).length, 2);
  const home = readFileSync(join(root, 'src/components/parent/PendingRecipes.tsx'), 'utf8');
  assert.match(home, /if \(!v\?\.uploadFailed \|\| stops\.has\(j\.job_id\)\) continue;/);
  assert.match(home, /sendAgainRow\(v, sendAgainOffer\(note, note \? clipsHere\(note\)\.length : 0\)/);
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

test('markGone: a failed row cleared with its x is gone at once (Home then stops its live job once), never over a stop in progress', () => {
  S.markGone('cleared');
  assert.equal(S.stopState('cleared'), 'gone');
  S.markGone('cleared');
  assert.equal(S.stopState('cleared'), 'gone', 'twice is the same');
  S.stopSoon('waiting-one', async () => true, 60_000);
  S.markGone('waiting-one');
  assert.equal(S.stopState('waiting-one'), 'waiting', 'an x waiting for Undo keeps its own stop');
  assert.equal(S.undoStop('waiting-one', Date.now() + 10_000), true);
  assert.equal(S.stopState('waiting-one'), null);
});

test('jobs.create is asked again until Convex lists the job, backing off, then the row says it failed', () => {
  const fields = { glasses: false, language: 'mr', title: 'Poha', kids: [] };
  const row = { sender_id: 'p-mom', job_fields: fields, local_state: 'uploading' };
  const at = (now, more = {}) => ({ now, liveKnown: false, inFlight: false, ...more });
  assert.equal(R.jobNext(row, at(0)), 'create', 'the first try goes at once');
  assert.equal(R.jobNext(row, at(0, { inFlight: true })), 'skip', 'never two at once');
  assert.equal(R.jobNext(row, at(0, { liveKnown: true })), 'mark-ok', 'Convex already has it');
  assert.equal(R.jobNext({ ...row, convex_job: 'ok' }, at(0)), 'skip');
  assert.equal(R.jobNext({ ...row, job_fields: undefined }, at(0)), 'skip', 'a row from an older build');
  assert.equal(R.jobNext({ ...row, sender_id: null }, at(0)), 'skip');
  assert.equal(R.jobNext({ ...row, local_state: 'failed' }, at(0)), 'skip', 'the upload itself failed');

  // Each failed try waits longer; after the last one the row is 'failed' and isn't tried again.
  let r = { ...row };
  let t = 1_000_000;
  for (let i = 0; i < R.JOB_RETRY_MS.length; i++) {
    r = { ...r, ...R.afterFailure(r, t) };
    assert.equal(r.convex_job, null, `try ${i + 1}`);
    assert.equal(R.jobNext(r, at(t + R.JOB_RETRY_MS[i] - 1)), 'skip', `waits before try ${i + 2}`);
    t += R.JOB_RETRY_MS[i];
    assert.equal(R.jobNext(r, at(t)), 'create', `try ${i + 2}`);
  }
  r = { ...r, ...R.afterFailure(r, t) };
  assert.equal(r.convex_job, 'failed');
  assert.equal(R.jobNext(r, at(t + 10 * 3600_000)), 'skip');
  // Convex turning up with it later still clears the failure.
  assert.equal(R.jobNext(r, at(t, { liveKnown: true })), 'mark-ok');
});

test('a job stopped anywhere (this phone or another) is dropped; a real failure is not', () => {
  assert.equal(J.liveJobCancelled({ stage: 'failed', error: 'Cancelled.' }), true);
  assert.equal(J.liveJobCancelled({ stage: 'failed', error: 'We couldn’t finish this recipe.' }), false);
  assert.equal(J.liveJobCancelled({ stage: 'writing' }), false);
  assert.equal(J.liveJobCancelled(undefined), false);
});

console.log(`\n${passed} passed`);
