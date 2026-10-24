// Unit tests for the cook's recording and walkie-talkie screens (TS run by Node's type stripping):
//   src/lib/homie/strings.ts                 every line in English and Marathi, names and step numbers
//                                            filled in, Devanagari digits, English for other languages
//   src/components/record/words.ts           the v3/v4 lines (the stop button, "Just answer out loud",
//                                            the done screen, the errors), with their small English
//   src/components/record/recordingLogic.ts  the line under the button in each phase, when filming
//                                            starts by itself, the pot for the service's state, what
//                                            "not now" sends, homie's question with its English
//   src/components/record/walkieLogic.ts     when her spoken answer is over, when nobody answered
//   src/lib/languages.ts                     the picker's list and search (Track F's API)
//   node scripts/test-recording-ui.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});

const S = await import(pathToFileURL(join(root, 'src/lib/homie/strings.ts')).href);
const W = await import(pathToFileURL(join(root, 'src/components/record/words.ts')).href);
const R = await import(pathToFileURL(join(root, 'src/components/record/recordingLogic.ts')).href);
const K = await import(pathToFileURL(join(root, 'src/components/record/walkieLogic.ts')).href);
const L = await import(pathToFileURL(join(root, 'src/lib/languages.ts')).href);

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
const mr = S.cookWords('mr');
const en = S.cookWords('en');
const rmr = W.recordWords('mr');
const ren = W.recordWords('en');
const both = { cook: mr, record: rmr };

test('every line has English and Marathi; Marathi is in Devanagari', () => {
  const tables = [S.wordTable(), W.recordWordTable()];
  for (const table of tables) {
    for (const [key, w] of Object.entries(table)) {
      assert.ok(w.en.trim(), `${key} en`);
      assert.ok(w.mr.trim(), `${key} mr`);
      assert.match(w.mr, DEVANAGARI, `${key} mr is Marathi`);
      for (const t of [w.en, w.mr]) for (const hole of t.match(/\{[a-z]+\}/g) ?? []) assert.ok(['{kid}', '{n}', '{language}'].includes(hole), `${key} ${hole}`);
    }
  }
  assert.ok(Object.keys(tables[1]).length >= 15);
});

test('Caleb’s lines are the ones on screen', () => {
  // The stop button's label: her words big, "Tap when you're done" small, in every language.
  assert.deepEqual(rmr.line('stop'), { text: 'माझं झालं', en: 'Tap when you’re done' });
  assert.deepEqual(ren.line('stop'), { text: 'I’m done', en: 'Tap when you’re done' });
  assert.deepEqual(rmr.line('listening'), { text: 'बोला, मी ऐकतोय', en: 'Just answer out loud' });
  assert.deepEqual(ren.line('listening'), { text: 'Go ahead, I’m listening', en: 'Just answer out loud' });
  assert.equal(mr.text('kidAsked', { kid: 'Shreya' }), 'Shreya ने विचारलं');
  assert.equal(mr.text('sentTo', { kid: 'Shreya' }), 'Shreya ला पाठवलं');
  assert.equal(mr.text('sayingHello'), 'homie नमस्कार करतोय');
});

test('the done screen says who it goes to', () => {
  assert.deepEqual(W.doneLine(rmr, { kid: 'Shreya', everyone: false, nobody: false }), { text: 'झालं! Shreya ला पाठवतोय', en: 'Done! Sending it to Shreya' });
  assert.deepEqual(W.doneLine(ren, { kid: 'Shreya', everyone: false, nobody: false }), { text: 'Done! Sending it to Shreya', en: null });
  assert.equal(W.doneLine(rmr, { kid: 'Shreya', everyone: true, nobody: false }).text, 'झालं! घरच्यांना पाठवतोय');
  assert.equal(W.doneLine(ren, { kid: ' ', everyone: false, nobody: false }).text, 'Done! Sending it to your family');
  assert.equal(W.doneLine(ren, { kid: null, everyone: false, nobody: true }).text, 'Done! Saving it to your recipes');
});

test('errors are in her language too, with the English under them', () => {
  for (const key of ['lostConnection', 'signedOut', 'ended', 'elsewhere', 'micOff', 'noMicHere', 'couldntSend']) {
    const l = rmr.line(key);
    assert.match(l.text, DEVANAGARI, key);
    assert.ok(l.en && !DEVANAGARI.test(l.en), key);
    assert.equal(ren.line(key).en, null, `${key}: English once`);
  }
});

test('names and step numbers are filled in; Marathi digits are Devanagari', () => {
  assert.deepEqual(mr.line('step', { n: 3 }), { text: 'पायरी ३', en: 'Step 3' });
  assert.equal(S.localDigits(12, 'mr'), '१२');
  assert.equal(S.localDigits(12, 'en'), '12');
  assert.equal(en.text('sentTo', { kid: '' }), 'Sent to your family');
});

test('English, and languages these screens aren’t written in, read English', () => {
  assert.deepEqual(en.line('imDone'), { text: 'I’m done', en: null });
  assert.deepEqual(S.cookWords('fr').line('imDone'), { text: 'I’m done', en: null });
  assert.deepEqual(W.recordWords('fr').line('leave'), { text: 'Leave', en: null });
  assert.deepEqual(W.recordWords(undefined).line('stop'), { text: 'I’m done', en: 'Tap when you’re done' });
  assert.equal(W.recordWords('MR').line('leave').text, 'बाहेर पडा');
});

test('the line under the button in each phase; it is the stop button only while filming', () => {
  assert.deepEqual(R.recordingView('connecting', both), { line: { text: 'homie तयार होतोय', en: 'homie is getting ready' }, live: false });
  assert.deepEqual(R.recordingView('intro', both), { line: { text: 'homie नमस्कार करतोय', en: 'homie is saying hello' }, live: false });
  assert.deepEqual(R.recordingView('recording', both), { line: { text: 'माझं झालं', en: 'Tap when you’re done' }, live: true });
  assert.deepEqual(R.recordingView('wrapping_up', both), { line: { text: 'जवळजवळ झालं', en: 'Almost done' }, live: false });
  assert.equal(R.recordingView('ended', both).live, false);
  assert.equal(R.recordingView('recording', { cook: en, record: ren }).line.text, 'I’m done');
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

// The walkie-talkie listens at ~10 readings a second.
function run(levels, stepMs = 100) {
  let l = K.startListening(0);
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

console.log(`\n${passed} passed`);
