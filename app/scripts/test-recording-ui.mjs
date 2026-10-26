// Unit tests for the cook's recording and walkie-talkie screens (TS run by Node's type stripping):
//   src/components/record/words.ts           every line in English and Marathi (the stop button, "Just
//                                            answer out loud", the done screen, the errors), with their
//                                            small English, names filled in, English for other languages
//   src/components/record/recordingLogic.ts  the line under the button in each phase, when filming
//                                            starts by itself, the pot for the service's state, what
//                                            "not now" sends, homie's question with its English, homie
//                                            held in the middle across the wrap-up's questions (the
//                                            service's hold; none = as before), half duplex (silence
//                                            while the phone talks), the wrap-up watchdog
//   src/components/record/walkieLogic.ts     when her spoken answer is over (a share ask's short yes
//                                            too), when nobody answered, how a question reads
//   src/lib/languages.ts                     the picker's list and search (Track F's API)
//   src/components/record/cameraLogic.ts     filming in the app: file names, the gap between two files,
//                                            the clock, when leaving stops the camera and coming back
//                                            films again by itself, the clip each file becomes, the
//                                            flip (a file boundary while filming; where its button goes);
//                                            every upload task checks its file is there first (the Oct 24
//                                            crash)
//   src/lib/unsentLogic.ts                   a recording the app died before fully sending: where its
//                                            videos are, what a launch does with it (wait, make the job,
//                                            stop and send again, done, give up); one it died in while
//                                            she was still filming (the note each saved file updates,
//                                            never sent by itself, Home's card for her alone, Send it /
//                                            Delete); a Send-screen send of camera-roll videos (copied
//                                            out of the cache, its own note id, found by its upload)
//   build-4 safety                           an EAS Update reaches TestFlight builds without VisionCamera
//                                            or expo-image-manipulator: recording.tsx's whole import graph
//                                            never imports either by value, and src/lib/live/camera.ts (the
//                                            only place that loads them) loads and answers null with their
//                                            native halves missing
//   node scripts/test-recording-ui.mjs
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
const U = await import(pathToFileURL(join(root, 'src/lib/unsentLogic.ts')).href);
const Fm = await import(pathToFileURL(join(root, 'src/components/record/filming.ts')).href);

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

// homie held in the middle across the wrap-up's questions (Caleb, Oct 25: "homie should STAY in center
// expanded view until all questions are finished, then snap back to small corner").
const askOf = (promptId, kind = 'end', text = `q ${promptId}`) => ({ promptId, text, textEn: `${text} (en)`, kind });
const lineOf = (id, text) => ({ id, text, textEn: `${text} (en)` });

test('moment: with no hold (an older service, or filming) it is up exactly while a question is', () => {
  const none = { ask: null, hold: false, said: null, ended: false };
  assert.deepEqual(R.momentView(none), { open: false, words: null, asking: false });
  const v = R.momentView({ ...none, ask: askOf('p1', 'amount', 'आलं किती?') });
  assert.equal(v.open, true);
  assert.equal(v.asking, true);
  assert.deepEqual(v.words, { key: 'ask:p1', line: { text: 'आलं किती?', en: 'आलं किती? (en)' } });
  assert.notEqual(R.momentView({ ...none, ask: askOf('p2') }).words.key, v.words.key, 'a new question is a new key: it crossfades');
  assert.equal(R.momentView({ ...none, said: lineOf(1, 'Before we send it') }).open, false, 'a line with no hold shows nothing');
});

test('moment: held with no question up, homie stays big with no stale question; a tap closes nothing', () => {
  const held = { ask: null, hold: true, said: null, ended: false };
  assert.deepEqual(R.momentView(held), { open: true, words: null, asking: false }, 'between two questions');
  const said = R.momentView({ ...held, said: lineOf(7, 'पाठवण्याआधी दोन छोटे प्रश्न.') });
  assert.deepEqual(said, { open: true, words: { key: 'said:7', line: { text: 'पाठवण्याआधी दोन छोटे प्रश्न.', en: 'पाठवण्याआधी दोन छोटे प्रश्न. (en)' } }, asking: false });
  assert.equal(R.momentView({ ...held, said: { id: 8, text: 'Okay.', textEn: 'Okay.' } }).words.line.en, null, 'English once');
  const q = R.momentView({ ...held, said: lineOf(7, 'count'), ask: askOf('p3') });
  assert.equal(q.words.key, 'ask:p3', 'a question up wins over homie’s line');
  assert.equal(q.asking, true);
});

test('moment: the plate photo has its own view, and the end closes it, held or not', () => {
  assert.equal(R.momentView({ ask: askOf('plate', 'plate'), hold: false, said: null, ended: false }).open, false);
  assert.equal(R.momentView({ ask: askOf('plate', 'plate'), hold: true, said: null, ended: false }).open, false, 'a plate ask under a hold that never went off');
  assert.equal(R.momentView({ ask: askOf('p4'), hold: true, said: lineOf(1, 'x'), ended: true }).open, false);
  assert.equal(R.momentView({ ask: null, hold: true, said: null, ended: true }).open, false);
});

test('moment: a stalled wrap-up (the app ends it without homie) is never held, so the × can show', () => {
  const held = { ask: null, hold: true, said: lineOf(1, 'count'), ended: false };
  assert.equal(R.momentView({ ...held, stalled: true }).open, false, 'a half-open socket that never sends hold off');
  assert.equal(R.momentView({ ...held, stalled: false }).open, true);
  const q = R.momentView({ ...held, ask: askOf('p5'), stalled: true });
  assert.equal(q.open, true, 'a question still up stays');
  assert.equal(q.asking, true, 'and a tap closes it');
});

test('moment: on a short phone a long question lifts homie just enough, never past the top', () => {
  // iPhone SE (375 x 667, insets 20 / 0): homie's bottom at 42% (280), the words 48 below it.
  const se = (wordsH) => R.liftToFit({ wordsTop: 280.14 + 48, wordsH, bottom: 667 - 0 - 16, homieTop: 280.14 - 176 - 18, topLimit: 20 + 8 });
  assert.equal(se(300), 0, 'a short question fits where homie is');
  assert.ok(Math.abs(se(360) - 37.14) < 0.01, 'a long one: up by what it reaches past the bottom');
  assert.ok(Math.abs(se(500) - 58.14) < 0.01, 'longer still: up until homie (and its sun ring) is 8 below the top inset');
  // iPhone 15 (390 x 844, insets 59 / 34): the same long question fits with homie where it is.
  assert.equal(R.liftToFit({ wordsTop: 354.48 + 48, wordsH: 380, bottom: 844 - 34 - 16, homieTop: 354.48 - 194, topLimit: 67 }), 0);
  assert.equal(R.liftToFit({ wordsTop: 100, wordsH: 50, bottom: 400, homieTop: 10, topLimit: 30 }), 0, 'never down');
});

test('hold: a reconnect mid-run (ready resets it, the hold comes again right after the phase)', () => {
  let s = R.heldAfter(R.NOT_HELD, { type: 'hold', on: true });
  s = R.heldAfter(s, { type: 'reset' }); // ready, or the close before it (4409 included)
  assert.deepEqual(s, R.NOT_HELD);
  s = R.heldAfter(s, { type: 'hold', on: true });
  assert.equal(R.momentView({ ask: null, hold: s.hold, said: s.said, ended: false }).open, true);
});

test('hold: what the hook keeps from the service’s messages', () => {
  let s = R.NOT_HELD;
  s = R.heldAfter(s, { type: 'say', line: lineOf(1, 'nice, the onions'), askUp: false });
  assert.deepEqual(s, R.NOT_HELD, 'a reaction while filming is never kept for later');
  s = R.heldAfter(s, { type: 'hold', on: true });
  assert.deepEqual(s, { hold: true, said: null });
  s = R.heldAfter(s, { type: 'say', line: lineOf(2, 'count'), askUp: false });
  assert.equal(s.said.id, 2, 'the count line shows');
  assert.equal(R.heldAfter(s, { type: 'hold', on: true }), s, 'a second hold on keeps the line');
  s = R.heldAfter(s, { type: 'ask', kind: 'end' });
  assert.deepEqual(s, { hold: true, said: null }, 'a question clears it: never back once answered');
  assert.equal(R.heldAfter(s, { type: 'say', line: lineOf(3, 'the question'), askUp: true }), s, 'the question’s own line');
  assert.equal(R.heldAfter(s, { type: 'say', line: lineOf(4, 'still there?'), askUp: true }), s, 'a nudge under the question');
  s = R.heldAfter(s, { type: 'say', line: lineOf(5, 'no need to answer today'), askUp: false });
  assert.equal(s.said.id, 5, 'the let-off, after the drop');
  assert.deepEqual(R.heldAfter(s, { type: 'hold', on: false }), R.NOT_HELD);
  assert.deepEqual(R.heldAfter(s, { type: 'reset' }), R.NOT_HELD, 'a new or lost socket, a pause, the end');
  assert.deepEqual(R.heldAfter(R.NOT_HELD, { type: 'hold', on: false }), R.NOT_HELD);
  assert.deepEqual(R.heldAfter({ hold: true, said: lineOf(6, 'x') }, { type: 'ask', kind: 'plate' }), R.NOT_HELD, 'the plate photo ends the run, even with no hold off');
});

// The wrap-up as the service sends it, message by message; `open` after each one.
function runWrapUp(events) {
  let held = R.NOT_HELD;
  let ask = null;
  let ended = false;
  let n = 0;
  return events.map((e) => {
    if (e.hold !== undefined) held = R.heldAfter(held, { type: 'hold', on: e.hold });
    if (e.ask) {
      ask = e.ask;
      held = R.heldAfter(held, { type: 'ask', kind: e.ask.kind });
    }
    if (e.gone) ask = null; // drop / answered
    if (e.say) held = R.heldAfter(held, { type: 'say', line: lineOf(++n, e.say), askUp: !!ask });
    if (e.ended) {
      ended = true;
      held = R.heldAfter(held, { type: 'reset' });
    }
    const v = R.momentView({ ask, hold: held.hold, said: held.said, ended });
    return { at: e.at, open: v.open, words: v.words?.line.text ?? null, asking: v.asking };
  });
}
// The order the voice service sends (Oct 25): "I'm done" with a live card up → phase wrapping_up, say_end,
// hold on, then the live card's drop; homie thinks (~3 s while Claude writes the questions), the count line…
const WRAP = (hold) => [
  { at: 'a live question up', ask: askOf('live', 'amount', 'How much ginger?') },
  { at: '"I’m done": phase wrapping_up' },
  ...(hold ? [{ at: 'hold on', hold: true }] : []),
  { at: 'drop the live question', gone: true },
  { at: 'homie writes the questions (thinking)' },
  { at: 'count line', say: 'Before we send it: two quick questions and a photo of your plate.' },
  { at: 'question 1', ask: askOf('e1', 'end', 'What must Shreya never skip?') },
  { at: 'question 1 said', say: 'What must Shreya never skip?' },
  { at: 'still there?', say: 'Still there? Take your time.' },
  { at: 'answered 1', gone: true },
  { at: 'question 2', ask: askOf('e2', 'end', 'How do you know it’s ready?') },
  { at: 'not now', gone: true },
  { at: 'opt-in', ask: askOf('o', 'optin', 'Can Shreya hear your stories too?') },
  { at: 'answered opt-in', gone: true },
  ...(hold ? [{ at: 'hold off', hold: false }] : []),
  { at: 'plate photo', ask: askOf('pl', 'plate', 'Hold the plate up') },
  { at: 'photo taken', gone: true },
  { at: 'goodbye', say: 'That’s a wrap.' },
  { at: 'ended', ended: true },
];

test('wrap-up with hold: from the live card at "I’m done" to the last answer homie never leaves the middle', () => {
  const steps = runWrapUp(WRAP(true));
  const to = steps.findIndex((s) => s.at === 'hold off');
  for (const s of steps.slice(0, to)) assert.equal(s.open, true, `still up at "${s.at}"`);
  for (const s of steps.slice(to)) assert.equal(s.open, false, `back in the corner at "${s.at}" (the plate has its own view)`);
  const at = (name) => steps.find((s) => s.at === name);
  assert.equal(at('hold on').words, 'How much ginger?', 'the hold comes before the drop: the live card is still up');
  assert.deepEqual(at('drop the live question'), { at: 'drop the live question', open: true, words: null, asking: false }, 'its words fade out, homie stays');
  assert.deepEqual(at('homie writes the questions (thinking)'), { at: 'homie writes the questions (thinking)', open: true, words: null, asking: false }, 'centred, thinking, no words');
  assert.equal(at('count line').words, 'Before we send it: two quick questions and a photo of your plate.');
  assert.equal(at('count line').asking, false, 'no "Just answer out loud" for the count line');
  assert.equal(at('still there?').words, 'What must Shreya never skip?', 'the nudge leaves the question up');
  assert.equal(at('answered 1').words, null, 'the answered question fades out; nothing stale under homie');
  assert.equal(at('answered 1').asking, false);
  assert.equal(at('question 2').words, 'How do you know it’s ready?');
});

test('wrap-up with no hold (an older service): each question opens and closes on its own, as before', () => {
  const steps = runWrapUp(WRAP(false));
  const opened = steps.filter((s) => s.open).map((s) => s.at);
  assert.deepEqual(opened, ['a live question up', '"I’m done": phase wrapping_up', 'question 1', 'question 1 said', 'still there?', 'question 2', 'opt-in']);
  assert.equal(steps.find((s) => s.at === 'drop the live question').open, false, 'the live card closes at "I’m done", as today');
  assert.ok(steps.every((s) => !s.open || s.asking), 'never up without a question');
});

test('wrap-up whose hold off never came: the plate photo still ends the hold, and nothing holds homie after it', () => {
  const steps = runWrapUp(WRAP(true).filter((e) => e.at !== 'hold off'));
  const at = (name) => steps.find((s) => s.at === name);
  assert.equal(at('answered opt-in').open, true, 'still held after the last answer');
  assert.equal(at('plate photo').open, false);
  assert.equal(at('photo taken').open, false, 'not back in the middle after the photo');
  assert.equal(at('goodbye').open, false, 'the goodbye in the corner');
});

test('wrap-up let-off: the let-off line shows while held, then homie goes back for the plate', () => {
  const steps = runWrapUp([
    { at: 'hold on', hold: true },
    { at: 'question 1', ask: askOf('e1') },
    { at: 'still there?', say: 'Still there? Take your time.' },
    { at: 'drop', gone: true },
    { at: 'let-off', say: 'That’s okay. No need to answer today.' },
    { at: 'hold off', hold: false },
  ]);
  assert.deepEqual(
    steps.map((s) => [s.at, s.open, s.words]),
    [
      ['hold on', true, null],
      ['question 1', true, 'q e1'],
      ['still there?', true, 'q e1'],
      ['drop', true, null],
      ['let-off', true, 'That’s okay. No need to answer today.'],
      ['hold off', false, null],
    ],
  );
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

// iOS closes the app on an upload task for a file that isn't there (an Objective-C exception no JS can
// catch), so every upload task in the app is preceded by a check that throws when the file is missing.
test('every upload task first checks its file is on the phone (signer videos, plate photo, voice notes, photos)', () => {
  const missing = [];
  let tasks = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const f = join(dir, name);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.tsx?$/.test(f)) {
        const lines = readFileSync(f, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!line.includes('.createUploadTask(')) return;
          tasks += 1;
          const before = lines.slice(Math.max(0, i - 14), i).join('\n');
          if (!/if \(!\s*(fileOnPhone\(|new File\([^)]*\)\.exists|[\w.]+\.exists\b)/.test(before)) missing.push(`${f.slice(root.length + 1)}:${i + 1}`);
        });
      }
    }
  };
  walk(join(root, 'src'));
  assert.ok(tasks >= 4, `found ${tasks} upload tasks`);
  assert.deepEqual(missing, [], 'an upload task with no "is the file there?" check before it');
  const uploads = readFileSync(join(root, 'src/lib/uploads.ts'), 'utf8');
  assert.match(uploads, /if \(input\.assets\.some\(\(a\) => !fileOnPhone\(a\.uri\)\)\) throw new Error\(MISSING_VIDEO\);/, 'before the signer is even asked');
});

test('unsent recordings: a video\'s place inside documents/ survives the app folder moving', () => {
  const docs = 'file:///var/mobile/Containers/Data/Application/AAAA/Documents/';
  assert.equal(U.docPath(`${docs}recordings/r1/part-01.mp4`, docs), 'recordings/r1/part-01.mp4');
  assert.equal(U.docPath(`${docs}recordings/r1/part-01.mp4`, docs.slice(0, -1)), 'recordings/r1/part-01.mp4', 'with or without the slash');
  // Left in tmp (the move failed): kept as is.
  const tmp = 'file:///private/var/mobile/Containers/Data/Application/AAAA/tmp/ABC.mp4';
  assert.equal(U.docPath(tmp, docs), tmp);
  assert.equal(U.isFullUri(tmp), true);
  assert.equal(U.isFullUri('recordings/r1/part-01.mp4'), false);
});

const NOW = Date.parse('2026-10-24T19:30:00Z');
const note = (id, extra = {}) => ({
  recordingId: id,
  familyId: 'fam-1',
  cookId: 'cook-1',
  clips: [{ path: `recordings/${id}/part-01.mp4`, durationMs: 3000, width: 1080, height: 1920, startedAt: 1 }],
  dish: null,
  language: 'en',
  forKids: null,
  everyone: true,
  requestFrom: null,
  savedAt: '2026-10-24T19:20:00Z',
  jobId: null,
  resends: 0,
  ...extra,
});

test('unsent recordings: one note per recording, the newest first; the job goes on it; stopping its row on Home drops it', () => {
  let list = U.withUnsent([], note('r1'));
  list = U.withUnsent(list, note('r2'));
  assert.deepEqual(list.map((u) => u.recordingId), ['r2', 'r1']);
  list = U.withUnsent(list, note('r1', { dish: 'Poha' }));
  assert.deepEqual(list.map((u) => u.recordingId), ['r1', 'r2'], 'saved again: replaced, not doubled');
  assert.equal(list[0].dish, 'Poha');
  list = U.patchUnsent(list, 'r2', { jobId: 'family-recipe-ea10a0' });
  assert.equal(list[1].jobId, 'family-recipe-ea10a0');
  assert.equal(list[0].jobId, null);
  assert.deepEqual(U.withoutUnsent(list, 'r1').map((u) => u.recordingId), ['r2']);
  // Home's Stop / clear: by the row's job, or by its recording (a crash before the job went on the note).
  assert.deepEqual(U.withoutUnsentFor(list, { job_id: 'family-recipe-ea10a0' }).map((u) => u.recordingId), ['r1']);
  assert.deepEqual(U.withoutUnsentFor(list, { job_id: 'other', recording_id: 'r1' }).map((u) => u.recordingId), ['r2']);
  assert.equal(U.withoutUnsentFor(list, { job_id: 'other', recording_id: null }).length, 2, 'an unrelated row');
});

test('unsent recordings: what a launch does with one, from what Convex and the upload row say', () => {
  const at = (convexJob, extra = {}) => ({ convexJob, upload: 'uploading', clipsHere: 1, now: NOW, ...extra });
  const job = (stage, error = null) => ({ stage, error });
  const later = NOW + U.REDO_AFTER_MS; // over an hour after "I'm done"
  // Convex couldn't say: wait, whatever the phone has (never a second copy on a guess).
  assert.equal(U.resendStep(note('r'), at(undefined)), 'wait');
  assert.equal(U.resendStep(note('r'), at(undefined, { clipsHere: 0 })), 'wait', 'even with its videos gone');
  // The Oct 24 crash: the signer made the upload, then the app died before jobs.create.
  assert.equal(U.resendStep(note('r'), at(null)), 'send');
  assert.equal(U.resendStep(note('r'), at(null, { upload: null })), 'send', 'its row is gone too');
  // The upload finished but jobs.create didn't: make only the job.
  assert.equal(U.resendStep(note('r'), at(null, { upload: 'uploaded' })), 'create');
  // Only the worker's own word that files are missing ('uploading') redoes, and only an hour on: iOS may
  // still be finishing a background upload the app was killed during.
  assert.equal(U.resendStep(note('r'), at(job('uploading'))), 'wait', 'ten minutes on');
  assert.equal(U.resendStep(note('r'), at(job('uploading'), { now: later })), 'redo');
  assert.equal(U.resendStep(note('r'), at(job('uploading'), { upload: 'failed' })), 'redo', 'this phone saw the upload fail: no need to wait');
  // Queued (the worker hasn't looked, maybe offline with every file in) and preparing (it claimed the job and
  // is checking, or waiting 45 s for missing files) never redo: a cut-off upload shows 'uploading' soon after.
  for (const s of ['queued', 'preparing']) {
    assert.equal(U.resendStep(note('r'), at(job(s))), 'wait', s);
    assert.equal(U.resendStep(note('r'), at(job(s), { now: later })), 'wait', `${s}, hours on`);
  }
  // Nothing to do.
  assert.equal(U.resendStep(note('r'), at(job('uploading'), { upload: 'uploaded', now: later })), 'done', 'this phone saw every file go');
  for (const s of ['understanding', 'writing', 'indexing', 'done']) assert.equal(U.resendStep(note('r'), at(job(s))), 'done', s);
  assert.equal(U.resendStep(note('r'), at(job('failed', U.CANCELLED))), 'done', 'she stopped it');
  assert.equal(U.resendStep(note('r'), at(job('failed', 'We couldn’t finish this recipe.'), { now: later })), 'wait', 'failed for its own reason: her row says so');
  assert.equal(U.resendStep(note('r'), at(job(null))), 'done', 'not among the newest jobs: long since handled');
  // No videos left: nothing to send (a job is left alone; its files may have arrived).
  assert.equal(U.resendStep(note('r'), at(null, { clipsHere: 0 })), 'gone');
  assert.equal(U.resendStep(note('r'), at(job('uploading'), { clipsHere: 0, now: later })), 'gone');
  // Too many tries; too old.
  assert.equal(U.resendStep(note('r', { resends: U.MAX_RESENDS - 1 }), at(null)), 'send');
  assert.equal(U.resendStep(note('r', { resends: U.MAX_RESENDS }), at(null)), 'give-up');
  assert.equal(U.resendStep(note('r', { resends: U.MAX_RESENDS }), at(null, { upload: 'uploaded' })), 'give-up');
  assert.equal(U.resendStep(note('r', { resends: U.MAX_RESENDS }), at(job('uploading'), { now: later })), 'give-up');
  const old = note('r', { savedAt: new Date(NOW - U.MAX_AGE_MS - 1).toISOString() });
  assert.equal(U.resendStep(old, at(undefined)), 'give-up', 'a week old: stop asking, even offline');
});

test('stopped early: each saved file updates the recording’s filming note; never over one being sent', () => {
  let list = U.withFilming([], note('r1', { clips: [] }));
  assert.equal(list[0].state, 'filming');
  const first = list[0].savedAt;
  const two = [note('r1').clips[0], { ...note('r1').clips[0], path: 'recordings/r1/part-02.mp4' }];
  list = U.withFilming(list, note('r1', { clips: two, savedAt: '2026-10-24T19:40:00Z' }));
  assert.equal(list.length, 1, 'one note per recording');
  assert.equal(list[0].clips.length, 2, 'every file so far');
  assert.equal(list[0].savedAt, first, 'filming began when its first file was saved');
  // "I'm done" made it a send; a file saved late (let go after 10 s, then saved) must not turn it back.
  const sending = U.withUnsent(list, note('r1', { clips: two }));
  assert.equal(sending[0].state, undefined);
  assert.equal(U.withFilming(sending, note('r1', { clips: two })), sending, 'left exactly as it was');
  // A launch never sends a filming note by itself.
  assert.equal(U.sendsBySelf(list[0]), false);
  assert.equal(U.sendsBySelf(sending[0]), true);
  assert.equal(U.sendsBySelf(note('old')), true, 'notes from before Oct 26 have no state: sent as before');
});

test('stopped early: Home asks only the cook who filmed it, in that family, when it isn’t being filmed now', () => {
  const filming = (id, extra = {}) => ({ ...note(id, extra), state: 'filming' });
  const list = [filming('mine'), filming('auntie', { cookId: 'cook-2' }), filming('other-family', { familyId: 'fam-2' }), filming('empty', { clips: [] }), note('sending'), filming('on-screen')];
  const at = { cookId: 'cook-1', familyId: 'fam-1', filmingNow: (id) => id === 'on-screen' };
  assert.deepEqual(U.stoppedEarly(list, at).map((u) => u.recordingId), ['mine']);
  assert.deepEqual(U.stoppedEarly(list, { ...at, cookId: 'cook-2' }).map((u) => u.recordingId), ['auntie']);
  assert.deepEqual(U.stoppedEarly(list, { ...at, cookId: null }), [], 'nobody picked: nobody is asked');
  assert.deepEqual(U.stoppedEarly(list, { ...at, filmingNow: () => false }).map((u) => u.recordingId), ['mine', 'on-screen'], 'its screen closed: ask');
});

test('stopped early: her Send it makes it a send from now (no job, no tries yet); how much was filmed', () => {
  const u = { ...note('r1', { jobId: 'stale', resends: 2 }), state: 'filming' };
  const s = U.asSending(u, NOW);
  assert.equal('state' in s, false);
  assert.equal(s.savedAt, new Date(NOW).toISOString(), 'the hour before a redo counts from her tap');
  assert.equal(s.jobId, null);
  assert.equal(s.resends, 0);
  assert.equal(u.state, 'filming', 'the note itself is left alone');
  // A second tap (one consent yes answers every waiting tap): the note is on its way, never reset.
  assert.equal(U.asSending({ ...s, jobId: 'job-1', resends: 1 }, NOW + 1000), null);
  assert.equal(U.asSending(note('old'), NOW), null, 'nor a note sent after "I’m done"');
  assert.equal(U.filmedLength([{ durationMs: 300_000 }, { durationMs: 300_000 }, { durationMs: 120_000 }]), 720_000);
  assert.equal(U.filmedLength([]), 0);
});

test('library send: a picked video in a cache iOS may empty is copied into documents/sends/<note>/ first', () => {
  const docs = 'file:///var/mobile/Containers/Data/Application/AAAA/Documents/';
  const caches = 'file:///var/mobile/Containers/Data/Application/AAAA/Library/Caches/ImagePicker/9C1E.MOV';
  assert.equal(U.copyPath(caches, docs, 'send-x', 1), 'sends/send-x/part-01.mov', 'keeps its own type');
  assert.equal(U.copyPath('file:///private/var/mobile/Containers/Data/Application/AAAA/tmp/ABC.mp4', docs, 'send-x', 12), 'sends/send-x/part-12.mp4');
  assert.equal(U.copyPath(`${docs}recordings/r1/part-01.mp4`, docs, 'send-x', 1), null, 'filmed in the app: kept already');
  assert.equal(U.copyPath('ph://ABC', docs, 'send-x', 1), null, 'not a file');
  assert.equal(U.copyPath('https://homecookd.app/media/a.jpg', docs, 'send-x', 1), null);
  // The name and type it uploads with after a relaunch.
  assert.deepEqual(U.clipFile('recordings/r1/part-03.mp4', 3), { fileName: 'part-03.mp4', mimeType: 'video/mp4' });
  assert.deepEqual(U.clipFile('sends/send-x/part-01.mov', 1), { fileName: 'part-01.mov', mimeType: undefined }, 'contentTypeFor reads .mov as QuickTime');
  // Its own id: never a Convex recording id, never twice.
  const a = U.newNoteId(NOW, 0.1);
  assert.match(a, /^send-[a-z0-9]+-[a-z0-9]+$/);
  assert.notEqual(a, U.newNoteId(NOW, 0.2));
});

test('library send: stopping its row on Home drops its note too (found by the row’s note id)', () => {
  const list = [note('send-abc', { local: true }), note('r2')];
  assert.deepEqual(U.withoutUnsentFor(list, { job_id: 'other', recording_id: null, unsent_id: 'send-abc' }).map((u) => u.recordingId), ['r2']);
  assert.equal(U.withoutUnsentFor(list, { job_id: 'other', recording_id: null, unsent_id: null }).length, 2);
  // The same launch rules as a recording (resendStep); its Convex job is found by its upload folder.
  const at = { convexJob: null, upload: 'uploading', clipsHere: 1, now: NOW };
  assert.equal(U.resendStep(note('send-abc', { local: true }), at), 'send');
  assert.equal(U.resendStep(note('send-abc', { local: true }), { ...at, convexJob: { stage: 'uploading' } }), 'wait', 'the hour still holds');
});

test('library send: a job Convex had that fell out of the family’s 20 newest reads as done, never sent twice', () => {
  const jobs = [{ _id: 'j1', uploadPath: 'family-recipe-aa/', stage: 'writing' }];
  assert.deepEqual(U.jobForUpload(jobs, 'family-recipe-aa', true), { id: 'j1', stage: 'writing', error: null });
  // iOS finished the upload after the kill, the job was made, then 20 more jobs landed.
  const old = U.jobForUpload(jobs, 'family-recipe-bb', true);
  assert.equal(old.stage, null);
  assert.equal(U.resendStep(note('send-b', { local: true, jobId: 'family-recipe-bb' }), { convexJob: old, upload: 'uploading', clipsHere: 1, now: NOW }), 'done');
  // jobs.create never landed: no job, send again.
  assert.equal(U.jobForUpload(jobs, 'family-recipe-bb', false), null);
  assert.equal(U.jobForUpload(jobs, null, true), null, 'no upload was ever made');
});

test('library send: copies no note lists are tidied once a launch, never one being prepared', () => {
  const notes = [note('send-a', { clips: [{ ...note('x').clips[0], path: 'sends/send-a/part-01.mov', copy: true }] })];
  const paths = ['sends/send-a/part-01.mov', 'sends/send-a/part-02.mov', 'sends/send-dead/part-01.mov', 'sends/send-now/part-01.mov'];
  assert.deepEqual(U.orphanCopies(paths, notes, (id) => id === 'send-now'), ['sends/send-a/part-02.mov', 'sends/send-dead/part-01.mov']);
  assert.deepEqual(U.orphanCopies([], notes, () => false), []);
});

test('stopped early: one Send it, a delete that stays deleted, the row’s thumbnail kept', () => {
  const src = (f) => readFileSync(join(root, 'src', f), 'utf8');
  const card = src('components/record/StoppedEarlyCard.tsx');
  assert.match(card, /if \(preview \|\| busy\.current \|\| !me\) return;\n\s*busy\.current = true;\n\s*if \(!\(await ensureAiConsent\(\)\)\)/, 'the in-flight guard comes before the consent wait');
  assert.match(card, /deleteRecording\(note\);[\s\S]*?try \{[\s\S]*?endRecording\(note\.recordingId, me\.id\)/, 'Delete ends the Convex recording, after the files go');
  const kept = src('lib/unsentRecordings.ts');
  assert.match(kept, /export function saveFilming\(input: UnsentInput\) \{\n[^\n]*\n\s*if \(deleted\.has\(input\.recordingId\)\) return;/, 'a late file never brings a deleted recording back');
  assert.match(kept, /deleted\.add\(u\.recordingId\);/);
  assert.match(src('components/record/sendKept.ts'), /thumb: input\.clips\[0\]\?\.asset\.uri/, 'the thumbnail is the original pick, not the copy that goes once sent');
  assert.match(src('components/record/useResendUnsent.ts'), /uploadJob\(u\.jobId, seen\?\.convex_job === 'ok', cook\.id\)/);
});

test('stopped early and library sends: the screens use the kept sends, and a resend never sends a filming note', () => {
  const src = (f) => readFileSync(join(root, 'src', f), 'utf8');
  assert.match(src('app/send.tsx'), /await sendKept\(/, 'Send keeps a note');
  assert.match(src('components/record/DoneView.tsx'), /await sendKept\(/, 'the done view too (a system-camera recording)');
  assert.match(src('components/record/useResendUnsent.ts'), /if \(!sendsBySelf\(u\) \|\|/, 'filming notes are Home’s to ask about');
  assert.match(src('app/recording.tsx'), /onSaved: \(clips\) => \{[\s\S]*?saveFilming\(/, 'each saved file updates the note');
  assert.match(src('app/recording.tsx'), /filmingOnScreen\(id, true\)/);
  const card = src('components/record/StoppedEarlyCard.tsx');
  assert.match(card, /endRecording\(u\.recordingId, me\.id\)/, 'Send it ends the Convex recording as her');
  assert.match(card, /setSure\(true\)/, 'Delete asks first');
  assert.doesNotMatch(card, /<Txt[^>]*>\s*[A-Z][a-z]/, 'every word on the card goes through t()');
});

test('flip: while filming it is a file boundary; otherwise only the camera switches', () => {
  assert.deepEqual(C.flipSteps('filming'), ['endFile', 'switch', 'betweenFiles', 'startFile']);
  for (const phase of ['idle', 'paused', 'done']) assert.deepEqual(C.flipSteps(phase), ['switch'], phase);
  assert.equal(C.otherFacing('back'), 'front');
  assert.equal(C.otherFacing('front'), 'back');
  assert.ok(C.FLIP_WAIT_MS <= 5000, 'never long without a file');
  assert.ok(C.FLIP_SETTLE_MS >= 1000, 'a still after a flip is the new camera’s');
  assert.ok(C.END_WAIT_MS <= 10_000);
});

// ---- filming.ts with a fake camera: the order of things when files, flips, rolls, pauses and "I'm done" meet ----

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, what, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(1);
  }
};
const gate = () => {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
};

/**
 * A fake <Camera>. A file is open from its start until it is saved (saveMs after a stop); a new device or a
 * fresh <Camera> (cameraKey) is ready readyMs later unless `dead(view)`. The log says what happened, and marks
 * a mic restart while a file is open, or a camera switch while one is still saving.
 */
const rigs = [];
function rig({ saveMs = 5, readyMs = 5, dead = () => false, between = null, onSaved = null } = {}) {
  const log = [];
  const events = [];
  const saves = [];
  const f = new Fm.Filming({ chunkMs: 60_000, readyWaitMs: 300, flipWaitMs: 60, endWaitMs: 120, settleMs: 30 });
  rigs.push(f);
  const cam = {
    open: null,
    saving: 0,
    n: 0,
    neverSaves: false,
    readyAt: 0,
    startRecording(finished, failed) {
      if (cam.open) throw new Error('two files open at once');
      cam.open = { n: ++cam.n, finished, failed };
      log.push(`start ${cam.n} ${f.snapshot().facing}`);
    },
    async stopRecording() {
      const file = cam.open;
      if (!file || file.stopping) return;
      file.stopping = true;
      log.push(`stop ${file.n}`);
      if (cam.neverSaves) return;
      cam.saving += 1;
      setTimeout(() => {
        cam.saving -= 1;
        cam.open = null;
        file.finished({ path: `/tmp/${file.n}.mp4`, duration: 2, width: 1080, height: 1920 });
      }, saveMs);
    },
    keep: (path) => path,
    /** The open file fails by itself (VisionCamera's onRecordingError). */
    fail() {
      const file = cam.open;
      cam.open = null;
      file.failed({ code: 'capture/unknown', message: 'boom' });
    },
  };
  const open = () => (cam.open ? ' WHILE A FILE IS OPEN' : '');
  f.connect(cam, {
    onPause: () => events.push('pause'),
    onResume: () => events.push('resume'),
    beforeResume: async (goesOn) => {
      events.push(`beforeResume${open()}`);
      events.push(`goesOn ${goesOn()}`);
    },
    betweenFiles: async (goesOn) => {
      events.push(`betweenFiles${open()}`);
      if (between) await between.promise;
      events.push(`goesOn ${goesOn()}`);
    },
    onSaved: (clips) => {
      saves.push(clips.map((c) => c.asset.fileName).join(' '));
      onSaved?.(clips);
    },
  });
  // The <Camera>: onInitialized once per device and per fresh one.
  let seen = '';
  const mount = () => {
    const v = f.snapshot();
    const now = `${v.facing}#${v.cameraKey}`;
    if (now === seen) return;
    seen = now;
    log.push(`camera ${now}${cam.saving ? ' WHILE A FILE IS SAVING' : ''}`);
    if (!dead(v))
      setTimeout(() => {
        cam.readyAt = Date.now();
        f.initialized();
      }, readyMs);
  };
  f.subscribe(mount);
  mount();
  const files = () => log.filter((l) => /^(start|stop) /.test(l));
  const rulesKept = () => {
    assert.ok(!events.some((e) => e.includes('WHILE')), `homie’s mic restarted while a file was open: ${events}`);
    assert.ok(!log.some((l) => l.includes('WHILE')), `the camera switched while a file was saving: ${log}`);
  };
  return { f, cam, log, events, saves, files, rulesKept };
}

const atest = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  } finally {
    for (const f of rigs.splice(0)) f.dispose(); // no 5-minute timers left running
  }
};

await atest('filming: every saved file is reported with all the files so far (the crash note); a failing report changes nothing', async () => {
  const r = rig();
  await r.f.start();
  await r.f.flip();
  await r.f.pause();
  await r.f.resume();
  const clips = await r.f.stop();
  assert.deepEqual(r.saves, ['part-01.mp4', 'part-01.mp4 part-02.mp4', 'part-01.mp4 part-02.mp4 part-03.mp4']);
  assert.equal(clips.length, 3);
  r.rulesKept();
  const bad = rig({
    onSaved: () => {
      throw new Error('disk full');
    },
  });
  await bad.f.start();
  await bad.f.flip();
  assert.equal(bad.f.phase, 'filming', 'filming goes on');
  assert.equal((await bad.f.stop()).length, 2);
});

await atest('filming: a flip while filming ends the file, waits for the other camera, starts the next file on it', async () => {
  const r = rig();
  assert.equal(await r.f.start(), true);
  assert.equal(await r.f.flip(), true);
  assert.equal(r.f.snapshot().facing, 'front');
  assert.equal(r.f.phase, 'filming');
  const clips = await r.f.stop();
  assert.deepEqual(r.files(), ['start 1 back', 'stop 1', 'start 2 front', 'stop 2']);
  assert.deepEqual(r.log.filter((l) => l.startsWith('camera')), ['camera back#0', 'camera front#0']);
  assert.deepEqual(r.events, ['betweenFiles', 'goesOn true', 'resume'], 'the mic may restart between the files; homie hears the gap');
  assert.deepEqual(clips.map((c) => c.asset.fileName), ['part-01.mp4', 'part-02.mp4']);
  r.rulesKept();
});

await atest('filming: "I’m done" during each step of a flip returns every finished file and starts none after it', async () => {
  for (const step of ['saving the file', 'waiting for the other camera', 'betweenFiles', 'the new file just started']) {
    const between = step === 'betweenFiles' ? gate() : null;
    const r = rig({ saveMs: 20, readyMs: 20, between });
    await r.f.start();
    const flipping = r.f.flip();
    if (step === 'saving the file') await until(() => r.log.includes('stop 1'), step);
    if (step === 'waiting for the other camera') await until(() => r.f.snapshot().facing === 'front', step);
    if (step === 'betweenFiles') await until(() => r.events.includes('betweenFiles'), step);
    if (step === 'the new file just started') await until(() => r.log.includes('start 2 front'), step);
    const stopping = r.f.stop();
    between?.open();
    const clips = await stopping;
    await flipping;
    await wait(80);
    const started = r.files().filter((l) => l.startsWith('start')).length;
    assert.equal(started, step === 'the new file just started' ? 2 : 1, `${step}: no file starts after "I’m done"`);
    assert.equal(clips.length, started, `${step}: every file is in the clips`);
    assert.equal(r.cam.open, null, `${step}: nothing left open`);
    assert.equal(r.f.phase, 'done');
    if (between) assert.ok(r.events.includes('goesOn false'), 'after "I’m done" the mic is not marked busy again');
    r.rulesKept();
  }
});

await atest('filming: the 5-minute timer firing during a flip does nothing; on the open file it rolls', async () => {
  const r = rig({ saveMs: 10, readyMs: 10 });
  await r.f.start();
  const first = r.f.openSince;
  await Promise.all([r.f.flip(), r.f.roll(first)]);
  assert.deepEqual(r.files(), ['start 1 back', 'stop 1', 'start 2 front'], 'the flip already ended that file');
  await r.f.roll(r.f.openSince);
  assert.deepEqual(r.files().slice(-2), ['stop 2', 'start 3 front']);
  r.rulesKept();
});

await atest('filming: leaving the app during a flip starts no file; coming back films on the new camera', async () => {
  const r = rig({ readyMs: 20 });
  await r.f.start();
  const flipping = r.f.flip();
  await until(() => r.f.snapshot().facing === 'front', 'the switch');
  await r.f.pause();
  await flipping;
  await wait(30);
  assert.equal(r.f.phase, 'paused');
  assert.equal(r.cam.open, null);
  assert.deepEqual(r.files(), ['start 1 back', 'stop 1']);
  assert.ok(r.events.includes('pause'));
  assert.equal(await r.f.resume(), true);
  assert.equal(r.files().at(-1), 'start 2 front');
  r.rulesKept();
});

await atest('filming: a flip after "I’m done" waits for the last file to be saved before it switches', async () => {
  const r = rig({ saveMs: 40 });
  await r.f.start();
  const stopping = r.f.stop();
  const flipping = r.f.flip();
  assert.equal((await stopping).length, 1);
  assert.equal(await flipping, true);
  assert.deepEqual(r.log.filter((l) => l.startsWith('camera')), ['camera back#0', 'camera front#0']);
  r.rulesKept(); // no "WHILE A FILE IS SAVING"
});

await atest('filming: coming back right after leaving: the mic restarts only once the file is saved', async () => {
  const r = rig({ saveMs: 30 });
  await r.f.start();
  void r.f.pause();
  assert.equal(await r.f.resume(), true);
  assert.deepEqual(r.events, ['pause', 'beforeResume', 'goesOn true', 'resume']);
  r.rulesKept();
});

await atest('filming: the other camera never gets ready: a fresh camera on the one that worked, and filming goes on', async () => {
  const r = rig({ dead: (v) => v.facing === 'front' });
  await r.f.start();
  assert.equal(await r.f.flip(), false);
  const v = r.f.snapshot();
  assert.equal(v.facing, 'back');
  assert.equal(v.cameraKey, 1, 'a fresh <Camera>');
  assert.equal(r.f.phase, 'filming');
  assert.equal(v.trouble, false);
  assert.deepEqual(r.files(), ['start 1 back', 'stop 1', 'start 2 back'], 'a file only once the fresh camera is ready');
  r.rulesKept();
});

await atest('filming: no camera comes back: no file, paused, the trouble line; a resume waits until one does', async () => {
  let broken = false;
  const r = rig({ dead: () => broken });
  await r.f.start();
  broken = true;
  assert.equal(await r.f.flip(), false);
  let v = r.f.snapshot();
  assert.equal(r.f.phase, 'paused', 'never "filming" with nothing filmed');
  assert.equal(v.trouble, true);
  assert.equal(v.since, null, 'the clock stops');
  assert.equal(v.cameraKey, 2, 'and the <Camera> starts over again');
  assert.equal(r.cam.open, null);
  assert.deepEqual(r.files(), ['start 1 back', 'stop 1']);
  assert.ok(r.events.includes('pause'), 'homie is told');
  // That fresh camera never came up either: the resume starts no file, and the camera starts over once more.
  broken = false;
  assert.equal(await r.f.resume(), false);
  assert.equal(r.f.phase, 'paused');
  assert.equal(r.f.snapshot().cameraKey, 3);
  assert.equal(await r.f.resume(), true);
  v = r.f.snapshot();
  assert.equal(v.trouble, false);
  assert.equal(r.files().at(-1), 'start 2 back');
  r.rulesKept();
});

await atest('filming: a file that fails by itself pauses filming (no ticking clock over nothing), with the trouble line', async () => {
  const r = rig();
  await r.f.start();
  r.cam.fail();
  const v = r.f.snapshot();
  assert.equal(r.f.phase, 'paused');
  assert.equal(v.trouble, true);
  assert.equal(v.since, null);
  assert.ok(r.events.includes('pause'));
  assert.equal(await r.f.resume(), true, 'her tap films again on a fresh camera');
  r.rulesKept();
});

await atest('filming: a file that never says it ended is let go, so nothing waits forever', async () => {
  const r = rig();
  await r.f.start();
  r.cam.neverSaves = true;
  const t0 = Date.now();
  assert.deepEqual(await r.f.stop(), []);
  assert.ok(Date.now() - t0 >= 100 && Date.now() - t0 < 1000, 'after endWaitMs');
  r.cam.neverSaves = false;
  r.cam.open = null;
  assert.equal(await r.f.flip(), true, 'the queue still moves');
});

await atest('filming: a still right after a flip waits for the new camera’s frames', async () => {
  const r = rig({ readyMs: 15 });
  assert.equal(await r.f.flip(), false, 'not before the camera is first ready');
  await until(() => r.f.snapshot().ready, 'the first camera');
  const flipping = r.f.flip();
  await until(() => r.f.snapshot().facing === 'front', 'the switch');
  await r.f.readyForStill();
  assert.ok(Date.now() >= r.cam.readyAt + 30 - 2, 'settleMs after the new camera was ready');
  await flipping;
});

test('flip: the button sits beside the card, beside the shutter for the plate, never under homie’s question', () => {
  const on = { camera: true, twoCameras: true, asking: false, plate: false, photo: false };
  assert.equal(C.flipPlace(on), 'card', 'from the hello on, filming, paused, wrapping up');
  assert.equal(C.flipPlace({ ...on, asking: true }), null, 'homie’s question covers the screen');
  assert.equal(C.flipPlace({ ...on, plate: true }), 'shutter');
  assert.equal(C.flipPlace({ ...on, plate: true, photo: true }), null, '"Got it!": nothing left to shoot');
  assert.equal(C.flipPlace({ ...on, camera: false }), null, 'no card: glasses, the system camera, the done view');
  assert.equal(C.flipPlace({ ...on, twoCameras: false }), null, 'a phone with one camera');
});

test('flip: beside the card it fits the space to its right, its label ending at the card’s bottom', () => {
  // iPhone 15 (390 wide): the card is 177 x 236 in the middle.
  const card = { x: 106.5, y: 120, width: 177, height: 236 };
  const b = C.flipBeside(card, 390, 68);
  assert.ok(b.left >= card.x + card.width, 'right of the card, never on it');
  assert.ok(b.left + b.width <= 390, 'on the screen');
  assert.ok(b.width >= 68);
  assert.equal(b.top + 68 + C.FLIP_LABEL_ROOM, card.y + card.height);
  assert.deepEqual(C.flipBeside(card, 390, 68, { x: 310, y: 52, size: 56 }), b, 'homie’s pot is far above it');
  // iPhone SE (375 x 667): a 140-wide card, and homie's corner pot at 52-108 right above it.
  const pot = { x: 295, y: 52, size: 56 };
  const se = C.flipBeside({ x: 117.5, y: 56, width: 140, height: 187 }, 375, 68, pot);
  assert.ok(se.left >= 257.5 && se.left + se.width <= 375);
  assert.ok(se.top >= pot.y + pot.size + C.FLIP_POT_GAP, `top ${se.top}: not a pair with the pot`);
});

test('flip: "Flip camera" in her language', () => {
  assert.deepEqual(rmr.line('flipCamera'), { text: 'कॅमेरा बदला', en: 'Flip camera' });
  assert.deepEqual(ren.line('flipCamera'), { text: 'Flip camera', en: null });
  assert.equal(W.recordWords('hi').text('flipCamera'), 'कैमरा बदलें');
  assert.equal(W.recordWords('es').line('flipCamera').en, 'Flip camera', 'VoiceOver reads the English');
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

test('expo-file-system moves and copies are never left un-awaited (an upload of a file still being moved crashed build 5)', () => {
  const offenders = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const f = join(d, name);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.tsx?$/.test(f))
        readFileSync(f, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            // `x.move(` / `x.copy(` (expo-file-system: async) must be awaited; the Sync forms are fine.
            if (/\.(move|copy)\(/.test(line) && !/await\s+[\w.()\[\]'"]*\.(move|copy)\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${f.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
          });
    }
  };
  walk(join(root, 'src'));
  assert.deepEqual(offenders, []);
});

test('the in-app camera keeps VisionCamera mirroring as is: isMirrored={false} stored front clips upside down', () => {
  const card = readFileSync(join(root, 'src/components/record/CameraCard.tsx'), 'utf8');
  // iOS mirrors front-camera frames itself; VisionCamera only corrects the rotation when mirroring is on.
  assert.doesNotMatch(card.replace(/^\s*\/\/.*$/gm, ''), /isMirrored\s*=/, 'CameraCard must not set isMirrored on <Camera>');
});

console.log(`\n${passed} passed`);
