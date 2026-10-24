// Unit tests for cook mode's voice rules (TS run by Node's type stripping):
//   src/lib/live/voiceLogic.ts  a say's kind (an older service sends none), which says are offers (read
//                               aloud, a story), the label under the pot, what the pot shows, kitchen
//                               timers on the phone's clock (parse, order, countdown, words), which of the
//                               cook's answers to offer, and the silence sent instead of the mic
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
