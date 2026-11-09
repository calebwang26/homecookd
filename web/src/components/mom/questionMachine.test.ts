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
  blocked: { k: 'blocked' },
  elsewhere: { k: 'elsewhere' },
  finishing: { k: 'finishing' },
};

/** One sample of each event (the payload variants are tested on their own below). */
const EVENT: Record<QEventType, QEvent> = {
  PRESS: { type: 'PRESS' },
  MIC_OK: { type: 'MIC_OK', tap: false },
  MIC_DENIED: { type: 'MIC_DENIED', inApp: false },
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
  RETRY_TAP: { type: 'RETRY_TAP', pending: PENDING },
  MIC_RETRY: { type: 'MIC_RETRY', ok: true },
  NEXT: { type: 'NEXT' },
  BACK: { type: 'BACK' },
};

/**
 * The expected outcome of each cell, on the middle question of three (index 1 of 3): the next phase
 * (with its note, tap or index where it matters) and the command, or null where the event is ignored.
 * Cells not listed are null.
 */
type Want = { to: string; index?: number; cmd?: Cmd };
const TABLE: Partial<Record<QEventType, Partial<Record<PhaseKind, Want>>>> = {
  PRESS: { idle: { to: 'arming', cmd: 'open' } },
  MIC_OK: { arming: { to: 'recording:hold' } },
  MIC_DENIED: { arming: { to: 'blocked' } },
  MIC_LATE: { arming: { to: 'idle:null' } },
  BEGIN_FAILED: { arming: { to: 'blocked' } },
  LET_GO_SHORT: {}, // only from a hold; the sample recording is a hold, see below
  STOP: { recording: { to: 'saving', cmd: 'stop' } },
  CLIP_SHORT: { saving: { to: 'idle:short' } },
  CLIP_QUIET: { saving: { to: 'idle:quiet' } },
  CLIP_OK: { saving: { to: 'saving', cmd: 'save' } },
  SAVED: { saving: { to: 'saved', cmd: 'scheduleNext' } },
  SAVE_RETRY: { saving: { to: 'retry' } },
  SAVE_REDO: { saving: { to: 'idle:failed' } },
  SAVE_GONE: {},
  RETRY_TAP: { retry: { to: 'saving', cmd: 'save' } },
  // Any phase, as before: the reply can land after she skipped on.
  MIC_RETRY: Object.fromEntries(PHASES.map((k) => [k, { to: 'idle:null' }])),
  // Skip, Next, Done and the timer after a save: the next question, from where they're enabled.
  NEXT: { idle: { to: 'idle:null', index: 2 }, retry: { to: 'idle:null', index: 2 }, blocked: { to: 'idle:null', index: 2 }, saved: { to: 'idle:null', index: 2 } },
  // Back: the question before, from where it's enabled.
  BACK: { idle: { to: 'idle:null', index: 0 }, retry: { to: 'idle:null', index: 0 }, blocked: { to: 'idle:null', index: 0 }, elsewhere: { to: 'idle:null', index: 0 } },
};
TABLE.LET_GO_SHORT = { recording: { to: 'recording:tap' } };

function name(p: Phase): string {
  if (p.k === 'idle') return `idle:${p.note}`;
  if (p.k === 'recording') return `recording:${p.tap ? 'tap' : 'hold'}`;
  return p.k;
}

const at = (phase: Phase, index = 1): QState => ({ phase, index, n: 3 });

test('every phase × event on the middle question matches the table', () => {
  for (const k of PHASES) {
    for (const ev of EVENTS) {
      const got = transition(at(PHASE[k]), EVENT[ev]);
      const want = TABLE[ev]?.[k] ?? null;
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
});

test('the last question: NEXT finishes instead of moving on', () => {
  for (const k of ['idle', 'retry', 'blocked', 'saved'] as const) {
    const got = transition(at(PHASE[k], 2), EVENT.NEXT);
    assert.deepEqual(got && { to: name(got.state.phase), index: got.state.index, cmd: got.cmd }, { to: 'finishing', index: 2, cmd: 'finish' }, k);
  }
});

test('the first question: BACK leaves for the guess, the phase unchanged', () => {
  for (const k of ['idle', 'retry', 'blocked', 'elsewhere'] as const) {
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
  // A refused retry keeps the phase and reloads (Safari keeps "Don't Allow" until a reload).
  for (const k of PHASES) {
    const got = transition(at(PHASE[k]), { type: 'MIC_RETRY', ok: false })!;
    assert.equal(got.cmd, 'reload', k);
    assert.equal(got.state.phase, PHASE[k], k);
  }
  // A retry keeps the clip to resend.
  const r = transition(at(PHASE.saving), { type: 'SAVE_RETRY', pending: PENDING })!.state.phase;
  assert.deepEqual(r, { k: 'retry', pending: PENDING });
  // A tap recording isn't shortened again.
  assert.equal(transition(at({ k: 'recording', tap: true }), EVENT.LET_GO_SHORT), null);
  // STOP works from a tap recording too.
  assert.equal(transition(at({ k: 'recording', tap: true }), EVENT.STOP)!.cmd, 'stop');
});

test('a recording or a save in flight is never dropped by Back, Skip or a press', () => {
  for (const k of ['recording', 'saving', 'saved', 'finishing'] as const) {
    for (const ev of ['BACK', 'PRESS'] as const) assert.equal(transition(at(PHASE[k]), EVENT[ev]), null, `${k} × ${ev}`);
    if (k !== 'saved') assert.equal(transition(at(PHASE[k]), EVENT.NEXT), null, `${k} × NEXT`);
  }
});

/** What each phase shows and allows (canRecord true), as QuestionScreen rendered it before the table. */
const VIEW: Record<PhaseKind, { label: string; mic: string; micShown: boolean; micDisabled: boolean; retrying: boolean; spinner: boolean; back: boolean; skipShown: boolean; skip: boolean }> = {
  idle: { label: 'm3.hold', mic: 'idle', micShown: true, micDisabled: false, retrying: false, spinner: false, back: true, skipShown: true, skip: true },
  // Pinned as it is today; decision 3 enables Back and Skip here.
  arming: { label: 'm3.hold', mic: 'idle', micShown: true, micDisabled: false, retrying: false, spinner: false, back: false, skipShown: true, skip: false },
  recording: { label: 'm3.letGo', mic: 'rec', micShown: true, micDisabled: false, retrying: false, spinner: false, back: false, skipShown: true, skip: false },
  saving: { label: 'm3.saving', mic: 'saving', micShown: true, micDisabled: true, retrying: false, spinner: true, back: false, skipShown: true, skip: false },
  saved: { label: 'm3.saved', mic: 'saved', micShown: true, micDisabled: true, retrying: false, spinner: false, back: false, skipShown: true, skip: false },
  retry: { label: 'm3.failed', mic: 'retry', micShown: true, micDisabled: false, retrying: true, spinner: false, back: true, skipShown: true, skip: true },
  blocked: { label: 'm3.blocked', mic: 'retry', micShown: true, micDisabled: false, retrying: true, spinner: false, back: true, skipShown: true, skip: true },
  // Pinned as it is today; decision 3 shows Skip and a copy-link way out here.
  elsewhere: { label: 'm3.elsewhere', mic: 'idle', micShown: false, micDisabled: false, retrying: false, spinner: false, back: true, skipShown: false, skip: true },
  finishing: { label: 'm3.saving', mic: 'saving', micShown: true, micDisabled: true, retrying: false, spinner: true, back: false, skipShown: true, skip: false },
};

test('what every phase shows and allows', () => {
  for (const k of PHASES) {
    const v = view(PHASE[k], true);
    assert.deepEqual(
      { label: v.label, mic: v.mic, micShown: v.micShown, micDisabled: v.micDisabled, retrying: v.retrying, spinner: v.spinner, back: v.backEnabled, skipShown: v.skipShown, skip: v.skipEnabled },
      VIEW[k],
      k,
    );
  }
});

test('labels for the notes and the tap recording', () => {
  assert.equal(view({ k: 'idle', note: 'short' }, true).label, 'm3.short');
  assert.equal(view({ k: 'idle', note: 'quiet' }, true).label, 'm3.quiet');
  assert.equal(view({ k: 'idle', note: 'failed' }, true).label, 'm3.failed');
  assert.equal(view({ k: 'recording', tap: true }, true).label, 'm3.tapStop');
});

test('a browser that cannot record: no mic, no Skip, the elsewhere line, in every phase', () => {
  for (const k of PHASES) {
    const v = view(PHASE[k], false);
    assert.equal(v.micShown, false, k);
    assert.equal(v.skipShown, false, k);
    assert.equal(v.label, 'm3.elsewhere', k);
  }
});
