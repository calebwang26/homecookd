// Unit tests for cook mode's voice rules (TS run by Node's type stripping):
//   src/lib/live/voiceLogic.ts  a say's kind (an older service sends none), which says are offers (read
//                               aloud, a story), the label under the pot, which say_end is whose, the
//                               service's echo of a text, waiting for the "Let Mom see" answer (none for
//                               a memorial cook), when the phone reads aloud itself, app-only moments and
//                               the offer's end (the shared contract's messages; the service's answer
//                               kept), a spoken yes or no and what follows a no (the service's own rules,
//                               checked against voice/src/yesNo.ts), when homie is 'thinking', the
//                               no-buttons yes-or-no moment, what the pot shows (true to the mic),
//                               homie on or off (a tap, a step line's 8 s window, a turn begun in it),
//                               what a tap does (never the chat), kitchen timers on the
//                               phone's clock (parse, order, ids per socket, each buzzing once, at its
//                               zero here or the service's timer_done, whichever comes first, countdown,
//                               words),
//                               which of the cook's answers to offer, the silence the mic hands on, the
//                               Cartesia credit fixes (which frames go to /cook, the app leaving), and one
//                               socket at a time (a retry or a connect from before a pause), and which
//                               lines wait while a video plays (the same split as the service's)
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
// The service's own yes and no (#47), so the phone's copy can't drift from it.
const S = await import(pathToFileURL(join(root, '..', 'voice', 'src', 'yesNo.ts')).href);

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

await test('homie never talks over a video: what it says on its own waits, an answer to the kid doesn’t', () => {
  for (const k of ['greeting', 'nudge', 'timer']) assert.equal(V.waitsForVideo(k), true, k);
  // A step's line answers the kid's flip (made ahead, said at once); the read-aloud offer is gone.
  for (const k of ['step', 'reply', 'hint', 'translation', 'offer']) assert.equal(V.waitsForVideo(k), false, k);
  // The same split as the service's (voice/src/cook.ts UNPROMPTED).
  const cook = readFileSync(join(root, '..', 'voice', 'src', 'cook.ts'), 'utf8');
  const unprompted = cook.match(/const UNPROMPTED[^=]*= new Set\(\[([^\]]*)\]/)[1].match(/"(\w+)"/g).map((w) => w.slice(1, -1));
  assert.deepEqual(unprompted.sort(), ['greeting', 'nudge', 'timer']);
  assert.deepEqual(V.videoMessage(true), { type: 'video', playing: true });
  assert.deepEqual(V.videoMessage(false), { type: 'video', playing: false });
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

// The phrases of the service's own tests (voice/test/yesNo.test.ts, #47).
const SAID_YES = [
  'Yes.', 'Yes please.', 'Yeah.', 'Yep!', 'Yup', 'Sure.', 'Okay.', 'OK', 'Alright.', 'All right.', 'Please.',
  'Of course.', 'Go ahead.', 'Do it.', 'Play it.', 'Read it.', "Let's hear it.", 'Read it out loud.', 'Can do.',
  'Sure, read it.', 'Yeah, go ahead.', 'Yes, play it.', 'Yes, I want to hear it.', 'Okay sure.', 'Okay, yes please.',
  'Um, yes.', 'Oh, okay.', 'Okay, go ahead and read it.', 'Please read it to me.', 'Okay, thanks.', 'Okay?',
  'Yes, but how much ginger?', 'Yes, no problem.', 'Sure, no worries.',
  'Please do.', "Okay, let's do it.", 'Okay, sounds good.', 'Okay cool.', 'Ok go.', 'Okay, I want to hear it.',
  'Please read the recipe.', "Alright, let's hear it.", 'Okay, will do.',
];
const SAID_NO = [
  'No.', 'No thanks.', 'No, thank you.', 'Nope.', 'Nah.', "Don't.", 'Dont', 'Don’t.', 'Not now.', 'Not right now.',
  'No, not right now.', "Nah, I'm good.", "I'm good.", 'Im good, thanks.', "No, I don't want that.", 'Not really.',
  'Not yet.', 'Later.', 'Maybe later.', 'Skip it.', 'No, maybe later.', 'Um, no.', 'Well, not now.',
  'Okay, no.', 'Okay, no thanks.', "Please don't.", 'No no no.', 'Not now, thanks.', "Don't read it.",
  "Don't bother.", "Don't worry about it.", 'Of course not.', 'Not really, thanks.', "No, it's fine.",
  'Oh, no thanks.', 'Oh no, not now.', 'Oh, no.', "Oh no, I'm good.", 'Oh no no, maybe later.',
  'Yeah, no.', "Yeah no, I'm good.", 'Yes, not now.', 'Sure, but not right now.',
];
const SAID_NEITHER = [
  'Next step.', "What's the next step?", "Okay, what's the next step?", 'Okay, next step.', 'Okay, next.', 'Please go back.',
  'Wait, go back.', 'Repeat that.', 'Say that again.', 'What?', 'Now what?', 'Okay, now what?', 'Okay, how much salt do I add?',
  'How hot should the oil be?', 'Okay, set a timer for 5 minutes.', 'Set a timer for five minutes.', 'Okay, go on.',
  'Okay, done.', 'Okay, wait.', 'Alright, is the oil hot enough?', 'Please, a timer for 5 minutes.', 'Okay, the rice is soft?',
  'Okay, do I add the salt now?', 'Please say that again.',
  'Know what?', 'Nothing.', 'Now.', 'Nobody told me.', 'Not yet sure how much salt.', "Later I'll add the ginger.",
  'Yesterday Grandma said so.', "Surely it's done.", 'No problem.', 'No worries.', 'No idea how much ginger.',
  "Don't know how much salt.", "Don't understand step two.", 'Thanks.', 'Um', '', '...', 'Okayish.', "I'm sure it's fine.",
  'Not really sure how much salt.', 'No clue how much ginger.', 'No one told me how much salt.', "I'm good at this.",
  "Don't forget the timer.", 'Oh no, I burned it!', "Oh no, it's boiling over.", 'Oh no no no, the rice!',
];
// A plain command right after a no: the service still runs it, without Claude.
const NO_THEN_COMMAND = [
  ['No, next step.', 'next step'], ['No, go back.', 'go back'], ["Nah, what's next?", "what's next"],
  ['No thanks, next step please.', 'next step'], ['Not now, set a timer for 5 minutes.', 'set a timer for 5 minutes'],
  ['Okay, no, go back.', 'go back'], ['Nah, no need, next step.', 'next step'], ['No, but repeat that.', 'repeat that'],
];
// More than the no: the service gives Claude the whole sentence.
const MORE_AFTER_NO = [
  'No point in reading it.', 'No, no point reading it out loud.', 'No, no need at all to read it.', 'No, no need of reading it.',
  'Nah, no need really to read it.', "No, I'm out of ginger. Can I skip it?", "No, it's burning, what do I do?",
  "No, the oil's too hot?", 'No, too hot?', 'No, go to step 3.', 'No, play the video.', 'No, tell me the story.',
  'Nah, show me the video.', 'No, skip this step.', 'No, why?', 'No, but how much salt do I add?', 'No, just read it.',
  'No? Fine.', 'No, too salty.', "No, don't set a timer for 5 minutes.",
];
// Only the no: nothing goes on.
const ONLY_NO = [
  'No.', 'No, thanks.', 'No thanks.', 'No, not now.', "Nah, I'm good.", 'No, maybe later.', "No, I'm good for now.",
  "Nah, that's okay.", "No, it's fine.", "No, don't read it.", 'No, skip it.', 'No, not today, thanks.', "No, I'm all good.",
  'No, no need.', "No, I don't want to hear it.", "No, I don't want that.",
  'No, no need to read it.', 'Nope, no need to read it out loud.', 'Nah, no need for that.', 'No, no need to play it.',
  'No need to read it.', 'No need.', "No, there's no need.", 'No, no need to.', 'Nah, no need for now.',
  "No, no need, I'm good.", 'Oh no, no need to read it.', 'No thanks, no need to read it.', 'No point.',
  "No, I'm all right.", 'No, I got it.', "No, I've got it.", 'No, I can do it.', "No, I'm good on that.",
  "Nah, I'm fine with that.", "No, you don't have to.", "No, I'm good, thank you so much.",
];

await test('a spoken yes or no follows the service’s rules (#47): a yes word whatever follows, a no wins', () => {
  for (const t of SAID_YES) assert.equal(V.yesNo(t), 'yes', t);
  for (const t of SAID_NO) assert.equal(V.yesNo(t), 'no', t);
  for (const t of SAID_NEITHER) assert.equal(V.yesNo(t), null, t);
});

await test('after a no: a plain command is the fast tail, more is more, and more no is only the no', () => {
  for (const [t, fastTail] of NO_THEN_COMMAND) {
    assert.deepEqual(V.afterNo(t), { more: true, fastTail }, t);
    assert.equal(V.yesNo(t), 'no', t);
  }
  for (const t of MORE_AFTER_NO) {
    assert.equal(V.afterNo(t).more, true, t);
    assert.equal(V.yesNo(t), 'no', t);
  }
  for (const t of ONLY_NO) {
    assert.deepEqual(V.afterNo(t), { more: false, fastTail: '' }, t);
    assert.equal(V.yesNo(t), 'no', t);
  }
  for (const t of ['Yes, next step.', 'Next step.', 'Oh no, go back!', 'How much salt?']) assert.deepEqual(V.afterNo(t), { more: false, fastTail: '' }, t);
});

await test('the phone’s yes and no are the service’s own (voice/src/yesNo.ts), phrase for phrase', () => {
  const all = [...SAID_YES, ...SAID_NO, ...SAID_NEITHER, ...NO_THEN_COMMAND.map(([t]) => t), ...MORE_AFTER_NO, ...ONLY_NO];
  for (const t of all) {
    assert.equal(V.yesNo(t), S.yesNo(t), t);
    assert.deepEqual(V.afterNo(t), S.afterNo(t), t);
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
  // A yes or a no with nothing up goes to homie's AI, which answers.
  for (const t of ['no', 'No, not right now.', "Don't.", 'Sure, read it.']) assert.equal(V.thinksAfter({ ...base, text: t }), true, t);
});

await test('thinking: not for a yes, or a no with nothing more, while an app-only moment is up (the service holds it)', () => {
  const up = { echo: false, appMoment: true, momentUp: true };
  for (const t of ['yes', 'Sure, read it.', 'Yes, play it.', 'Please do.', 'Yes, but how much ginger?', 'no', 'No, not right now.', "Don't.", 'Okay, no.', 'No, no need to read it.']) {
    assert.equal(V.thinksAfter({ ...up, text: t }), false, t);
  }
  // More after a no, a command or a question still reaches homie (the fast path or its AI).
  for (const t of ["No, I'm out of ginger. Can I skip it?", 'No, next step.', 'No point in reading it.', "Okay, what's the next step?", 'how long do I fry it?', 'next']) {
    assert.equal(V.thinksAfter({ ...up, text: t }), true, t);
  }
});

await test('thinking: not for a no with nothing more to the service’s own offer (it closes it and says nothing)', () => {
  const offer = { echo: false, appMoment: false, momentUp: true };
  for (const t of ['no', 'nope', 'No, not right now.', "Don't.", 'No thanks.', "Nah, I'm good.", 'Oh, no thanks.']) assert.equal(V.thinksAfter({ ...offer, text: t }), false, t);
  // A yes gets an answer (it reads, or her clip plays), and so does more after a no.
  for (const t of ['yes', 'Sure, read it.', 'yes please', "No, I'm out of ginger. Can I skip it?", 'No, next step.', 'No point in reading it.']) {
    assert.equal(V.thinksAfter({ ...offer, text: t }), true, t);
  }
});

await test('thinking ends with homie’s answer: an action, a line, or the offer closing', () => {
  for (const t of ['go_to_step', 'play_clip', 'asked_cook', 'timer', 'timer_done', 'say', 'offer_closed', 'quiet']) assert.equal(V.endsThinking(t), true, t);
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

await test('the pot: listening only while homie is on and the recorder streams, thinking after the kid spoke, else off', () => {
  const base = { active: true, listening: true, sounding: false, thinking: false, timers: 0, timerDue: false };
  assert.equal(V.cookPotState(base), 'listening');
  assert.equal(V.cookPotState({ ...base, thinking: true }), 'thinking');
  // homie off (the line open or not): a plain pot, even with words waiting for an answer.
  assert.equal(V.cookPotState({ ...base, active: false, listening: false }), 'off');
  assert.equal(V.cookPotState({ ...base, active: false, listening: false, thinking: true }), 'off');
  // On, but the recorder hasn't started yet (the permission prompt, the line still opening): not listening.
  assert.equal(V.cookPotState({ ...base, listening: false }), 'off');
  assert.equal(V.cookPotState({ ...base, listening: false, thinking: true }), 'off');
});

await test('the pot: never listening while the app makes sound (every frame is zeroed then); thinking stays', () => {
  const on = { active: true, listening: true, sounding: true, thinking: false, timers: 0, timerDue: false };
  assert.equal(V.cookPotState(on), 'off', 'a video or her voice plays: homie hears nothing');
  assert.equal(V.cookPotState({ ...on, timers: 1 }), 'timer');
  assert.equal(V.cookPotState({ ...on, thinking: true }), 'thinking', 'the answer is still on its way');
});

await test('the pot: a timer shows while homie is off; the mic on always shows as listening or thinking', () => {
  const base = { active: false, listening: false, sounding: false, thinking: false, timers: 1, timerDue: false };
  assert.equal(V.cookPotState(base), 'timer');
  assert.equal(V.cookPotState({ ...base, timers: 0, timerDue: true }), 'timer');
  // The ring shows anyway (it follows store.timer); the state stays true to the mic.
  assert.equal(V.cookPotState({ ...base, active: true, listening: true }), 'listening');
  assert.equal(V.cookPotState({ ...base, active: true, listening: true, thinking: true, timerDue: true }), 'thinking');
  assert.equal(V.cookPotState({ ...base, active: true, listening: true, timerDue: true }), 'listening');
});

// ---------------------------------------------------------------------------------------------
// homie on or off (Caleb, Oct 24: one tap on, the next off; 8 s after a step line; no always-on mic)

await test('a tap toggles what the kid sees: a quiet pot goes on, a listening one (a tap or a window) goes off', () => {
  assert.equal(V.micAfter('off', 'tap'), 'tap');
  for (const hold of ['tap', 'window', 'turn']) assert.equal(V.micAfter(hold, 'tap'), 'off', hold);
  // On by a tap: a window, its end or a turn's answer never turn it off; only the next tap or the idle minute.
  for (const e of ['step_line_end', 'window_timeout', 'heard', 'answered', 'cap']) assert.equal(V.micAfter('tap', e), 'tap', e);
  assert.equal(V.micAfter('tap', 'idle'), 'off');
  for (const hold of ['off', 'window', 'turn']) assert.equal(V.micAfter(hold, 'idle'), hold, hold);
});

await test('a step line’s end opens a window; the kid’s words hold it for the turn; its 8 s, the answer or the cap close it', () => {
  assert.equal(V.micAfter('off', 'step_line_end'), 'window');
  assert.equal(V.micAfter('window', 'step_line_end'), 'window');
  // "next step" said in a window: homie moves on and says the next line, which opens a fresh window.
  assert.equal(V.micAfter('turn', 'step_line_end'), 'window');
  assert.equal(V.micAfter('window', 'heard'), 'turn');
  assert.equal(V.micAfter('turn', 'heard'), 'turn');
  assert.equal(V.micAfter('window', 'window_timeout'), 'off');
  assert.equal(V.micAfter('turn', 'window_timeout'), 'turn', 'the kid is talking: the window’s count no longer closes it');
  assert.equal(V.micAfter('turn', 'answered'), 'off');
  assert.equal(V.micAfter('window', 'answered'), 'window');
  for (const hold of ['window', 'turn']) assert.equal(V.micAfter(hold, 'cap'), 'off', hold);
  // Off stays off unless a tap or a step line: late words never open the mic.
  for (const e of ['window_timeout', 'heard', 'answered', 'cap', 'idle']) assert.equal(V.micAfter('off', e), 'off', e);
  // The order of a step line's end and the answer's end doesn't matter.
  assert.equal(V.micAfter(V.micAfter('turn', 'answered'), 'step_line_end'), 'window');
  assert.equal(V.micAfter(V.micAfter('turn', 'step_line_end'), 'answered'), 'window');
});

await test('the mic’s timers: 8 s of really hearing, a beat after the answer, the 20 s cap, the idle minute', () => {
  const base = { hold: 'window', listening: true, sounding: false, thinking: false, talking: false, kidTalking: false, heardFinal: false, openFor: 0 };
  assert.deepEqual(V.micTimer(base), { ms: V.LISTEN_WINDOW_MS, event: 'window_timeout' });
  assert.equal(V.LISTEN_WINDOW_MS, 8000);
  // The count waits while the mic hears nothing (homie's line, a video, her voice) or is still starting:
  // only the cap runs then.
  const cap = (openFor) => ({ ms: V.TURN_MAX_MS - openFor, event: 'cap' });
  assert.deepEqual(V.micTimer({ ...base, sounding: true, talking: true }), cap(0));
  assert.deepEqual(V.micTimer({ ...base, sounding: true, openFor: 5000 }), cap(5000), 'a video: the count waits');
  assert.deepEqual(V.micTimer({ ...base, listening: false }), cap(0));
  // Near the cap, the cap comes first.
  assert.deepEqual(V.micTimer({ ...base, openFor: 15_000 }), cap(15_000));
  assert.deepEqual(V.micTimer({ ...base, openFor: 25_000 }), { ms: 0, event: 'cap' });
  const turn = { ...base, hold: 'turn' };
  assert.deepEqual(V.micTimer(turn), { ms: V.ANSWER_GRACE_MS, event: 'answered' });
  assert.deepEqual(V.micTimer({ ...turn, thinking: true }), cap(0), 'the answer is on its way');
  assert.deepEqual(V.micTimer({ ...turn, talking: true, sounding: true }), cap(0), 'homie is answering');
  assert.deepEqual(V.micTimer({ ...turn, kidTalking: true }), cap(0), 'mid-sentence (Ink needs the audio to end the turn)');
  // Once the first finished words came, more talking (a TV, a sibling) never holds the turn.
  assert.deepEqual(V.micTimer({ ...turn, kidTalking: true, heardFinal: true }), { ms: V.ANSWER_GRACE_MS, event: 'answered' });
  // On by a tap: a minute with the mic hearing and nobody talking or answering.
  const tap = { ...base, hold: 'tap' };
  assert.deepEqual(V.micTimer(tap), { ms: V.TAP_IDLE_MS, event: 'idle' });
  assert.equal(V.TAP_IDLE_MS, 60_000);
  for (const k of ['sounding', 'thinking', 'kidTalking']) assert.equal(V.micTimer({ ...tap, [k]: true }), null, k);
  assert.equal(V.micTimer({ ...tap, listening: false }), null);
  assert.equal(V.micTimer({ ...base, hold: 'off' }), null);
});

await test('a word or two never starts or holds a turn; two or more do', () => {
  for (const t of ['um', 'Yeah', '  okay  ', '']) assert.equal(V.turnWords(t), false, t);
  for (const t of ['how much', 'How much salt goes in', 'next step']) assert.equal(V.turnWords(t), true, t);
});

await test('the window’s edge waits for a kid mid-sentence, up to 3 s more', () => {
  const quiet = { loudAgo: 5000, wordsAgo: Infinity, extended: 0 };
  assert.equal(V.edgeWait(quiet), 0, 'nobody talking: close at 8 s');
  assert.equal(V.edgeWait({ ...quiet, loudAgo: 200 }), V.SPEECH_TAIL_MS - 200, 'loud just now: wait until it has been quiet a moment');
  assert.ok(V.edgeWait({ ...quiet, wordsAgo: 1000 }) > 0, 'Ink’s words still coming');
  assert.equal(V.edgeWait({ ...quiet, wordsAgo: V.WORDS_OPEN_MS }), 0, 'a stray word that never got a final stops counting');
  assert.equal(V.edgeWait({ ...quiet, loudAgo: 0, extended: V.EDGE_MAX_MS }), 0, 'never past 3 s');
  assert.equal(V.edgeWait({ ...quiet, loudAgo: 0, extended: V.EDGE_MAX_MS - 100 }), 100);
  assert.equal(V.EDGE_MAX_MS, 3000);
});

await test('the recorder runs only while homie is on, the line is open, the screen is on top, the mic isn’t refused and no video plays', () => {
  const on = { hold: 'tap', open: true, focused: true, muted: false, video: false };
  assert.equal(V.micWanted(on), true);
  for (const hold of ['window', 'turn']) assert.equal(V.micWanted({ ...on, hold }), true, hold);
  assert.equal(V.micWanted({ ...on, hold: 'off' }), false, 'homie off: no frames, no Ink');
  assert.equal(V.micWanted({ ...on, open: false }), false, 'the line is still opening (or dropped)');
  assert.equal(V.micWanted({ ...on, focused: false }), false);
  assert.equal(V.micWanted({ ...on, muted: true }), false);
  // A video plays at full volume: no recorder (its voice-chat mode turned the video's sound right down).
  for (const hold of ['tap', 'window', 'turn']) assert.equal(V.micWanted({ ...on, hold, video: true }), false, hold);
});

await test('the rule, both ways: frames go out only while the pot shows listening or thinking, and listening means they do', () => {
  const holds = ['off', 'tap', 'window', 'turn'];
  const bools = [false, true];
  for (const hold of holds)
    for (const open of bools)
      for (const focused of bools)
        for (const muted of bools)
          for (const quiet of bools)
            for (const thinking of bools)
              for (const timerDue of bools) {
                const wanted = V.micWanted({ hold, open, focused, muted, video: false });
                // The recorder streams once it has started for a wanted mic; a frame goes out only then.
                const listening = wanted;
                const sends = listening && V.cookSendsFrame({ quiet, focused, active: wanted });
                const pot = V.cookPotState({ active: hold !== 'off', listening, sounding: quiet, thinking, timers: 1, timerDue });
                const at = JSON.stringify({ hold, open, focused, muted, quiet, thinking, timerDue, pot });
                if (sends) assert.ok(pot === 'listening' || pot === 'thinking', at);
                if (pot === 'listening') assert.ok(sends, at);
                if (!wanted) assert.ok(pot === 'off' || pot === 'timer', at);
              }
});

await test('the kid answers a yes-or-no out loud only with homie on by a tap (a step line’s window may close first)', () => {
  assert.equal(V.hearsAnswers({ live: true, hold: 'tap', listening: true }), true);
  assert.equal(V.hearsAnswers({ live: true, hold: 'window', listening: true }), false);
  assert.equal(V.hearsAnswers({ live: true, hold: 'turn', listening: true }), false);
  assert.equal(V.hearsAnswers({ live: true, hold: 'tap', listening: false }), false);
  assert.equal(V.hearsAnswers({ live: false, hold: 'tap', listening: true }), false);
  assert.equal(V.hearsAnswers({ live: true, hold: 'off', listening: false }), false);
});

await test('a tap in cook mode never navigates: it toggles homie with a voice line, else reads the step, and stops it', () => {
  const none = { voiceHere: false, status: 'off', unavailable: false, talking: false };
  // Expo Go, web, no voice service: the step aloud, and a tap while homie talks stops it.
  assert.equal(V.cookTap(none), 'read');
  assert.equal(V.cookTap({ ...none, talking: true }), 'stop');
  // A build that can open the line (before it opened, while it opens, open): on or off.
  assert.equal(V.cookTap({ ...none, voiceHere: true }), 'toggle');
  for (const status of ['connecting', 'listening']) assert.equal(V.cookTap({ ...none, voiceHere: true, status }), 'toggle', status);
  // The line failed ("Tap homie to try again"): the tap opens it again.
  assert.equal(V.cookTap({ ...none, voiceHere: true, status: 'error', unavailable: true }), 'toggle');
  // No line will read (a dish the service can't cook, or no real service): the phone reads.
  assert.equal(V.cookTap({ ...none, voiceHere: true, unavailable: true }), 'read');
  assert.equal(V.cookTap({ ...none, voiceHere: true, unavailable: true, talking: true }), 'stop');
});

await test('a step her clip moved the screen to goes to the service with read: false; any other with no flag', () => {
  assert.deepEqual(V.stepMessage(3), { type: 'step', stepOrder: 3 });
  assert.deepEqual(V.stepMessage(3, true), { type: 'step', stepOrder: 3 });
  assert.deepEqual(V.stepMessage(3, false), { type: 'step', stepOrder: 3, read: false });
});

/**
 * Cook mode's mic, 100 ms at a time, as lib/live/voice.ts runs it: `hold` follows micAfter; a timer is
 * armed from micTimer whenever what it looks at changes (the hook's effect), and a window's end waits
 * as edgeWait says; the recorder follows micWanted, and a frame goes out unless the app makes sound.
 * `loud`: the kid's voice is in the mic. `sentS`: seconds of audio that reached Ink.
 */
function cookMic() {
  const h = { now: 0, hold: 'off', thinking: false, talking: false, video: false, kidTalking: false, heardFinal: false, finals: 0, loud: false, windowAt: 0, loudAt: -1e9, wordsAt: 0, stepLine: false, sentS: 0 };
  const listening = () => V.micWanted({ hold: h.hold, open: true, focused: true, muted: false, video: h.video });
  const sounding = () => h.talking || h.video;
  const ev = (e) => {
    const next = V.micAfter(h.hold, e);
    if (e === 'step_line_end' && next === 'window') {
      h.windowAt = h.now;
      h.heardFinal = false;
    }
    h.hold = next;
  };
  let armed = null;
  const key = () => JSON.stringify([h.hold, listening(), sounding(), h.thinking, h.talking, h.kidTalking, h.heardFinal, h.finals]);
  const pass = (s) => {
    for (let i = 0; i < Math.round(s * 10); i++) {
      if (listening() && V.cookSendsFrame({ quiet: sounding(), focused: true, active: true })) {
        h.sentS += 0.1;
        if (h.loud) h.loudAt = h.now;
      }
      h.now += 100;
      if (!armed || armed.key !== key()) {
        const t = V.micTimer({ hold: h.hold, listening: listening(), sounding: sounding(), thinking: h.thinking, talking: h.talking, kidTalking: h.kidTalking, heardFinal: h.heardFinal, openFor: h.now - h.windowAt });
        armed = { key: key(), t, due: t ? h.now + t.ms : Infinity, extended: 0 };
      }
      if (armed.t && h.now >= armed.due) {
        const wordsAgo = h.wordsAt ? h.now - h.wordsAt : Infinity;
        const wait = armed.t.event === 'window_timeout' ? V.edgeWait({ loudAgo: h.now - h.loudAt, wordsAgo, extended: armed.extended }) : 0;
        if (wait > 0) {
          armed.extended += wait;
          armed.due = h.now + wait;
        } else {
          ev(armed.t.event);
          armed = null;
        }
      }
    }
  };
  /** homie says a line for `s` seconds; a step line or a nudge opens the window when it ends (unless a tap cancelled it). */
  const line = (s, opens = true) => {
    h.talking = true;
    h.stepLine = opens;
    pass(s);
    h.talking = false;
    if (h.stepLine) ev('step_line_end');
    h.stepLine = false;
  };
  /** The kid's tap: it also cancels the window of a step line still playing. */
  const tap = () => {
    h.stepLine = false;
    ev('tap');
  };
  const partial = (text) => {
    h.wordsAt = h.now;
    if (!V.turnWords(text)) return;
    h.kidTalking = true;
    ev('heard');
  };
  const final = () => {
    h.wordsAt = 0;
    h.kidTalking = false;
    h.heardFinal = true;
    h.finals += 1;
    ev('heard');
  };
  const pot = () => V.cookPotState({ active: h.hold !== 'off', listening: listening(), sounding: sounding(), thinking: h.thinking, timers: 0, timerDue: false });
  return { h, ev, pass, line, tap, partial, final, pot };
}

await test('a step line with nobody talking: 8 s of listening, then off', () => {
  const c = cookMic();
  c.line(3);
  assert.equal(c.pot(), 'listening');
  c.pass(7.8);
  assert.equal(c.pot(), 'listening');
  c.pass(0.4);
  assert.equal(c.h.hold, 'off');
  assert.equal(c.pot(), 'off');
  assert.ok(Math.abs(c.h.sentS - 8) < 0.3, `about 8 s reached Ink: ${c.h.sentS}`);
  c.pass(60);
  assert.ok(c.h.sentS < 8.4, 'nothing more while homie is off');
});

await test('the kid talks in the window: listening, thinking, homie answers, then off a beat later', () => {
  const c = cookMic();
  c.line(3);
  c.pass(5);
  c.partial('how much salt');
  c.pass(4); // past the window's 8 s: the turn holds it
  assert.equal(c.h.hold, 'turn');
  assert.equal(c.pot(), 'listening');
  c.final();
  c.h.thinking = true;
  assert.equal(c.pot(), 'thinking');
  c.pass(1.5);
  c.h.thinking = false; // homie's answer starts
  c.h.talking = true;
  c.pass(3);
  assert.equal(c.h.hold, 'turn', 'still on while homie answers');
  c.h.talking = false;
  c.pass(0.5);
  assert.equal(c.h.hold, 'turn', 'a beat for a line that follows an action');
  c.pass(0.7);
  assert.equal(c.h.hold, 'off');
  assert.equal(c.pot(), 'off');
});

await test('a TV talking in the window: the first finished words and their answer end the turn, more talking doesn’t hold it', () => {
  const c = cookMic();
  c.line(3);
  c.pass(2);
  c.partial('and now the weather for'); // the TV
  c.pass(3);
  c.final();
  c.h.thinking = true;
  c.pass(1);
  c.h.thinking = false; // Claude: not for homie (quiet)
  c.partial('tomorrow looks sunny with'); // the TV keeps going
  c.pass(1.2);
  assert.equal(c.h.hold, 'off');
});

await test('a TV that never stops and never ends a sentence: the turn ends 20 s after the window opened', () => {
  const c = cookMic();
  c.line(3);
  for (let i = 0; i < 40; i++) {
    c.partial('and in other news today the');
    c.pass(0.5);
  }
  assert.equal(c.h.hold, 'off');
  assert.ok(c.h.sentS <= 20.2, `at most 20 s reached Ink: ${c.h.sentS}`);
});

await test('a word or two (um, a stray word) never starts a turn: the window still closes', () => {
  const c = cookMic();
  c.line(3);
  c.pass(2);
  c.partial('um');
  assert.equal(c.h.hold, 'window');
  c.pass(9);
  assert.equal(c.h.hold, 'off');
});

await test('the window’s edge: a kid mid-sentence at 8 s gets up to 3 s more, then it closes', () => {
  const c = cookMic();
  c.line(3);
  c.pass(7.5);
  c.h.loud = true; // "can I use butter ins…": no partial yet
  c.pass(1.5);
  assert.equal(c.h.hold, 'window', 'still listening at 9 s');
  c.h.loud = false;
  c.pass(1);
  assert.equal(c.h.hold, 'off', 'quiet a moment: it closes');
  // Talking straight through: never past 3 s more.
  const d = cookMic();
  d.line(3);
  d.h.loud = true;
  d.pass(10.9);
  assert.equal(d.h.hold, 'window');
  d.pass(0.3);
  assert.equal(d.h.hold, 'off');
});

await test('a tap on a listening pot turns it off, during a window too; during a step line it opens no window after', () => {
  const c = cookMic();
  c.line(3);
  c.pass(2);
  assert.equal(c.pot(), 'listening');
  c.tap();
  assert.equal(c.pot(), 'off');
  // The next step line: the kid taps while homie says it (to silence it), and no window opens after.
  c.h.talking = true;
  c.h.stepLine = true;
  c.pass(1);
  c.tap();
  assert.equal(c.h.hold, 'tap', 'a quiet pot goes on');
  c.tap();
  c.pass(2);
  c.h.talking = false;
  if (c.h.stepLine) c.ev('step_line_end');
  assert.equal(c.h.hold, 'off');
  c.pass(10);
  assert.equal(c.pot(), 'off');
});

await test('on by a tap: a minute with no word from the kid turns it off; each word starts the minute again', () => {
  const c = cookMic();
  c.tap();
  c.pass(50);
  c.partial('how long now');
  c.pass(1);
  c.final();
  c.pass(59);
  assert.equal(c.h.hold, 'tap', 'the kid’s words restarted the minute');
  c.pass(1.2);
  assert.equal(c.h.hold, 'off');
  // A video meanwhile: homie hears nothing, so the minute waits.
  const v = cookMic();
  v.tap();
  v.h.video = true;
  v.pass(120);
  assert.equal(v.h.hold, 'tap');
  assert.equal(v.pot(), 'off', 'the pot doesn’t claim to listen while every frame is zeroed');
  v.h.video = false;
  assert.equal(v.pot(), 'listening');
  v.pass(61);
  assert.equal(v.h.hold, 'off');
});

await test('a video in the window: the 8 s wait for it (the pot shows off meanwhile), within the 20 s cap', () => {
  const c = cookMic();
  c.line(3);
  c.pass(2);
  c.h.video = true; // the kid plays the step video
  c.pass(4);
  assert.equal(c.h.hold, 'window');
  assert.equal(c.pot(), 'off');
  c.h.video = false;
  c.pass(7.9);
  assert.equal(c.h.hold, 'window', '8 s of really hearing after the video');
  c.pass(0.3);
  assert.equal(c.h.hold, 'off');
  // A long video: the cap ends the window 20 s after it opened.
  const d = cookMic();
  d.line(3);
  d.h.video = true;
  d.pass(19.8);
  assert.equal(d.h.hold, 'window');
  d.pass(0.4);
  assert.equal(d.h.hold, 'off');
});

await test('credits, a 30-minute cook: 12 step-line windows stream about 96 s, far under an always-on mic', () => {
  // Always on (main before Oct 24): every second the app isn't making sound reaches Ink.
  const cookS = 30 * 60;
  const appSoundS = 12 * 4 + 6 * 8; // 12 short step lines (~4 s) and 6 answers (~8 s), muted by half duplex
  const alwaysOn = (cookS - appSoundS) * 3;
  // Tap to activate: 2 min of tapped-on listening, and 12 windows of 8 s after the step lines.
  const c = cookMic();
  for (let i = 0; i < 12; i++) {
    c.line(4);
    c.pass(60);
  }
  const tapped = (c.h.sentS + 120) * 3;
  assert.ok(Math.abs(c.h.sentS - 96) < 4, `12 windows ≈ 96 s: ${c.h.sentS}`);
  assert.ok(alwaysOn > 5000 && tapped < 700, `${alwaysOn} vs ${tapped}`);
});

// ---------------------------------------------------------------------------------------------
// Timers

await test('a timer ends `seconds` from now on the phone’s clock, not the service’s endsAt', () => {
  const t = V.parseTimer({ id: 'timer-1', seconds: 300, label: 'rice', endsAt: 99 }, 1_000_000, 1);
  assert.deepEqual(t, { id: '1/timer-1', label: 'rice', endsAt: 1_300_000, totalS: 300 });
});

await test('a timer without a label is "timer"; a malformed one is dropped', () => {
  assert.equal(V.parseTimer({ id: 't', seconds: 60 }, 0, 1).label, 'timer');
  assert.equal(V.parseTimer({ id: 't', seconds: 60, label: '  ' }, 0, 1).label, 'timer');
  assert.equal(V.parseTimer({ seconds: 60 }, 0, 1), null);
  assert.equal(V.parseTimer({ id: '', seconds: 60 }, 0, 1), null);
  assert.equal(V.parseTimer({ id: 't', seconds: 0 }, 0, 1), null);
  assert.equal(V.parseTimer({ id: 't', seconds: -5 }, 0, 1), null);
  assert.equal(V.parseTimer({ id: 't', seconds: 'soon' }, 0, 1), null);
  assert.equal(V.parseTimer({ id: 't', seconds: 25 * 3600 }, 0, 1), null);
  // A string number from a loose server still counts.
  assert.equal(V.parseTimer({ id: 't', seconds: '90' }, 0, 1).totalS, 90);
});

await test('timers stay soonest first; the same id replaces the old one; done ones leave', () => {
  const a = V.parseTimer({ id: 'a', seconds: 600 }, 0, 1);
  const b = V.parseTimer({ id: 'b', seconds: 60 }, 0, 1);
  let list = V.withTimer([], a);
  list = V.withTimer(list, b);
  assert.deepEqual(list.map((t) => t.id), ['1/b', '1/a']);
  list = V.withTimer(list, V.parseTimer({ id: 'b', seconds: 900 }, 0, 1));
  assert.deepEqual(list.map((t) => t.id), ['1/a', '1/b']);
  assert.deepEqual(V.withoutTimer(list, 1, 'a').map((t) => t.id), ['1/b']);
  assert.deepEqual(V.withoutTimer(list, 1, 'nope').map((t) => t.id), ['1/a', '1/b']);
});

// The hook's timers, step for step (lib/live/voice.ts): each socket's open counts up `socketNo`, and
// `timer` / `timer_done` are read with the socket they came on. `run` is the due-timer effect, run until
// it waits: each pass picks the soonest timer still to buzz; one at zero by `now` buzzes (its
// setTimeout(0) fires) and the effect runs again. `buzz` is the hook's buzzTimer, which both the phone's
// zero and an early timer_done call: once per timer. `leave`: a timer leaving on its own (the hook's
// TIMER_DUE_HOLD_MS after its buzz).
function cookTimers() {
  const h = { socket: 0, list: [], buzzed: new Set(), buzzes: [], due: false };
  const buzz = (id) => {
    if (h.buzzed.has(id)) return;
    h.buzzed.add(id);
    h.buzzes.push(id);
  };
  const c = {
    h,
    open: () => void (h.socket += 1),
    timer: (m, now) => {
      const t = V.parseTimer(m, now, h.socket);
      if (t) h.list = V.withTimer(h.list, t);
    },
    done: (id, now) => {
      const r = V.timerDone(h.list, h.buzzed, h.socket, id, now);
      h.list = r.list;
      if (r.buzz) buzz(r.buzz);
      c.run(now);
    },
    run: (now) => {
      for (let pass = 0; pass < 20; pass++) {
        const { next, kept, due } = V.timerBuzz(h.list, h.buzzed);
        h.buzzed = kept;
        h.due = due;
        if (!next || next.endsAt > now) return;
        buzz(next.id);
      }
      throw new Error('the due timers never settle');
    },
    buzz,
    leave: (id) => void (h.list = h.list.filter((t) => t.id !== id)),
  };
  return c;
}

await test('timer ids are per socket: a pause and resume keeps the old "timer-1" counting down', () => {
  const c = cookTimers();
  c.open();
  c.timer({ id: 'timer-1', seconds: 300, label: 'rice' }, 0);
  // The app goes to the background and comes back: a new socket, where the service starts at timer-1 again.
  c.open();
  c.timer({ id: 'timer-1', seconds: 60, label: 'eggs' }, 12_000);
  assert.deepEqual(c.h.list.map((t) => [t.id, t.label]), [['2/timer-1', 'eggs'], ['1/timer-1', 'rice']]);
  // The new socket's timer_done is only about its own timer (the eggs buzz); the rice keeps counting down,
  // and leaves on its own at zero (no timer_done can come).
  c.done('timer-1', 71_990);
  assert.deepEqual(c.h.buzzes, ['2/timer-1']);
  c.leave('2/timer-1');
  assert.deepEqual(c.h.list.map((t) => [t.id, t.label]), [['1/timer-1', 'rice']]);
  assert.equal(c.h.list[0].endsAt, 300_000);
  assert.equal(V.socketTimerId(2, 'timer-1'), '2/timer-1');
});

await test('two timers at zero together buzz once each (old-socket timers after a pause get no timer_done)', () => {
  const c = cookTimers();
  c.open();
  c.timer({ id: 'timer-1', seconds: 60, label: 'rice' }, 0);
  c.timer({ id: 'timer-2', seconds: 90, label: 'dal' }, 0);
  c.run(30_000);
  assert.deepEqual(c.h.buzzes, []);
  assert.equal(c.h.due, false);
  // Away past both, then back on a new socket: both old timers are at zero at once.
  c.open();
  c.run(200_000);
  assert.deepEqual(c.h.buzzes, ['1/timer-1', '1/timer-2']);
  assert.equal(c.h.due, true);
  // Again and again (every re-render) while they're held on screen: still two.
  for (const now of [200_000, 201_000, 205_000]) c.run(now);
  assert.equal(c.h.buzzes.length, 2);
  c.leave('1/timer-1');
  c.run(210_000);
  assert.equal(c.h.due, true);
  c.leave('1/timer-2');
  c.run(210_000);
  assert.deepEqual([c.h.buzzes.length, c.h.due, c.h.buzzed.size], [2, false, 0]);
});

await test('a timer_done for one timer at zero leaves the other one alone; a new timer after both buzzes once', () => {
  const c = cookTimers();
  c.open();
  c.timer({ id: 'timer-1', seconds: 60, label: 'rice' }, 0);
  c.timer({ id: 'timer-2', seconds: 60, label: 'eggs' }, 0);
  c.run(60_000);
  assert.deepEqual(c.h.buzzes, ['1/timer-1', '1/timer-2']);
  c.done('timer-1', 61_000);
  // The eggs already buzzed: no second buzz, and the pot still shows it done.
  assert.deepEqual([c.h.buzzes.length, c.h.due, [...c.h.buzzed]], [2, true, ['1/timer-2']]);
  c.done('timer-2', 62_000);
  assert.deepEqual([c.h.due, c.h.buzzed.size], [false, 0]);
  c.timer({ id: 'timer-3', seconds: 30, label: 'tea' }, 62_000);
  c.run(80_000);
  assert.equal(c.h.buzzes.length, 2);
  c.run(92_000);
  c.run(93_000);
  assert.deepEqual(c.h.buzzes, ['1/timer-1', '1/timer-2', '1/timer-3']);
  assert.equal(c.h.due, true);
});

await test('a timer_done before the phone’s own zero buzzes it now, once, and shows it done', () => {
  const c = cookTimers();
  c.open();
  c.timer({ id: 'timer-1', seconds: 5, label: 'rice' }, 1_000);
  c.run(5_000);
  assert.deepEqual([c.h.buzzes, c.h.due], [[], false]);
  // The service's zero beats the phone's by a few ms: the rice buzzes now and stays, at zero.
  c.done('timer-1', 5_960);
  assert.deepEqual(c.h.buzzes, ['1/timer-1']);
  assert.equal(c.h.due, true);
  assert.deepEqual(c.h.list.map((t) => [t.id, t.endsAt]), [['1/timer-1', 5_960]]);
  assert.equal(V.secondsLeft(c.h.list[0], 5_960), 0);
  assert.equal(V.cookPotState({ active: false, listening: false, thinking: false, timers: 1, timerDue: c.h.due }), 'timer');
  // The phone's own zero right after (its setTimeout not cleared yet), and every re-render: still one.
  c.buzz('1/timer-1');
  for (const now of [6_000, 6_500, 10_000]) c.run(now);
  assert.deepEqual(c.h.buzzes, ['1/timer-1']);
  // It leaves a little later, like any buzzed timer.
  c.leave('1/timer-1');
  c.run(16_000);
  assert.deepEqual([c.h.list.length, c.h.due, c.h.buzzed.size, c.h.buzzes.length], [0, false, 0, 1]);
});

await test('a timer_done after the phone’s own buzz never buzzes again: the timer leaves', () => {
  const c = cookTimers();
  c.open();
  c.timer({ id: 'timer-1', seconds: 5, label: 'rice' }, 0);
  c.run(5_000);
  assert.deepEqual([c.h.buzzes, c.h.due], [['1/timer-1'], true]);
  c.done('timer-1', 5_040);
  assert.deepEqual([c.h.buzzes, c.h.list.length, c.h.due, c.h.buzzed.size], [['1/timer-1'], 0, false, 0]);
  // A timer_done for a timer this phone doesn't have changes nothing.
  assert.deepEqual(V.timerDone([], new Set(), 1, 'timer-9', 6_000), { list: [], buzz: null });
});

await test('two timers, one done early: only that one buzzes; the other buzzes once at its own zero', () => {
  const c = cookTimers();
  c.open();
  c.timer({ id: 'timer-1', seconds: 60, label: 'rice' }, 0);
  c.timer({ id: 'timer-2', seconds: 90, label: 'dal' }, 0);
  c.done('timer-1', 59_950);
  assert.deepEqual(c.h.buzzes, ['1/timer-1']);
  // The dal keeps counting down, untouched.
  assert.deepEqual(c.h.list.map((t) => [t.id, t.endsAt]), [['1/timer-1', 59_950], ['1/timer-2', 90_000]]);
  c.run(60_000);
  c.leave('1/timer-1');
  c.run(70_000);
  assert.deepEqual([c.h.buzzes, c.h.due], [['1/timer-1'], false]);
  // The phone's zero comes first this time; the service's timer_done after it only takes it away.
  c.run(90_000);
  assert.deepEqual([c.h.buzzes, c.h.due], [['1/timer-1', '1/timer-2'], true]);
  c.done('timer-2', 90_030);
  assert.deepEqual([c.h.buzzes.length, c.h.list.length, c.h.due], [2, 0, false]);
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

await test('credit fix A: /cook gets only the kid’s frames while homie is on, nothing while the app makes sound or another screen is up', () => {
  assert.equal(V.cookSendsFrame({ quiet: false, focused: true, active: true }), true);
  assert.equal(V.cookSendsFrame({ quiet: true, focused: true, active: true }), false);
  assert.equal(V.cookSendsFrame({ quiet: false, focused: false, active: true }), false);
  assert.equal(V.cookSendsFrame({ quiet: true, focused: false, active: true }), false);
  // homie just went off: a frame still arriving before the recorder stops is dropped.
  assert.equal(V.cookSendsFrame({ quiet: false, focused: true, active: false }), false);
});

await test('cook mode’s tap never opens the chat, there is no long press, and a tapped step sends no "repeat"', () => {
  const screen = readFileSync(join(root, 'src', 'app', 'cook', '[id].tsx'), 'utf8');
  const hook = readFileSync(join(root, 'src', 'lib', 'live', 'voice.ts'), 'utf8');
  const moments = readFileSync(join(root, 'src', 'components', 'cooking', 'CookMoments.tsx'), 'utf8');
  assert.ok(!/onLongPress/.test(screen), 'one gesture only');
  assert.ok(!/openChatWith|openCircle|\/chat\/\[id\]/.test(screen), 'the pot never navigates to Messages');
  assert.ok(!/sendText\('repeat'\)/.test(hook), 'the service says a step’s line itself (builder D)');
  assert.ok(!/potPress|Ask \$\{name\} anything/.test(moments), 'no tap-to-ask moment');
  // Voice connects on its own, but the mic starts off: onopen only syncs the recorder to homie's state.
  assert.ok(!/startMic/.test(hook));
});

await test('credit fix B: the app in the background closes the line; iOS \'inactive\' (still on screen) never does', () => {
  const on = { lineOn: true, paused: false };
  assert.equal(V.appStateStep({ ...on, next: 'background' }), 'pause');
  // Control Center, the notification shade, a call banner, the mic's permission prompt: the app is still on screen.
  assert.equal(V.appStateStep({ ...on, next: 'inactive' }), null);
  // No line on (voice never started, it gave up, or the kid hung up): nothing to close or reopen.
  assert.equal(V.appStateStep({ ...on, lineOn: false, next: 'background' }), null);
  assert.equal(V.appStateStep({ ...on, lineOn: false, next: 'active' }), null);
  // Already paused: once.
  assert.equal(V.appStateStep({ ...on, paused: true, next: 'background' }), null);
});

await test('credit fix B: back on top after a pause the line opens again; otherwise nothing changes', () => {
  assert.equal(V.appStateStep({ lineOn: false, paused: true, next: 'active' }), 'resume');
  assert.equal(V.appStateStep({ lineOn: true, paused: false, next: 'active' }), null);
  // Only 'active' resumes: not 'inactive' on the way back, nor Android and iOS extension states.
  for (const next of ['inactive', 'unknown', 'extension']) assert.equal(V.appStateStep({ lineOn: false, paused: true, next }), null, next);
  // background, inactive, active: one pause and one resume.
  const steps = [];
  let paused = false;
  for (const next of ['inactive', 'background', 'inactive', 'active']) {
    const step = V.appStateStep({ lineOn: !paused, paused, next });
    if (step) steps.push(step);
    if (step === 'pause') paused = true;
    if (step === 'resume') paused = false;
  }
  assert.deepEqual(steps, ['pause', 'resume']);
  assert.equal(V.appInForeground('active'), true);
  assert.equal(V.appInForeground(null), true);
  assert.equal(V.appInForeground('inactive'), true);
  assert.equal(V.appInForeground('background'), false);
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

await test('a step line or a nudge (it asks the kid something) opens the listening window; other lines don’t', () => {
  for (const k of ['step', 'nudge']) assert.equal(V.opensWindow(k), true, k);
  for (const k of ['reply', 'hint', 'translation', 'greeting', 'timer', 'offer']) assert.equal(V.opensWindow(k), false, k);
});

await test('stopping the mic hands iOS back to playback (else the next step video plays near silent), never under the camera', () => {
  const mic = readFileSync(join(root, 'src/lib/live/mic.ts'), 'utf8');
  const stop = mic.slice(mic.indexOf('const stop = useCallback'), mic.indexOf('}, [rec]);', mic.indexOf('const stop = useCallback')));
  assert.match(stop, /stopRecording\(\)[\s\S]*if \(!withCamera\.current\) await setAudioModeAsync\(PLAYBACK_AUDIO_MODE\)/);
  const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
  assert.match(layout, /setAudioModeAsync\(PLAYBACK_AUDIO_MODE\)/, 'the launch mode and the mode put back are one');
});

console.log(`\n${passed} passed`);
