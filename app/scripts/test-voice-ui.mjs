// Unit tests for cook mode's voice rules (TS run by Node's type stripping):
//   src/lib/live/voiceLogic.ts  a say's kind (an older service sends none), which says are offers (read
//                               aloud, a story), the label under the pot, which say_end is whose, the
//                               service's echo of a text, waiting for the "Let Mom see" answer (none for
//                               a memorial cook), when the phone reads aloud itself, app-only moments and
//                               the offer's end (the shared contract's messages), a spoken yes or no, the
//                               no-buttons yes-or-no moment, what the pot shows, kitchen timers on the
//                               phone's clock (parse, order, key, countdown, words), which of the cook's
//                               answers to offer, and the silence sent instead of the mic
//   node scripts/test-voice-ui.mjs
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

const V = await import(pathToFileURL(join(root, 'src/lib/live/voiceLogic.ts')).href);

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

// ---------------------------------------------------------------------------------------------
// Says

await test('a say keeps its kind; an unknown or missing kind is a reply', () => {
  assert.equal(V.sayKind({ kind: 'step' }), 'step');
  assert.equal(V.sayKind({ kind: 'greeting' }), 'greeting');
  assert.equal(V.sayKind({ kind: 'shout' }), 'reply');
  assert.equal(V.sayKind({}), 'reply');
});

await test('an older service marks a translation with translation: true', () => {
  assert.equal(V.sayKind({ translation: true }), 'translation');
  assert.equal(V.sayKind({ kind: 'translation', translation: true }), 'translation');
  // A kind wins over the flag.
  assert.equal(V.sayKind({ kind: 'reply', translation: true }), 'reply');
});

await test('the read-aloud offer and a story nudge are offers; other nudges and replies are only spoken', () => {
  assert.equal(V.offerOf('offer', "Want me to read Grandma's recipe out loud? Say yes, or tap here."), 'read');
  assert.equal(V.offerOf('nudge', 'Grandma has a story about this one. Want to hear it?'), 'story');
  assert.equal(V.offerOf('nudge', 'Still on step 3? Say "next" when you’re ready.'), null);
  assert.equal(V.offerOf('reply', 'A story? I’ll ask Grandma.'), null);
  assert.equal(V.offerOf('hint', 'Grandma didn’t say. Most recipes use about a teaspoon.'), null);
});

await test('the label under the pot: the cook named for a translation, AI for a hint, else the overlay’s own', () => {
  assert.equal(V.sayLabel('translation', 'Grandma'), 'Translated from Grandma');
  assert.equal(V.sayLabel('hint', 'Grandma'), 'AI hint');
  for (const kind of ['step', 'reply', 'nudge', 'offer', 'greeting', 'timer']) assert.equal(V.sayLabel(kind, 'Grandma'), undefined);
});

// ---------------------------------------------------------------------------------------------
// The line to the service

await test('a say_end while a newer line is open is the old line’s; the last one ends the current line', () => {
  // say A, say B (the service cut A off), A's say_end, B's say_end.
  let open = 2;
  let end = V.endSay(open);
  assert.deepEqual(end, { open: 1, stale: true });
  end = V.endSay(end.open);
  assert.deepEqual(end, { open: 0, stale: false });
  // One line, one end.
  assert.deepEqual(V.endSay(1), { open: 0, stale: false });
  // An end with nothing open (a reconnect reset the count) is never stale and never negative.
  assert.deepEqual(V.endSay(0), { open: 0, stale: false });
});

await test('the service’s echo of a text this phone sent is found (any case), a late one or a new phrase isn’t', () => {
  const sent = [V.sentText('back', 1_000), V.sentText(' Yes ', 1_200)];
  assert.equal(V.echoAt(sent, 'back', 1_100), 0);
  assert.equal(V.echoAt(sent, 'yes', 1_300), 1);
  assert.equal(V.echoAt(sent, 'YES', 1_300), 1);
  assert.equal(V.echoAt(sent, 'go back', 1_300), -1);
  // Five seconds on, the service dropped that text: the kid saying it is the kid.
  assert.equal(V.echoAt(sent, 'back', 7_000), -1);
  assert.equal(V.echoAt([], 'next', 0), -1);
});

await test('voice and homie’s questions wait for the "Let Mom see" answer; no live session, no wait', () => {
  const base = { askConsent: false, liveOn: true, consent: 'unknown', startFailed: false };
  // The session's start hasn't answered: the sheet may still come.
  assert.equal(V.consentSettled(base), false);
  assert.equal(V.consentSettled({ ...base, askConsent: true, consent: 'unasked' }), false);
  assert.equal(V.consentSettled({ ...base, consent: 'yes' }), true);
  assert.equal(V.consentSettled({ ...base, consent: 'no' }), true);
  // The start failed: nothing will ask.
  assert.equal(V.consentSettled({ ...base, startFailed: true }), true);
  // Not another family cook's dish: nothing to ask.
  assert.equal(V.consentSettled({ ...base, liveOn: false }), true);
});

await test('a memorial cook (or the dev aid, or no dish yet) has no "Let Mom see" session, so nothing waits', () => {
  const on = { enabled: true, cookId: 'p-grandma', memorial: false, recipeId: 'biryani', total: 6 };
  assert.equal(V.cookingSessionOn(on), true);
  assert.equal(V.cookingSessionOn({ ...on, memorial: null }), true);
  assert.equal(V.cookingSessionOn({ ...on, memorial: true }), false);
  assert.equal(V.cookingSessionOn({ ...on, enabled: false }), false);
  assert.equal(V.cookingSessionOn({ ...on, cookId: null }), false);
  assert.equal(V.cookingSessionOn({ ...on, recipeId: undefined }), false);
  assert.equal(V.cookingSessionOn({ ...on, total: 0 }), false);
  // The memorial cook's visit: the hook is off, so consent stays 'unknown' and nothing asks; settled at once.
  const liveOn = V.cookingSessionOn({ ...on, memorial: true });
  assert.equal(V.consentSettled({ askConsent: false, liveOn, consent: 'unknown', startFailed: false }), true);
});

await test('the phone reads aloud itself when no voice line will: no service here, or the line gave up or failed', () => {
  // Expo Go or web: no line at all.
  assert.equal(V.phoneReads({ voiceHere: false, live: false, unavailable: false }), true);
  // A dev build, still connecting (or not tried yet): wait for the line.
  assert.equal(V.phoneReads({ voiceHere: true, live: false, unavailable: false }), false);
  // A dish Convex doesn't know, a 4404, a line lost for good, or the local stub.
  assert.equal(V.phoneReads({ voiceHere: true, live: false, unavailable: true }), true);
  // homie reads on the line.
  assert.equal(V.phoneReads({ voiceHere: true, live: true, unavailable: false }), false);
});

await test('app-only moments: her answer and "Ask Grandma anything"; the service’s own offers never are', () => {
  assert.equal(V.appMomentKind('answer:q123'), 'answer');
  assert.equal(V.appMomentKind('ask:1729800000000'), 'ask');
  for (const id of ['read:1', 'story:2', 'help:3', 'mic:4', '', null, undefined]) assert.equal(V.appMomentKind(id), null, String(id));
});

await test('the shared contract: { type: "moment" } open with its kind, closed without; "no" declines; offer_closed', () => {
  assert.deepEqual(V.momentMessage('answer'), { type: 'moment', open: true, kind: 'answer' });
  assert.deepEqual(V.momentMessage('ask'), { type: 'moment', open: true, kind: 'ask' });
  assert.equal(JSON.stringify(V.momentMessage('story')), '{"type":"moment","open":true,"kind":"story"}');
  assert.equal(JSON.stringify(V.momentMessage(null)), '{"type":"moment","open":false}');
  assert.equal(V.DECLINE_TEXT, 'no');
  assert.equal(V.offerClosed({ type: 'offer_closed', accepted: true }), true);
  assert.equal(V.offerClosed({ type: 'offer_closed', accepted: false }), false);
  // Anything but a real true is not reading.
  assert.equal(V.offerClosed({ type: 'offer_closed' }), false);
  assert.equal(V.offerClosed({ type: 'offer_closed', accepted: 'yes' }), false);
});

await test('a spoken yes is what homie takes for yes; no, not now and later are no; commands are neither', () => {
  for (const t of ['yes', 'Yes!', 'yeah', 'sure, read it', 'okay', 'ok', 'please', 'yes please', 'Let\'s hear it', 'go ahead']) assert.equal(V.yesNo(t), 'yes', t);
  for (const t of ['no', 'No.', 'nope', 'nah', 'not now', 'no thanks', 'later', 'maybe later', 'um, no', 'skip it', 'don\'t']) assert.equal(V.yesNo(t), 'no', t);
  // Commands go the usual way, as on the service ("ok next" is next, not yes).
  for (const t of ['next', 'ok next', 'go back', 'repeat', 'again', 'what', 'um, next please']) assert.equal(V.yesNo(t), null, t);
  for (const t of ['how much salt?', 'I don’t know', '', 'nobody told me']) assert.equal(V.yesNo(t), null, t);
});

await test('a yes-or-no moment: no buttons and the listening bars when the kid can answer out loud', () => {
  const onChoose = () => {};
  const m = V.yesNoMoment({ id: 'read:1', question: 'Want me to read each step out loud?', hearing: true, button: 'Read it to me', onChoose });
  assert.deepEqual(m.options, []);
  assert.equal(m.bars, true);
  assert.deepEqual(m.prompt, { label: 'Say “yes” or “no”' });
  assert.equal(m.tapToClose, 'Tap anywhere to close');
  assert.equal(m.onChoose, onChoose);
});

await test('a yes-or-no moment on a phone that can’t hear: one yes button, a tap anywhere still closes', () => {
  const m = V.yesNoMoment({ id: 'answer:q1', question: 'Grandma answered your question', questionEn: '“How much salt?”', hearing: false, button: 'Play it', onChoose: () => {} });
  assert.deepEqual(m.options, [{ id: 'yes', label: 'Play it', kind: 'primary' }]);
  assert.equal(m.bars, undefined);
  assert.equal(m.prompt, undefined);
  assert.equal(m.tapToClose, 'Tap anywhere to close');
  assert.equal(m.questionEn, '“How much salt?”');
});

// ---------------------------------------------------------------------------------------------
// The pot

await test('the pot: listening with the mic on, thinking after the kid spoke, off when muted or off', () => {
  const base = { status: 'listening', muted: false, thinking: false, timers: 0, timerDue: false };
  assert.equal(V.cookPotState(base), 'listening');
  assert.equal(V.cookPotState({ ...base, thinking: true }), 'thinking');
  assert.equal(V.cookPotState({ ...base, muted: true }), 'off');
  assert.equal(V.cookPotState({ ...base, muted: true, thinking: true }), 'off');
  assert.equal(V.cookPotState({ ...base, status: 'off' }), 'off');
  assert.equal(V.cookPotState({ ...base, status: 'error' }), 'off');
  assert.equal(V.cookPotState({ ...base, status: 'connecting' }), 'thinking');
});

await test('the pot: a timer shows when the mic is off, and a timer at zero wins over everything', () => {
  const base = { status: 'off', muted: false, thinking: false, timers: 1, timerDue: false };
  assert.equal(V.cookPotState(base), 'timer');
  // Listening keeps its steam; the ring shows anyway (it follows store.timer).
  assert.equal(V.cookPotState({ ...base, status: 'listening' }), 'listening');
  assert.equal(V.cookPotState({ ...base, status: 'listening', thinking: true, timerDue: true }), 'timer');
  assert.equal(V.cookPotState({ ...base, status: 'connecting', timerDue: true }), 'timer');
});

// ---------------------------------------------------------------------------------------------
// Timers

await test('a timer ends `seconds` from now on the phone’s clock, not the service’s endsAt', () => {
  const t = V.parseTimer({ id: 'timer-1', seconds: 300, label: 'rice', endsAt: 99 }, 1_000_000);
  assert.deepEqual(t, { id: 'timer-1', label: 'rice', endsAt: 1_300_000, totalS: 300 });
});

await test('a timer without a label is "timer"; a malformed one is dropped', () => {
  assert.equal(V.parseTimer({ id: 't', seconds: 60 }, 0).label, 'timer');
  assert.equal(V.parseTimer({ id: 't', seconds: 60, label: '  ' }, 0).label, 'timer');
  assert.equal(V.parseTimer({ seconds: 60 }, 0), null);
  assert.equal(V.parseTimer({ id: '', seconds: 60 }, 0), null);
  assert.equal(V.parseTimer({ id: 't', seconds: 0 }, 0), null);
  assert.equal(V.parseTimer({ id: 't', seconds: -5 }, 0), null);
  assert.equal(V.parseTimer({ id: 't', seconds: 'soon' }, 0), null);
  assert.equal(V.parseTimer({ id: 't', seconds: 25 * 3600 }, 0), null);
  // A string number from a loose server still counts.
  assert.equal(V.parseTimer({ id: 't', seconds: '90' }, 0).totalS, 90);
});

await test('timers stay soonest first; the same id replaces the old one; done ones leave', () => {
  const a = V.parseTimer({ id: 'a', seconds: 600 }, 0);
  const b = V.parseTimer({ id: 'b', seconds: 60 }, 0);
  let list = V.withTimer([], a);
  list = V.withTimer(list, b);
  assert.deepEqual(list.map((t) => t.id), ['b', 'a']);
  list = V.withTimer(list, V.parseTimer({ id: 'b', seconds: 900 }, 0));
  assert.deepEqual(list.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(V.withoutTimer(list, 'a').map((t) => t.id), ['b']);
  assert.deepEqual(V.withoutTimer(list, 'nope').map((t) => t.id), ['a', 'b']);
});

await test('a timer is known by its id and its end, so a new socket’s "timer-1" is a new timer', () => {
  const first = V.parseTimer({ id: 'timer-1', seconds: 60 }, 0);
  const again = V.parseTimer({ id: 'timer-1', seconds: 60 }, 90_000);
  assert.equal(V.timerKey(first), 'timer-1:60000');
  assert.notEqual(V.timerKey(first), V.timerKey(again));
  assert.equal(V.timerKey(first), V.timerKey({ ...first }));
});

await test('seconds left round up, so 0 only once it is done', () => {
  const t = { endsAt: 10_000 };
  assert.equal(V.secondsLeft(t, 0), 10);
  assert.equal(V.secondsLeft(t, 100), 10);
  assert.equal(V.secondsLeft(t, 9_001), 1);
  assert.equal(V.secondsLeft(t, 10_000), 0);
  assert.equal(V.secondsLeft(t, 20_000), 0);
});

await test('the pill’s clock: m:ss, and h:mm:ss past an hour', () => {
  assert.equal(V.clockText(0), '0:00');
  assert.equal(V.clockText(9), '0:09');
  assert.equal(V.clockText(272), '4:32');
  assert.equal(V.clockText(720), '12:00');
  assert.equal(V.clockText(3900), '1:05:00');
  assert.equal(V.clockText(-3), '0:00');
});

await test('VoiceOver hears the timer in words', () => {
  assert.equal(V.timerA11y({ label: 'rice', endsAt: 272_000 }, 0), 'Rice timer, 4 minutes 32 seconds left');
  assert.equal(V.timerA11y({ label: 'timer', endsAt: 60_000 }, 0), 'Timer, 1 minute left');
  assert.equal(V.timerA11y({ label: 'dal', endsAt: 3_601_000 }, 0), 'Dal timer, 1 hour 1 second left');
  assert.equal(V.timerA11y({ label: 'rice', endsAt: 5_000 }, 9_000), 'Rice timer is done');
});

// ---------------------------------------------------------------------------------------------
// The cook's answers

const row = (id, over = {}) => ({
  _id: id,
  _creationTime: 1_000,
  status: 'answered',
  text: 'How much salt?',
  askedByName: 'Shreya',
  answerAudioUrl: `https://files/${id}.m4a`,
  ...over,
});

await test('answers to hear: my answered questions with a voice note, newest first', () => {
  const rows = [
    row('old', { _creationTime: 500 }),
    row('new', { _creationTime: 2_000 }),
    row('waiting', { status: 'asked_cook', answerAudioUrl: null }),
    row('typed', { answerAudioUrl: null }),
    row('video', { status: 'found_in_video', answerAudioUrl: null }),
    row('leo', { askedByName: 'Leo' }),
  ];
  const got = V.answersToHear(rows, { myName: 'Shreya', heard: new Set(), since: 0 });
  assert.deepEqual(got.map((r) => r._id), ['new', 'old']);
});

await test('answers to hear: my name in any case, or a question sent from this cook mode', () => {
  const rows = [row('a', { askedByName: ' shreya ' }), row('b', { askedByName: '' }), row('c', { askedByName: 'Leo' })];
  assert.deepEqual(V.answersToHear(rows, { myName: 'Shreya', heard: new Set(), since: 0 }).map((r) => r._id), ['a']);
  assert.deepEqual(V.answersToHear(rows, { myName: 'Shreya', mine: new Set(['b']), heard: new Set(), since: 0 }).map((r) => r._id).sort(), ['a', 'b']);
  // Nobody signed in: only the ones this cook mode sent.
  assert.deepEqual(V.answersToHear(rows, { myName: null, mine: new Set(['c']), heard: new Set(), since: 0 }).map((r) => r._id), ['c']);
  assert.deepEqual(V.answersToHear(rows, { myName: '', heard: new Set(), since: 0 }), []);
});

await test('answers to hear: never one already played, one put off this visit, or an old question', () => {
  const rows = [row('heard'), row('later'), row('old', { _creationTime: 10 }), row('fresh')];
  const got = V.answersToHear(rows, { myName: 'Shreya', heard: new Set(['heard']), skipped: new Set(['later']), since: 100 });
  assert.deepEqual(got.map((r) => r._id), ['fresh']);
});

// ---------------------------------------------------------------------------------------------
// Half duplex

await test('silence is zeros the size of the mic chunk, and the same buffer each time', () => {
  const s = V.silence(3200);
  assert.equal(s.byteLength, 3200);
  assert.ok(new Uint8Array(s).every((b) => b === 0));
  assert.equal(V.silence(3200), s);
  assert.equal(V.silence(320).byteLength, 320);
});

console.log(`\n${passed} passed`);
