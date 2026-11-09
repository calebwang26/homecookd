// Every phase × event of Mom's answer screen, against the table written out below. A change in
// behaviour fails a named cell. Run: cd web && npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVENTS, PHASES, transition, view, type Cmd, type Phase, type PhaseKind, type QEvent, type QEventType, type QState } from './questionMachine.ts';

const PENDING = { qid: 'q1', clip: 'clip' };

/** One sample of each phase. */
const PHASE: Record<PhaseKind, Phase> = {
  idle: { k: 'idle', note: null },
  arming: { k: 'arming' },
  recording: { k: 'recording', tap: false },
  saving: { k: 'saving' },
  saved: { k: 'saved' },
  retry: { k: 'retry', pending: PENDING },
  blocked: { k: 'blocked', help: false },
  elsewhere: { k: 'elsewhere' },
  finishing: { k: 'finishing' },
  sendFailed: { k: 'sendFailed' },
};

/** One sample of each event (the payload variants are tested on their own below). */
const EVENT: Record<QEventType, QEvent> = {
  PRESS: { type: 'PRESS' },
  MIC_OK: { type: 'MIC_OK', tap: false },
  MIC_DENIED: { type: 'MIC_DENIED', inApp: false },
  MIC_TIMEOUT: { type: 'MIC_TIMEOUT', inApp: false },
  MIC_LATE: { type: 'MIC_LATE' },
  BEGIN_FAILED: { type: 'BEGIN_FAILED' },
  LET_GO_SHORT: { type: 'LET_GO_SHORT' },
  STOP: { type: 'STOP' },
  CLIP_SHORT: { type: 'CLIP_SHORT' },
  CLIP_QUIET: { type: 'CLIP_QUIET' },
  CLIP_OK: { type: 'CLIP_OK' },
  SAVED: { type: 'SAVED' },
  SAVE_RETRY: { type: 'SAVE_RETRY', pending: PENDING },
  SAVE_REDO: { type: 'SAVE_REDO' },
  SAVE_GONE: { type: 'SAVE_GONE' },
  RETRY_TAP: { type: 'RETRY_TAP' },
  MIC_RETRY: { type: 'MIC_RETRY', ok: true, mayReload: true },
  FINISH_FAILED: { type: 'FINISH_FAILED' },
  NEXT: { type: 'NEXT' },
  BACK: { type: 'BACK' },
};

/**
 * The expected outcome of each cell, on the middle question of three (index 1 of 3, no refusals yet):
 * the next phase (with its note, tap or help where it matters), the index, and the command, or
 * nothing where the event is ignored. Cells not listed are ignored.
 */
type Want = { to: string; index?: number; cmd?: Cmd };
const ON = (to: string, index = 1, cmd?: Cmd): Want => ({ to, index, cmd });
/** Skip, Next, Done and the timer after a save: the next question. Decision 3 adds arming, elsewhere and a failed Send. */
const NEXT_FROM: PhaseKind[] = ['idle', 'arming', 'retry', 'blocked', 'elsewhere', 'saved', 'sendFailed'];
/** Back: the question before. Decision 3 adds arming and a failed Send. */
const BACK_FROM: PhaseKind[] = ['idle', 'arming', 'retry', 'blocked', 'elsewhere', 'sendFailed'];
const TABLE: Record<QEventType, Partial<Record<PhaseKind, Want>>> = {
  PRESS: { idle: ON('arming', 1, 'open') },
  MIC_OK: { arming: ON('recording:hold') },
  MIC_DENIED: { arming: ON('blocked') },
  MIC_TIMEOUT: { arming: ON('blocked') }, // decision 3: a prompt that never answers gives up
  MIC_LATE: { arming: ON('idle:null') },
  BEGIN_FAILED: { arming: ON('blocked') },
  LET_GO_SHORT: { recording: ON('recording:tap') },
  STOP: { recording: ON('saving', 1, 'stop') },
  CLIP_SHORT: { saving: ON('idle:short') },
  CLIP_QUIET: { saving: ON('idle:quiet') },
  CLIP_OK: { saving: ON('saving', 1, 'save') },
  SAVED: { saving: ON('saved', 1, 'scheduleNext') },
  SAVE_RETRY: { saving: ON('retry') },
  SAVE_REDO: { saving: ON('idle:failed') },
  SAVE_GONE: {},
  RETRY_TAP: { retry: ON('saving', 1, 'save'), sendFailed: ON('finishing', 1, 'finish') },
  MIC_RETRY: { blocked: ON('idle:null') }, // decision 3: only while blocked; a late answer after she moved on is ignored
  FINISH_FAILED: { finishing: ON('sendFailed') }, // decision 3: a failed Send says so
  NEXT: Object.fromEntries(NEXT_FROM.map((k) => [k, ON('idle:null', 2)])),
  BACK: Object.fromEntries(BACK_FROM.map((k) => [k, ON('idle:null', 0)])),
};

function name(p: Phase): string {
  if (p.k === 'idle') return `idle:${p.note}`;
  if (p.k === 'recording') return `recording:${p.tap ? 'tap' : 'hold'}`;
  if (p.k === 'blocked' && p.help) return 'blocked:help';
  return p.k;
}

const at = (phase: Phase, index = 1, redos = 0): QState => ({ phase, index, n: 3, redos });

test('every phase × event on the middle question matches the table', () => {
  for (const k of PHASES) {
    for (const ev of EVENTS) {
      const got = transition(at(PHASE[k]), EVENT[ev]);
      const want = TABLE[ev][k] ?? null;
      const cell = `${k} × ${ev}`;
      if (!want) {
        assert.equal(got, null, `${cell}: expected ignored, got ${got && name(got.state.phase)}`);
        continue;
      }
      assert.ok(got, `${cell}: expected ${want.to}, got ignored`);
      assert.equal(name(got.state.phase), want.to, cell);
      assert.equal(got.state.index, want.index ?? 1, `${cell}: index`);
      assert.equal(got.cmd, want.cmd, `${cell}: command`);
    }
  }
});

test('the table covers every phase and event, and nothing else', () => {
  assert.deepEqual(Object.keys(PHASE).sort(), [...PHASES].sort());
  assert.deepEqual(Object.keys(EVENT).sort(), [...EVENTS].sort());
  assert.deepEqual(Object.keys(TABLE).sort(), [...EVENTS].sort());
});

test('the last question: NEXT finishes instead of moving on', () => {
  for (const k of NEXT_FROM) {
    const got = transition(at(PHASE[k], 2), EVENT.NEXT);
    assert.deepEqual(got && { to: name(got.state.phase), index: got.state.index, cmd: got.cmd }, { to: 'finishing', index: 2, cmd: 'finish' }, k);
  }
});

test('the first question: BACK leaves for the guess, the phase unchanged', () => {
  for (const k of BACK_FROM) {
    const got = transition(at(PHASE[k], 0), EVENT.BACK);
    assert.ok(got, k);
    assert.equal(got.cmd, 'leave', k);
    assert.equal(got.state.index, 0, k);
    assert.equal(got.state.phase, PHASE[k], k);
  }
});

test('payload variants', () => {
  assert.equal(name(transition(at(PHASE.arming), { type: 'MIC_OK', tap: true })!.state.phase), 'recording:tap');
  assert.equal(name(transition(at(PHASE.arming), { type: 'MIC_DENIED', inApp: true })!.state.phase), 'elsewhere');
  assert.equal(name(transition(at(PHASE.arming), { type: 'MIC_TIMEOUT', inApp: true })!.state.phase), 'elsewhere');
  // A retry keeps the clip to resend.
  assert.deepEqual(transition(at(PHASE.saving), { type: 'SAVE_RETRY', pending: PENDING })!.state.phase, { k: 'retry', pending: PENDING });
  // A tap recording isn't shortened again; STOP works from it.
  assert.equal(transition(at({ k: 'recording', tap: true }), EVENT.LET_GO_SHORT), null);
  assert.equal(transition(at({ k: 'recording', tap: true }), EVENT.STOP)!.cmd, 'stop');
});

test('a refused mic retry: one reload, then help instead of a loop', () => {
  const first = transition(at(PHASE.blocked), { type: 'MIC_RETRY', ok: false, mayReload: true })!;
  assert.equal(first.cmd, 'reload');
  assert.equal(first.state.phase, PHASE.blocked);
  const again = transition(at(PHASE.blocked), { type: 'MIC_RETRY', ok: false, mayReload: false })!;
  assert.equal(again.cmd, undefined);
  assert.equal(name(again.state.phase), 'blocked:help');
  assert.equal(view(again.state.phase, true).label, 'm3.blockedHelp');
  // From help, Try again can still open the mic.
  assert.equal(name(transition(at({ k: 'blocked', help: true }), { type: 'MIC_RETRY', ok: true, mayReload: false })!.state.phase), 'idle:null');
});

test('an answer refused twice in a row says so, and a save or a new question starts the count over', () => {
  const once = transition(at(PHASE.saving), EVENT.SAVE_REDO)!;
  assert.equal(name(once.state.phase), 'idle:failed');
  assert.equal(once.state.redos, 1);
  const twice = transition({ ...once.state, phase: PHASE.saving }, EVENT.SAVE_REDO)!;
  assert.equal(name(twice.state.phase), 'idle:refused');
  assert.equal(view(twice.state.phase, true).label, 'm3.refused');
  assert.equal(view(twice.state.phase, true).skipEnabled, true);
  assert.equal(transition(at(PHASE.saving, 1, 1), EVENT.SAVED)!.state.redos, 0);
  assert.equal(transition(at(PHASE.idle, 1, 1), EVENT.NEXT)!.state.redos, 0);
});

test('a recording or a request in flight is never dropped by Back, Skip or a press', () => {
  for (const k of ['recording', 'saving', 'saved', 'finishing'] as const) {
    for (const ev of ['BACK', 'PRESS', 'MIC_RETRY'] as const) assert.equal(transition(at(PHASE[k]), EVENT[ev]), null, `${k} × ${ev}`);
    if (k !== 'saved') assert.equal(transition(at(PHASE[k]), EVENT.NEXT), null, `${k} × NEXT`);
    const v = view(PHASE[k], true);
    assert.equal(v.backEnabled, false, `${k}: Back`);
    assert.equal(v.skipEnabled, false, `${k}: Skip`);
  }
});

/** What each phase shows and allows (canRecord true). */
const VIEW: Record<PhaseKind, { label: string; mic: string; micShown: boolean; micDisabled: boolean; retrying: boolean; spinner: boolean; back: boolean; skip: boolean; copyLink: boolean }> = {
  idle: { label: 'm3.hold', mic: 'idle', micShown: true, micDisabled: false, retrying: false, spinner: false, back: true, skip: true, copyLink: false },
  // Decision 3: Back and Skip work while the browser asks for the mic.
  arming: { label: 'm3.hold', mic: 'idle', micShown: true, micDisabled: false, retrying: false, spinner: false, back: true, skip: true, copyLink: false },
  recording: { label: 'm3.letGo', mic: 'rec', micShown: true, micDisabled: false, retrying: false, spinner: false, back: false, skip: false, copyLink: false },
  saving: { label: 'm3.saving', mic: 'saving', micShown: true, micDisabled: true, retrying: false, spinner: true, back: false, skip: false, copyLink: false },
  saved: { label: 'm3.saved', mic: 'saved', micShown: true, micDisabled: true, retrying: false, spinner: false, back: false, skip: false, copyLink: false },
  retry: { label: 'm3.failed', mic: 'retry', micShown: true, micDisabled: false, retrying: true, spinner: false, back: true, skip: true, copyLink: false },
  blocked: { label: 'm3.blocked', mic: 'retry', micShown: true, micDisabled: false, retrying: true, spinner: false, back: true, skip: true, copyLink: false },
  // Decision 3: Skip and a Copy link way out in an in-app browser.
  elsewhere: { label: 'm3.elsewhere', mic: 'idle', micShown: false, micDisabled: false, retrying: false, spinner: false, back: true, skip: true, copyLink: true },
  finishing: { label: 'm3.saving', mic: 'saving', micShown: true, micDisabled: true, retrying: false, spinner: true, back: false, skip: false, copyLink: false },
  // Decision 3: a failed Send says so, with Try again on the mic.
  sendFailed: { label: 'm3.sendFailed', mic: 'retry', micShown: true, micDisabled: false, retrying: true, spinner: false, back: true, skip: true, copyLink: false },
};

test('what every phase shows and allows', () => {
  for (const k of PHASES) {
    const v = view(PHASE[k], true);
    assert.equal(v.skipShown, true, `${k}: Skip is always on the page`);
    assert.deepEqual(
      { label: v.label, mic: v.mic, micShown: v.micShown, micDisabled: v.micDisabled, retrying: v.retrying, spinner: v.spinner, back: v.backEnabled, skip: v.skipEnabled, copyLink: v.copyLink },
      VIEW[k],
      k,
    );
  }
});

test('labels for the notes and the tap recording', () => {
  assert.equal(view({ k: 'idle', note: 'short' }, true).label, 'm3.short');
  assert.equal(view({ k: 'idle', note: 'quiet' }, true).label, 'm3.quiet');
  assert.equal(view({ k: 'idle', note: 'failed' }, true).label, 'm3.failed');
  assert.equal(view({ k: 'idle', note: 'refused' }, true).label, 'm3.refused');
  assert.equal(view({ k: 'recording', tap: true }, true).label, 'm3.tapStop');
});

test('a browser that cannot record: no mic, but Skip and Copy link, and the elsewhere line', () => {
  for (const k of PHASES) {
    const v = view(PHASE[k], false);
    assert.equal(v.micShown, false, k);
    assert.equal(v.skipShown, true, k);
    assert.equal(v.copyLink, true, k);
    assert.equal(v.label, 'm3.elsewhere', k);
  }
});
