import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';
import { clearMachineHistory, HISTORY_SIZE, machineHistory, record } from './machine.ts';

// Next's types make NODE_ENV read-only; the tests set it.
const env = process.env as Record<string, string | undefined>;
const ENV = env.NODE_ENV;
afterEach(() => {
  clearMachineHistory();
  if (ENV === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = ENV;
});

test('keeps the last 20 events of each machine, oldest first', () => {
  for (let i = 0; i < HISTORY_SIZE + 5; i++) record('mom', { type: `E${i}` }, 'a', 'b');
  record('question', { type: 'PRESS' }, 'idle', 'arming');
  const h = machineHistory();
  assert.equal(h.mom.length, HISTORY_SIZE);
  assert.equal(h.mom[0].event, 'E5');
  assert.equal(h.mom[HISTORY_SIZE - 1].event, `E${HISTORY_SIZE + 4}`);
  assert.deepEqual(
    h.question.map(({ event, from, to }) => ({ event, from, to })),
    [{ event: 'PRESS', from: 'idle', to: 'arming' }],
  );
});

test('an ignored event is kept with to: null', () => {
  record('mom', { type: 'INTRO_NEXT' }, 'questions', null);
  assert.equal(machineHistory().mom[0].to, null);
});

test('keeps only the event type, never what it carries', () => {
  const clip = { blob: 'her voice', token: 'secret' };
  record('question', { type: 'SAVE_RETRY', pending: clip } as { type: string }, 'saving', 'retry');
  assert.deepEqual(Object.keys(machineHistory().question[0]).sort(), ['event', 'from', 't', 'to']);
  assert.ok(!JSON.stringify(machineHistory()).includes('her voice'));
});

test("the same event object twice (React's development double call) is kept once; a new one with the same type is kept", () => {
  const e = { type: 'START' };
  record('mom', e, 'guess', 'questions');
  record('mom', e, 'guess', 'questions');
  record('mom', { type: 'START' }, 'guess', 'questions');
  assert.equal(machineHistory().mom.length, 2);
});

test('a production build keeps nothing', () => {
  env.NODE_ENV = 'production';
  record('mom', { type: 'LOAD_START' }, 'loading', 'loading');
  assert.deepEqual(machineHistory(), {});
});

test('machineHistory hands out copies', () => {
  record('mom', { type: 'LOAD_START' }, 'loading', 'loading');
  machineHistory().mom[0].event = 'changed';
  assert.equal(machineHistory().mom[0].event, 'LOAD_START');
});
