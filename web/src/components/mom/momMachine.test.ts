// Every stage × event of Mom's page, against the table written out below. Run: cd web && npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOM_EVENTS, STAGES, momTransition, type MomEvent, type MomEventType, type Stage } from './momMachine.ts';

const EVENT: Record<MomEventType, MomEvent> = {
  LOAD_START: { type: 'LOAD_START' },
  BAD_LINK: { type: 'BAD_LINK' },
  LOADED: { type: 'LOADED', finished: false, merging: false, resume: false },
  LOAD_FAILED: { type: 'LOAD_FAILED' },
  INTRO_NEXT: { type: 'INTRO_NEXT' },
  GUESS_BACK: { type: 'GUESS_BACK' },
  START: { type: 'START', questions: 3 },
  QUESTIONS_BACK: { type: 'QUESTIONS_BACK' },
  SAVE_CLOSED: { type: 'SAVE_CLOSED' },
  SAVE_NOT_FOUND: { type: 'SAVE_NOT_FOUND' },
  FINISH: { type: 'FINISH', answered: 2, ok: true },
  FILL_STOPPED: { type: 'FILL_STOPPED', version: false, finished: true },
  FILL_DONE: { type: 'FILL_DONE' },
  OPEN_RECIPE: { type: 'OPEN_RECIPE' },
  CLOSE_RECIPE: { type: 'CLOSE_RECIPE' },
};

const every = (to: Stage) => Object.fromEntries(STAGES.map((s) => [s, to])) as Record<Stage, Stage>;

/** The expected next stage of each cell; cells not listed are ignored (null). */
const TABLE: Record<MomEventType, Partial<Record<Stage, Stage>>> = {
  // The page's own loads and the server's answers act from any stage, as their setStage calls did.
  LOAD_START: every('loading'),
  BAD_LINK: every('error'),
  LOADED: every('intro'),
  LOAD_FAILED: every('error'),
  SAVE_CLOSED: every('sent'),
  SAVE_NOT_FOUND: every('error'),
  FINISH: every('fill'), // the sample is a Send that went through
  FILL_DONE: every('sent'),
  // A screen's own buttons act only on that screen.
  INTRO_NEXT: { intro: 'guess' },
  GUESS_BACK: { guess: 'intro' },
  START: { guess: 'questions', nothing: 'questions' },
  QUESTIONS_BACK: { questions: 'guess' },
  FILL_STOPPED: { fill: 'sent' },
  OPEN_RECIPE: { sent: 'recipe', recipe: 'recipe' },
  CLOSE_RECIPE: { recipe: 'sent' },
};

test('every stage × event matches the table', () => {
  for (const s of STAGES) {
    for (const ev of MOM_EVENTS) assert.equal(momTransition(s, EVENT[ev]), TABLE[ev][s] ?? null, `${s} × ${ev}`);
  }
});

test('the table covers every stage and event', () => {
  assert.deepEqual(Object.keys(EVENT).sort(), [...MOM_EVENTS].sort());
  assert.deepEqual(Object.keys(TABLE).sort(), [...MOM_EVENTS].sort());
});

test('a loaded ask opens where the server has it', () => {
  assert.equal(momTransition('loading', { type: 'LOADED', finished: true, merging: true, resume: false }), 'fill');
  assert.equal(momTransition('loading', { type: 'LOADED', finished: true, merging: false, resume: false }), 'sent');
  assert.equal(momTransition('loading', { type: 'LOADED', finished: false, merging: true, resume: false }), 'intro');
});

test('decision 3: back from a mic reload, straight to the questions (unless she already sent)', () => {
  assert.equal(momTransition('loading', { type: 'LOADED', finished: false, merging: false, resume: true }), 'questions');
  assert.equal(momTransition('loading', { type: 'LOADED', finished: true, merging: false, resume: true }), 'sent');
});

test('no questions to answer: nothing', () => {
  assert.equal(momTransition('guess', { type: 'START', questions: 0 }), 'nothing');
  assert.equal(momTransition('nothing', { type: 'START', questions: 0 }), 'nothing');
  assert.equal(momTransition('questions', { type: 'FINISH', answered: 0, ok: true }), 'nothing');
});

test('decision 3: a failed Send stays on the questions, and only a finished ask reaches Sent', () => {
  for (const s of ['questions', 'fill', 'sent'] as const) assert.equal(momTransition(s, { type: 'FINISH', answered: 2, ok: false }), null, s);
  assert.equal(momTransition('fill', { type: 'FILL_STOPPED', version: false, finished: true }), 'sent');
  assert.equal(momTransition('fill', { type: 'FILL_STOPPED', version: false, finished: false }), 'questions');
});

test('her version arrived: fill stays until its own done', () => {
  assert.equal(momTransition('fill', { type: 'FILL_STOPPED', version: true, finished: true }), null);
  assert.equal(momTransition('fill', { type: 'FILL_DONE' }), 'sent');
});
