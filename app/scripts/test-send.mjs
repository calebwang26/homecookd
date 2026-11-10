// Send's button as a state machine (src/components/record/sendMachine.ts; STATE-MACHINES.md row 5, decision 8:
// one tap, one send), run for real under node with a fake clock and a fake api.
//   cd app && node scripts/test-send.mjs
//
// 1. The table: every state × event pair against the expected one; the button's look in each state.
// 2. lib/machine.ts holdMachine (what useMachineNow holds): a move is seen at once, a refused event says so.
// 3. runSend with fake steps on a fake clock: sent, slow, declined, failed before and after the upload
//    started, the retry, the screen gone mid-send, and the spinner's least time.
// 4. Decision 8: taps at every point of a send (in the same frame, during the consent ask, the upload, the
//    job, the fade, the burst, "Didn't send") start nothing; only idle's tap sends.
// 5. The whole send through the real sendKept and sendDraft against a fake upload, job and pending-send api:
//    the state at each call, the note kept, put back or left for the resend, and one upload however often
//    Send is tapped.
// 6. The screen uses the machine (send.tsx), and sendDraft says `started` once the upload has started.
// 7. Home's Send again (components/parent/sendAgain, Caleb Nov 10): the same machine, one per recording: one tap
//    one send, a tap while it's going does nothing, a failure says so and the button comes back, recordings apart.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The fake api (section 5): what sendKept and sendDraft call, recorded with the send machine's state then.
globalThis.__api = null;
const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const call = (name) => `(...a) => globalThis.__api.${name}(...a)`;
const stubs = {
  '@/lib/askReminders': stub(`export const askFilmed = ${call('askFilmed')};`),
  '@/lib/aiConsent': stub(`export const requireAiConsent = ${call('requireAiConsent')}; export const getAiConsent = () => 'given';`),
  '@/lib/live/convex': stub(`export const convexKidIds = async (kids) => kids.map((k) => k.id); export const createJob = ${call('createJob')};`),
  '@/lib/uploads': stub(
    `export const startUpload = ${call('startUpload')}; export const ensurePendingSend = ${call('ensurePendingSend')};` +
      ` export const updateJobMeta = ${call('updateJobMeta')}; export const uploadFinished = ${call('uploadFinished')};`,
  ),
  '@/lib/unsentRecordings': stub(
    ['keepForSend', 'saveUnsent', 'loadUnsent', 'putUnsent', 'dropUnsent', 'markUnsentJob', 'stillUnsent'].map((n) => `export const ${n} = ${call(n)};`).join(' '),
  ),
};
registerHooks({
  resolve(spec, ctx, next) {
    if (stubs[spec]) return { url: stubs[spec], shortCircuit: true };
    if (spec.startsWith('@/') && existsSync(join(root, 'src', `${spec.slice(2)}.ts`))) return next(pathToFileURL(join(root, 'src', `${spec.slice(2)}.ts`)).href, ctx);
    const base = spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});
const load = (p) => import(pathToFileURL(join(root, p)).href);
const { holdMachine, machineHistory, clearMachineHistory } = await load('src/lib/machine.ts');
const S = await load('src/components/record/sendMachine.ts');
const { sendKept } = await load('src/components/record/sendKept.ts');
const A = await load('src/components/parent/sendAgain.ts');

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

/** Every state × event pair of `m` against `expected` (state → event → next; missing means null). */
function everyPair(m, expected) {
  assert.deepEqual([...m.states].sort(), Object.keys(expected).sort(), `${m.name}: the states`);
  for (const s of m.states) {
    for (const e of m.events) {
      assert.equal(m.transition(s, e), expected[s][e] ?? null, `${m.name}: ${s} --${e}-->`);
    }
  }
}

const flush = () => new Promise((r) => setImmediate(r));

/** A fake clock: `wait` resolves when `advance` passes its time, in order. */
function fakeClock() {
  let t = 0;
  let timers = [];
  return {
    now: () => t,
    wait: (ms) => new Promise((r) => timers.push({ at: t + ms, r })),
    pending: () => timers.length,
    async advance(ms) {
      const end = t + ms;
      await flush();
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers = timers.slice(1);
        t = next.at;
        next.r();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}

/** A promise the test settles. */
function later() {
  let resolve;
  let reject;
  const p = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { p, resolve, reject };
}

const LEAST = 450;

/** A send machine, the states it went through, and fake steps whose consent and send the test settles. */
function rig() {
  const states = ['idle'];
  const held = holdMachine(S.sendMachine, 'idle', (s) => states.push(s));
  const clock = fakeClock();
  const log = [];
  let alive = true;
  const consent = [];
  const sends = [];
  const steps = {
    consent: () => {
      log.push('consent');
      const d = later();
      consent.push(d);
      return d.p;
    },
    send: (started) => {
      log.push('send');
      const d = later();
      sends.push({ ...d, started });
      return d.p;
    },
    fade: () => log.push(`fade@${clock.now()}`),
    failed: (e) => log.push(`failed:${e.message}@${clock.now()}`),
    alive: () => alive,
  };
  const tap = () => S.runSend(held.send, steps, LEAST, clock);
  return { held, states, clock, log, consent, sends, steps, tap, gone: () => (alive = false) };
}

// ---------------------------------------------------------------------------------------------
// 1. The table

const TABLE = {
  idle: { tap: 'asking' },
  asking: { consented: 'uploading', declined: 'idle' },
  uploading: { started: 'creatingJob', failed: 'failed' },
  creatingJob: { sent: 'sent', failed: 'failed' },
  sent: { shown: 'done' },
  done: {},
  failed: { cleared: 'idle' },
};

await test('the send table: every state × event pair', () => {
  everyPair(S.sendMachine, TABLE);
  assert.deepEqual([...S.sendMachine.events], ['tap', 'consented', 'declined', 'started', 'sent', 'failed', 'shown', 'cleared']);
});

await test('only idle takes a tap, and nothing moves done', () => {
  for (const s of S.sendMachine.states) assert.equal(S.sendMachine.transition(s, 'tap') !== null, s === 'idle', s);
  for (const e of S.sendMachine.events) assert.equal(S.sendMachine.transition('done', e), null, e);
});

await test('the button: a spinner from the upload until the burst, "Didn’t send" when it failed', () => {
  const looks = { idle: 'idle', asking: 'idle', uploading: 'loading', creatingJob: 'loading', sent: 'loading', done: 'idle', failed: 'error' };
  for (const s of S.sendMachine.states) {
    assert.equal(S.buttonState(s), looks[s], s);
    assert.equal(S.sending(s), looks[s] === 'loading', s);
  }
  assert.equal(S.FADE_MS, 220);
  assert.equal(S.ERROR_MS, 1800);
});

// ---------------------------------------------------------------------------------------------
// 2. holdMachine

await test('holdMachine: a move is seen at once; a refused event says so and changes nothing', () => {
  clearMachineHistory();
  const heard = [];
  const h = holdMachine(S.sendMachine, 'idle', (s) => heard.push(s));
  assert.equal(h.send('tap'), true);
  assert.equal(h.now(), 'asking', 'before any render');
  assert.equal(h.send('tap'), false);
  assert.equal(h.now(), 'asking');
  assert.equal(h.send('declined'), true);
  assert.deepEqual(heard, ['asking', 'idle'], 'onChange hears moves only');
  assert.deepEqual(
    machineHistory().send.map(({ event, from, to }) => [event, from, to]),
    [
      ['tap', 'idle', 'asking'],
      ['tap', 'asking', null],
      ['declined', 'asking', 'idle'],
    ],
    'every event is in the history, the refused one too',
  );
});

// ---------------------------------------------------------------------------------------------
// 3. runSend

await test('a send: asking, uploading, creatingJob, sent, then the burst once the fade is over', async () => {
  const r = rig();
  const run = r.tap();
  await flush();
  assert.equal(r.held.now(), 'asking');
  r.consent[0].resolve(true);
  await flush();
  assert.equal(r.held.now(), 'uploading');
  r.sends[0].started();
  assert.equal(r.held.now(), 'creatingJob');
  await r.clock.advance(100);
  r.sends[0].resolve();
  await flush();
  assert.equal(r.held.now(), 'sent', 'sent the moment it is');
  assert.deepEqual(r.log, ['consent', 'send'], 'no fade before the spinner’s least time');
  await r.clock.advance(LEAST - 100 - 1);
  assert.deepEqual(r.log, ['consent', 'send']);
  await r.clock.advance(1);
  assert.deepEqual(r.log, ['consent', 'send', `fade@${LEAST}`]);
  assert.equal(r.held.now(), 'sent', 'the spinner stays while the screen fades');
  await r.clock.advance(S.FADE_MS);
  assert.equal(r.held.now(), 'done');
  assert.equal(await run, 'sent');
  assert.deepEqual(r.states, ['idle', 'asking', 'uploading', 'creatingJob', 'sent', 'done']);
});

await test('a slow send fades at once: no extra wait past the least time', async () => {
  const r = rig();
  const run = r.tap();
  await flush();
  r.consent[0].resolve(true);
  await flush();
  r.sends[0].started();
  await r.clock.advance(5000);
  r.sends[0].resolve();
  await flush();
  await flush();
  assert.deepEqual(r.log, ['consent', 'send', 'fade@5000']);
  await r.clock.advance(S.FADE_MS);
  assert.equal(await run, 'sent');
});

await test('no to the AI companies: back to idle, nothing sent, Send can be tapped again', async () => {
  const r = rig();
  const run = r.tap();
  await flush();
  r.consent[0].resolve(false);
  assert.equal(await run, 'declined');
  assert.equal(r.held.now(), 'idle');
  assert.deepEqual(r.log, ['consent']);
  const again = r.tap();
  await flush();
  assert.equal(r.held.now(), 'asking', 'a new tap asks again');
  r.consent[1].resolve(false);
  assert.equal(await again, 'declined');
});

await test('the consent check throws (storage): a no, back to idle, and a new tap asks again', async () => {
  const r = rig();
  const run = r.tap();
  await flush();
  r.consent[0].reject(new Error('storage unreadable'));
  assert.equal(await run, 'declined');
  assert.equal(r.held.now(), 'idle', 'never stuck in asking');
  assert.deepEqual(r.log, ['consent'], 'nothing sent');
  const again = r.tap();
  await flush();
  assert.equal(r.held.now(), 'asking');
  assert.equal(r.consent.length, 2, 'the new tap asks');
  r.consent[1].resolve(true);
  await flush();
  r.sends[0].started();
  r.sends[0].resolve();
  await r.clock.advance(LEAST + S.FADE_MS);
  assert.equal(await again, 'sent');
  assert.deepEqual(r.states, ['idle', 'asking', 'idle', 'asking', 'uploading', 'creatingJob', 'sent', 'done']);
});

await test('it fails before the upload started (the hello, the copies): failed after the least time, then idle', async () => {
  const r = rig();
  const run = r.tap();
  await flush();
  r.consent[0].resolve(true);
  await flush();
  r.sends[0].reject(new Error('no hello'));
  await flush();
  assert.equal(r.held.now(), 'uploading', 'the spinner holds its least time');
  await r.clock.advance(LEAST);
  assert.equal(r.held.now(), 'failed');
  assert.deepEqual(r.log, ['consent', 'send', `failed:no hello@${LEAST}`]);
  await r.clock.advance(S.ERROR_MS - 1);
  assert.equal(r.held.now(), 'failed', '"Didn’t send" stays ERROR_MS');
  await r.clock.advance(1);
  assert.equal(r.held.now(), 'idle');
  assert.equal(await run, 'failed');
  assert.deepEqual(r.states, ['idle', 'asking', 'uploading', 'failed', 'idle']);
});

await test('it fails after the upload started: creatingJob to failed; her tap after is the retry', async () => {
  const r = rig();
  const run = r.tap();
  await flush();
  r.consent[0].resolve(true);
  await flush();
  r.sends[0].started();
  await r.clock.advance(LEAST + 10);
  r.sends[0].reject(new Error('no answer'));
  await flush();
  await flush();
  assert.equal(r.held.now(), 'failed', 'past the least time: at once');
  await r.clock.advance(S.ERROR_MS);
  assert.equal(await run, 'failed');
  const retry = r.tap();
  await flush();
  r.consent[1].resolve(true);
  await flush();
  assert.equal(r.sends.length, 2, 'the retry sends');
  r.sends[1].started();
  r.sends[1].resolve();
  await r.clock.advance(LEAST + S.FADE_MS);
  assert.equal(await retry, 'sent');
  assert.deepEqual(r.states, ['idle', 'asking', 'uploading', 'creatingJob', 'failed', 'idle', 'asking', 'uploading', 'creatingJob', 'sent', 'done']);
});

await test('the screen went away mid-send: no fade, no burst, no "Didn’t send"', async () => {
  const ok = rig();
  const sent = ok.tap();
  await flush();
  ok.consent[0].resolve(true);
  await flush();
  ok.sends[0].started();
  ok.sends[0].resolve();
  ok.gone();
  await ok.clock.advance(LEAST + S.FADE_MS);
  assert.equal(await sent, 'sent');
  assert.deepEqual(ok.log, ['consent', 'send']);
  assert.equal(ok.held.now(), 'sent');

  const bad = rig();
  const failed = bad.tap();
  await flush();
  bad.consent[0].resolve(true);
  await flush();
  bad.sends[0].reject(new Error('x'));
  bad.gone();
  await bad.clock.advance(LEAST + S.ERROR_MS);
  assert.equal(await failed, 'failed');
  assert.deepEqual(bad.log, ['consent', 'send']);
  assert.equal(bad.held.now(), 'uploading');
});

await test('the screen went away during the fade: the burst never comes', async () => {
  const r = rig();
  const run = r.tap();
  await flush();
  r.consent[0].resolve(true);
  await flush();
  r.sends[0].started();
  r.sends[0].resolve();
  await r.clock.advance(LEAST);
  r.gone();
  await r.clock.advance(S.FADE_MS);
  assert.equal(await run, 'sent');
  assert.equal(r.held.now(), 'sent');
});

// ---------------------------------------------------------------------------------------------
// 4. Decision 8: one tap, one send

await test('two taps in the same frame: one consent ask, one send', async () => {
  const r = rig();
  const first = r.tap();
  const second = r.tap();
  const third = r.tap();
  assert.equal(await second, 'ignored');
  assert.equal(await third, 'ignored');
  r.consent[0].resolve(true);
  await flush();
  r.sends[0].started();
  r.sends[0].resolve();
  await r.clock.advance(LEAST + S.FADE_MS);
  assert.equal(await first, 'sent');
  assert.equal(r.consent.length, 1);
  assert.equal(r.sends.length, 1);
});

await test('a tap at every point of a send starts nothing; only idle’s does', async () => {
  const r = rig();
  const extra = [];
  const tapAgain = () => extra.push(r.tap());
  const run = r.tap();
  await flush();
  tapAgain(); // asking: the consent sheet is opening (#ensureAiConsent's waiters would all hear her yes)
  r.consent[0].resolve(true);
  await flush();
  tapAgain(); // uploading
  r.sends[0].started();
  tapAgain(); // creatingJob
  r.sends[0].resolve();
  await flush();
  tapAgain(); // sent, the spinner's least time
  await r.clock.advance(LEAST);
  tapAgain(); // sent, the fade (the old screen's idle window before the burst)
  await r.clock.advance(S.FADE_MS);
  tapAgain(); // done, the burst
  assert.equal(await run, 'sent');
  assert.deepEqual(await Promise.all(extra), Array(6).fill('ignored'));
  assert.equal(r.consent.length, 1);
  assert.equal(r.sends.length, 1);
  assert.deepEqual(r.states, ['idle', 'asking', 'uploading', 'creatingJob', 'sent', 'done']);
});

await test('"Didn’t send" takes no tap; idle after it does', async () => {
  const r = rig();
  const run = r.tap();
  await flush();
  r.consent[0].resolve(true);
  await flush();
  r.sends[0].reject(new Error('x'));
  await r.clock.advance(LEAST);
  assert.equal(r.held.now(), 'failed');
  assert.equal(await r.tap(), 'ignored');
  await r.clock.advance(S.ERROR_MS);
  assert.equal(await run, 'failed');
  void r.tap();
  await flush();
  assert.equal(r.consent.length, 2, 'idle again: the tap asks');
});

// ---------------------------------------------------------------------------------------------
// 5. The whole send through the real sendKept and sendDraft, against a fake api

const me = { id: 'cook-1', name: 'Asha', relation: 'Mom', role: 'cook' };
const kid = { id: 'kid-1', name: 'Leo', role: 'learner' };
const clip = (n) => ({ key: `c${n}`, asset: { uri: `file:///picked/${n}.mov`, duration: 60_000, type: 'video' }, source: 'library', selected: true });

/** The fake api: every call logged with the send machine's state at that moment; failures by name. */
function fakeApi(held, { fail = null, upload = later(), pending = later() } = {}) {
  const calls = [];
  let notes = [];
  const at = (name) => calls.push(`${name}:${held.now()}`);
  const boom = (name) => {
    if (fail === name) throw new Error(`${name} failed`);
  };
  globalThis.__api = {
    requireAiConsent: async () => at('requireAiConsent'),
    keepForSend: async (clips, noteId) => {
      at('keepForSend');
      boom('keepForSend');
      return { clips: clips.map((c) => ({ ...c, asset: { ...c.asset, uri: `file:///documents/sends/${noteId}/${c.key}.mov` } })), copies: new Set() };
    },
    saveUnsent: (u) => {
      at('saveUnsent');
      notes = [...notes.filter((n) => n.recordingId !== u.recordingId), u];
    },
    loadUnsent: () => notes,
    putUnsent: (u) => {
      at('putUnsent');
      notes = [...notes, u];
    },
    dropUnsent: (id) => {
      at('dropUnsent');
      notes = notes.filter((n) => n.recordingId !== id);
    },
    markUnsentJob: (id, jobId) => {
      at('markUnsentJob');
      notes = notes.map((n) => (n.recordingId === id ? { ...n, jobId } : n));
    },
    stillUnsent: (id) => notes.some((n) => n.recordingId === id),
    startUpload: async (input) => {
      at('startUpload');
      await upload.p;
      boom('startUpload');
      return { job_id: 'up-1', sender_id: input.as, job_fields: input.meta.job_fields, recipient_ids: input.meta.recipient_ids };
    },
    createJob: async () => {
      at('createJob');
      boom('createJob');
    },
    updateJobMeta: () => {},
    uploadFinished: async () => false,
    ensurePendingSend: async () => {
      at('ensurePendingSend');
      await pending.p;
      boom('ensurePendingSend');
      return true;
    },
    askFilmed: async () => at('askFilmed'),
  };
  return { calls, notes: () => notes, upload, pending };
}

/** Send's tap with the screen's real steps: consent yes, then sendKept with `started`. */
function realTap(r) {
  const steps = {
    ...r.steps,
    consent: async () => true,
    send: async (started) => {
      await sendKept({
        me,
        draft: { glasses: false, language: 'en', recordingId: null },
        clips: [clip(1), clip(2)],
        kids: [kid],
        recipients: [kid],
        toLabel: 'Leo',
        dish: 'Dal',
        hello: null,
        familyId: 'fam-1',
        forKids: [kid.id],
        everyone: false,
        requestFrom: null,
        onStarted: started,
      });
    },
  };
  return S.runSend(r.held.send, steps, LEAST, r.clock);
}

await test('through sendKept and sendDraft: the state at each api call, and one upload however often she taps', async () => {
  const r = rig();
  const api = fakeApi(r.held);
  const run = realTap(r);
  const extra = [realTap(r), realTap(r)];
  await flush();
  assert.equal(r.held.now(), 'uploading');
  extra.push(realTap(r));
  api.upload.resolve();
  await flush();
  await flush();
  assert.equal(r.held.now(), 'creatingJob', 'the upload started: the job and who gets it');
  extra.push(realTap(r));
  api.pending.resolve();
  await r.clock.advance(LEAST);
  extra.push(realTap(r));
  await r.clock.advance(S.FADE_MS);
  assert.equal(await run, 'sent');
  assert.deepEqual(await Promise.all(extra), Array(5).fill('ignored'));
  // The note and its copies, the consent check, the upload; once it has started, who gets it and the job
  // (jobs.create isn't awaited: the home card asks again until it's made); askFilmed before Send hears it's sent.
  assert.deepEqual(api.calls, [
    'keepForSend:uploading',
    'saveUnsent:uploading',
    'requireAiConsent:uploading',
    'startUpload:uploading',
    'markUnsentJob:uploading',
    'ensurePendingSend:creatingJob',
    'createJob:creatingJob',
    'askFilmed:creatingJob',
  ]);
  assert.equal(api.calls.filter((c) => c.startsWith('startUpload')).length, 1, 'one upload');
  assert.equal(api.calls.filter((c) => c.startsWith('createJob')).length, 1, 'one job');
  assert.equal(api.notes().length, 1, 'the note stays until every video is up and the job is made (the resend path)');
  assert.equal(api.notes()[0].jobId, 'up-1');
  assert.equal(r.held.now(), 'done');
});

await test('the upload refused before it started: failed, and the note goes (no resend behind her back)', async () => {
  const r = rig();
  const api = fakeApi(r.held, { fail: 'startUpload' });
  const run = realTap(r);
  await flush();
  api.upload.resolve();
  await r.clock.advance(LEAST);
  assert.equal(r.held.now(), 'failed');
  assert.ok(r.log.includes(`failed:startUpload failed@${LEAST}`));
  assert.equal(api.notes().length, 0, 'sendKept dropped the note it made');
  assert.ok(!api.calls.some((c) => c.startsWith('createJob')));
  await r.clock.advance(S.ERROR_MS);
  assert.equal(await run, 'failed');
  assert.equal(r.held.now(), 'idle');
});

await test('it fails after the upload started: failed from creatingJob, and the note stays for the resend', async () => {
  const r = rig();
  const api = fakeApi(r.held, { fail: 'ensurePendingSend' });
  const run = realTap(r);
  await flush();
  api.upload.resolve();
  api.pending.resolve();
  await r.clock.advance(LEAST);
  assert.equal(r.held.now(), 'failed');
  assert.deepEqual(r.states.slice(0, 5), ['idle', 'asking', 'uploading', 'creatingJob', 'failed']);
  assert.equal(api.notes().length, 1, 'an upload exists: the next launch owns it (useResendUnsent)');
  await r.clock.advance(S.ERROR_MS);
  assert.equal(await run, 'failed');
});

// ---------------------------------------------------------------------------------------------
// 6. The screen and sendDraft use it

await test('send.tsx: the button is the machine; sendDraft says started after the upload, before the job', () => {
  const src = (p) => readFileSync(join(root, 'src', p), 'utf8');
  const screen = src('app/send.tsx');
  assert.match(screen, /useMachineNow\(sendMachine,/);
  assert.match(screen, /await runSend\(\n\s*go,/);
  assert.match(screen, /state=\{buttonState\(phase\)\}/);
  assert.match(screen, /onStarted: started,/);
  assert.match(screen, /const sending = isSending\(phase\);/);
  assert.doesNotMatch(screen, /useState<ActionState>/, 'no second state for the button');
  const draft = src('components/record/sendDraft.ts');
  const body = draft.slice(draft.indexOf('export async function sendDraft'));
  const at = (s) => {
    const i = body.indexOf(s);
    assert.ok(i >= 0, s);
    return i;
  };
  assert.ok(at('await startUpload(') < at('onStarted?.();'));
  assert.ok(at('markUnsentJob(noteId, job.job_id)') < at('onStarted?.();'));
  assert.ok(at('onStarted?.();') < at('const made = tryJob(job);'));
});

await test('Send again (Home, Caleb Nov 10): one tap, one send per recording; a tap while it goes does nothing; then idle again', async () => {
  const clock = fakeClock();
  const sends = [];
  const going = later();
  const steps = (id) => ({
    consent: async () => true,
    send: async (started) => {
      sends.push(id);
      started();
      await going.p;
    },
    failed: () => assert.fail('no failure here'),
  });
  assert.equal(A.sendAgainState('n1'), 'idle');
  assert.equal(A.sendAgainLook('n1'), 'offer', 'the button before any tap');
  const first = A.sendAgain('n1', steps('n1'), clock);
  await clock.advance(0);
  assert.equal(A.sendAgainState('n1'), 'creatingJob', 'consented, upload started, the job on its way');
  assert.equal(A.sendAgainLook('n1'), 'sending');
  // Taps while it goes: in the same frame, during the job. None sends.
  assert.equal(await A.sendAgain('n1', steps('n1'), clock), 'ignored');
  assert.equal(await A.sendAgain('n1', steps('n1'), clock), 'ignored');
  assert.deepEqual(sends, ['n1'], 'one tap, one send');
  // Another recording's button is its own.
  assert.equal(A.sendAgainLook('n2'), 'offer');
  going.resolve();
  await clock.advance(A.SEND_AGAIN_LEAST_MS);
  assert.equal(A.sendAgainLook('n1'), 'sending', 'sent: the spinner until the row moves on');
  await clock.advance(S.FADE_MS);
  assert.equal(await first, 'sent');
  assert.equal(A.sendAgainState('n1'), 'idle', 'over: a later give-up of the new send offers the button again');
});

await test('Send again: a failure says so for ERROR_MS, then the button is back; she can say no to the AI ask', async () => {
  const clock = fakeClock();
  const said = [];
  const run = A.sendAgain('f1', { consent: async () => true, send: async () => {
    throw new Error('We can’t reach homecookd. Try again in a moment.');
  }, failed: (e) => said.push(e.message) }, clock);
  await clock.advance(A.SEND_AGAIN_LEAST_MS);
  assert.equal(A.sendAgainLook('f1'), 'error', '"Didn\'t send" on the button');
  assert.deepEqual(said, ['We can’t reach homecookd. Try again in a moment.']);
  assert.equal(await A.sendAgain('f1', { consent: async () => assert.fail('no ask'), send: async () => assert.fail('no send'), failed: () => {} }, clock), 'ignored', 'no tap while it says so');
  await clock.advance(S.ERROR_MS);
  assert.equal(await run, 'failed');
  assert.equal(A.sendAgainLook('f1'), 'offer', 'her own next try');
  let sent = false;
  assert.equal(await A.sendAgain('f1', { consent: async () => false, send: async () => (sent = true), failed: () => {} }, clock), 'declined');
  assert.equal(sent, false, 'no yes, nothing sent');
  assert.equal(A.sendAgainLook('f1'), 'offer');
});

await test('Send again: the row uses it (PendingRecipes), through the launch\'s own resend (sendNoteAgain), started before it resolves', () => {
  const home = readFileSync(join(root, 'src/components/parent/PendingRecipes.tsx'), 'utf8');
  assert.match(home, /void sendAgain\(note\.recordingId, \{/);
  assert.match(home, /consent: \(\) => ensureAiConsent\(\)/);
  assert.match(home, /await sendNoteAgain\(note\.recordingId, profiles, learners,/);
  assert.match(home, /if \(!begun\) started\(\);/, 'runSend only reaches sent from creatingJob');
  const resend = readFileSync(join(root, 'src/components/record/useResendUnsent.ts'), 'utf8');
  assert.match(resend, /resendOne\(u, cook, profiles, learners, true, onStarted\)/, 'by hand');
  assert.match(resend, /inFlight\.has\(u\.recordingId\)/, 'a launch\'s pass skips a note being sent');
  assert.match(resend, /if \(inFlight\.has\(noteId\)\) return 'busy';/, 'and her tap one a launch is sending');
});

await test('a resend keeps its note sendable: the note\'s job is cleared between stopping the old job and the send; a by-hand failure goes back to the next pass; queued says On its way', () => {
  const src = readFileSync(join(root, 'src/components/record/useResendUnsent.ts'), 'utf8');
  const at = (s) => {
    const i = src.indexOf(s);
    assert.ok(i > 0, s);
    return i;
  };
  const stop = at('if (job && !(await cancelLiveJob(job.id, cook.id))) {');
  const clear = at('if (job) markUnsentJob(u.recordingId, null);');
  const rows = at('for (const r of rowsOf(u)) {\n    cancelJobUploads(r.job_id);');
  const send = at('await sendDraft({');
  assert.ok(stop < clear && clear < rows && rows < send, 'stop the old job, clear the note\'s job, drop the rows, then send');
  assert.match(src, /catch \(e\) \{\s*looked\.delete\(noteId\);[^\n]*\n\s*throw e;/, 'a failed tap is the next pass\'s to send');
  assert.match(src, /if \(step === 'wait'\) return 'waiting';/);
  const home = readFileSync(join(root, 'src/components/parent/PendingRecipes.tsx'), 'utf8');
  assert.match(home, /if \(r === 'waiting' \|\| r === 'busy'\) toast\.show\(t\('parent\.send\.onItsWay'\)\);/, 'not a quiet tap');
});

console.log(`\n${passed} passed`);
