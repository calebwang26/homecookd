// The sheets' lifecycle and the coordinator that holds it (src/lib/sheets/, src/lib/machine.ts), run for real
// under node: every state × event pair against the expected table, then the coordinator on a fake clock.
//   cd app && node scripts/test-sheets.mjs
//
// 1. lib/machine.ts: a missing entry is a no-op (null), never a throw; step() keeps the last 20 events.
// 2. The sheet table (hidden, held, open, closing; `drop`), every pair; how `visible` becomes an event.
// 3. The root host table (the AI consent ask waits for no sheet up), every pair.
// 4. afterClose: waits for every sheet up at the call, then SETTLE_MS, never before minMs, never past the cap.
// 5. #402's hand-off: "New message" closes while "Add family" is created already visible.
//    Every sheet below goes through the coordinator as BottomSheet does (moveSheet, holdSheet), and the helper
//    fails the test whenever a sheet presents while another sheet's Modal is up (its ancestors aside).
// 6. Toasts go to the newest viewport on screen, never one inside a held or closing sheet.
// 7. A sheet shown while another's Modal is up waits on that Modal's state, not a timer (iOS journey 4: "OK, continue"
//    on the AI consent sheet, then Record's pre-record sheet), in any flush order: (b) two shown in one commit present
//    one at a time; (c) a root host showing while a sheet is held keeps it held; a sheet inside another's content
//    opens at once; a held sheet gives up after HELD_MAX_MS; (a) a raw <Modal> (StepPlayerFull) counts while up and
//    for CLOSING_WAIT_MS as it fades, and every raw <Modal> in src/ claims its place.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
let failed = 0;
// Every test runs, so a change that breaks several says which (each test starts from reset()).
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}\n     ${String(e?.message ?? e).split('\n')[0]}`);
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
  for (const id of ['a', 'b', 'members', 'invite', 'share', 'consent', 'preRecord', 'push', 'root', 'parent', 'child', 'sibling', 'player']) C.forgetSheet(id);
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

await test('sheet: every state × event (BottomSheet, as a table; `drop` gives up a held sheet)', () => {
  everyPair(SM.sheetMachine, {
    hidden: { show: 'open', showBehind: 'held' },
    held: { settled: 'open', hide: 'hidden', drop: 'hidden' },
    open: { hide: 'closing' },
    closing: { show: 'open', showBehind: 'open', closeDone: 'hidden' },
  });
  assert.deepEqual([...SM.SHEET_EVENTS], ['show', 'showBehind', 'settled', 'hide', 'closeDone', 'drop']);
});

await test('sheet: its Modal is up only in open and closing', () => {
  assert.deepEqual(
    ['hidden', 'held', 'open', 'closing'].map((s) => SM.isUp(s)),
    [false, false, true, true],
  );
  assert.equal(SM.isUp(undefined), false);
});

await test('sheet: `visible` as an event (on mount too): it waits while any other Modal is up; the waits', () => {
  assert.equal(SM.showEvent(false), 'show');
  assert.equal(SM.showEvent(true), 'showBehind');
  assert.equal(SM.SETTLE_MS, 60);
  assert.equal(SM.CLOSING_WAIT_MS, 600);
  assert.equal(SM.HELD_MAX_MS, 30_000);
});

await test('moveSheet: the next state is recorded at once; a move the table lacks records nothing', () => {
  reset();
  assert.equal(C.moveSheet('a', 'hidden', 'show'), 'open');
  assert.equal(C.sheetState('a'), 'open', 'recorded by the decision itself, not a later effect');
  assert.equal(C.moveSheet('a', 'open', 'show'), null);
  assert.equal(C.sheetState('a'), 'open');
  assert.equal(C.moveSheet('a', 'open', 'hide'), 'closing');
  assert.equal(C.sheetState('a'), 'closing');
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

/**
 * A BottomSheet as the coordinator sees it: every decision through moveSheet, a held sheet's wait through holdSheet,
 * as components/ui/BottomSheet does. `presents` lists every moment it presented over another sheet's Modal (its
 * ancestors aside): the bug class (#402, journey 4). Closing → open isn't a new present (its Modal never left).
 */
const presentedOver = [];
function sheet(id, ancestors = []) {
  const s = { id, state: 'hidden', dropped: false, presentedAt: null, cancel: null };
  const move = (event) => {
    const from = s.state;
    const next = C.moveSheet(id, from, event);
    if (!next) return;
    s.state = next;
    if (next === 'open' && from !== 'closing') {
      s.presentedAt = now;
      if (C.upCount(id, ancestors) > 0) presentedOver.push(`${id} at ${now} ms`);
    }
    if (next !== 'held' && s.cancel) {
      s.cancel();
      s.cancel = null;
    }
    if (next === 'held') {
      s.cancel = C.holdSheet(id, ancestors, {
        settle: () => move('settled'),
        drop: () => {
          move('drop');
          s.dropped = true;
        },
      });
    }
  };
  s.show = () => move(C.showEventFor(id, ancestors));
  s.hide = () => move('hide');
  s.closeDone = () => move('closeDone');
  return s;
}
function fresh() {
  reset();
  presentedOver.length = 0;
}

await test('#402: "Add family" created visible while "New message" closes waits, then presents after it is gone (either order in the commit)', () => {
  for (const order of ['members first', 'invite first']) {
    fresh();
    const members = sheet('members');
    const invite = sheet('invite');
    members.show();
    // One tap: members hides and invite mounts already visible, in the same commit.
    if (order === 'members first') {
      members.hide();
      invite.show();
    } else {
      invite.show();
      members.hide();
    }
    assert.equal(invite.state, 'held', order);
    advance(motion.sheetCloseMs);
    members.closeDone();
    assert.equal(invite.state, 'held', 'a few frames after the Modal goes');
    advance(SM.SETTLE_MS);
    assert.equal(invite.state, 'open', order);
    assert.equal(C.upCount(), 1, 'only the invite sheet is up');
    assert.deepEqual(presentedOver, [], order);
  }
});

await test('journey 4 (named fix): "OK, continue", then the pre-record sheet waits on the consent Modal, however late it starts to go', () => {
  fresh();
  const consent = sheet('consent');
  const preRecord = sheet('preRecord');
  consent.show();
  // settle() resolved Record's await (setSheet(true)) before the root host dropped the consent sheet.
  preRecord.show();
  assert.equal(preRecord.state, 'held');
  // A stalled JS thread: the consent sheet doesn't start to go for 5 s. Nothing presents over it meanwhile.
  advance(5000);
  assert.equal(preRecord.state, 'held', 'no timer lets it through');
  const closeStart = now;
  consent.hide();
  advance(motion.sheetCloseMs);
  consent.closeDone();
  advance(SM.SETTLE_MS);
  assert.equal(preRecord.state, 'open');
  assert.equal(preRecord.presentedAt - closeStart, motion.sheetCloseMs + SM.SETTLE_MS, 'close start to present: 240 + 60 ms');
  assert.deepEqual(presentedOver, []);
});

await test('(b) named fix: two sheets shown in one commit (the consent and push asks together) present one at a time', () => {
  fresh();
  const consent = sheet('consent');
  const push = sheet('push');
  consent.show();
  push.show();
  assert.equal(consent.state, 'open');
  assert.equal(push.state, 'held', 'the first one is recorded when it decides, so the second sees it');
  advance(10_000);
  assert.equal(push.state, 'held', 'while the first is read');
  consent.hide();
  advance(motion.sheetCloseMs);
  consent.closeDone();
  advance(SM.SETTLE_MS);
  assert.equal(push.state, 'open');
  assert.deepEqual(presentedOver, []);
});

await test('(c) named fix: a root host showing while a sheet is held keeps it held until the root sheet goes', () => {
  fresh();
  const members = sheet('members');
  const invite = sheet('invite');
  const root = sheet('root');
  members.show();
  invite.show();
  members.hide();
  advance(motion.sheetCloseMs);
  members.closeDone();
  // No Modal is up (the held one isn't), so the root host clears and its sheet shows before invite settles.
  assert.equal(C.upCount(), 0);
  root.show();
  assert.equal(root.state, 'open');
  advance(SM.SETTLE_MS * 10);
  assert.equal(invite.state, 'held', 'not over the root sheet');
  root.hide();
  advance(motion.sheetCloseMs);
  root.closeDone();
  advance(SM.SETTLE_MS);
  assert.equal(invite.state, 'open');
  assert.deepEqual(presentedOver, []);
});

await test('ancestors: a sheet inside another sheet\'s content opens at once over it; a sibling waits', () => {
  fresh();
  const parent = sheet('parent');
  const child = sheet('child', ['parent']);
  const sibling = sheet('sibling');
  parent.show();
  child.show();
  assert.equal(child.state, 'open', 'it presents over its parent, from the parent\'s Modal');
  sibling.show();
  assert.equal(sibling.state, 'held');
  child.hide();
  advance(motion.sheetCloseMs);
  child.closeDone();
  advance(SM.SETTLE_MS);
  assert.equal(sibling.state, 'held', 'the parent is still up');
  parent.hide();
  advance(motion.sheetCloseMs);
  parent.closeDone();
  advance(SM.SETTLE_MS);
  assert.equal(sibling.state, 'open');
  assert.deepEqual(presentedOver, []);
});

await test('held: it gives up after HELD_MAX_MS behind a Modal that stays up, never presents over it; hidden first, nothing fires', () => {
  fresh();
  const stuck = sheet('a');
  const waiting = sheet('b');
  stuck.show();
  waiting.show();
  advance(SM.HELD_MAX_MS - 1);
  assert.equal(waiting.state, 'held');
  assert.equal(waiting.dropped, false);
  advance(1);
  assert.equal(waiting.dropped, true, 'dropped at 30 s');
  assert.equal(waiting.state, 'hidden');
  assert.equal(C.sheetState('b'), 'hidden');
  assert.equal(waiting.presentedAt, null, 'never shown');
  // Hidden by its owner while held: its wait is cancelled, so neither settle nor drop comes later.
  fresh();
  const other = sheet('a');
  const gone = sheet('b');
  other.show();
  gone.show();
  gone.hide();
  assert.equal(gone.state, 'hidden');
  other.hide();
  advance(SM.HELD_MAX_MS * 2);
  assert.equal(gone.state, 'hidden');
  assert.equal(gone.dropped, false);
  assert.deepEqual(presentedOver, []);
});

await test('(a) named fix: a raw <Modal> (StepPlayerFull) holds sheets while up and for CLOSING_WAIT_MS after it unmounts', () => {
  fresh();
  C.claimModal('player');
  assert.equal(C.upCount(), 1, 'root hosts wait for it too');
  const s = sheet('a');
  s.show();
  assert.equal(s.state, 'held');
  advance(10_000);
  assert.equal(s.state, 'held');
  // It unmounts (closed, or cook/[id] unmounted under it): UIKit is still fading it out.
  const unmountedAt = now;
  C.releaseModal('player');
  assert.equal(C.sheetState('player'), 'closing');
  advance(SM.CLOSING_WAIT_MS - 1);
  assert.equal(s.state, 'held', 'not while it fades');
  advance(1);
  assert.equal(C.sheetState('player'), undefined, 'forgotten');
  advance(SM.SETTLE_MS);
  assert.equal(s.state, 'open');
  assert.equal(s.presentedAt - unmountedAt, SM.CLOSING_WAIT_MS + SM.SETTLE_MS);
  assert.deepEqual(presentedOver, []);
  // Released twice, or never claimed: nothing. Claimed again while closing: its old timer leaves it up.
  C.releaseModal('nobody');
  assert.equal(C.sheetState('nobody'), undefined);
  C.claimModal('player');
  C.releaseModal('player');
  C.claimModal('player');
  advance(SM.CLOSING_WAIT_MS);
  assert.equal(C.sheetState('player'), 'open');
  C.forgetSheet('player');
});

await test('(b) BottomSheet records its moves only through moveSheet, never from a passive effect that could write a stale state back', () => {
  const src = readFileSync(join(root, 'src/components/ui/BottomSheet.tsx'), 'utf8');
  assert.match(src, /\bmoveSheet\(/);
  assert.doesNotMatch(src, /\breportSheet\b/, 'a passive reportSheet(state) flushes after a newer move on mount and undoes it');
});

await test('(a) every raw <Modal> in src/ claims its place (useModalClaim); BottomSheet is the only other Modal', () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(f)) files.push(p);
    }
  };
  walk(join(root, 'src'));
  const raw = files.filter((f) => /<Modal\b/.test(readFileSync(f, 'utf8')) && !f.endsWith(join('ui', 'BottomSheet.tsx')));
  assert.ok(raw.length >= 1, 'StepPlayerFull at least');
  for (const f of raw) assert.match(readFileSync(f, 'utf8'), /\buseModalClaim\(/, `${f.slice(root.length + 1)}: a raw <Modal> without useModalClaim()`);
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
console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
