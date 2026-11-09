// Unit tests for homie, the pot on every screen (TS run by Node's type stripping):
//   src/lib/homie/store.ts  the screen's state under a lit / speaking beat, the lit beat and its
//                           watchdogs (speaking, and a lit line whose audio never comes), the mic
//                           level's re-render threshold, moments (choose closes first, keepOpen, a
//                           stale close, a tap anywhere dismisses), the shrunk pot, a screen's dock /
//                           hidden / onPress / onLongPress claims (cook mode's long press and its hint)
//   src/lib/homie/logic.ts  what the pot shows while a say loads or plays, its label, half duplex,
//                           its size and where it rests on each screen (centred on an even header
//                           row), cook mode's dock, the help lines, the centred moment (which
//                           ones, its frame, the listening bars), the timer ring, PCM loudness, the
//                           voice service's https base, the phone voice's language
//   src/lib/homie/tap.ts    each screen's one tap line (about its big button), "I’m right here." on a
//                           second tap in a row, news first (never in cook mode or while she films)
//                           and once, never the same line twice in a row
//   src/lib/homie/intro.ts  the hello once per person on this phone (after a restart too), two quick
//                           taps, the recording hello counting, news told once per person
//   node scripts/test-homie.mjs
// 'react' is a stub (the store only needs useSyncExternalStore to exist); the store gets a fake clock.
// '@/lib/storage' is a map that outlives resetIntroForTests (the phone's storage across a restart).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stub = (src) => 'data:text/javascript,' + encodeURIComponent(src);
const kv = (globalThis.__homieKv = new Map());
const STUBS = {
  react: stub('export function useSyncExternalStore() {} export const useReducer = (r, a, init) => [init ? init(a) : a, () => {}];'),
  '@/lib/storage': stub(
    'const m = globalThis.__homieKv; export async function kvGet(k) { return m.get(k) ?? null; } export async function kvSet(k, v) { if (v == null) m.delete(k); else m.set(k, v); }',
  ),
};

registerHooks({
  resolve(spec, ctx, next) {
    if (STUBS[spec]) return { url: STUBS[spec], shortCircuit: true };
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});

const S = await import(pathToFileURL(join(root, 'src/lib/homie/store.ts')).href);
const L = await import(pathToFileURL(join(root, 'src/lib/homie/logic.ts')).href);
const I = await import(pathToFileURL(join(root, 'src/lib/homie/intro.ts')).href);
const T = await import(pathToFileURL(join(root, 'src/lib/homie/tap.ts')).href);

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

function fakeClock() {
  let now = 0;
  let seq = 0;
  const due = new Map();
  return {
    timers: {
      setTimeout: (fn, ms) => {
        seq += 1;
        due.set(seq, { at: now + ms, fn });
        return seq;
      },
      clearTimeout: (id) => due.delete(id),
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
    pending: () => due.size,
  };
}

const fresh = () => {
  const clock = fakeClock();
  const store = S.createHomieStore(clock.timers);
  let emits = 0;
  store.subscribe(() => (emits += 1));
  return { clock, store, emits: () => emits };
};

// ---------------------------------------------------------------------------------------------
// store

await test('starts off, visible, with no moment', () => {
  const { store } = fresh();
  assert.deepEqual(store.get(), { state: 'off', level: 0, moment: null, hidden: false });
});

await test('setHomie merges, and only a real change notifies', () => {
  const { store, emits } = fresh();
  store.setHomie({ state: 'listening' });
  store.setHomie({ state: 'listening' });
  assert.equal(store.get().state, 'listening');
  assert.equal(emits(), 1);
  store.setHomie({ hidden: true });
  assert.equal(store.get().state, 'listening');
  assert.equal(store.get().hidden, true);
  assert.equal(emits(), 2);
});

await test('the lit beat lasts LIT_BEAT_MS, then speaking, then back to the screen state', () => {
  const { store, clock } = fresh();
  store.setHomie({ state: 'listening' });
  store.pulseLit();
  assert.equal(store.get().state, 'lit');
  clock.advance(S.LIT_BEAT_MS - 1);
  assert.equal(store.get().state, 'lit');
  clock.advance(1);
  assert.equal(store.get().state, 'speaking');
  store.doneSpeaking();
  assert.equal(store.get().state, 'listening');
});

await test('a screen state set while homie speaks waits until homie is done', () => {
  const { store } = fresh();
  store.setHomie({ state: 'listening' });
  store.setHomie({ state: 'speaking', label: 'AI voice' });
  store.setHomie({ state: 'thinking' });
  assert.equal(store.get().state, 'speaking');
  store.doneSpeaking();
  assert.equal(store.get().state, 'thinking');
  assert.equal(store.get().label, undefined);
});

await test('during the lit beat, a screen state keeps the beat and lands after it', () => {
  const { store, clock } = fresh();
  store.pulseLit();
  store.setHomie({ state: 'listening' });
  assert.equal(store.get().state, 'lit');
  clock.advance(S.LIT_BEAT_MS);
  assert.equal(store.get().state, 'speaking');
  store.doneSpeaking();
  assert.equal(store.get().state, 'listening');
});

await test('speaking ends on its own after MAX_SPEAKING_MS if no say ever ended it', () => {
  const { store, clock } = fresh();
  store.setHomie({ state: 'timer' });
  store.pulseLit();
  clock.advance(S.LIT_BEAT_MS + S.MAX_SPEAKING_MS - 1);
  assert.equal(store.get().state, 'speaking');
  clock.advance(1);
  assert.equal(store.get().state, 'timer');
  assert.equal(clock.pending(), 0);
});

await test('a lit line whose audio never comes ends on its own after MAX_LIT_MS (lit holds the mic)', () => {
  const { store, clock } = fresh();
  store.setHomie({ state: 'listening' });
  store.setHomie({ state: 'lit', label: 'AI hint' });
  clock.advance(S.MAX_LIT_MS - 1);
  assert.equal(store.get().state, 'lit');
  clock.advance(1);
  assert.equal(store.get().state, 'listening');
  assert.equal(store.get().label, undefined);
  assert.equal(clock.pending(), 0);
});

await test('a lit line that starts speaking keeps the speaking watchdog, not the lit one', () => {
  const { store, clock } = fresh();
  store.setHomie({ state: 'listening' });
  store.setHomie({ state: 'lit' });
  clock.advance(1000);
  store.setHomie({ state: 'speaking' });
  clock.advance(S.MAX_LIT_MS);
  assert.equal(store.get().state, 'speaking');
  clock.advance(S.MAX_SPEAKING_MS - S.MAX_LIT_MS);
  assert.equal(store.get().state, 'listening');
  assert.equal(clock.pending(), 0);
});

await test('doneSpeaking outside a beat changes nothing; it cancels a pending beat', () => {
  const { store, clock, emits } = fresh();
  store.setHomie({ state: 'listening' });
  const before = emits();
  store.doneSpeaking();
  assert.equal(emits(), before);
  store.pulseLit();
  store.doneSpeaking();
  assert.equal(store.get().state, 'listening');
  clock.advance(S.LIT_BEAT_MS * 2);
  assert.equal(store.get().state, 'listening');
});

await test('a second pulseLit restarts the beat and keeps the screen state underneath', () => {
  const { store, clock } = fresh();
  store.setHomie({ state: 'listening' });
  store.pulseLit();
  clock.advance(S.LIT_BEAT_MS);
  store.pulseLit(100);
  assert.equal(store.get().state, 'lit');
  clock.advance(100);
  assert.equal(store.get().state, 'speaking');
  store.doneSpeaking();
  assert.equal(store.get().state, 'listening');
});

await test('the mic level is clamped and re-renders only on a visible change (or back to 0)', () => {
  const { store, emits } = fresh();
  store.setHomieLevel(0.5);
  assert.equal(store.get().level, 0.5);
  const n = emits();
  store.setHomieLevel(0.52);
  assert.equal(emits(), n);
  store.setHomieLevel(0.6);
  assert.equal(store.get().level, 0.6);
  store.setHomieLevel(2);
  assert.equal(store.get().level, 1);
  store.setHomieLevel(0.01);
  store.setHomieLevel(0);
  assert.equal(store.get().level, 0);
  store.setHomieLevel(Number.NaN);
  assert.equal(store.get().level, 0);
});

const moment = (id, calls, extra = {}) => ({
  id,
  question: 'How do you know the onions are done?',
  options: [
    { id: 'again', label: 'Say it again', keepOpen: true },
    { id: 'not_now', label: 'Not now' },
  ],
  onChoose: (o) => calls.push(o),
  ...extra,
});

await test('choosing closes the moment first, then calls onChoose (which may open the next)', () => {
  const { store } = fresh();
  const calls = [];
  let seenOpen;
  store.showMoment({
    ...moment('a', calls),
    onChoose: (o) => {
      seenOpen = store.get().moment;
      calls.push(o);
      store.showMoment(moment('b', calls));
    },
  });
  store.chooseMoment('not_now');
  assert.equal(seenOpen, null);
  assert.deepEqual(calls, ['not_now']);
  assert.equal(store.get().moment.id, 'b');
});

await test('a keepOpen option leaves the moment up; an unknown option does nothing', () => {
  const { store } = fresh();
  const calls = [];
  store.showMoment(moment('a', calls));
  store.chooseMoment('again');
  assert.equal(store.get().moment.id, 'a');
  store.chooseMoment('nope');
  assert.deepEqual(calls, ['again']);
});

await test('a throwing onChoose never breaks the store', () => {
  const { store } = fresh();
  const warn = console.warn;
  console.warn = () => {};
  try {
    store.showMoment({ ...moment('a', []), onChoose: () => { throw new Error('boom'); } });
    store.chooseMoment('not_now');
    assert.equal(store.get().moment, null);
  } finally {
    console.warn = warn;
  }
});

await test('closeMoment with a stale id leaves a newer moment alone', () => {
  const { store } = fresh();
  store.showMoment(moment('help:1', []));
  store.showMoment(moment('ask:2', []));
  store.closeMoment('help:1');
  assert.equal(store.get().moment.id, 'ask:2');
  store.closeMoment();
  assert.equal(store.get().moment, null);
  store.closeMoment();
});

await test('dismissMoment closes it first, then says not now; a stale id or no moment does nothing', () => {
  const { store } = fresh();
  const calls = [];
  let seenOpen;
  // A no-buttons moment: no options at all.
  store.showMoment({ id: 'read:1', question: 'Read it out loud?', options: [], bars: true, tapToClose: 'Tap anywhere to close', onChoose: (o) => { seenOpen = store.get().moment; calls.push(o); } });
  store.dismissMoment('help:0');
  assert.equal(store.get().moment.id, 'read:1');
  // chooseMoment can't close it: there's no option to choose.
  store.chooseMoment('not_now');
  assert.equal(store.get().moment.id, 'read:1');
  store.dismissMoment('read:1');
  assert.equal(seenOpen, null);
  assert.deepEqual(calls, [S.MOMENT_DISMISS]);
  assert.equal(S.MOMENT_DISMISS, 'not_now');
  store.dismissMoment();
  assert.deepEqual(calls, ['not_now']);
});

await test('dismissMoment without an id closes whatever is up; a throwing onChoose never breaks it', () => {
  const { store } = fresh();
  const warn = console.warn;
  console.warn = () => {};
  try {
    store.showMoment({ id: 'a', question: 'q', options: [], onChoose: () => { throw new Error('boom'); } });
    store.dismissMoment();
    assert.equal(store.get().moment, null);
  } finally {
    console.warn = warn;
  }
});

await test('the cook’s voice playing shrinks the resting pot, and only that changes', () => {
  const { store } = fresh();
  store.setHomie({ state: 'listening' });
  store.setHomie({ shrunk: true });
  assert.equal(store.get().shrunk, true);
  assert.equal(store.get().state, 'listening');
  store.setHomie({ shrunk: false });
  assert.equal(store.get().shrunk, false);
});

await test('a screen claim is cleared only by its own release', () => {
  const { store } = fresh();
  const a = {};
  const b = {};
  const press = () => {};
  store.claimScreen(a, { dock: { x: 1, y: 2, size: 56 }, hidden: false, onPress: press });
  // B gains focus before A's blur runs.
  store.claimScreen(b, { dock: undefined, hidden: true, onPress: undefined });
  store.releaseScreen(a);
  assert.equal(store.get().hidden, true);
  store.releaseScreen(b);
  assert.equal(store.get().hidden, false);
  assert.equal(store.get().dock, undefined);
  assert.equal(store.get().onPress, undefined);
});

await test('cook mode’s long press ("Ask Grandma anything"): claimed with what it does, gone with its screen; VoiceOver hears both gestures', () => {
  const { store } = fresh();
  const a = {};
  const b = {};
  const tap = () => {};
  const hold = () => {};
  const cook = { dock: undefined, hidden: false, onPress: tap, onLongPress: hold, longPressLabel: 'Ask Grandma' };
  store.claimScreen(a, cook);
  assert.equal(store.get().onLongPress, hold);
  assert.equal(store.get().onPress, tap, 'two gestures, each its own');
  assert.equal(L.potHint(store.get()), 'Turns homie on or off. Touch and hold to ask Grandma.');
  // The next screen has none, and gains focus before cook mode's blur runs.
  store.claimScreen(b, { dock: undefined, hidden: false, onPress: undefined, onLongPress: undefined, longPressLabel: undefined });
  store.releaseScreen(a);
  assert.equal(store.get().onLongPress, undefined);
  assert.equal(L.potHint(store.get()), 'Says what you can do here');
  store.claimScreen(a, cook);
  store.releaseScreen(a);
  assert.equal(store.get().onLongPress, undefined);
  assert.equal(store.get().longPressLabel, undefined);
  assert.equal(L.potHint({ onPress: tap }), 'Turns homie on or off');
  assert.equal(L.potHint({ onPress: tap, longPressLabel: 'Ask Grandma' }), 'Turns homie on or off', 'no long press, no hint for one');
  // The pot: a long press after about 400 ms, a VoiceOver action for it, and only the 0.96 press scale.
  const overlay = readFileSync(join(root, 'src/components/homie/HomieOverlay.tsx'), 'utf8');
  assert.match(overlay, /onPress=\{onPress\}\s*onLongPress=\{hold\}\s*delayLongPress=\{400\}/);
  assert.match(overlay, /\(\) => \{\s*haptic\('medium'\);\s*onHold\(\);\s*\}/, 'one buzz when the hold takes');
  assert.match(overlay, /accessibilityActions=\{hold \? \[\{ name: 'longpress', label: h\.longPressLabel/);
  assert.ok(!/scaleTo=/.test(overlay), 'never scaled up while held: drawn at its real size');
});

await test('docked low (cook mode’s bottom bar), the words go above the pot; the moment starts where the pot really is', () => {
  assert.equal(L.labelAbove(L.barFrame({ width: 390, height: 844 }, 34), 844), true);
  assert.equal(L.labelAbove(L.restFrame(L.homieRoute('/kid/home'), { width: 390, insetsTop: 59 }), 844), false);
  assert.deepEqual(L.shownFrame({ x: 100, y: 700, size: 60 }, false), { x: 100, y: 700, size: 60 });
  const shrunk = L.shownFrame({ x: 100, y: 700, size: 60 }, true);
  assert.equal(shrunk.size, 60 * L.SHRUNK_SCALE);
  // Same centre, and only ever smaller (the pot is drawn at its real size; scaling it up blurs it).
  assert.equal(shrunk.x + shrunk.size / 2, 130);
  assert.equal(shrunk.y + shrunk.size / 2, 730);
  assert.ok(L.SHRUNK_SCALE < 1);
});

await test('a moment starts exactly where the resting pot is, centred or in the corner', () => {
  const screen = { width: 390, insetsTop: 59 };
  for (const p of ['/kid/recipes/poha', '/recipe/poha', '/kid/home', '/record']) {
    const rest = L.restFrame(L.homieRoute(p), screen);
    assert.deepEqual(L.shownFrame(rest, false), rest, p);
    const small = L.shownFrame(rest, true);
    assert.equal(small.x + small.size / 2, rest.x + rest.size / 2, p);
    assert.equal(small.y + small.size / 2, rest.y + rest.size / 2, p);
  }
});

// ---------------------------------------------------------------------------------------------
// logic

await test('an AI say lights the pot while it loads and speaks while it plays; the cook clips never do', () => {
  assert.equal(L.sayPhase('say:3', 'loading'), 'loading');
  assert.equal(L.sayPhase('say:translation:4', 'playing'), 'playing');
  assert.equal(L.sayPhase('say:homie:2', 'ended'), 'none');
  assert.equal(L.sayPhase('https://x/voice.m4a#42-118', 'playing'), 'none');
  assert.equal(L.sayPhase(null, 'playing'), 'none');
  assert.equal(L.potState({ state: 'listening' }, 'none'), 'listening');
  assert.equal(L.potState({ state: 'listening' }, 'loading'), 'lit');
  assert.equal(L.potState({ state: 'listening' }, 'playing'), 'speaking');
  assert.equal(L.potState({ state: 'speaking' }, 'loading'), 'lit');
  assert.equal(L.potState({ state: 'lit' }, 'playing'), 'lit');
  assert.equal(L.potState({ state: 'speaking' }, 'none'), 'speaking');
  assert.equal(L.potState({ state: 'timer' }, 'none'), 'timer');
});

await test('the label under the pot always says it is the AI', () => {
  assert.equal(L.speakingLabel({}, 'say:3'), 'AI voice');
  assert.equal(L.speakingLabel({}, 'say:translation:3'), 'Translated from the cook');
  assert.equal(L.speakingLabel({ label: 'Translated from Grandma' }, 'say:translation:3'), 'Translated from Grandma');
});

await test('half duplex: homie lit or speaking, anything on the shared player, or a step video', () => {
  const quiet = { homie: 'listening', audio: 'idle', video: false };
  assert.equal(L.halfDuplex(quiet), false);
  for (const homie of ['lit', 'speaking']) assert.equal(L.halfDuplex({ ...quiet, homie }), true, homie);
  for (const homie of ['off', 'listening', 'thinking', 'timer']) assert.equal(L.halfDuplex({ ...quiet, homie }), false, homie);
  for (const audio of ['loading', 'playing']) assert.equal(L.halfDuplex({ ...quiet, audio }), true, audio);
  for (const audio of ['idle', 'paused', 'ended', 'error']) assert.equal(L.halfDuplex({ ...quiet, audio }), false, audio);
  assert.equal(L.halfDuplex({ ...quiet, video: true }), true);
});

await test('homie stays off sign-in, the gateway, links, the month story and chat', () => {
  for (const p of ['/', '/join', '/join-code', '/i', '/r', '/recap', '/chat/abc', '/join/']) assert.equal(L.homieRoute(p).hidden, true, p);
  for (const p of ['/kid/home', '/parent/home', '/cook/biryani', '/recipe/biryani', '/record', '/recording', '/answer/q1', '/dev/gallery']) assert.equal(L.homieRoute(p).hidden, false, p);
});

await test('each screen gets its own tap line', () => {
  assert.equal(L.homieRoute('/cook/biryani').screen, 'cook');
  assert.equal(L.homieRoute('/kid/home').screen, 'kidHome');
  assert.equal(L.homieRoute('/kid').screen, 'kidHome');
  assert.equal(L.homieRoute('/kid/recipes').screen, 'recipes');
  assert.equal(L.homieRoute('/kid/recipes/biryani').screen, 'dish');
  assert.equal(L.homieRoute('/recipe/biryani').screen, 'dish');
  assert.equal(L.homieRoute('/kid/community').screen, 'community');
  assert.equal(L.homieRoute('/kid/ask').screen, 'ask');
  assert.equal(L.homieRoute('/parent/home', 'Mom').screen, 'parentHome');
  assert.equal(L.homieRoute('/parent/recipes').screen, 'parentRecipes');
  assert.equal(L.homieRoute('/parent/messages/').screen, 'messages');
  assert.equal(L.homieRoute('/record').screen, 'record');
  assert.equal(L.homieRoute('/recording').screen, 'recording');
  assert.equal(L.homieRoute('/dev/gallery').screen, 'other');
  assert.equal(L.homieRoute('/recipe/biryani/ingredients').screen, 'other');
});

await test('one line per screen, short enough to say in one breath (12 words at most); each tab says "Explore X by doing X"', () => {
  for (const [k, line] of Object.entries(L.HELP)) assert.ok(line.split(/\s+/).length <= 12, `${k}: ${line}`);
  for (const [screen, line] of [...Object.entries(T.TAP_LINES), ['again', T.TAP_AGAIN]]) {
    assert.equal(typeof line, 'string', screen);
    assert.ok(line.split(/\s+/).length <= 12, `${screen}: ${line}`);
    if (['cook', 'recording', 'other', 'again'].includes(screen)) continue;
    assert.match(line, /^[A-Z].* by [a-z]+ing\b.*\.$/, `${screen}: ${line}`);
  }
  // The table was cut from parent Home (#64), and Back mid-recording would stop her filming.
  for (const line of Object.values(T.TAP_LINES)) assert.doesNotMatch(line, /\btable\b|\bBack\b/, line);
});

const hello = 'Hi, I’m homie.';
const home1 = T.TAP_LINES.kidHome;
const again = T.TAP_AGAIN;
const freshIntro = () => {
  kv.clear();
  I.resetIntroForTests();
};
const fact = (id, line, kind = 'answer') => ({ id, kind, line, at: 1 });

await test('chooseTapLine: news not told yet first (Claude’s words when written), else the screen’s line, never the last line again', () => {
  const base = { screen: 'kidHome', facts: [], told: new Set(), last: null };
  assert.deepEqual(T.chooseTapLine(base), { text: home1 });
  // The screen's line was just said: "I’m right here.", then the line again.
  assert.deepEqual(T.chooseTapLine({ ...base, last: home1 }), { text: again });
  assert.deepEqual(T.chooseTapLine({ ...base, last: again }), { text: home1 });
  const news = [fact('answer:q1', 'Grandma answered your question about the Poha.'), fact('recipe:r1', 'Grandma just added Poha.', 'recipe')];
  assert.deepEqual(T.chooseTapLine({ ...base, facts: news }), { text: 'Grandma answered your question about the Poha.', factId: 'answer:q1' });
  const written = new Map([['answer:q1', 'Grandma answered your poha question! Go have a listen.']]);
  assert.deepEqual(T.chooseTapLine({ ...base, facts: news, written }), { text: 'Grandma answered your poha question! Go have a listen.', factId: 'answer:q1' });
  assert.deepEqual(T.chooseTapLine({ ...base, facts: news, told: new Set(['answer:q1']) }), { text: 'Grandma just added Poha.', factId: 'recipe:r1' });
  assert.deepEqual(T.chooseTapLine({ ...base, facts: news, told: new Set(['answer:q1', 'recipe:r1']) }), { text: home1 });
  // Cook mode keeps its own line: no news over the kid's cooking. Nor while she films.
  assert.deepEqual(T.chooseTapLine({ ...base, screen: 'cook', facts: news }), { text: T.TAP_LINES.cook });
  assert.deepEqual(T.chooseTapLine({ ...base, screen: 'recording', facts: news }), { text: T.TAP_LINES.recording });
  assert.deepEqual(T.chooseTapLine({ ...base, screen: 'recording', facts: news, last: T.TAP_LINES.recording }), { text: again });
});

await test('a tap always gets a line: the hello once per person, then lines that never repeat in a row', async () => {
  freshIntro();
  const home = L.homieRoute('/kid/home');
  assert.equal(await I.takeTapLine(home, 'kid1'), `${hello} ${home1}`);
  assert.equal(await I.takeTapLine(home, 'kid1'), again);
  assert.equal(await I.takeTapLine(home, 'kid1'), home1);
  assert.ok(kv.has(I.introducedKey('kid1')));
  assert.equal(I.introducedKey('kid1'), 'homie.introduced.kid1');
  // Another tab has its own line.
  const community = L.homieRoute('/kid/community');
  assert.equal(await I.takeTapLine(community, 'kid1'), T.TAP_LINES.community);
  // Someone else on the same phone gets their own hello.
  assert.ok((await I.takeTapLine(home, 'mom1')).startsWith(`${hello} `));
  // A restart: the in-memory guard is gone, the phone's storage remembers the hello.
  I.resetIntroForTests();
  assert.equal(await I.takeTapLine(home, 'kid1'), home1);
  assert.ok(!(await I.takeTapLine(home, 'mom1')).startsWith(hello));
});

await test('news is told once per person (after a restart too), then the tab’s lines', async () => {
  freshIntro();
  I.markIntroduced('kid1');
  const home = L.homieRoute('/kid/home');
  const news = { facts: [fact('answer:q1', 'Grandma answered your question about the Poha.')], written: new Map() };
  assert.equal(await I.takeTapLine(home, 'kid1', news), 'Grandma answered your question about the Poha.');
  assert.equal(await I.takeTapLine(home, 'kid1', news), home1);
  assert.deepEqual(JSON.parse(kv.get(I.toldKey('kid1'))), ['answer:q1']);
  I.resetIntroForTests();
  assert.equal(await I.takeTapLine(home, 'kid1', news), home1);
  // Mom hasn't heard it.
  I.markIntroduced('mom1');
  assert.equal(await I.takeTapLine(home, 'mom1', news), 'Grandma answered your question about the Poha.');
});

await test('two quick taps before storage answers: one hello, two different lines', async () => {
  freshIntro();
  const home = L.homieRoute('/kid/home');
  assert.deepEqual(await Promise.all([I.takeTapLine(home, 'kid1'), I.takeTapLine(home, 'kid1')]), [`${hello} ${home1}`, again]);
});

await test('the recording hello counts as homie’s hello (after a restart too)', async () => {
  freshIntro();
  I.markIntroduced('mom1');
  assert.equal(await I.takeTapLine(L.homieRoute('/record'), 'mom1'), T.TAP_LINES.record);
  I.resetIntroForTests();
  assert.ok(!(await I.takeTapLine(L.homieRoute('/record'), 'mom1')).startsWith(hello));
  I.markIntroduced(undefined);
  I.markIntroduced(null);
  assert.equal(kv.size, 1);
});

await test('nobody signed in: the hello and the line, nothing stored', async () => {
  freshIntro();
  assert.equal(await I.takeTapLine(L.homieRoute('/kid/home'), null), `${hello} ${home1}`);
  assert.equal(await I.takeTapLine(L.homieRoute('/kid/home'), undefined), `${hello} ${again}`);
  assert.equal(kv.size, 0);
});

await test('homie is exactly as tall as the controls beside it: 48 in a header, 60 in cook mode’s bar', () => {
  assert.deepEqual(L.HOMIE_SIZE, { header: 48, bar: 60 });
  const screen = { width: 390, insetsTop: 59 };
  for (const p of ['/kid/home', '/kid/recipes', '/kid/community', '/kid/ask', '/parent/home', '/parent/recipes', '/parent/messages', '/recipe/poha', '/kid/recipes/poha', '/my-recipe/poha', '/community/c1', '/record', '/recording', '/send', '/dinner/new', '/dinner/d1']) {
    assert.equal(L.restFrame(L.homieRoute(p, 'Mom'), screen).size, 48, p);
  }
  // Cook mode: Back and Next (ActionButton lg, 60 pt) either side, 24 pt gutters, 12 pt gaps.
  const bottom = 34;
  const dock = L.barFrame({ width: 390, height: 844 }, bottom);
  assert.equal(dock.size, 60);
  assert.equal(dock.y, 844 - bottom - 60); // level with the buttons, on the bar's bottom padding
  const button = (390 - 2 * 24 - 2 * 12 - 60) / 2;
  assert.equal(dock.x - (24 + button), 12); // Back's right edge to homie
  assert.equal(390 - 24 - button - (dock.x + dock.size), 12); // homie to Next's left edge
});

await test('homie rests on the header’s 48 pt row, level with the buttons there', () => {
  const notch = 59;
  const at = (p) => L.restFrame(L.homieRoute(p, 'Mom'), { width: 390, insetsTop: notch });
  // Tabs: the large title's row (LargeHeader max(60, inset + 13)), the profile pill's top.
  for (const p of ['/kid/home', '/kid/recipes', '/kid/community', '/parent/home', '/parent/messages']) assert.equal(at(p).y, notch + 13, p);
  // The dish, cook mode's top row, recording: useScreenTop max(56, inset + 4).
  for (const p of ['/recipe/poha', '/kid/recipes/poha', '/recording', '/answer/q1']) assert.equal(at(p).y, notch + 4, p);
  // A page whose Back sits a little lower (record, send, my dish, community and dinner pages): max(56, inset + 9).
  for (const p of ['/record', '/send', '/my-recipe/poha', '/community/c1', '/dinner/new', '/dinner/d1']) assert.equal(at(p).y, notch + 9, p);
  // No notch: the bible's own top lines.
  assert.equal(L.restFrame(L.homieRoute('/record'), { width: 375, insetsTop: 20 }).y, 56);
  assert.equal(L.restFrame(L.homieRoute('/recipe/poha'), { width: 375, insetsTop: 20 }).y, 56);
  assert.equal(L.restFrame(L.homieRoute('/kid/home'), { width: 375, insetsTop: 20 }).y, 60);
});

await test('an even header row (the dish: Back and the heart) puts homie in the middle', () => {
  for (const width of [375, 390, 430]) {
    for (const p of ['/recipe/poha', '/kid/recipes/poha']) {
      const f = L.restFrame(L.homieRoute(p), { width, insetsTop: 59 });
      assert.equal(f.x + f.size / 2, width / 2, `${p} @${width}`);
    }
  }
  // Clear of Back (24 + 48) and of Share beside the heart (390 - 24 - 48 - 12 - 48) on a dish.
  const dish = L.restFrame(L.homieRoute('/kid/recipes/poha'), { width: 375, insetsTop: 59 });
  assert.ok(dish.x >= 24 + 48 + 12);
  assert.ok(dish.x + dish.size <= 375 - 24 - 48 - 12 - 48 - 12);
  // A tab (title left, pill right), a lone Back, and my dish (a Back pill and Share; its compact title
  // takes the middle once scrolled) stay in the top-right corner.
  for (const p of ['/kid/home', '/kid/recipes', '/parent/home', '/record', '/recording', '/community/c1', '/my-recipe/poha']) {
    assert.equal(L.homieRoute(p, 'Mom').centred, false, p);
  }
  // My dish: just left of Share.
  assert.equal(L.restFrame(L.homieRoute('/my-recipe/poha'), { width: 390, insetsTop: 59 }).x, 390 - 24 - 48 - 10 - 48);
});

await test('homie rests top-right, left of the profile face where a screen has one', () => {
  const screen = { width: 390, insetsTop: 59 };
  const plain = L.restFrame(L.homieRoute('/recording'), screen);
  assert.deepEqual(plain, { x: 390 - 24 - 48, y: 63, size: 48 });
  // Kid Home: the face pill (76) at the gutter, then a 10 pt gap.
  const kid = L.restFrame(L.homieRoute('/kid/home'), screen);
  assert.equal(kid.x, 390 - (24 + 76) - 10 - 48);
  assert.equal(kid.y, 72); // the large title's row, the pill's top
  // Parent Home: the "Mom ▾" pill is wider for a longer name, never past 190.
  const mom = L.restFrame(L.homieRoute('/parent/home', 'Mom'), screen);
  const grandma = L.restFrame(L.homieRoute('/parent/home', 'Grandma'), screen);
  assert.ok(grandma.x < mom.x);
  assert.equal(L.namePillWidth('A very long name indeed'), 190);
  // "Mom ▾" measured 128 pt on the web build: never estimate it narrower (homie would touch it).
  assert.ok(L.namePillWidth('Mom') >= 128);
});

await test('the moment pot is centred, at most 170, smaller on a short phone', () => {
  const big = L.momentFrame({ width: 390, height: 844, insetsTop: 59 });
  assert.equal(big.size, 170);
  assert.equal(big.x, (390 - 170) / 2);
  assert.ok(big.y >= 59 + 24);
  const se = L.momentFrame({ width: 375, height: 667, insetsTop: 20 });
  assert.equal(se.size, Math.round(667 * 0.21));
});

await test('a moment with bars, a spoken prompt or a tap to close uses the centred column; buttons alone don’t', () => {
  assert.equal(L.isCentredMoment({ bars: true }), true);
  assert.equal(L.isCentredMoment({ prompt: { label: 'Say “yes” or “no”' } }), true);
  assert.equal(L.isCentredMoment({ tapToClose: 'Tap anywhere to close' }), true);
  assert.equal(L.isCentredMoment({}), false);
  assert.equal(L.isCentredMoment({ bars: false, tapToClose: '' }), false);
});

await test('the centred column: a 176 pot, 56 pt, the words, the whole group centred', () => {
  const screen = { width: 390, height: 844, insetsTop: 47, insetsBottom: 34 };
  const { pot, wordsTop } = L.askFrame(screen, 240);
  assert.equal(pot.size, 176);
  assert.equal(pot.x, (390 - 176) / 2);
  assert.equal(wordsTop, pot.y + 176 + L.ASK_POT_GAP);
  // As much room above the pot as below the words (within a point of rounding).
  const top = 47 + 16;
  const bottom = 844 - (34 + 8);
  assert.ok(Math.abs(pot.y - top - (bottom - (wordsTop + 240))) <= 1);
  // Taller words lift the pot.
  assert.ok(L.askFrame(screen, 400).pot.y < pot.y);
});

await test('the centred column on a short phone: a smaller pot, and too many words start at the top', () => {
  const se = { width: 375, height: 667, insetsTop: 20, insetsBottom: 0 };
  assert.equal(L.askFrame(se, 200).pot.size, Math.round(667 * 0.22));
  assert.equal(L.askFrame(se, 2000).pot.y, 20 + 16);
  // Before the words are measured (0), the pot still sits on the screen.
  assert.ok(L.askFrame(se, 0).pot.y >= 36);
});

await test('the listening bars rest low, grow with the mic level, and never pass their top', () => {
  const rest = L.barHeights(0);
  const loud = L.barHeights(1);
  assert.equal(rest.length, 5);
  assert.deepEqual(rest, [...rest].reverse());
  for (let i = 0; i < 5; i++) assert.ok(loud[i] > rest[i]);
  assert.equal(Math.max(...loud), L.BAR_MAX);
  assert.deepEqual(L.barHeights(3), loud);
  assert.deepEqual(L.barHeights(-1), rest);
  assert.deepEqual(L.barHeights(Number.NaN), rest);
  const half = L.barHeights(0.5);
  for (let i = 0; i < 5; i++) assert.ok(half[i] > rest[i] && half[i] < loud[i]);
});

await test('the timer ring empties from 1 to 0', () => {
  const t = { endsAt: 60_000, totalS: 60 };
  assert.equal(L.timerProgress(t, 0), 1);
  assert.equal(L.timerProgress(t, 30_000), 0.5);
  assert.equal(L.timerProgress(t, 90_000), 0);
  assert.equal(L.timerProgress(t, -5_000), 1);
  assert.equal(L.timerProgress({ endsAt: 1, totalS: 0 }, 0), 0);
});

await test('PCM loudness: silence 0, a quiet room 0, talking close 1, in between in between', () => {
  const tone = (amp, n = 1600) => Int16Array.from({ length: n }, (_, i) => Math.round(amp * 32767 * Math.sin(i / 3)));
  assert.equal(L.pcmLevel(new Int16Array(1600)), 0);
  assert.equal(L.pcmLevel(new ArrayBuffer(0)), 0);
  assert.equal(L.pcmLevel(tone(0.002)), 0);
  assert.equal(L.pcmLevel(tone(0.9)), 1);
  const mid = L.pcmLevel(tone(0.05));
  assert.ok(mid > 0.2 && mid < 0.8, String(mid));
  // The socket's ArrayBuffer and the Int16Array agree; an odd trailing byte is ignored.
  const pcm = tone(0.05);
  assert.equal(L.pcmLevel(pcm.buffer), mid);
  const odd = new Uint8Array(pcm.byteLength + 1);
  odd.set(new Uint8Array(pcm.buffer));
  assert.equal(L.pcmLevel(odd.buffer), mid);
});

await test('the voice service https base comes from EXPO_PUBLIC_VOICE_URL', () => {
  assert.equal(L.voiceHttpBase('wss://homecookd-voice-vyatb2n6oq-uw.a.run.app'), 'https://homecookd-voice-vyatb2n6oq-uw.a.run.app');
  assert.equal(L.voiceHttpBase('wss://host.run.app/cook?session=x'), 'https://host.run.app');
  assert.equal(L.voiceHttpBase(' ws://192.168.1.5:8787/ '), 'http://192.168.1.5:8787');
  assert.equal(L.voiceHttpBase('https://host.app/x'), 'https://host.app');
  assert.equal(L.voiceHttpBase(''), null);
  assert.equal(L.voiceHttpBase('not a url'), null);
});

await test('the phone voice speaks Marathi as mr-IN, English as en-US', () => {
  assert.equal(L.deviceVoiceLanguage(undefined), 'en-US');
  assert.equal(L.deviceVoiceLanguage('mr'), 'mr-IN');
  assert.equal(L.deviceVoiceLanguage('hi'), 'hi-IN');
  assert.equal(L.deviceVoiceLanguage('fr'), 'fr');
  assert.equal(L.deviceVoiceLanguage('ta'), 'ta-IN');
  assert.equal(L.deviceVoiceLanguage('tl'), 'fil-PH');
  assert.equal(L.deviceVoiceLanguage('ZH'), 'zh-CN');
});

console.log(`\n${passed} passed`);
