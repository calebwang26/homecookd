// journey-retries.mjs against made-up Maestro output folders: node --test scripts/journey-retries.test.mjs
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { lines, results } from './journey-retries.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'journey-retries.mjs');
const LAUNCH = "Launch, then a link that doesn't work";

function testcase(name, ok) {
  const n = name.replace(/'/g, '&apos;');
  return ok
    ? `<testcase id="${n}" name="${n}" classname="${n}" file="x.yaml" time="80" status="SUCCESS"/>`
    : `<testcase id="${n}" name="${n}" classname="${n}" file="x.yaml" time="157" status="ERROR">\n      <failure>Assertion is false: "x" is visible</failure>\n    </testcase>`;
}

/** A Maestro test-output folder: report.xml with these journeys, and each one's screenshots. */
function out(journeys) {
  const dir = mkdtempSync(path.join(tmpdir(), 'journeys-'));
  const cases = journeys.map(([name, ok]) => testcase(name, ok)).join('\n    ');
  writeFileSync(path.join(dir, 'report.xml'), `<?xml version='1.0' encoding='UTF-8'?>\n<testsuites>\n  <testsuite name="Test Suite" tests="${journeys.length}">\n    ${cases}\n  </testsuite>\n</testsuites>\n`);
  for (const [name, , shots] of journeys) {
    const d = path.join(dir, '2026-11-09_122731', name, 'takeScreenshot');
    mkdirSync(d, { recursive: true });
    for (const s of ['00-first-screen', 'open-dialog', ...shots]) writeFileSync(path.join(d, `${s}.png`), '');
  }
  return dir;
}

test('a journey with no Try again prints nothing', () => {
  assert.deepEqual(lines(out([[LAUNCH, true, []]])), []);
});

test('a pass after one Try again says so', () => {
  assert.deepEqual(lines(out([[LAUNCH, true, ['try-again-1']]])), [
    `${LAUNCH}: passed after 1 "Try again" retry on "We can't reach homecookd.", trust-check stall (if it repeats, check the staging api)`,
  ]);
});

test('a fail with the card still up after the last attempt says so', () => {
  assert.deepEqual(lines(out([[LAUNCH, false, ['try-again-1', 'try-again-2']]])), [
    `${LAUNCH}: failed after 2 "Try again" retries on "We can't reach homecookd.": the card stayed up`,
  ]);
});

test('each journey is counted on its own', () => {
  const dir = out([
    [LAUNCH, true, ['try-again-1']],
    ['Sign in', true, []],
    ['Ask Mom', false, ['try-again-2', 'try-again-3']],
  ]);
  assert.deepEqual(lines(dir), [
    'Ask Mom: failed after 2 "Try again" retries on "We can\'t reach homecookd.": the card stayed up',
    `${LAUNCH}: passed after 1 "Try again" retry on "We can't reach homecookd.", trust-check stall (if it repeats, check the staging api)`,
  ]);
});

test('the summary names the card: the family load after a sign-in, or both', () => {
  const J3 = 'New message, Add family, Copy link';
  assert.deepEqual(lines(out([[J3, true, ['try-again-kitchen-1']]])), [
    `${J3}: passed after 1 "Try again" retry on "We can't reach your kitchen.", trust-check stall (if it repeats, check the staging api)`,
  ]);
  assert.deepEqual(lines(out([[J3, false, ['try-again-1', 'try-again-kitchen-2', 'try-again-kitchen-3']]])), [
    `${J3}: failed after 3 "Try again" retries (1 on "We can't reach homecookd.", 2 on "We can't reach your kitchen."): the card stayed up`,
  ]);
});

test('a journey that needed no re-open of the link says nothing', () => {
  assert.deepEqual(lines(out([['Sign in', true, ['open-dialog']]])), []);
});

test('one re-open of the link is reported, passed or failed (#467: one, silent)', () => {
  const J3 = 'New message, Add family, Copy link';
  assert.deepEqual(lines(out([[J3, true, ['open-again-1']]])), [
    `${J3}: passed after 1 re-open of the link: the link didn’t land or the app stalled (the kept simulator log says which)`,
  ]);
  assert.deepEqual(lines(out([[J3, false, ['open-again-1', 'open-again-2']]])), [
    `${J3}: failed after 2 re-opens of the link: the link didn’t land or the app stalled (the kept simulator log says which)`,
  ]);
});

test('Try again taps and re-opens together are both reported', () => {
  assert.deepEqual(lines(out([[LAUNCH, true, ['try-again-1', 'open-again-1']]])), [
    `${LAUNCH}: passed after 1 "Try again" retry on "We can't reach homecookd." and 1 re-open of the link, trust-check stall (if it repeats, check the staging api)`,
  ]);
  assert.deepEqual(lines(out([[LAUNCH, false, ['try-again-kitchen-1', 'open-again-1', 'open-again-2']]])), [
    `${LAUNCH}: failed after 1 "Try again" retry on "We can't reach your kitchen." and 2 re-opens of the link: the card stayed up`,
  ]);
});

test("Maestro's real report: status and the escaped apostrophe", () => {
  const xml = `<testsuites><testsuite><testcase id="${LAUNCH.replace("'", '&apos;')}" name="${LAUNCH.replace("'", '&apos;')}" status="ERROR">
      <failure>Assertion is false</failure></testcase><testcase name="B" status="SUCCESS"/></testsuite></testsuites>`;
  assert.deepEqual([...results(xml)], [[LAUNCH, false], ['B', true]]);
});

test('no output folder (the job failed before the journeys) prints nothing, and the CLI exits 0', () => {
  const r = spawnSync(process.execPath, [SCRIPT, path.join(tmpdir(), 'no-such-maestro-out')], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('the CLI prints the lines', () => {
  const r = spawnSync(process.execPath, [SCRIPT, out([[LAUNCH, true, ['try-again-1']]])], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /passed after 1 "Try again" retry/);
});
