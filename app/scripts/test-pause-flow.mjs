// Pause while filming in the app (src/components/record/pauseFlow.ts; Caleb, Nov 12: "the only button is pause, and
// after they pause, they can click 'im done'"): every state × event of the table, what the screen shows in each
// state, that only a pause made by leaving the app films again by itself, and the real Filming (fake camera) going
// through pause → move → keep filming → done, with every part sent in order.
//   cd app && node scripts/test-pause-flow.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const FAKES = {
  'react-native': js("export const NativeModules = {}; export const Platform = { OS: 'ios' };"),
  'expo-constants': js("export default { executionEnvironment: 'standalone' }; export const ExecutionEnvironment = { StoreClient: 'storeClient' };"),
  'expo-modules-core': js('export const requireOptionalNativeModule = () => null;'),
};
registerHooks({
  resolve(spec, ctx, next) {
    if (FAKES[spec]) return { url: FAKES[spec], shortCircuit: true };
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});
const P = await import(pathToFileURL(join(root, 'src/components/record/pauseFlow.ts')).href);
const W = await import(pathToFileURL(join(root, 'src/components/record/words.ts')).href);
const Fm = await import(pathToFileURL(join(root, 'src/components/record/filming.ts')).href);
const C = await import(pathToFileURL(join(root, 'src/components/record/cameraLogic.ts')).href);
const U = await import(pathToFileURL(join(root, 'src/lib/unsentLogic.ts')).href);
const src = (p) => readFileSync(join(root, p), 'utf8');

let passed = 0;
const rigs = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  } finally {
    for (const f of rigs.splice(0)) f.dispose();
  }
};

const STATES = ['idle', 'filming', 'paused', 'away', 'stopped', 'done'];
// The table as Caleb set the flow; '.' = the event does nothing there.
const EXPECTED = {
  //          start      tapPause  leaveApp backSoon   cameraStops keepFilming imDone
  idle:    ['filming', '.',      '.',     '.',       '.',        '.',        '.'],
  filming: ['.',       'paused', 'away',  '.',       'stopped',  '.',        '.'],
  paused:  ['.',       '.',      '.',     '.',       'stopped',  'filming',  'done'],
  away:    ['.',       '.',      '.',     'filming', 'stopped',  'filming',  'done'],
  stopped: ['.',       '.',      '.',     '.',       '.',        'filming',  'done'],
  done:    ['.',       '.',      '.',     '.',       '.',        '.',        '.'],
};

await test('every state × event', () => {
  assert.deepEqual([...P.pauseFlowMachine.states], STATES);
  assert.deepEqual([...P.pauseFlowMachine.events], ['start', 'tapPause', 'leaveApp', 'backSoon', 'cameraStops', 'keepFilming', 'imDone']);
  for (const s of STATES)
    P.PAUSE_FLOW_EVENTS.forEach((e, i) => {
      const want = EXPECTED[s][i] === '.' ? null : EXPECTED[s][i];
      assert.equal(P.pauseFlowMachine.transition(s, e), want, `${s} × ${e}`);
    });
});

await test('Caleb’s flow: while filming the one button is Pause; "I’m done" only once paused', () => {
  for (const s of STATES) {
    const press = P.pressAction(s);
    // What the button does is the table's own event from that state.
    if (press === 'pause') assert.equal(P.pauseFlowMachine.transition(s, 'tapPause'), 'paused', s);
    if (press === 'keepFilming') assert.equal(P.pauseFlowMachine.transition(s, 'keepFilming'), 'filming', s);
    // "I'm done" shows exactly where the table takes imDone.
    assert.equal(P.showsImDone(s), P.pauseFlowMachine.transition(s, 'imDone') !== null, `${s}: I'm done`);
  }
  assert.equal(P.pressAction('filming'), 'pause');
  assert.equal(P.showsImDone('filming'), false, 'no "I’m done" while filming');
  for (const s of ['paused', 'away', 'stopped']) assert.equal(P.pressAction(s), 'keepFilming', s);
  for (const s of ['idle', 'done']) assert.equal(P.pressAction(s), null, s);
});

await test('the state comes from filming.ts’s view: whose pause it is, or a camera that stopped', () => {
  for (const phase of ['idle', 'filming', 'paused', 'done'])
    for (const trouble of [false, true])
      for (const pausedBy of [null, 'her', 'away']) {
        const s = P.flowState({ phase, trouble, pausedBy });
        const want = phase !== 'paused' ? phase : trouble ? 'stopped' : pausedBy === 'her' ? 'paused' : 'away';
        assert.equal(s, want, `${phase} ${trouble} ${pausedBy}`);
      }
});

await test('back in the app: only a short trip away from filming films again by itself, never her own Pause', () => {
  for (const s of STATES)
    for (const ms of [500, C.AUTO_RESUME_MS - 1, C.AUTO_RESUME_MS + 1, 60_000])
      for (const bg of [false, true])
        assert.equal(P.resumesOnReturn(s, ms, bg), s === 'away' && C.resumesBySelf(ms, bg), `${s} ${ms} ${bg}`);
  assert.equal(P.resumesOnReturn('away', 1000, false), true);
  assert.equal(P.resumesOnReturn('paused', 1000, false), false, 'her Pause stays paused');
  assert.equal(P.resumesOnReturn('stopped', 1000, false), false);
});

await test('the words: while filming they say what a tap does, never a state; paused, Keep filming and why', () => {
  const en = W.recordWords('en');
  assert.deepEqual(P.flowLine('filming', en), { text: 'Tap to pause', en: 'Then you can move the camera' });
  assert.deepEqual(P.flowLine('paused', en), { text: 'Keep filming', en: 'Paused. Move the camera if you need to.' });
  assert.deepEqual(P.flowLine('away', en), { text: 'Keep filming', en: 'Recording stopped while you were away' });
  assert.deepEqual(P.flowLine('stopped', en), { text: 'Keep filming', en: 'The camera stopped. Your video so far is saved.' });
  assert.equal(P.flowLine('idle', en), null);
  assert.equal(P.flowLine('done', en), null);
  // A bare "Pause" reads as if it were paused (Caleb, Nov 12).
  assert.notEqual(P.flowLine('filming', en).text, 'Pause');
  assert.match(P.flowLine('filming', en).text, /^Tap to /);
  // Her language, both parts.
  const hi = W.recordWords('hi');
  assert.deepEqual(P.flowLine('filming', hi), { text: 'रोकने के लिए छुएँ', en: 'फिर आप कैमरा दूसरी जगह रख सकते हैं' });
  assert.deepEqual(P.flowLine('away', hi), { text: 'वीडियो बनाते रहें', en: 'आपके जाने पर रिकॉर्डिंग रुक गई' });
  // The pill on the camera card.
  assert.equal(P.pillLabel('filming', '4:07'), 'Recording · 4:07');
  assert.equal(P.pillLabel('paused', '4:07'), 'Paused · 4:07');
  assert.equal(P.pillLabel('away', '4:07'), 'Paused · 4:07');
  assert.equal(P.pillLabel('stopped', '4:07'), 'Stopped');
  assert.equal(P.pillLabel('idle', '0:00'), null);
  assert.equal(P.pillLabel('done', '4:07'), null);
});

// ---- the real Filming, on a fake camera ----

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function rig({ startFails = () => false } = {}) {
  const f = new Fm.Filming({ chunkMs: 60_000, readyWaitMs: 300, flipWaitMs: 60, endWaitMs: 120, settleMs: 30 });
  rigs.push(f);
  const log = [];
  const cam = {
    open: null,
    n: 0,
    startRecording(finished, failed) {
      if (startFails()) throw new Error('the camera is gone');
      if (cam.open) throw new Error('two files open at once');
      cam.open = { n: ++cam.n, finished, failed };
      log.push(`start ${cam.n}`);
    },
    async stopRecording() {
      const file = cam.open;
      if (!file || file.stopping) return;
      file.stopping = true;
      log.push(`stop ${file.n}`);
      setTimeout(() => {
        cam.open = null;
        file.finished({ path: `/tmp/${file.n}.mp4`, duration: 2, width: 1080, height: 1920 });
      }, 3);
    },
    keep: (path) => path,
  };
  f.connect(cam, {});
  let seen = '';
  const mount = () => {
    const v = f.snapshot();
    const now = `${v.facing}#${v.cameraKey}`;
    if (now === seen) return;
    seen = now;
    if (!startFails()) setTimeout(() => f.initialized(), 2);
  };
  f.subscribe(mount);
  mount();
  const state = () => P.flowState(f.snapshot());
  return { f, cam, log, state };
}

await test('Filming: pause → move the phone → keep filming → pause → I’m done: one file per part, all sent in order', async () => {
  const r = rig();
  assert.equal(r.state(), 'idle');
  assert.equal(await r.f.start(), true);
  assert.equal(r.state(), 'filming');
  await r.f.pause('her');
  assert.equal(r.state(), 'paused');
  assert.equal(r.cam.open, null, 'the file ended at the pause');
  assert.equal(await r.f.resume(), true);
  assert.equal(r.state(), 'filming');
  assert.equal(r.f.snapshot().pausedBy, null, 'filming again: nobody’s pause');
  await r.f.pause('her');
  assert.equal(r.state(), 'paused');
  const clips = await r.f.stop();
  assert.equal(r.state(), 'done');
  assert.deepEqual(r.log, ['start 1', 'stop 1', 'start 2', 'stop 2']);
  assert.deepEqual(clips.map((c) => c.asset.fileName), ['part-01.mp4', 'part-02.mp4'], 'both parts, in the order filmed');
});

await test('Filming: leaving the app is "away", which films again after a short trip; her Pause never does', async () => {
  const r = rig();
  await r.f.start();
  await r.f.pause('away');
  assert.equal(r.state(), 'away');
  assert.equal(P.resumesOnReturn(r.state(), 1000, false), true);
  await r.f.resume();
  assert.equal(r.state(), 'filming');
  await r.f.pause('her');
  assert.equal(P.resumesOnReturn(r.state(), 1000, false), false, 'her Pause, a short trip away: still paused');
  // A pause while paused changes nothing: still hers.
  await r.f.pause('away');
  assert.equal(r.state(), 'paused');
  await r.f.stop();
});

await test('Filming: Keep filming when the camera can’t start is "stopped", and it films again once it can', async () => {
  let gone = false;
  const r = rig({ startFails: () => gone });
  await r.f.start();
  await r.f.pause('her');
  gone = true;
  assert.equal(await r.f.resume(), false);
  assert.equal(r.state(), 'stopped');
  gone = false;
  r.f.initialized();
  await wait(5);
  assert.equal(await r.f.resume(), true);
  assert.equal(r.state(), 'filming');
  assert.equal(r.f.snapshot().trouble, false);
  const clips = await r.f.stop();
  assert.equal(clips.length, 2);
});

await test('the screen and the hook use the flow (wiring)', () => {
  const screen = src('src/app/recording.tsx');
  assert.match(screen, /const act = pressAction\(flow\);\n\s*if \(act === 'pause'\) return void cam\.pause\(\);\n\s*if \(act === 'keepFilming'\) return void cam\.resume\(\);/, 'the big button pauses while filming');
  assert.doesNotMatch(screen, /cam\.phase === 'filming'\) return void doneInApp/, 'the big button never ends the recording while filming');
  assert.match(screen, /\{showsImDone\(flow\) \? \(/, '"I’m done" only while paused');
  assert.equal((screen.match(/doneInApp\(\)/g) ?? []).length, 1, '"I’m done" is the one way to end filming in the app');
  assert.match(screen, /pause=\{flow === 'filming'\}/);
  const hook = src('src/components/record/useInAppCamera.ts');
  assert.match(hook, /void filming\.pause\('away'\);/, 'leaving the app is an away pause');
  assert.match(hook, /resumesOnReturn\(flowState\(filming\.snapshot\(\)\)/, 'back in the app: only an away pause films again');
  assert.doesNotMatch(hook, /resumesBySelf\(/, 'not the old check, which resumed any pause');
  assert.match(hook, /filming\.pause\('her'\)/);
});

await test('the job says it was filmed in the app, so the pipeline keeps the parts in order (Pipeline & recipes, #496)', () => {
  const cam = { source: 'camera' };
  const lib = { source: 'library' };
  // The rule, as sendDraft's own export (it imports React Native, so its source is checked here).
  const send = src('src/components/record/sendDraft.ts');
  assert.match(send, /export const filmedInApp = \(clips: \{ source: 'camera' \| 'library' \}\[\]\) => clips\.length > 0 && clips\.every\(\(c\) => c\.source === 'camera'\);/);
  const rule = (clips) => clips.length > 0 && clips.every((c) => c.source === 'camera');
  assert.equal(rule([cam, cam]), true);
  assert.equal(rule([cam, lib]), false, 'one camera-roll clip: its order is unknown');
  assert.equal(rule([]), false);
  assert.match(send, /job_fields: \{ glasses, .*, dishAskId, filmedInApp: filmedInApp\(clips\) \}/, 'kept on the row, for the home card’s retries');
  // Both tries that keep anything keep it: the order outlasts the details.
  assert.equal((send.match(/filmedInApp: inApp \|\| undefined/g) ?? []).length, 2);
  // A note resent after a crash: its own clips (a camera-roll copy or glasses: not filmed in the app).
  const clip = (copy) => ({ path: 'recordings/r/part-01.mp4', durationMs: 2000, width: 1080, height: 1920, startedAt: 1, ...(copy ? { copy: true } : {}) });
  assert.equal(U.noteFilmedInApp({ clips: [clip(false), clip(false)] }), true);
  assert.equal(U.noteFilmedInApp({ clips: [clip(false), clip(true)] }), false);
  assert.equal(U.noteFilmedInApp({ clips: [clip(false)], glasses: true }), false);
  assert.equal(U.noteFilmedInApp({ clips: [] }), false);
  assert.match(src('src/components/record/useResendUnsent.ts'), /makeJob\([^)]*filmedInApp: noteFilmedInApp\(u\) \}\)/);
  // AWS's POST /v1/jobs gets it; Convex's jobs.create (1.0) never does (it would refuse the field).
  const live = src('src/lib/live/convex.ts');
  assert.match(live, /awsJobs\.create\(\{ [^}]*filmedInApp \}, as\)/);
  assert.match(live, /present\(\{ \.\.\.extras, dishAskId: undefined, filmedInApp: undefined \}\)/);
});

console.log(`\n${passed} passed`);
