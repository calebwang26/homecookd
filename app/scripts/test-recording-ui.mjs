// Unit tests for the cook's recording and walkie-talkie screens (TS run by Node's type stripping):
//   src/components/record/words.ts           every line in English and Marathi (the stop button, "Just
//                                            answer out loud", the done screen, the errors), with their
//                                            small English, names filled in, English for other languages
//   src/components/record/recordingLogic.ts  the line under the button in each phase, when filming
//                                            starts by itself, the pot for the service's state, what
//                                            "not now" sends, homie's question with its English, half
//                                            duplex (silence while the phone talks), the wrap-up watchdog
//   src/components/record/walkieLogic.ts     when her spoken answer is over (a share ask's short yes
//                                            too), when nobody answered, how a question reads
//   src/lib/languages.ts                     the picker's list and search (Track F's API)
//   src/components/record/cameraLogic.ts     filming in the app: file names, the gap between two files,
//                                            the clock, when leaving stops the camera and coming back
//                                            films again by itself, the clip each file becomes
//   build-4 safety                           an EAS Update reaches TestFlight builds without VisionCamera
//                                            or expo-image-manipulator: recording.tsx's whole import graph
//                                            never imports either by value, and src/lib/live/camera.ts (the
//                                            only place that loads them) loads and answers null with their
//                                            native halves missing
//   node scripts/test-recording-ui.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A build without the new native modules (TestFlight build 4): react-native without CameraView, no
// ExpoImageManipulator, and the two packages throw if anything loads them.
const NATIVE_NEW = ['react-native-vision-camera', 'expo-image-manipulator'];
const js = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const FAKES = {
  'react-native': js("export const NativeModules = {}; export const Platform = { OS: 'ios' };"),
  'expo-constants': js("export default { executionEnvironment: 'standalone' }; export const ExecutionEnvironment = { StoreClient: 'storeClient' };"),
  'expo-modules-core': js('export const requireOptionalNativeModule = () => null;'),
  ...Object.fromEntries(NATIVE_NEW.map((p) => [p, js(`throw new Error('${p}: no native module in this build');`)])),
};

registerHooks({
  resolve(spec, ctx, next) {
    if (FAKES[spec]) return { url: FAKES[spec], shortCircuit: true };
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});

const W = await import(pathToFileURL(join(root, 'src/components/record/words.ts')).href);
const R = await import(pathToFileURL(join(root, 'src/components/record/recordingLogic.ts')).href);
const K = await import(pathToFileURL(join(root, 'src/components/record/walkieLogic.ts')).href);
const L = await import(pathToFileURL(join(root, 'src/lib/languages.ts')).href);
const C = await import(pathToFileURL(join(root, 'src/components/record/cameraLogic.ts')).href);

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

const DEVANAGARI = /[ऀ-ॿ]/;
const rmr = W.recordWords('mr');
const ren = W.recordWords('en');

test('every line has English and Marathi; Marathi is in Devanagari', () => {
  const table = W.recordWordTable();
  for (const [key, w] of Object.entries(table)) {
    assert.ok(w.en.trim(), `${key} en`);
    assert.ok(w.mr.trim(), `${key} mr`);
    assert.match(w.mr, DEVANAGARI, `${key} mr is Marathi`);
    for (const t of [w.en, w.mr]) for (const hole of t.match(/\{[a-z]+\}/g) ?? []) assert.equal(hole, '{kid}', `${key} ${hole}`);
  }
  assert.ok(Object.keys(table).length >= 20);
});

test('Caleb’s lines are the ones on screen', () => {
  // The stop button's label: her words big, "Tap when you're done" small, in every language.
  assert.deepEqual(rmr.line('stop'), { text: 'माझं झालं', en: 'Tap when you’re done' });
  assert.deepEqual(ren.line('stop'), { text: 'I’m done', en: 'Tap when you’re done' });
  assert.deepEqual(rmr.line('listening'), { text: 'बोला, मी ऐकतोय', en: 'Just answer out loud' });
  assert.deepEqual(ren.line('listening'), { text: 'Go ahead, I’m listening', en: 'Just answer out loud' });
  assert.equal(rmr.text('kidAsked', { kid: 'Shreya' }), 'Shreya ने विचारलं');
  assert.deepEqual(rmr.line('sentTo', { kid: 'Shreya' }), { text: 'Shreya ला पाठवलं', en: 'Sent to Shreya' });
  assert.equal(rmr.text('sayingHello'), 'homie नमस्कार करतोय');
});

test('the done screen says who it goes to', () => {
  assert.deepEqual(W.doneLine(rmr, { kid: 'Shreya', everyone: false, nobody: false }), { text: 'झालं! Shreya ला पाठवतोय', en: 'Done! Sending it to Shreya' });
  assert.deepEqual(W.doneLine(ren, { kid: 'Shreya', everyone: false, nobody: false }), { text: 'Done! Sending it to Shreya', en: null });
  assert.equal(W.doneLine(rmr, { kid: 'Shreya', everyone: true, nobody: false }).text, 'झालं! घरच्यांना पाठवतोय');
  assert.equal(W.doneLine(ren, { kid: ' ', everyone: false, nobody: false }).text, 'Done! Sending it to your family');
  assert.equal(W.doneLine(ren, { kid: null, everyone: false, nobody: true }).text, 'Done! Saving it to your recipes');
});

// The 12 languages added Oct 24 (wordsByLanguage.ts), each with the script it's written in.
const SCRIPTS = {
  hi: /\p{Script=Devanagari}/u, gu: /\p{Script=Gujarati}/u, ta: /\p{Script=Tamil}/u, te: /\p{Script=Telugu}/u,
  pa: /\p{Script=Gurmukhi}/u, ur: /\p{Script=Arabic}/u, zh: /\p{Script=Han}/u, ko: /\p{Script=Hangul}/u,
  ar: /\p{Script=Arabic}/u, tl: /[a-z]/, es: /[a-z]/, pt: /[a-z]/,
};

test('every line in each of the 12 other languages, in its script, with {kid} where the kid goes', () => {
  const keys = Object.keys(W.recordWordTable());
  for (const [code, script] of Object.entries(SCRIPTS)) {
    const w = W.recordWords(code);
    for (const key of keys) {
      const line = w.line(key, { kid: 'Shreya' });
      assert.match(line.text, script, `${code} ${key}`);
      assert.doesNotMatch(line.text, /\{|\}/, `${code} ${key}: every hole filled`);
      const en = W.recordWords('en').line(key, { kid: 'Shreya' }).text;
      assert.notEqual(line.text, en, `${code} ${key} is translated`);
      if (en.includes('Shreya')) assert.ok(line.text.includes('Shreya'), `${code} ${key} names the kid`);
      for (const brand of ['homie', 'homecookd']) if (en.includes(brand)) assert.ok(line.text.includes(brand), `${code} ${key} keeps ${brand}`);
    }
    assert.equal(w.line('stop').en, 'Tap when you’re done', `${code}: the hint stays English`);
    assert.equal(w.line('sentTo', { kid: 'Shreya' }).en, 'Sent to Shreya', `${code}: the English under it`);
    assert.ok(!w.text('sentTo').includes('your family'), `${code}: no kid named → her word for family`);
  }
  assert.equal(W.recordWords('gu').text('sentTo', { kid: 'Shreya' }), 'Shreya ને મોકલ્યું', 'a space after a Latin name, as in Marathi');
  assert.deepEqual(W.recordWords('vi').line('stop'), { text: 'I’m done', en: 'Tap when you’re done' }, 'no words yet: English');
});

test('errors are in her language too, with the English under them', () => {
  for (const key of ['lostConnection', 'signedOut', 'ended', 'elsewhere', 'micOff', 'noMicHere', 'couldntSend']) {
    const l = rmr.line(key);
    assert.match(l.text, DEVANAGARI, key);
    assert.ok(l.en && !DEVANAGARI.test(l.en), key);
    assert.equal(ren.line(key).en, null, `${key}: English once`);
  }
});

test('names are filled in; no name reads "your family"', () => {
  assert.equal(ren.text('sentTo', { kid: '' }), 'Sent to your family');
  assert.equal(rmr.text('sentTo', { kid: ' ' }), 'घरच्यां ला पाठवलं');
  assert.equal(ren.text('kidAsked', { kid: 'Shreya' }), 'Shreya asked');
});

test('English, and languages these screens aren’t written in, read English', () => {
  assert.deepEqual(ren.line('wrappingUp'), { text: 'Almost done', en: null });
  assert.deepEqual(W.recordWords('fr').line('tryAgain'), { text: 'Try again', en: null });
  assert.deepEqual(W.recordWords('fr').line('leave'), { text: 'Leave', en: null });
  assert.deepEqual(W.recordWords(undefined).line('stop'), { text: 'I’m done', en: 'Tap when you’re done' });
  assert.equal(W.recordWords('MR').line('leave').text, 'बाहेर पडा');
});

test('the line under the button in each phase; it is the stop button only while filming', () => {
  assert.deepEqual(R.recordingView('connecting', rmr), { line: { text: 'homie तयार होतोय', en: 'homie is getting ready' }, live: false });
  assert.deepEqual(R.recordingView('intro', rmr), { line: { text: 'homie नमस्कार करतोय', en: 'homie is saying hello' }, live: false });
  assert.deepEqual(R.recordingView('recording', rmr), { line: { text: 'माझं झालं', en: 'Tap when you’re done' }, live: true });
  assert.deepEqual(R.recordingView('wrapping_up', rmr), { line: { text: 'जवळजवळ झालं', en: 'Almost done' }, live: false });
  assert.equal(R.recordingView('ended', rmr).live, false);
  assert.equal(R.recordingView('recording', ren).line.text, 'I’m done');
});

test('filming starts by itself once the hello has been said and has played', () => {
  const s = { phase: 'intro', introDone: true, aiSpeaking: false, error: false };
  assert.equal(R.shouldAutoStart(s), true);
  assert.equal(R.shouldAutoStart({ ...s, introDone: false }), false, 'hello not said yet');
  assert.equal(R.shouldAutoStart({ ...s, aiSpeaking: true }), false, 'still playing: starting would cut it off');
  assert.equal(R.shouldAutoStart({ ...s, error: true }), false, 'no homie');
  assert.equal(R.shouldAutoStart({ ...s, phase: 'connecting' }), false);
  assert.equal(R.shouldAutoStart({ ...s, phase: 'recording' }), false, 'already filming');
});

test('the pot follows the service; speaking comes from the say itself', () => {
  assert.equal(R.potFor('listening', true), 'listening');
  assert.equal(R.potFor('quiet', true), 'listening');
  assert.equal(R.potFor('quiet', false), 'off');
  assert.equal(R.potFor('thinking', false), 'thinking');
  assert.equal(R.potFor('speaking', true), null);
});

test('"not now": a live question is dropped; an end question hears the words', () => {
  assert.deepEqual(R.notNowMessage('amount'), { type: 'not_now' });
  assert.deepEqual(R.notNowMessage('story'), { type: 'not_now' });
  assert.deepEqual(R.notNowMessage('end'), { type: 'text', text: 'not now' });
  assert.deepEqual(R.notNowMessage('optin'), { type: 'text', text: 'not now' });
});

test('homie’s question: her words, the English under them once', () => {
  assert.deepEqual(R.askLine({ text: 'आलं साधारण किती घातलं?', textEn: 'About how much ginger was that?' }), { text: 'आलं साधारण किती घातलं?', en: 'About how much ginger was that?' });
  assert.deepEqual(R.askLine({ text: 'How much ginger?', textEn: 'How much ginger?' }), { text: 'How much ginger?', en: null });
  assert.deepEqual(R.askLine({ text: 'How much ginger?', textEn: '' }), { text: 'How much ginger?', en: null });
});

test('half duplex: silence while homie is lit or speaking, or anything plays on the phone', () => {
  const idle = { key: null, phase: 'idle' };
  assert.equal(R.micQuiet('listening', idle), false);
  assert.equal(R.micQuiet('off', idle), false);
  assert.equal(R.micQuiet('lit', idle), true, 'the beat before homie speaks');
  assert.equal(R.micQuiet('speaking', idle), true);
  assert.equal(R.micQuiet('listening', { key: 'say:3', phase: 'loading' }), true, 'a say on its way');
  assert.equal(R.micQuiet('listening', { key: 'say:3', phase: 'playing' }), true);
  assert.equal(R.micQuiet('listening', { key: 'clip:abc', phase: 'playing' }), true, 'a clip');
  assert.equal(R.micQuiet('listening', { key: 'say:3', phase: 'ended' }), false);
  assert.equal(R.micQuiet('listening', { key: 'say:3', phase: 'paused' }), false);
});

test('half duplex: the silence is zeros the size of the mic chunk', () => {
  const z = R.silence(3200);
  assert.equal(z.byteLength, 3200);
  assert.ok(new Int16Array(z).every((v) => v === 0));
  assert.equal(R.silence(3200), z, 'reused, not made for every chunk');
  assert.equal(R.silence(320).byteLength, 320);
});

test('the wrap-up watchdog: 2 min of nothing, 20 s once there is trouble', () => {
  assert.equal(R.wrapStallMs(false), 120_000);
  assert.equal(R.wrapStallMs(true), 20_000);
  assert.ok(R.WRAP_TROUBLE_MS < R.WRAP_STALL_MS);
});

// The walkie-talkie listens at ~10 readings a second.
function run(levels, stepMs = 100, kind) {
  let l = K.startListening(0, kind);
  let t = 0;
  for (const level of levels) {
    t += stepMs;
    l = K.hear(l, level, t);
    const v = K.verdict(l, t);
    if (v !== 'listening') return { v, t };
  }
  return { v: 'listening', t };
}
const loud = (ms) => Array(ms / 100).fill(0.8);
const quiet = (ms) => Array(ms / 100).fill(0.1);

test('walkie: about 2 s of quiet after at least a second of talking sends her answer', () => {
  const r = run([...quiet(1500), ...loud(3000), ...quiet(3000)]);
  assert.equal(r.v, 'send');
  assert.equal(r.t, 1500 + 3000 + K.END_SILENCE_MS);
  // A short pause mid-answer doesn't end it.
  assert.equal(run([...loud(1500), ...quiet(1500), ...loud(1000), ...quiet(1000)]).v, 'listening');
});

test('walkie: a cough is not an answer; 15 s of nothing is no answer', () => {
  const r = run([...loud(500), ...quiet(20_000)]);
  assert.equal(r.v, 'no_answer');
  assert.equal(r.t, K.NO_ANSWER_MS);
  assert.equal(run(quiet(14_900)).v, 'listening');
});

test('walkie: never cut off mid-word at 15 s', () => {
  // She starts at 14.5 s: not "no answer" while she talks; her answer sends after it.
  const r = run([...quiet(14_500), ...loud(2000), ...quiet(3000)]);
  assert.equal(r.v, 'send');
  assert.equal(r.t, 14_500 + 2000 + K.END_SILENCE_MS);
});

test('walkie: a stalled meter counts at most 300 ms a reading', () => {
  let l = K.startListening(0);
  l = K.hear(l, 0.9, 5000);
  assert.equal(l.speechMs, 300);
  assert.equal(K.verdict(l, 5000), 'listening');
});

test('walkie: no answer asks once more, then closes', () => {
  assert.equal(K.afterNoAnswer(1), 'ask_again');
  assert.equal(K.afterNoAnswer(K.ASKS), 'close');
});

test('walkie: a share ask takes a short yes or no; a cooking question still needs a sentence', () => {
  // "हो" (yes): about 0.4 s of voice.
  const yes = [...quiet(1000), ...loud(400), ...quiet(3000)];
  const r = run(yes, 100, 'share');
  assert.equal(r.v, 'send');
  assert.equal(r.t, 1000 + 400 + K.END_SILENCE_MS);
  assert.equal(run(yes, 100, undefined).v, 'listening', 'a kid question: a short sound is not the answer yet');
  assert.equal(run(yes, 100, 'something-new').v, 'listening', 'an unknown kind reads as a plain question');
  assert.equal(K.startListening(0, 'share').minSpeechMs, K.MIN_YES_NO_MS);
  assert.equal(K.startListening(0).minSpeechMs, K.MIN_SPEECH_MS);
  // Nothing at all is still no answer.
  assert.equal(run(quiet(20_000), 100, 'share').v, 'no_answer');
});

test('a question reads in her language first, the kid’s English small (marked translated)', () => {
  assert.deepEqual(K.questionLines({ text: 'How much ginger?', textForCook: 'आलं किती?' }), { main: 'आलं किती?', en: 'How much ginger?' });
  assert.deepEqual(K.questionLines({ text: 'How much ginger?' }), { main: 'How much ginger?', en: null });
  assert.deepEqual(K.questionLines({ text: 'How much ginger?', textForCook: '  ' }), { main: 'How much ginger?', en: null }, 'an empty translation');
  // What homie said when it translated it itself, until Track F's arrives.
  assert.deepEqual(K.questionLines({ text: 'How much ginger?' }, 'आलं किती घालायचं?'), { main: 'आलं किती घालायचं?', en: 'How much ginger?' });
  assert.deepEqual(K.questionLines({ text: 'How much ginger?', textForCook: 'आलं किती?' }, 'other'), { main: 'आलं किती?', en: 'How much ginger?' }, 'Track F’s wins');
  // A share ask (convex/shareRequests.ts) reads the same way.
  const share = { kind: 'share', text: 'Shreya wants to put your Poha on the map for neighbors. Is that okay?', textForCook: 'श्रेयाला तुमचे पोहे नकाशावर ठेवायचे आहेत. चालेल का?' };
  assert.equal(K.questionLines(share).main, share.textForCook);
  assert.equal(K.questionLines(share).en, share.text);
});

test('a long question (a share ask) gets smaller type and a smaller homie, so it fits the phone', () => {
  assert.deepEqual(K.questionFit('आलं किती घालायचं?'), { font: 36, homie: 200, compact: false });
  assert.equal(K.questionFit('x'.repeat(100)).font, 30);
  const share = K.questionFit('Shreya wants to put your Kanda Poha on the map for neighbors. They’d see the recipe and one line you said, never your video. Is that okay?');
  assert.deepEqual(share, { font: 24, homie: 150, compact: true });
});

test('languages: English first; "mar" and "मरा" find Marathi', () => {
  assert.equal(L.LANGUAGES[0].code, 'en');
  assert.equal(L.matchLanguages('')[0].code, 'en');
  assert.equal(L.matchLanguages('mar')[0].code, 'mr');
  assert.ok(L.matchLanguages('मरा').some((l) => l.code === 'mr'));
  assert.deepEqual(L.matchLanguages('zzzz'), []);
  assert.equal(L.languageName('mr'), 'Marathi');
  assert.equal(L.languageName(undefined), 'English');
  const marathi = L.LANGUAGES.find((l) => l.code === 'mr');
  assert.equal(marathi.native, 'मराठी');
});

test('in-app camera: 5-minute files named in order, and the wall time between them that the video skips', () => {
  assert.equal(C.CHUNK_MS, 300_000);
  assert.equal(C.chunkName(1), 'part-01.mp4');
  assert.equal(C.chunkName(12), 'part-12.mp4');
  // Names sort in filming order (the worker downloads in name order; prep.py orders by file time).
  assert.deepEqual([C.chunkName(10), C.chunkName(2)].sort(), ['part-02.mp4', 'part-10.mp4']);
  assert.equal(C.gapS(undefined, 5000), 0, 'the first file has no gap');
  const prev = { startedAt: 1_000_000, durationMs: 300_000 };
  assert.equal(C.gapS(prev, 1_300_400), 0.4, 'a roll-over: under a second');
  assert.equal(C.gapS(prev, 1_420_000), 120, 'a phone call: two minutes');
  assert.equal(C.gapS(prev, 1_200_000), 0, 'never negative');
});

test('in-app camera: what has been filmed, and the clock on the card', () => {
  assert.equal(C.filmedMs([{ durationMs: 300_000 }, { durationMs: 1000 }], null, 0), 301_000);
  assert.equal(C.filmedMs([{ durationMs: 300_000 }], 10_000, 12_500), 302_500);
  assert.equal(C.clockLabel(0), '0:00');
  assert.equal(C.clockLabel(247_000), '4:07');
  assert.equal(C.clockLabel(3_753_000), '1:02:33');
});

test('in-app camera: leaving the app stops the file; a short trip films again by itself, a real one waits for her', () => {
  assert.equal(C.stopsFilming('active'), false);
  assert.equal(C.stopsFilming('inactive'), true, 'Control Center, a call screen, the lock: before iOS takes the camera');
  assert.equal(C.stopsFilming('background'), true);
  assert.equal(C.resumesBySelf(2000, false), true, 'pulled down Control Center');
  assert.equal(C.resumesBySelf(2000, true), false, 'went to the home screen');
  assert.equal(C.resumesBySelf(60_000, false), false, 'a long call');
});

test('in-app camera: each file becomes a selected camera clip for the Send path', () => {
  const clip = C.chunkClip({ uri: 'file:///doc/recordings/r1/part-02.mp4', startedAt: Date.parse('2026-10-25T17:05:00Z'), durationMs: 300_000, width: 1080, height: 1920 }, 2);
  assert.equal(clip.source, 'camera');
  assert.equal(clip.selected, true);
  assert.equal(clip.recordedAt, '2026-10-25T17:05:00.000Z');
  assert.deepEqual(clip.asset, { uri: 'file:///doc/recordings/r1/part-02.mp4', width: 1080, height: 1920, type: 'video', duration: 300_000, fileName: 'part-02.mp4', mimeType: 'video/mp4' });
});

test('build-4 safety: recording.tsx never imports VisionCamera or the image manipulator by value', () => {
  // Every app/src file recording.tsx reaches through its imports (relative and @/ paths).
  const file = (base) => ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((x) => base + x).find((f) => existsSync(f) && /\.tsx?$/.test(f));
  const seen = new Set();
  const offenders = [];
  const stack = [join(root, 'src/app/recording.tsx')];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const [, typeOnly, spec] = m;
      const local = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') ? join(dirname(f), spec) : null;
      if (local) {
        const next = file(local);
        if (next && !typeOnly) stack.push(next);
      } else if (!typeOnly && NATIVE_NEW.some((p) => spec === p || spec.startsWith(`${p}/`))) offenders.push(`${f.slice(root.length + 1)} imports ${spec}`);
    }
    // A require() of either is only allowed in lib/live/camera.ts, behind its native-module checks.
    if (!f.endsWith('src/lib/live/camera.ts')) for (const p of NATIVE_NEW) if (src.includes(`require('${p}')`)) offenders.push(`${f.slice(root.length + 1)} requires ${p}`);
  }
  assert.ok(seen.size > 30, `walked ${seen.size} files`);
  assert.ok(seen.has(join(root, 'src/components/record/useInAppCamera.ts')), 'the camera hook is in the graph');
  assert.deepEqual(offenders, []);
});

// Loaded here, not inside test(): an import that throws must fail the run.
const camera = await import(pathToFileURL(join(root, 'src/lib/live/camera.ts')).href);
test('build-4 safety: lib/live/camera.ts loads without the native modules, and both are null', () => {
  assert.equal(camera.visionCamera(), null);
  assert.equal(camera.inAppCameraSupported(), false);
  assert.equal(camera.imageManipulator(), null);
});

console.log(`\n${passed} passed`);
