// Unit tests for cook mode's voice rules (TS run by Node's type stripping):
//   src/lib/live/voiceLogic.ts  a say's kind (an older service sends none), which says are offers (read
//                               aloud, a story), the label under the pot, which say_end is whose, the
//                               service's echo of a text, waiting for the "Let Mom see" answer (none for
//                               a memorial cook), when the phone reads aloud itself, app-only moments and
//                               the offer's end (the shared contract's messages; the service's answer
//                               kept), a spoken yes or no (and a whole one, as the service has it), when
//                               homie is 'thinking', the no-buttons yes-or-no moment, what the pot shows,
//                               kitchen timers on the phone's clock (parse, order, key, countdown, words),
//                               which of the cook's answers to offer, the silence the mic hands on, the
//                               Cartesia credit fixes (which frames go to /cook, the app leaving), and one
//                               socket at a time (a retry or a connect from before a pause)
//   node scripts/test-voice-ui.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

await test('a spoken yes or no is what homie takes for one (voice/src/cook.ts isYes and NO_REPLY); commands are neither', () => {
  for (const t of ['yes', 'Yes!', 'yeah', 'sure, read it', 'okay', 'ok', 'please', 'yes please', 'Let\'s hear it', 'go ahead', 'yes, play it']) assert.equal(V.yesNo(t), 'yes', t);
  for (const t of ['no', 'No.', 'nope', 'nah', 'not now', 'no thanks', 'no thank you', 'later', 'maybe later', 'um, no', 'skip it', 'not right now', 'I\'m good', 'no, not now', 'well, nah']) assert.equal(V.yesNo(t), 'no', t);
  // A no wins, as on the service: "ok, no" declines.
  assert.equal(V.yesNo('ok, no'), 'no');
  // Only a whole no is a no there; a no with more after it goes the usual way, so it isn't one here either.
  for (const t of ['no I want to read it myself', 'don\'t', 'skip']) assert.equal(V.yesNo(t), null, t);
  // Commands go the usual way, as on the service ("ok next" is next, not yes).
  for (const t of ['next', 'ok next', 'go back', 'repeat', 'again', 'what', 'um, next please']) assert.equal(V.yesNo(t), null, t);
  for (const t of ['how much salt?', 'I don’t know', '', 'nobody told me']) assert.equal(V.yesNo(t), null, t);
});

await test('a whole yes or no is the service’s own (voice/src/cook.ts yesOrNo): "yes, play it" isn’t one', () => {
  for (const t of ['yes', 'Yes please', 'play it', 'sure', 'ok', 'of course', 'read it to me', 'yes yes', 'um, yeah']) assert.equal(V.wholeYesNo(t), 'yes', t);
  for (const t of ['no', 'No thanks', 'not now', 'ok, no', 'nah', "I'm good"]) assert.equal(V.wholeYesNo(t), 'no', t);
  for (const t of ['yes, play it', 'yes read it', 'no I want to read it myself', 'next', 'how much salt?', '']) assert.equal(V.wholeYesNo(t), null, t);
  // The same answers as the service's own regexes, read from its source (so the two can't drift).
  const src = readFileSync(join(root, '..', 'voice', 'src', 'cook.ts'), 'utf8');
  const re = (name) => new RegExp(src.match(new RegExp(`const ${name} = /(.+)/;`))[1]);
  const [yes, no] = [re('YES_REPLY'), re('NO_REPLY')];
  const reply = (t) =>
    t.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^((um|uh|oh|ah|hmm|mm|well|wait|okay|ok|so|hey|alright|and|now) )+/, '')
      .replace(/( (please|thanks|thank you))+$/, '');
  const service = (t) => (yes.test(reply(t)) ? 'yes' : no.test(reply(t)) ? 'no' : null);
  for (const t of ['yes', 'yes please', 'play it', 'alright', 'yes, play it', 'no', 'no no', 'maybe later', 'ok, no', 'skip it', 'next', 'go ahead', 'let’s hear it', "let's hear it"]) {
    assert.equal(V.wholeYesNo(t), service(t), t);
  }
});

await test('thinking: never for the echo of the phone’s own text (a tapped "no" gets no answer)', () => {
  const base = { echo: false, appMoment: false, momentUp: false };
  assert.equal(V.thinksAfter({ ...base, echo: true, text: 'no' }), false);
  assert.equal(V.thinksAfter({ ...base, echo: true, text: 'back' }), false);
  assert.equal(V.thinksAfter({ ...base, echo: true, momentUp: true, text: 'no' }), false);
  // The kid's own words get an answer.
  assert.equal(V.thinksAfter({ ...base, text: 'how much salt?' }), true);
  assert.equal(V.thinksAfter({ ...base, text: 'next' }), true);
  // A "no" with nothing up goes to homie's AI, which answers.
  assert.equal(V.thinksAfter({ ...base, text: 'no' }), true);
});

await test('thinking: not for a whole yes or no while an app-only moment is up (the service holds it)', () => {
  const up = { echo: false, appMoment: true, momentUp: true };
  for (const t of ['yes', 'yes please', 'play it', 'no', 'not now', 'ok, no']) assert.equal(V.thinksAfter({ ...up, text: t }), false, t);
  // More than a yes, or a question, still reaches homie's AI.
  for (const t of ['yes, play it', 'how long do I fry it?', 'next']) assert.equal(V.thinksAfter({ ...up, text: t }), true, t);
});

await test('thinking: not for a whole no to the service’s own offer (it closes it and says nothing)', () => {
  const offer = { echo: false, appMoment: false, momentUp: true };
  for (const t of ['no', 'nope', 'not now', 'no thanks']) assert.equal(V.thinksAfter({ ...offer, text: t }), false, t);
  // A yes to the offer gets an answer (it reads, or her clip plays).
  for (const t of ['yes', 'sure, read it', 'yes please']) assert.equal(V.thinksAfter({ ...offer, text: t }), true, t);
});

await test('thinking ends with homie’s answer: an action, a line, or the offer closing', () => {
  for (const t of ['go_to_step', 'play_clip', 'asked_cook', 'timer', 'timer_done', 'say', 'offer_closed']) assert.equal(V.endsThinking(t), true, t);
  for (const t of ['transcript', 'ready', 'say_end', 'error', 'nonsense']) assert.equal(V.endsThinking(t), false, t);
  // offer_closed isn't an action: it never cuts off the line still arriving.
  assert.equal(V.HOMIE_ACTIONS.has('offer_closed'), false);
  assert.equal(V.HOMIE_ACTIONS.has('say'), false);
});

await test('offer_closed: the service’s answer is kept whenever the phone’s differs', () => {
  // The phone had no answer (homie heard it first), or a stale one: the service's wins and is kept.
  assert.equal(V.readAfterOfferClosed(null, true), 'yes');
  assert.equal(V.readAfterOfferClosed(null, false), 'no');
  assert.equal(V.readAfterOfferClosed('no', true), 'yes');
  assert.equal(V.readAfterOfferClosed('yes', false), 'no');
  // The same answer: nothing to change (a tap's "not now" stays unsaved).
  assert.equal(V.readAfterOfferClosed('no', false), null);
  assert.equal(V.readAfterOfferClosed('yes', true), null);
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

await test('credit fix A: /cook gets only the kid’s frames, nothing while the app makes sound or another screen is up', () => {
  assert.equal(V.cookSendsFrame({ quiet: false, focused: true }), true);
  assert.equal(V.cookSendsFrame({ quiet: true, focused: true }), false);
  assert.equal(V.cookSendsFrame({ quiet: false, focused: false }), false);
  assert.equal(V.cookSendsFrame({ quiet: true, focused: false }), false);
});

await test('credit fix B: the app in the background or under a system sheet closes the line', () => {
  const on = { lineOn: true, paused: false, asking: false };
  assert.equal(V.appStateStep({ ...on, next: 'background' }), 'pause');
  assert.equal(V.appStateStep({ ...on, next: 'inactive' }), 'pause');
  // No line on (voice never started, it gave up, or the kid hung up): nothing to close or reopen.
  assert.equal(V.appStateStep({ ...on, lineOn: false, next: 'background' }), null);
  assert.equal(V.appStateStep({ ...on, lineOn: false, next: 'active' }), null);
  // Already paused ('inactive' then 'background'): once.
  assert.equal(V.appStateStep({ ...on, paused: true, next: 'background' }), null);
  // The mic's permission prompt makes iOS 'inactive': not a pause; going home meanwhile is.
  assert.equal(V.appStateStep({ ...on, asking: true, next: 'inactive' }), null);
  assert.equal(V.appStateStep({ ...on, asking: true, next: 'background' }), 'pause');
});

await test('credit fix B: back on top after a pause the line opens again; otherwise nothing changes', () => {
  assert.equal(V.appStateStep({ lineOn: false, paused: true, asking: false, next: 'active' }), 'resume');
  assert.equal(V.appStateStep({ lineOn: true, paused: false, asking: false, next: 'active' }), null);
  // Android and iOS extension states that aren't on top or away.
  for (const next of ['unknown', 'extension']) assert.equal(V.appStateStep({ lineOn: true, paused: true, asking: false, next }), null, next);
  assert.equal(V.appInForeground('active'), true);
  assert.equal(V.appInForeground(null), true);
  assert.equal(V.appInForeground('background'), false);
  assert.equal(V.appInForeground('inactive'), false);
});

await test('one socket at a time: a retry or a connect opens only on its own line, and only with none open', () => {
  assert.equal(V.lineMayOpen({ want: true, line: 0, began: 0, open: false }), true);
  assert.equal(V.lineMayOpen({ want: false, line: 0, began: 0, open: false }), false);
  assert.equal(V.lineMayOpen({ want: true, line: 1, began: 0, open: false }), false);
  assert.equal(V.lineMayOpen({ want: true, line: 0, began: 0, open: true }), false);
});

// The hook's line, step for step (lib/live/voice.ts): stop() bumps `line`; connect() notes the line,
// waits for its Convex session, then opens if lineMayOpen; a dropped socket's retry notes the line too.
function cookLine() {
  const h = { want: false, line: 0, sock: null, opened: [] };
  const may = (began) => V.lineMayOpen({ want: h.want, line: h.line, began, open: !!h.sock });
  /** connect(): returns its session resolving. */
  const connect = () => {
    const began = h.line;
    return () => {
      if (!may(began)) return;
      h.sock = `#${h.opened.length + 1}`;
      h.opened.push(h.sock);
    };
  };
  return {
    h,
    connect,
    start: () => {
      h.want = true;
      return connect();
    },
    /** The service drops the socket (1011): returns the retry firing 1.5 s later. */
    drop: () => {
      h.sock = null;
      const on = h.line;
      return () => may(on) && connect()();
    },
    stop: () => {
      h.want = false;
      h.line += 1;
      h.sock = null;
    },
    resume: () => {
      if (h.want || h.sock) return () => {};
      h.want = true;
      return connect();
    },
  };
}

await test('one socket at a time: a drop, then a pause and a resume before the retry fires', () => {
  const l = cookLine();
  l.start()();
  const retry = l.drop();
  l.stop(); // the app goes to the background
  l.resume()(); // back on top: a new socket
  retry(); // the old retry fires: nothing
  assert.deepEqual(l.h.opened, ['#1', '#2']);
  assert.equal(l.h.sock, '#2');
  // A drop with no pause still retries.
  const again = l.drop();
  again();
  assert.deepEqual(l.h.opened, ['#1', '#2', '#3']);
});

await test('one socket at a time: a pause and a resume while the first connect waits for its session', () => {
  for (const order of ['first-resolves-first', 'second-resolves-first']) {
    const l = cookLine();
    const first = l.start();
    l.stop();
    const second = l.resume();
    if (order === 'first-resolves-first') (first(), second());
    else (second(), first());
    assert.deepEqual(l.h.opened, ['#1'], order);
  }
  // Hung up for good meanwhile (the kid, or leaving the screen): no socket at all.
  const l = cookLine();
  const first = l.start();
  l.stop();
  first();
  assert.deepEqual(l.h.opened, []);
});

console.log(`\n${passed} passed`);
