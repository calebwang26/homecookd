// The sheets' lifecycle and the coordinator that holds it (src/lib/sheets/, src/lib/machine.ts), run for real
// under node: every state × event pair against the expected table, then the coordinator on a fake clock.
//   cd app && node scripts/test-sheets.mjs
//
// 1. lib/machine.ts: a missing entry is a no-op (null), never a throw; step() keeps the last 20 events.
// 2. The sheet table (hidden, held, open, closing), every pair; how `visible` becomes an event.
// 3. The root host table (the AI consent ask waits for no sheet up), every pair.
// 4. afterClose: waits for every sheet up at the call, then SETTLE_MS, never before minMs, never past the cap.
// 5. #402's hand-off: "New message" closes while "Add family" is created already visible.
// 6. Toasts go to the newest viewport on screen, never one inside a held or closing sheet.
// 7. A sheet shown in the same commit another one hides waits for that Modal (iOS journey 4: "OK, continue" on the AI
//    consent sheet, then Record's pre-record sheet); one shown over a sheet that stays open presents a few frames later.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});
const load = (p) => import(pathToFileURL(join(root, p)).href);
const { machine, machineHistory, clearMachineHistory, HISTORY_SIZE } = await load('src/lib/machine.ts');
const SM = await load('src/lib/sheets/machine.ts');
const C = await load('src/lib/sheets/coordinator.ts');
const { motion } = await load('src/theme/tokens.ts');

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

/** Every state × event pair of `m` against `expected` (state → event → next; missing means null). */
function everyPair(m, expected) {
  assert.deepEqual([...m.states].sort(), Object.keys(expected).sort(), `${m.name}: the states`);
  for (const s of m.states) {
    for (const e of m.events) {
      assert.equal(m.transition(s, e), expected[s][e] ?? null, `${m.name}: ${s} --${e}-->`);
    }
  }
}

// A fake clock for the coordinator: timers run when `advance` passes their time, in order.
let now = 0;
let timers = [];
let seq = 0;
C.clock.now = () => now;
C.clock.set = (fn, ms) => {
  const t = { id: (seq += 1), at: now + ms, fn };
  timers.push(t);
  return t.id;
};
C.clock.clear = (id) => {
  timers = timers.filter((t) => t.id !== id);
};
function advance(ms) {
  const end = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!due) break;
    timers = timers.filter((t) => t !== due);
    now = due.at;
    due.fn();
  }
  now = end;
}
function reset() {
  for (const id of ['a', 'b', 'members', 'invite', 'share', 'consent', 'preRecord']) C.forgetSheet(id);
  timers = [];
  now = 0;
}

await test('machine: a listed event moves, an unlisted one is null (a no-op), never a throw', () => {
  const door = machine('door', ['open', 'close'], { shut: { open: 'ajar' }, ajar: { close: 'shut' } });
  assert.deepEqual(door.states, ['shut', 'ajar']);
  assert.equal(door.transition('shut', 'open'), 'ajar');
  assert.equal(door.transition('ajar', 'open'), null);
  assert.equal(door.transition('shut', 'close'), null);
});

await test('machine: step() records every event (no-ops too), keeps the last 20, and transition() records nothing', () => {
  clearMachineHistory();
  const door = machine('door', ['open', 'close'], { shut: { open: 'ajar' }, ajar: { close: 'shut' } });
  door.transition('shut', 'open');
  assert.deepEqual(machineHistory(), {}, 'transition is pure');
  assert.equal(door.step('shut', 'open'), 'ajar');
  assert.equal(door.step('ajar', 'open'), null);
  const h = machineHistory().door;
  assert.deepEqual(h.map(({ event, from, to }) => [event, from, to]), [['open', 'shut', 'ajar'], ['open', 'ajar', null]]);
  assert.equal(typeof h[0].t, 'number');
  for (let i = 0; i < 30; i += 1) door.step(i % 2 ? 'ajar' : 'shut', i % 2 ? 'close' : 'open');
  assert.equal(HISTORY_SIZE, 20);
  assert.equal(machineHistory().door.length, 20, 'a ring of 20');
  assert.equal(machineHistory().door.at(-1).event, 'close', 'newest last');
  machineHistory().door.pop();
  assert.equal(machineHistory().door.length, 20, 'a copy, not the buffer');
  clearMachineHistory();
});

await test('sheet: every state × event (today\'s BottomSheet, as a table)', () => {
  everyPair(SM.sheetMachine, {
    hidden: { show: 'open', showBehind: 'held' },
    held: { settled: 'open', hide: 'hidden' },
    open: { hide: 'closing' },
    closing: { show: 'open', showBehind: 'open', closeDone: 'hidden' },
  });
  assert.deepEqual([...SM.SHEET_EVENTS], ['show', 'showBehind', 'settled', 'hide', 'closeDone']);
});

await test('sheet: its Modal is up only in open and closing', () => {
  assert.deepEqual(
    ['hidden', 'held', 'open', 'closing'].map((s) => SM.isUp(s)),
    [false, false, true, true],
  );
  assert.equal(SM.isUp(undefined), false);
});

await test('sheet: `visible` as an event: created visible or shown later, it waits while any other Modal is up', () => {
  assert.equal(SM.initialSheetState(false, true), 'hidden');
  assert.equal(SM.initialSheetState(true, false), 'open');
  assert.equal(SM.initialSheetState(true, true), 'held');
  assert.equal(SM.showEvent(false), 'show');
  assert.equal(SM.showEvent(true), 'showBehind');
  assert.equal(SM.heldWaitMs(true), SM.CLOSING_WAIT_MS);
  assert.equal(SM.heldWaitMs(false), SM.SETTLE_MS);
  assert.equal(SM.SETTLE_MS, 60);
  assert.equal(SM.CLOSING_WAIT_MS, 600);
});

await test('root host (the AI consent ask): every state × event', () => {
  everyPair(SM.rootHostMachine, {
    idle: { want: 'waiting' },
    waiting: { clear: 'showing', drop: 'idle' },
    showing: { drop: 'idle' },
  });
});

await test('coordinator: up and closing counts follow what each sheet reports', () => {
  reset();
  C.reportSheet('a', 'open');
  C.reportSheet('b', 'held');
  assert.equal(C.upCount(), 1);
  assert.equal(C.upCount('a'), 0);
  assert.equal(C.othersClosing('b'), false);
  C.reportSheet('a', 'closing');
  assert.equal(C.upCount(), 1);
  assert.equal(C.othersClosing('b'), true);
  assert.equal(C.othersClosing('a'), false, 'never itself');
  C.reportSheet('a', 'hidden');
  assert.equal(C.upCount(), 0);
  C.forgetSheet('a');
  assert.equal(C.sheetState('a'), undefined);
});

await test('afterClose: nothing up runs after the settle, or after minMs when longer', () => {
  reset();
  const ran = [];
  C.afterClose(() => ran.push('settle'));
  C.afterClose(() => ran.push('min'), 600);
  advance(SM.SETTLE_MS - 1);
  assert.deepEqual(ran, []);
  advance(1);
  assert.deepEqual(ran, ['settle']);
  advance(600 - SM.SETTLE_MS - 1);
  assert.deepEqual(ran, ['settle']);
  advance(1);
  assert.deepEqual(ran, ['settle', 'min']);
});

await test('afterClose: waits for the sheet being closed (still open at the call), then the settle', () => {
  reset();
  let ran = 0;
  C.reportSheet('a', 'open');
  C.afterClose(() => (ran += 1), motion.sheetCloseMs + 40);
  C.reportSheet('a', 'closing');
  advance(motion.sheetCloseMs);
  assert.equal(ran, 0, 'its Modal is still up');
  C.reportSheet('a', 'hidden'); // closeDone, 240 ms in
  advance(SM.SETTLE_MS - 1);
  assert.equal(ran, 0);
  advance(1);
  assert.equal(ran, 1, 'gone + settle (300 ms), past minMs (280 ms)');
  advance(5000);
  assert.equal(ran, 1, 'once');
});

await test('afterClose: never before minMs, even when the Modal goes sooner', () => {
  reset();
  let at = null;
  C.reportSheet('a', 'open');
  C.afterClose(() => (at = now), 600);
  C.reportSheet('a', 'closing');
  advance(motion.sheetCloseMs);
  C.reportSheet('a', 'hidden');
  advance(1000);
  assert.equal(at, 600);
});

await test('afterClose: a sheet that never goes is capped; a sheet opened after the call is not waited on', () => {
  reset();
  let at = null;
  C.reportSheet('a', 'open');
  C.afterClose(() => (at = now));
  advance(C.AFTER_CLOSE_CAP_MS - 1);
  assert.equal(at, null);
  advance(1);
  assert.equal(at, C.AFTER_CLOSE_CAP_MS);
  assert.equal(C.AFTER_CLOSE_CAP_MS, motion.sheetCloseMs + SM.CLOSING_WAIT_MS + SM.SETTLE_MS);

  reset();
  at = null;
  C.afterClose(() => (at = now));
  C.reportSheet('b', 'open');
  advance(SM.SETTLE_MS);
  assert.equal(at, SM.SETTLE_MS);
});

await test('afterClose: the cancel stops it (an effect cleaned up)', () => {
  reset();
  let ran = false;
  C.reportSheet('a', 'open');
  const cancel = C.afterClose(() => (ran = true));
  cancel();
  C.reportSheet('a', 'hidden');
  advance(5000);
  assert.equal(ran, false);
});

await test('whenSheetsClosed resolves once the sheets are gone', async () => {
  reset();
  C.reportSheet('a', 'open');
  let done = false;
  const p = C.whenSheetsClosed(600).then(() => (done = true));
  C.reportSheet('a', 'hidden');
  advance(600);
  await p;
  assert.equal(done, true);
});

await test('#402: "Add family" created visible while "New message" closes waits, then presents after it is gone', () => {
  reset();
  const T = SM.sheetMachine.transition;
  let members = 'open';
  C.reportSheet('members', members);
  // One tap: members hides (before paint), invite mounts already visible in the same commit.
  members = T(members, 'hide');
  let invite = SM.initialSheetState(true, C.upCount('invite') > 0);
  assert.equal(invite, 'held', 'members still reports open when invite is created');
  C.reportSheet('members', members);
  C.reportSheet('invite', invite);
  assert.equal(SM.heldWaitMs(C.othersClosing('invite')), SM.CLOSING_WAIT_MS, 'members is closing: up to 600 ms');
  // Members slides out and its Modal unmounts.
  members = T(members, 'closeDone');
  C.reportSheet('members', members);
  assert.equal(C.othersClosing('invite'), false);
  assert.equal(SM.heldWaitMs(C.othersClosing('invite')), SM.SETTLE_MS, 'then a few frames');
  invite = T(invite, 'settled');
  C.reportSheet('invite', invite);
  assert.equal(invite, 'open');
  assert.equal(C.upCount(), 1, 'only the invite sheet is up');
});

/** Reports a sheet's state, as BottomSheet's effect does, and notes any moment two Modals are up at once. */
function reporter() {
  const both = [];
  return {
    both,
    report(id, s) {
      C.reportSheet(id, s);
      if (C.upCount() > 1) both.push(`${id} ${s}`);
    },
  };
}

await test('journey 4 (named fix): "OK, continue" shows the pre-record sheet while the consent sheet still reports open: it waits for that Modal, then presents', () => {
  reset();
  const T = SM.sheetMachine.transition;
  const { both, report } = reporter();
  let consent = 'open';
  let preRecord = 'hidden';
  report('consent', consent);
  report('preRecord', preRecord);
  // One commit: settle() resolved Record's `await ensureAiConsent()` (setSheet(true)) before the root host's `drop`,
  // which comes from its effect. So the pre-record sheet's layout effect still finds the consent sheet open.
  assert.equal(C.othersClosing('preRecord'), false, 'the consent sheet has not reported closing yet');
  assert.equal(T('hidden', SM.showEvent(C.othersClosing('preRecord'))), 'open', 'the old rule (only behind a closing one) presented here, over the consent Modal');
  preRecord = T(preRecord, C.showEventFor('preRecord'));
  assert.equal(preRecord, 'held');
  report('preRecord', preRecord);
  assert.equal(SM.heldWaitMs(C.othersClosing('preRecord')), SM.SETTLE_MS, 'held: its timer starts at a few frames');
  // The host drops in the same task: the consent sheet slides out, and the held timer re-arms to the closing cap.
  consent = T(consent, 'hide');
  report('consent', consent);
  assert.equal(SM.heldWaitMs(C.othersClosing('preRecord')), SM.CLOSING_WAIT_MS);
  consent = T(consent, 'closeDone');
  report('consent', consent);
  assert.equal(SM.heldWaitMs(C.othersClosing('preRecord')), SM.SETTLE_MS, 'the consent Modal is gone: a few frames');
  preRecord = T(preRecord, 'settled');
  report('preRecord', preRecord);
  assert.equal(preRecord, 'open');
  assert.deepEqual(both, [], 'never two Modals up at once');
});

await test('sheet (named fix): shown in the same commit another sheet is hidden, it waits for that one to go', () => {
  reset();
  const T = SM.sheetMachine.transition;
  const { both, report } = reporter();
  let a = 'open';
  let b = 'hidden';
  report('a', a);
  report('b', b);
  // One tap: a hides and b shows. a's layout effect moves it to closing, but it reports that from its effect, after
  // b's layout effect has already decided.
  a = T(a, 'hide');
  b = T(b, C.showEventFor('b'));
  assert.equal(b, 'held', 'a still reads open: b waits');
  report('a', a);
  report('b', b);
  assert.equal(SM.heldWaitMs(C.othersClosing('b')), SM.CLOSING_WAIT_MS);
  a = T(a, 'closeDone');
  report('a', a);
  b = T(b, 'settled');
  report('b', b);
  assert.equal(b, 'open');
  assert.deepEqual(both, [], 'never two Modals up at once');
});

await test('sheet: shown over a sheet that stays open (one inside another), it presents a few frames later, never stuck', () => {
  reset();
  const T = SM.sheetMachine.transition;
  C.reportSheet('a', 'open');
  let b = T('hidden', C.showEventFor('b'));
  assert.equal(b, 'held');
  C.reportSheet('b', b);
  assert.equal(SM.heldWaitMs(C.othersClosing('b')), SM.SETTLE_MS, 'nothing is closing: SETTLE_MS, then settled');
  b = T(b, 'settled');
  assert.equal(b, 'open');
  C.reportSheet('b', b);
  C.forgetSheet('a');
  assert.equal(C.showEventFor('c'), 'showBehind', 'b is up');
  C.forgetSheet('b');
  assert.equal(C.showEventFor('c'), 'show', 'nothing up: at once');
});

await test('toast (named fix): the newest viewport on screen, never inside a held or closing sheet', () => {
  reset();
  const pick = (vps) => C.pickToastViewport(vps);
  assert.equal(pick([]), null);
  assert.equal(pick([{ id: 'root' }]), 'root');
  C.reportSheet('a', 'open');
  assert.equal(pick([{ id: 'root' }, { id: 'in-a', sheetId: 'a' }]), 'in-a');
  C.reportSheet('a', 'closing');
  assert.equal(pick([{ id: 'root' }, { id: 'in-a', sheetId: 'a' }]), 'root', 'a closing sheet takes no toast');
  C.reportSheet('a', 'held');
  assert.equal(pick([{ id: 'root' }, { id: 'in-a', sheetId: 'a' }]), 'root', 'nor a held one');
  C.reportSheet('a', 'open');
  C.reportSheet('b', 'closing');
  assert.equal(pick([{ id: 'root' }, { id: 'in-a', sheetId: 'a' }, { id: 'in-b', sheetId: 'b' }]), 'in-a', 'the open sheet under a closing one');
  assert.equal(pick([{ id: 'in-a', sheetId: 'unknown' }]), null);
});

await test('AiConsent host (named fix): waits while any sheet is up, then stays up over its own sheet', () => {
  reset();
  const T = SM.rootHostMachine.transition;
  C.reportSheet('share', 'open');
  let host = T('idle', 'want');
  assert.equal(host, 'waiting');
  assert.equal(C.upCount() === 0, false, 'the share sheet is up: no `clear` yet');
  C.reportSheet('share', 'hidden');
  host = T(host, 'clear');
  assert.equal(host, 'showing');
  C.reportSheet('consent', 'open');
  assert.equal(T(host, 'clear'), null, 'its own sheet up changes nothing');
  assert.equal(T(host, 'drop'), 'idle');
});

reset();
console.log(`\n${passed} passed`);
