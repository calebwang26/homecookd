// Unit tests for "Leo is cooking your chili" app logic (TS run by Node's type stripping):
//   src/lib/cookingLogic.ts  copy, the cook-mode session (start at once, 2 s step debounce, one call
//                            in flight, consent gate, memorial cooks, end after the last call, 45 min
//                            idle and the step change that starts again), the heart watch & its
//                            per-session feed, the cook's live rows
//   src/components/messages/chatGroups.ts  reactions in the chat: stamps under what they answer,
//                            repeated hearts once, a heart opening the day, "Sent" after a heart
//   src/lib/postcardLogic.ts "Send it home" (PR 3): who gets a postcard, the burst's words (never
//                            for the cook), the rating pots, the tilt, "Just like mine" once, the
//                            cook Home's refetch stamp and row key, an open chat watching for a
//                            postcard, a waiting postcard's rank on the updates card
//   node scripts/test-cooking.mjs
// The session gets a fake clock (timers run when the test advances it) and a fake api that records
// every call and answers when the test says so.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The app imports '@/lib/format' and siblings without an extension; resolve them to .ts.
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});

const L = await import(pathToFileURL(join(root, 'src/lib/cookingLogic.ts')).href);
const G = await import(pathToFileURL(join(root, 'src/components/messages/chatGroups.ts')).href);
const PC = await import(pathToFileURL(join(root, 'src/lib/postcardLogic.ts')).href);

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

// Let pending promise callbacks run.
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

function fakeClock() {
  let now = 0;
  let seq = 0;
  const due = new Map(); // id -> {at, fn}
  return {
    timers: {
      setTimeout: (fn, ms) => {
        seq += 1;
        due.set(seq, { at: now + ms, fn });
        return seq;
      },
      clearTimeout: (id) => due.delete(id),
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
    pending: () => due.size,
  };
}

/** Records calls; each start resolves with `answer` unless the test holds it. */
function fakeApi(answer = { ok: true, shared: true, consent: 'yes', started_at: '2026-10-19T00:00:00.123456+00:00', new_session: true }) {
  const calls = [];
  let hold = null;
  let fail = false;
  return {
    calls,
    starts: () => calls.filter((c) => c[0] === 'start').map((c) => c[1].step),
    holdNext() {
      let release;
      hold = new Promise((r) => (release = r));
      return () => release();
    },
    failNext() {
      fail = true;
    },
    set answer(a) {
      answer = a;
    },
    api: {
      start: async (input) => {
        calls.push(['start', input]);
        if (hold) {
          const h = hold;
          hold = null;
          await h;
        }
        if (fail) {
          fail = false;
          throw new Error('offline');
        }
        return { ...answer };
      },
      end: async (rid) => {
        calls.push(['end', rid]);
        return { ok: true };
      },
    },
  };
}

function session(api, clock, extra = {}) {
  const states = [];
  const s = L.createCookingSession({
    recipeId: 'mom-sunday-chili',
    cookId: 'mom',
    api,
    timers: clock.timers,
    onChange: (st) => states.push(st),
    ...extra,
  });
  return { s, states };
}

// --- copy ------------------------------------------------------------------------------------

await test('copy: the consent question, the live row and the heart toast', () => {
  assert.equal(L.consentQuestion('Mom'), 'Let Mom see when you cook their dishes?');
  assert.equal(L.consentQuestion('  '), 'Let your family see when you cook their dishes?');
  // One setting for every cook, so the line says every cook, not just the one the question names.
  assert.equal(L.consentDetail(), 'Each cook in the family gets a note when you start one of their dishes.');
  assert.equal(L.liveTitle('Leo', 'Sunday Chili'), 'Leo is making your Sunday Chili');
  assert.equal(L.liveTitle('Leo', ''), 'Leo is making your recipe');
  assert.equal(L.stepLine(3, 8), 'Step 3 of 8');
  assert.equal(L.heartToast('Mom'), 'Mom sent you a heart');
  assert.equal(L.heartToast(null), 'Your family sent you a heart');
});

await test('copy never assumes a gender and has no guilt words', () => {
  const lines = [L.consentQuestion('Mom'), L.consentDetail(), L.liveTitle('Leo', 'Chili'), L.heartToast('Mom'), L.stepLine(1, 2)];
  for (const line of lines) {
    assert.ok(!/\b(he|she|his|her|him|hers)\b/i.test(line), line);
    assert.ok(!/\b(lost|expired|broken|missed|miss)\b/i.test(line), line);
  }
});

await test('reactions in the chat: a stamp with a name, never the raw body', () => {
  assert.equal(L.reactionStampText('heart', 'Mom'), 'Mom');
  assert.equal(L.reactionStampText('heart', 'Mom', true), 'You');
  assert.equal(L.reactionStampText('heart', '  '), 'Your family');
  assert.equal(L.reactionStampText('just_like_mine', 'Mom'), '“Just like mine.” · Mom');
  for (const body of ['heart', 'just_like_mine']) assert.ok(!L.reactionStampText(body, 'Mom').includes(body));
  assert.equal(L.isReactionMessage({ kind: 'reaction' }), true);
  assert.equal(L.isReactionMessage({ kind: 'text' }), false);
  assert.equal(L.isReactionMessage(null), false);
});

// --- the session -----------------------------------------------------------------------------

await test('session: the first call goes at once; step changes go 2 s after the last one', async () => {
  const clock = fakeClock();
  const f = fakeApi();
  const { s, states } = session(f.api, clock);
  s.open(1, 8);
  await flush();
  assert.deepEqual(f.calls, [['start', { recipe_id: 'mom-sunday-chili', cook_id: 'mom', step: 1, total: 8 }]]);
  assert.deepEqual(states.at(-1), { consent: 'yes', shared: true, startedAt: '2026-10-19T00:00:00.123456+00:00', ended: false });
  s.step(2, 8);
  await clock.advance(1000);
  s.step(3, 8);
  await clock.advance(1000);
  s.step(4, 8);
  await clock.advance(1999);
  assert.deepEqual(f.starts(), [1], 'nothing until 2 s after the last change');
  await clock.advance(1);
  assert.deepEqual(f.starts(), [1, 4]);
  // The same step again is nothing.
  s.step(4, 8);
  await clock.advance(5000);
  assert.deepEqual(f.starts(), [1, 4]);
});

await test('session: one call in flight at a time, and the newest step wins', async () => {
  const clock = fakeClock();
  const f = fakeApi();
  const { s } = session(f.api, clock, { debounceMs: 0 });
  const release = f.holdNext();
  s.open(1, 8);
  s.step(2, 8);
  await clock.advance(0);
  s.step(3, 8);
  await clock.advance(0);
  assert.deepEqual(f.starts(), [1], 'waits for the first answer');
  release();
  await flush();
  assert.deepEqual(f.starts(), [1, 3]);
});

await test("session: before the kid answers, only the first call goes; yes shares now, no sends nothing", async () => {
  const clock = fakeClock();
  const f = fakeApi({ ok: true, shared: false, consent: 'unasked', started_at: null, new_session: false });
  const { s, states } = session(f.api, clock);
  s.open(1, 8);
  await flush();
  assert.equal(states.at(-1).consent, 'unasked');
  s.step(2, 8);
  await clock.advance(5000);
  assert.deepEqual(f.starts(), [1], 'no steps while unasked');
  f.answer = { ok: true, shared: true, consent: 'yes', started_at: '2026-10-19T00:01:00Z', new_session: true };
  s.answer(true);
  await flush();
  assert.deepEqual(f.starts(), [1, 2], 'yes: the current step at once');
  assert.deepEqual(states.at(-1), { consent: 'yes', shared: true, startedAt: '2026-10-19T00:01:00Z', ended: false });

  const clock2 = fakeClock();
  const g = fakeApi({ ok: true, shared: false, consent: 'unasked', started_at: null, new_session: false });
  const { s: s2 } = session(g.api, clock2);
  s2.open(1, 8);
  await flush();
  s2.answer(false);
  s2.step(2, 8);
  await clock2.advance(60_000);
  await s2.stop();
  assert.deepEqual(g.calls.map((c) => c[0]), ['start'], 'no: no more calls, and no end either');
});

await test("session: the server's 'no' (answered on another phone) stops the calls", async () => {
  const clock = fakeClock();
  const f = fakeApi({ ok: true, shared: false, consent: 'no', started_at: null, new_session: false });
  const { s } = session(f.api, clock);
  s.open(1, 8);
  await flush();
  s.step(2, 8);
  await clock.advance(3000);
  await s.stop();
  assert.deepEqual(f.calls.map((c) => c[0]), ['start']);
});

await test("session: a memorial cook's dish never asks, sends one call and no end (even if the server said 'unasked')", async () => {
  for (const consent of ['no', 'unasked', 'yes']) {
    const clock = fakeClock();
    const f = fakeApi({ ok: true, shared: false, consent, memorial: true, started_at: null, new_session: false });
    const { s, states } = session(f.api, clock);
    s.open(1, 8);
    await flush();
    assert.deepEqual(states.at(-1), { consent: 'no', shared: false, startedAt: null, ended: false }, consent);
    s.step(2, 8);
    await clock.advance(60_000);
    await s.stop();
    assert.deepEqual(f.calls.map((c) => c[0]), ['start'], consent);
  }
});

await test('session: stop waits for the call in flight, then ends this dish once; nothing after', async () => {
  const clock = fakeClock();
  const f = fakeApi();
  const { s, states } = session(f.api, clock);
  const release = f.holdNext();
  s.open(1, 8);
  const stopping = s.stop();
  await flush();
  assert.deepEqual(f.calls.map((c) => c[0]), ['start'], 'no end before the start answered');
  release();
  await stopping;
  assert.deepEqual(f.calls.map((c) => c[0]), ['start', 'end']);
  assert.equal(f.calls[1][1], 'mom-sunday-chili');
  assert.equal(states.at(-1).ended, true);
  assert.equal(states.at(-1).shared, false);
  await s.stop();
  s.step(5, 8);
  s.open(1, 8);
  await clock.advance(10_000);
  assert.deepEqual(f.calls.map((c) => c[0]), ['start', 'end']);
  assert.equal(clock.pending(), 0, 'no timers left behind');
});

await test('session: 45 min without a step change ends it; each step change restarts the wait', async () => {
  const clock = fakeClock();
  const f = fakeApi();
  const { s } = session(f.api, clock);
  s.open(1, 8);
  await flush();
  await clock.advance(30 * 60_000);
  s.step(2, 8);
  await clock.advance(44 * 60_000);
  assert.ok(!f.calls.some((c) => c[0] === 'end'));
  await clock.advance(60_000);
  assert.deepEqual(f.calls.map((c) => c[0]), ['start', 'start', 'end']);
  assert.equal(s.state.ended, true);
});

await test('session: a step change after the 45 min idle end starts a new session at once; stop is final', async () => {
  const clock = fakeClock();
  const f = fakeApi();
  const { s, states } = session(f.api, clock);
  s.open(1, 8);
  await flush();
  await clock.advance(45 * 60_000);
  assert.deepEqual(f.calls.map((c) => c[0]), ['start', 'end']);
  assert.equal(s.state.ended, true);
  // The same step again is nothing (only a real step change means the kid is back).
  s.step(1, 8);
  await clock.advance(10_000);
  assert.deepEqual(f.calls.map((c) => c[0]), ['start', 'end']);
  f.answer = { ok: true, shared: true, consent: 'yes', started_at: '2026-10-19T01:00:00Z', new_session: true };
  s.step(2, 8);
  await flush();
  assert.deepEqual(f.calls.map((c) => [c[0], c[1]?.step]), [['start', 1], ['end', undefined], ['start', 2]], 'at once, no debounce');
  assert.deepEqual(states.at(-1), { consent: 'yes', shared: true, startedAt: '2026-10-19T01:00:00Z', ended: false });
  // The idle wait runs again for the new session.
  await clock.advance(45 * 60_000);
  assert.deepEqual(f.calls.map((c) => c[0]), ['start', 'end', 'start', 'end']);
  // "I made it" after an idle end sends nothing more, and nothing reopens after it.
  await s.stop();
  s.step(5, 8);
  s.open(1, 8);
  await clock.advance(60 * 60_000);
  assert.deepEqual(f.calls.map((c) => c[0]), ['start', 'end', 'start', 'end']);
  assert.equal(clock.pending(), 0, 'no timers left behind');
});

await test('session: after an idle end, the new session waits for that end; the old call answering late changes nothing', async () => {
  const clock = fakeClock();
  const g = fakeApi();
  const seen = []; // each state change, with how many calls had gone by then
  const s = L.createCookingSession({
    recipeId: 'mom-sunday-chili',
    cookId: 'mom',
    api: g.api,
    timers: clock.timers,
    idleMs: 5000,
    debounceMs: 0,
    onChange: (st) => seen.push({ ...st, calls: g.calls.length }),
  });
  const hold = g.holdNext();
  s.open(1, 8); // still in flight when the idle end fires
  await clock.advance(5000);
  assert.deepEqual(g.calls.map((c) => c[0]), ['start'], 'the end waits for the call in flight');
  s.step(2, 8); // back before that end reached the server
  await flush();
  assert.deepEqual(g.calls.map((c) => c[0]), ['start'], 'nothing new before the end');
  hold();
  await flush();
  assert.deepEqual(g.calls.map((c) => [c[0], c[1]?.step]), [['start', 1], ['end', undefined], ['start', 2]]);
  // The first call's answer came back after the idle end: never applied (only the new start's is).
  assert.deepEqual(seen.filter((x) => x.shared).map((x) => x.calls), [3]);
  assert.deepEqual(seen.at(-1), { consent: 'yes', shared: true, startedAt: '2026-10-19T00:00:00.123456+00:00', ended: false, calls: 3 });
});

await test('session: an offline call is retried by the next step change, and never throws', async () => {
  const clock = fakeClock();
  const f = fakeApi();
  const { s, states } = session(f.api, clock, { debounceMs: 0 });
  f.failNext();
  s.open(1, 8);
  await flush();
  assert.equal(states.length, 0, 'still unknown');
  s.step(2, 8);
  await clock.advance(0);
  assert.deepEqual(f.starts(), [1, 2]);
  assert.equal(states.at(-1).consent, 'yes');
});

// --- hearts ----------------------------------------------------------------------------------

const msg = (id, extra) => ({ id, kind: 'reaction', body: 'heart', sender_id: 'mom', created_at: '2026-10-19T00:05:00Z', ...extra });

await test('newHearts: hearts from the cook, newer than the start, not seen yet, oldest first', () => {
  const list = [
    msg('a', { created_at: '2026-10-19T00:06:00Z' }),
    msg('b', { created_at: '2026-10-19T00:05:00Z' }),
    msg('old', { created_at: '2026-10-18T23:59:00Z' }),
    msg('mine', { sender_id: 'leo' }),
    msg('jlm', { body: 'just_like_mine' }),
    msg('text', { kind: 'text', body: 'heart' }),
    msg('seen'),
  ];
  const out = L.newHearts(list, { from: 'mom', since: '2026-10-19T00:00:00Z', seen: new Set(['seen']) });
  assert.deepEqual(out.map((m) => m.id), ['b', 'a']);
});

await test('heart watch: the newest new heart once, a moving cursor, and errors read as nothing', async () => {
  const asked = [];
  let next = [];
  const watch = L.createHeartWatch({
    from: 'mom',
    since: '2026-10-19T00:00:00.123456+00:00',
    fetchSince: async (cursor) => {
      asked.push(cursor);
      if (next === 'boom') throw new Error('offline');
      return next;
    },
  });
  assert.equal(await watch.poll(), null);
  next = [
    { id: 't1', kind: 'text', body: 'hi', sender_id: 'mom', created_at: '2026-10-19T00:01:00Z' },
    msg('h1', { created_at: '2026-10-19T00:02:00Z' }),
    msg('h2', { created_at: '2026-10-19T00:03:00Z' }),
  ];
  assert.equal((await watch.poll()).id, 'h2', 'two hearts between polls: one burst');
  assert.equal(await watch.poll(), null, 'the same messages again: nothing new');
  next = 'boom';
  assert.equal(await watch.poll(), null);
  assert.deepEqual(asked, [
    '2026-10-19T00:00:00.123456+00:00',
    '2026-10-19T00:00:00.123456+00:00',
    '2026-10-19T00:03:00Z',
    '2026-10-19T00:03:00Z',
  ]);
});

await test('heart feed: one per session, so pausing and resuming the poll never shows a heart twice', async () => {
  const since = '2026-10-19T00:00:00.123456+00:00';
  const thread = [];
  // The server: messages after the cursor.
  const fetchSince = async (cursor) => thread.filter((m) => Date.parse(m.created_at) > Date.parse(cursor));
  const o = { from: 'mom', since, fetchSince };
  const f1 = L.heartFeedFor(null, o);
  assert.equal(await f1.poll(), null);
  thread.push(msg('h1', { created_at: '2026-10-19T00:02:00Z' }));
  assert.equal((await f1.poll()).id, 'h1');
  // The screen lost focus (Control Center, a banner) and came back: the hook asks for the feed again.
  const f2 = L.heartFeedFor(f1, { ...o, fetchSince: async () => [...thread] });
  assert.equal(f2, f1, 'the same session keeps its feed');
  assert.equal(await f2.poll(), null, 'no second burst for h1');
  assert.equal(f2.takeHeld(), null);
  // What the old code did: a fresh watch from the session start shows h1 again.
  assert.equal((await L.createHeartWatch(o).poll()).id, 'h1');
  // A new session (or another cook) gets a new feed.
  assert.notEqual(L.heartFeedFor(f1, { ...o, since: '2026-10-19T01:00:00Z' }), f1);
  assert.notEqual(L.heartFeedFor(f1, { ...o, from: 'dad' }), f1);
  assert.equal(L.heartFeedKey('mom', since), `mom|${Date.parse(since)}`);
});

await test('heart feed: the same start spelled another way is the same session', async () => {
  const thread = [msg('h1', { created_at: '2026-10-18T17:02:00Z' })];
  const fetchSince = async (cursor) => thread.filter((m) => Date.parse(m.created_at) > Date.parse(cursor));
  const f1 = L.heartFeedFor(null, { from: 'mom', since: '2026-10-18T17:00:00.123Z', fetchSince });
  assert.equal((await f1.poll()).id, 'h1');
  // PostgREST's spelling of the same instant.
  const f2 = L.heartFeedFor(f1, { from: 'mom', since: '2026-10-18T17:00:00.123+00:00', fetchSince });
  assert.equal(f2, f1);
  assert.equal(await f2.poll(), null);
  assert.equal(L.heartFeedKey('mom', '2026-10-18T17:00:00.123Z'), L.heartFeedKey('mom', '2026-10-18T17:00:00.123000+00:00'));
  assert.notEqual(L.heartFeedKey('mom', '2026-10-18T17:00:00.123Z'), L.heartFeedKey('mom', '2026-10-18T17:00:00.124Z'));
  // Not a time at all: the raw text keys it, so two junk values never share a feed.
  assert.notEqual(L.heartFeedKey('mom', 'x'), L.heartFeedKey('mom', 'y'));
});

await test("session + heart feed: Mom's heart bursts once, though the step answers spell started_at another way", async () => {
  // The server's first call answers the edge clock's "...Z"; later steps answer the stored row as
  // PostgREST spells it ("...+00:00"). This plays useCookingSession's heart effect: it runs again
  // whenever the session's startedAt changes, gets the feed for that start and polls at once.
  const clock = fakeClock();
  const f = fakeApi({ ok: true, shared: true, consent: 'yes', started_at: '2026-10-18T17:00:00.123Z', new_session: true });
  const thread = [];
  const fetchSince = async (cursor) => thread.filter((m) => Date.parse(m.created_at) > Date.parse(cursor));
  const shown = [];
  let feed = null;
  let since = null;
  const effectRuns = [];
  const s = L.createCookingSession({
    recipeId: 'mom-sunday-chili',
    cookId: 'mom',
    api: f.api,
    timers: clock.timers,
    onChange: (st) => {
      const next = st.shared ? st.startedAt : null;
      if (next === since) return; // the effect's deps didn't change
      since = next;
      if (!next) return;
      feed = L.heartFeedFor(feed, { from: 'mom', since: next, fetchSince });
      effectRuns.push(next);
      void feed.poll().then((h) => h && shown.push(h.id));
    },
  });
  const tick = async () => {
    const h = await feed.poll();
    if (h) shown.push(h.id);
  };
  s.open(1, 8);
  await flush();
  // Mom taps the heart from the push; Leo's next poll shows it.
  thread.push(msg('h1', { created_at: '2026-10-18T17:03:00Z' }));
  await tick();
  assert.deepEqual(shown, ['h1']);
  // Leo goes to step 2, then 3: the answers spell the start PostgREST's way.
  f.answer = { ok: true, shared: true, consent: 'yes', started_at: '2026-10-18T17:00:00.123+00:00', new_session: false };
  s.step(2, 8);
  await clock.advance(2000);
  s.step(3, 8);
  await clock.advance(2000);
  await tick();
  await flush();
  assert.deepEqual(f.starts(), [1, 2, 3]);
  assert.equal(s.state.startedAt, '2026-10-18T17:00:00.123Z', 'the start is kept for the session');
  assert.deepEqual(effectRuns, ['2026-10-18T17:00:00.123Z'], 'the heart effect never re-ran');
  assert.deepEqual(shown, ['h1'], 'one burst, one toast');
  // Even a feed asked for with the other spelling is the same feed (belt and braces).
  assert.equal(L.heartFeedFor(feed, { from: 'mom', since: '2026-10-18T17:00:00.123+00:00', fetchSince }), feed);
  await s.stop();
});

await test('session: started_at is set once a session; only a new session (server says so) replaces it', async () => {
  const clock = fakeClock();
  const f = fakeApi({ ok: true, shared: true, consent: 'yes', started_at: '2026-10-18T17:00:00.123Z', new_session: true });
  const { s } = session(f.api, clock, { debounceMs: 0 });
  s.open(1, 8);
  await flush();
  f.answer = { ok: true, shared: true, consent: 'yes', started_at: '2026-10-18T17:00:00.123+00:00', new_session: false };
  s.step(2, 8);
  await clock.advance(0);
  assert.equal(s.state.startedAt, '2026-10-18T17:00:00.123Z');
  // The server's row had gone stale (offline for 45 min): its answer starts a new session.
  f.answer = { ok: true, shared: true, consent: 'yes', started_at: '2026-10-18T18:00:00.000Z', new_session: true };
  s.step(3, 8);
  await clock.advance(0);
  assert.equal(s.state.startedAt, '2026-10-18T18:00:00.000Z');
  // A shared answer while none is known (the first after "Yes") takes the server's start.
  const clock2 = fakeClock();
  const g = fakeApi({ ok: true, shared: false, consent: 'unasked', started_at: null, new_session: false });
  const { s: s2 } = session(g.api, clock2, { debounceMs: 0 });
  s2.open(1, 8);
  await flush();
  g.answer = { ok: true, shared: true, consent: 'yes', started_at: '2026-10-18T17:05:00+00:00', new_session: false };
  s2.answer(true);
  await flush();
  assert.equal(s2.state.startedAt, '2026-10-18T17:05:00+00:00');
  // Not shared any more ('no' from another phone): no start.
  g.answer = { ok: true, shared: false, consent: 'no', started_at: null, new_session: false };
  s2.step(2, 8);
  await clock2.advance(0);
  assert.deepEqual(g.starts(), [1, 1, 2]);
  assert.deepEqual([s2.state.shared, s2.state.startedAt], [false, null]);
});

await test('heart feed: a heart that lands after the listener stopped is held, then shown once', async () => {
  const thread = [];
  const f = L.heartFeedFor(null, {
    from: 'mom',
    since: '2026-10-19T00:00:00Z',
    fetchSince: async (cursor) => thread.filter((m) => Date.parse(m.created_at) > Date.parse(cursor)),
  });
  thread.push(msg('h1', { created_at: '2026-10-19T00:02:00Z' }));
  assert.equal(await f.poll(() => false), null, 'stopped mid-poll: not shown now');
  assert.equal(f.takeHeld().id, 'h1', 'shown when polling resumes');
  assert.equal(f.takeHeld(), null);
  assert.equal(await f.poll(), null);
  // Held, then the next poll (no news) delivers it.
  thread.push(msg('h2', { created_at: '2026-10-19T00:03:00Z' }));
  assert.equal(await f.poll(() => false), null);
  assert.equal((await f.poll()).id, 'h2');
  assert.equal(await f.poll(), null);
});

// --- the cook's live rows --------------------------------------------------------------------

await test('freshLive: fresh rows only, one per kid (their newest), newest first', () => {
  const now = Date.parse('2026-10-19T01:00:00Z');
  const row = (kid, updated, recipe = 'mom-dal') => ({
    profile: { id: kid, name: kid, role: 'learner', relation: null, avatar_key: null },
    recipe_id: recipe,
    cook_id: 'mom',
    step: 1,
    total: 4,
    started_at: '2026-10-19T00:00:00Z',
    updated_at: updated,
  });
  const out = L.freshLive(
    [
      row('leo', '2026-10-19T00:50:00Z'),
      row('maya', '2026-10-19T00:58:00Z'),
      row('leo', '2026-10-19T00:59:00Z', 'mom-sunday-chili'),
      row('sam', '2026-10-19T00:15:00Z'), // exactly 45 min: gone
      { profile: null },
    ],
    now,
  );
  assert.deepEqual(out.map((r) => [r.profile.id, r.recipe_id]), [['leo', 'mom-sunday-chili'], ['maya', 'mom-dal']]);
  assert.equal(L.liveKey(out[0]), 'leo:mom-sunday-chili:2026-10-19T00:00:00Z');
});

// --- reactions in the chat (ChatLog's grouping) -------------------------------------------------

// Local times, so the day checks hold in any time zone.
const local = (day, h, min) => new Date(2026, 9, day, h, min).toISOString();
const cm = (id, sender, kind, created_at, extra = {}) => ({ id, thread_id: 't', sender_id: sender, kind, body: null, reply_to: null, recipe_id: null, created_at, ...extra });
const groupsOf = (list, me) => G.groupMessages(G.splitReactions(list).flow, me);

await test('chat: a heart that opens the day hands the day to the next time line', () => {
  const list = [
    cm('yday', 'leo', 'text', local(17, 16, 48), { body: 'Making your dal!' }),
    cm('heart', 'dad', 'reaction', local(18, 18, 30), { body: 'heart' }),
    cm('made', 'leo', 'cooked', local(18, 18, 40)),
    cm('later', 'leo', 'text', local(18, 19, 30), { body: 'So good' }),
  ];
  // [key, stamp, firstOfDay (kid day line), showsDay (parent "Today, 6:40 pm")]
  assert.deepEqual(groupsOf(list, 'dad').map((g) => [g.key, g.stamp, g.firstOfDay, g.showsDay]), [
    ['yday', false, true, true],
    ['heart', true, true, false],
    ['made', false, false, true],
    ['later', false, false, false],
  ]);
  // A system note opening the day does the same; a day opened by a message names itself.
  const sys = [cm('s', 'x', 'system', local(19, 9, 0), { body: 'Linda joined.' }), cm('a', 'dad', 'text', local(19, 9, 5), { body: 'Hi' }), cm('b', 'leo', 'text', local(20, 9, 0), { body: 'Hey' })];
  assert.deepEqual(G.groupMessages(sys, 'dad').map((g) => [g.key, g.firstOfDay, g.showsDay]), [['s', true, false], ['a', false, true], ['b', true, true]]);
});

await test('chat: repeated hearts from one person in a row show once; another person or a long gap is a new line', () => {
  const h = (id, who, min) => cm(id, who, 'reaction', local(18, 18, min), { body: 'heart' });
  const list = [h('h1', 'dad', 30), h('h2', 'dad', 31), h('h3', 'dad', 35), h('m1', 'mom', 36), h('h4', 'dad', 37), h('h5', 'dad', 52)];
  assert.deepEqual(groupsOf(list, 'leo').map((g) => [g.key, g.stamp, g.messages.length]), [
    ['h1', true, 1],
    ['m1', true, 1],
    ['h4', true, 1],
    ['h5', true, 1],
  ]);
});

await test('chat: a reaction answering a message here goes under it (once per person), never in the flow', () => {
  const list = [
    cm('c1', 'leo', 'cooked', local(18, 18, 0), { recipe_id: 'dad-chili' }),
    cm('r1', 'dad', 'reaction', local(18, 18, 5), { body: 'just_like_mine', reply_to: 'c1' }),
    cm('r2', 'dad', 'reaction', local(18, 18, 6), { body: 'just_like_mine', reply_to: 'c1' }),
    cm('r3', 'mom', 'reaction', local(18, 18, 7), { body: 'heart', reply_to: 'c1' }),
    cm('r4', 'dad', 'reaction', local(18, 18, 8), { body: 'heart', reply_to: 'not-here' }),
    cm('t1', 'leo', 'text', local(18, 18, 9), { body: 'Thanks!' }),
  ];
  const { messages, flow, under } = G.splitReactions(list);
  assert.deepEqual(messages.map((m) => m.id), ['c1', 't1'], 'readers of the conversation never see a reaction');
  assert.deepEqual(flow.map((m) => m.id), ['c1', 'r4', 't1'], 'one answering nothing here stays a quiet line');
  assert.deepEqual((under.get('c1') ?? []).map((m) => m.id), ['r1', 'r3']);
});

await test("chat: a heart (or a system note) after my message keeps my '· Sent'", () => {
  const mine = cm('m', 'leo', 'text', local(18, 18, 0), { body: 'Making it now' });
  const heart = cm('h', 'dad', 'reaction', local(18, 18, 2), { body: 'heart' });
  const note = cm('s', 'x', 'system', local(18, 18, 3), { body: 'Linda joined.' });
  const under = cm('u', 'dad', 'reaction', local(18, 18, 4), { body: 'heart', reply_to: 'm' });
  const last = G.lastWrittenGroup(groupsOf([mine, heart, note, under], 'leo'));
  assert.equal(last?.key, 'm');
  assert.equal(last?.mine, true);
  const reply = cm('r', 'dad', 'text', local(18, 18, 5), { body: 'Go slow' });
  assert.equal(G.lastWrittenGroup(groupsOf([mine, heart, reply], 'leo'))?.mine, false);
  assert.equal(G.lastWrittenGroup(groupsOf([heart], 'leo')), undefined);
});

// --- PR 3: Send it home, get one back -----------------------------------------------------------

await test('postcard: only for someone else in the family who can read it; else the share prompt', () => {
  const dad = { id: 'dad', name: 'Dad' };
  assert.equal(PC.canPostcard(dad, 'leo'), true);
  assert.equal(PC.canPostcard(dad, 'dad'), false, 'my own dish');
  assert.equal(PC.canPostcard(null, 'leo'), false, 'a cook outside the family (or a YouTube dish)');
  assert.equal(PC.canPostcard({ ...dad, memorial: true }, 'leo'), false, 'a memorial cook (guardrail 2)');
  assert.equal(PC.canPostcard({ ...dad, memorial: false }, 'leo'), true);
});

await test('postcard: the burst says what happened, never what the cook will feel', () => {
  assert.deepEqual(PC.madeItWords(true, 'Dad'), { title: 'You made it', subtitle: 'We told Dad.' });
  assert.deepEqual(PC.madeItWords(false, 'Dad'), { title: 'You made it' }, 'nothing went out: nothing claimed');
  assert.equal(PC.postcardAsk('Grandma'), 'Show Grandma how it came out');
  assert.equal(PC.ratingAsk('Dad'), 'How close to Dad’s?');
  const words = JSON.stringify([PC.madeItWords(true, 'Dad'), PC.postcardAsk('Dad'), PC.ratingAsk('Dad'), PC.HOLD_HINT, PC.HOLD_HINT_SPOKEN, PC.HOLD_CUT, PC.HOLD_CUT_SPOKEN, PC.HOLD_WAIT, PC.HOLD_UNDO, PC.holdWaitSpoken('Leo'), PC.HOLD_UNDONE, PC.HOLD_TAP_SPOKEN]);
  assert.doesNotMatch(words, /\b(love|proud|miss|he|she|his|her|lost|expired|broken|missed)\b/i);
});

await test('hold to talk: only a lifted finger sends; a touch taken away never sends a cut-off note', () => {
  assert.equal(PC.holdEnd('lift', true), 'wait', 'a lifted note waits out its Undo time before it goes');
  assert.equal(PC.holdEnd('lift', false), 'short', 'too short to be a note: "Hold longer"');
  assert.equal(PC.holdEnd('cut', true), 'cut', 'the phone took the touch mid-note: nothing goes to the kid');
  assert.equal(PC.holdEnd('cut', false), 'cut');
  assert.equal(PC.HOLD_CUT, 'Not sent');
});

await test('hold to talk: a lifted note can be taken back until it goes; only Undo un-sends', () => {
  // The cook lets go: the note waits on the phone ("Sending… Undo").
  assert.equal(PC.holdEnd('lift', true), 'wait');
  // A touch on the pill while it waits takes it back, and nothing reaches the kid.
  assert.equal(PC.holdPress('waiting'), 'undo');
  assert.equal(PC.holdWait('tap'), 'undone');
  assert.equal(PC.HOLD_UNDONE, 'Not sent');
  // Untouched, it goes when the time runs out; the row going away first (sheet closed, row cleared)
  // still sends it: the cook let go to send.
  assert.equal(PC.holdWait('time'), 'send');
  assert.equal(PC.holdWait('leave'), 'send');
  // Once it is uploading, a touch does nothing (no second note, no half-undone one); otherwise a new hold.
  assert.equal(PC.holdPress('sending'), 'busy');
  for (const s of ['idle', 'sent', 'short', 'cut', 'undone', 'error']) assert.equal(PC.holdPress(s), 'record', s);
  // Long enough to reach Undo; longer with a screen reader (hearing it, then finding the button).
  assert.equal(PC.undoWindowMs(false), 3000);
  assert.equal(PC.undoWindowMs(true), 6000);
  assert.ok(PC.UNDO_MS >= 2000 && PC.UNDO_MS_SCREEN_READER > PC.UNDO_MS);
  assert.equal(PC.holdWaitSpoken(' Leo '), 'Sending to Leo. Tap to undo.');
  assert.equal(`${PC.HOLD_WAIT} ${PC.HOLD_UNDO}`, 'Sending… Undo');
});

await test('postcard: a pot rates, the same pot again takes it back, never outside 1-5', () => {
  assert.equal(PC.nextRating(null, 4), 4);
  assert.equal(PC.nextRating(4, 2), 2);
  assert.equal(PC.nextRating(2, 2), null, 'optional: tap it again to take it back');
  assert.equal(PC.nextRating(null, 9), 5);
  assert.equal(PC.nextRating(null, 0), 1);
  assert.deepEqual([1, 5, 3].map(PC.cleanRating), [1, 5, 3]);
  assert.deepEqual([0, 6, 2.5, '4', null, undefined].map(PC.cleanRating), [null, null, null, null, null, null]);
  assert.equal(PC.ratingWords(4), '4 of 5');
  assert.equal(PC.RATING_MAX, 5);
});

await test('postcard: a cooked card with a photo; the tilt is steady and at most 1.5°', () => {
  assert.equal(PC.isPostcard({ kind: 'cooked', photo_url: 'https://x/p.jpg' }), true);
  assert.equal(PC.isPostcard({ kind: 'cooked', photo_url: null }), false);
  assert.equal(PC.isPostcard({ kind: 'text', photo_url: 'https://x/p.jpg' }), false);
  const ids = ['a', 'b', 'c1', '0f4c-uuid', 'zzzz', crypto.randomUUID()];
  for (const id of ids) {
    const t = PC.postcardTilt(id);
    assert.equal(t, PC.postcardTilt(id), 'the same card, the same tilt');
    assert.ok(Math.abs(t) >= 1 && Math.abs(t) <= 1.5, `${id}: ${t}`);
  }
});

await test("postcard: 'Just like mine' once per card, mine only; the Home's stamp sees a postcard land", () => {
  const msgs = [
    { id: 'r1', kind: 'reaction', body: 'just_like_mine', sender_id: 'dad', reply_to: 'c1' },
    { id: 'r2', kind: 'reaction', body: 'heart', sender_id: 'dad', reply_to: null },
    { id: 'r3', kind: 'reaction', body: 'just_like_mine', sender_id: 'mom', reply_to: 'c2' },
    { id: 't1', kind: 'text', body: 'just_like_mine', sender_id: 'dad', reply_to: 'c3' },
  ];
  assert.deepEqual([...PC.likedIds(msgs, 'dad')], ['c1']);
  assert.deepEqual([...PC.likedIds(msgs, null)], []);
  const at = '2026-10-18T18:00:00.123456+00:00';
  const plain = PC.kitchenStamp({ last: { created_at: at, photo_url: null } });
  const card = PC.kitchenStamp({ last: { created_at: at, photo_url: 'https://x/sign/a?token=1' }, postcards: 1 });
  assert.notEqual(plain, card, 'a postcard on the same message refetches the thread');
  assert.equal(card, PC.kitchenStamp({ last: { created_at: at, photo_url: 'https://x/sign/a?token=2' }, postcards: 1 }), 'a fresh signature alone does not');
  assert.notEqual(card, PC.kitchenStamp({ last: { created_at: at, photo_url: 'https://x/sign/a', rating: 4 }, postcards: 1 }));
  // A postcard on an older card (someone wrote after it): `last` is the same, the count is not.
  const older = { created_at: at, photo_url: null };
  assert.notEqual(PC.kitchenStamp({ last: older, postcards: 0 }), PC.kitchenStamp({ last: older, postcards: 1 }));
  assert.equal(PC.kitchenStamp({ last: older }), PC.kitchenStamp({ last: older, postcards: 0 }), 'an older server (no count) keys as before');
  assert.equal(PC.kitchenStamp(null), '');
  assert.equal(PC.kitchenStamp({ last: null }), '');
  assert.equal(PC.madeKey({ id: 'c1', kind: 'cooked', photo_url: null }), 'c1');
  assert.equal(PC.madeKey({ id: 'c1', kind: 'cooked', photo_url: 'https://x' }), 'c1:postcard', 'a cleared plain row never hides the postcard');
});

await test('postcard: an open chat watches for a postcard only while a card from someone else is fresh', () => {
  const now = Date.parse('2026-10-18T18:30:00Z');
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  const card = (sender, min, extra = {}) => ({ id: `c-${sender}-${min}`, kind: 'cooked', sender_id: sender, created_at: ago(min), ...extra });
  assert.equal(PC.watchForPostcard([card('leo', 2)], 'dad', now), true, "Leo's card just came: its photo may follow");
  assert.equal(PC.watchForPostcard([card('leo', 29)], 'dad', now), true);
  assert.equal(PC.watchForPostcard([card('leo', 31)], 'dad', now), false, 'an old card: no extra polling');
  assert.equal(PC.watchForPostcard([card('dad', 2)], 'dad', now), false, 'my own card: my phone swaps it in');
  assert.equal(PC.watchForPostcard([card('leo', 2, { local: 'sending' })], 'dad', now), false);
  assert.equal(PC.watchForPostcard([{ ...card('leo', 2), kind: 'text' }], 'dad', now), false);
  assert.equal(PC.watchForPostcard([card('leo', 2)], null, now), false);
  assert.equal(PC.watchForPostcard([card('leo', 2, { created_at: 'nope' })], 'dad', now), false);
  assert.equal(PC.POSTCARD_WATCH_MS, 30 * 60_000);
});

await test('postcard: one waiting for its answer ranks at least as high as the newest made row, never above a newer question', () => {
  const r = (key, kind, min) => ({ key, kind, at: new Date(Date.parse('2026-10-18T18:00:00Z') + min * 60_000).toISOString() });
  const order = (rows) => PC.rankMine(rows, (x) => x.at, (x) => x.kind).map((x) => x.key);
  // Leo's postcard (his card at 18:10) under two newer plain rows: it comes up to the newest made row.
  assert.deepEqual(order([r('ask', 'ask', 30), r('mia', 'made', 25), r('sam', 'made', 20), r('leo', 'postcard', 10)]), ['ask', 'leo', 'mia', 'sam']);
  // A newer question stays above it; an older one goes below.
  assert.deepEqual(order([r('old-ask', 'ask', 5), r('leo', 'postcard', 10), r('mia', 'made', 25)]), ['leo', 'mia', 'old-ask']);
  // Already the newest: plain time order. No postcard: plain time order.
  assert.deepEqual(order([r('mia', 'made', 5), r('leo', 'postcard', 10)]), ['leo', 'mia']);
  assert.deepEqual(order([r('a', 'made', 5), r('q', 'ask', 7), r('b', 'made', 9)]), ['b', 'q', 'a']);
  // Two waiting postcards keep their own order between them.
  assert.deepEqual(order([r('mia', 'made', 30), r('leo', 'postcard', 20), r('max', 'postcard', 10)]), ['leo', 'max', 'mia']);
});

await test('timings match the handoff', () => {
  assert.equal(L.STEP_DEBOUNCE_MS, 2000);
  assert.equal(L.IDLE_END_MS, 45 * 60_000);
  assert.equal(L.HEART_POLL_MS, 10_000);
  assert.equal(L.LIVE_POLL_MS, 15_000);
  assert.equal(L.LIVE_FRESH_MS, 45 * 60_000);
  assert.equal(L.FINISH_WAIT_MS, 2000);
});

console.log(`\n${passed} passed`);
