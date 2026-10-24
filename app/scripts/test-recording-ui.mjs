// Unit tests for the cook's recording and walkie-talkie screens (TS run by Node's type stripping):
//   src/lib/homie/strings.ts               every line in English and Marathi, names and step numbers
//                                          filled in, Devanagari digits, English for other languages
//   src/components/record/recordingLogic.ts  what the screen shows in each phase, the elapsed clock,
//                                          the pot for the service's state, homie's question as a
//                                          moment, what "Not now" sends, "for Shreya · Biryani"
//   src/lib/languages.ts                   the picker's list and search (Track F's API)
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
const R = await import(pathToFileURL(join(root, 'src/components/record/recordingLogic.ts')).href);
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

test('every line has English and Marathi; Marathi is in Devanagari', () => {
  const table = S.wordTable();
  assert.ok(Object.keys(table).length >= 20);
  for (const [key, w] of Object.entries(table)) {
    assert.ok(w.en.trim(), `${key} en`);
    assert.ok(w.mr.trim(), `${key} mr`);
    assert.match(w.mr, DEVANAGARI, `${key} mr is Marathi`);
    for (const t of [w.en, w.mr]) for (const hole of t.match(/\{[a-z]+\}/g) ?? []) assert.ok(['{kid}', '{n}', '{language}'].includes(hole), `${key} ${hole}`);
  }
});

test('Caleb’s Marathi lines are the ones on screen', () => {
  assert.deepEqual(mr.line('imDone'), { text: 'माझं झालं', en: 'I’m done' });
  assert.equal(mr.text('recordingGlasses'), 'चष्म्यातून रेकॉर्डिंग चालू आहे');
  assert.equal(mr.text('justSayIt'), 'बोला, मी ऐकतोय');
  assert.equal(mr.text('sayItAgain'), 'पुन्हा सांग');
  assert.equal(mr.text('notNow'), 'आत्ता नको');
  assert.equal(mr.text('hearAgain'), 'पुन्हा ऐका');
  assert.equal(mr.text('holdAndTalk'), 'दाबून धरा, बोला');
  assert.equal(mr.text('cookAsAlways'), 'नेहमीसारखं स्वयंपाक करा. homie मधूनच एखादा प्रश्न विचारेल.');
});

test('names and step numbers are filled in; Marathi digits are Devanagari', () => {
  assert.deepEqual(mr.line('forKid', { kid: 'Shreya' }), { text: 'Shreya साठी', en: 'for Shreya' });
  assert.equal(mr.text('sentTo', { kid: 'Shreya' }), 'Shreya ला पाठवलं');
  assert.equal(mr.text('letGoToSend', { kid: 'Shreya' }), 'सोडल्यावर Shreya ला जाईल');
  assert.equal(mr.text('kidAsked', { kid: 'Shreya' }), 'Shreya ने विचारलं');
  assert.deepEqual(mr.line('step', { n: 3 }), { text: 'पायरी ३', en: 'Step 3' });
  assert.equal(S.localDigits(12, 'mr'), '१२');
  assert.equal(S.localDigits(12, 'en'), '12');
  assert.equal(en.text('sentTo', { kid: '' }), 'Sent to your family');
  assert.equal(en.text('readToYou', { language: 'Marathi' }), 'homie read it to you in Marathi');
});

test('English, and languages these screens aren’t written in, read English with no second line', () => {
  assert.deepEqual(en.line('imDone'), { text: 'I’m done', en: null });
  assert.deepEqual(S.cookWords('fr').line('imDone'), { text: 'I’m done', en: null });
  assert.deepEqual(S.cookWords(undefined).line('notNow'), { text: 'Not now', en: null });
  assert.equal(S.cookWords('MR').lang, 'mr');
});

test('elapsed clock: m:ss, then h:mm:ss', () => {
  assert.equal(R.elapsedLabel(0), '0:00');
  assert.equal(R.elapsedLabel(-500), '0:00');
  assert.equal(R.elapsedLabel(59_999), '0:59');
  assert.equal(R.elapsedLabel(754_000), '12:34');
  assert.equal(R.elapsedLabel(3_723_000), '1:02:03');
});

test('what the screen shows in each phase', () => {
  assert.deepEqual(R.recordingView('connecting', 'glasses', false), { status: 'gettingReady', live: false, button: null, clock: 'none' });
  assert.deepEqual(R.recordingView('intro', 'glasses', false), { status: 'sayingHello', live: false, button: null, clock: 'none' });
  assert.equal(R.recordingView('intro', 'phone', true).button, 'start');
  assert.deepEqual(R.recordingView('recording', 'glasses', true), { status: 'recordingGlasses', live: true, button: 'done', clock: 'running' });
  assert.equal(R.recordingView('recording', 'phone', true).status, 'recordingPhone');
  assert.deepEqual(R.recordingView('wrapping_up', 'glasses', true), { status: 'wrappingUp', live: false, button: null, clock: 'stopped' });
  assert.equal(R.recordingView('ended', 'phone', true).button, null);
});

test('after homie’s goodbye: glasses go home, a phone recording goes to Send', () => {
  assert.equal(R.afterEnd('glasses'), 'home');
  assert.equal(R.afterEnd('phone'), 'send');
});

test('the pot follows the service; speaking comes from the say itself', () => {
  assert.equal(R.potFor('listening', true), 'listening');
  assert.equal(R.potFor('quiet', true), 'listening');
  assert.equal(R.potFor('quiet', false), 'off');
  assert.equal(R.potFor('thinking', false), 'thinking');
  assert.equal(R.potFor('speaking', true), null);
});

test('"Not now": a live question is dropped; an end question hears the words', () => {
  assert.deepEqual(R.notNowMessage('amount'), { type: 'not_now' });
  assert.deepEqual(R.notNowMessage('story'), { type: 'not_now' });
  assert.deepEqual(R.notNowMessage('end'), { type: 'text', text: 'not now' });
  assert.deepEqual(R.notNowMessage('optin'), { type: 'text', text: 'not now' });
});

test('homie’s question as a moment: Marathi with English, the listening bar, Say it again / Not now', () => {
  const ask = { promptId: 'p1', text: 'आलं साधारण किती घातलं?', textEn: 'About how much ginger was that?', kind: 'amount' };
  const m = R.askMoment(ask, mr, true);
  assert.equal(m.id, 'p1');
  assert.equal(m.question, ask.text);
  assert.equal(m.questionEn, ask.textEn);
  assert.deepEqual(m.listening, { label: 'बोला, मी ऐकतोय', sublabel: 'Just say it, I’m listening' });
  assert.deepEqual(m.options, [
    { id: 'again', label: 'पुन्हा सांग', sublabel: 'Say it again', keepOpen: true },
    { id: 'not_now', label: 'आत्ता नको', sublabel: 'Not now' },
  ]);
  // No microphone (Expo Go): no "I'm listening".
  assert.equal(R.askMoment(ask, mr, false).listening, undefined);
  // English: the question once, no sublabels.
  const e = R.askMoment({ ...ask, text: 'How much ginger?', textEn: 'How much ginger?' }, en, true);
  assert.equal(e.questionEn, undefined);
  assert.deepEqual(e.options.map((o) => [o.id, o.label, o.sublabel]), [
    ['again', 'Say it again', undefined],
    ['not_now', 'Not now', undefined],
  ]);
});

test('the stories opt-in asks Yes / Not now, Yes first', () => {
  const m = R.askMoment({ promptId: 'o', text: 'Shreya ला तुमच्या गोष्टी पण ऐकू द्यायच्या का?', textEn: 'Can Shreya hear your stories too?', kind: 'optin' }, mr, true);
  assert.deepEqual(m.options.map((o) => [o.id, o.label, o.kind]), [
    ['yes', 'हो', 'primary'],
    ['not_now', 'आत्ता नको', undefined],
  ]);
  // VoiceOver's escape is the 'not_now' option (lib/homie/store).
  assert.ok(m.options.some((o) => o.id === 'not_now'));
});

test('"for Shreya · Chicken biryani", or less when one is missing', () => {
  assert.equal(R.forLine(mr, 'Shreya', 'Chicken biryani'), 'Shreya साठी · Chicken biryani');
  assert.equal(R.forLine(en, 'Shreya', ''), 'for Shreya');
  assert.equal(R.forLine(en, null, 'Dal'), 'Dal');
  assert.equal(R.forLine(en, ' ', null), null);
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
