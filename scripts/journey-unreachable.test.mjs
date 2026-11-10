// journey-unreachable.mjs on report.xml samples cut from real runs: node --test scripts/journey-unreachable.test.mjs
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { decide, describe, journeys, samePoint, stopStep } from './journey-unreachable.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'journey-unreachable.mjs');
const J3 = 'New message, Add family, Copy link';
const J2 = 'Family link, name, sign in';
const J0 = "Launch, then a link that doesn't work";
const UNREACHABLE = (call) => `maestro.DeviceUnreachableException: Device became unreachable during ${call}
\tat maestro.drivers.IOSDriver.runDeviceCall(IOSDriver.kt:645)
\tat maestro.drivers.IOSDriver.deviceInfo$lambda$6(IOSDriver.kt:114)`;
const esc = (s) => s.replace(/'/g, '&apos;');
const pass = (name, ts, time) => `<testcase id="${esc(name)}" name="${esc(name)}" classname="${esc(name)}" file="x.yaml" time="${time}" timestamp="${ts}" status="SUCCESS"/>`;
const fail = (name, ts, time, text) => `<testcase id="${esc(name)}" name="${esc(name)}" classname="${esc(name)}" file="x.yaml" time="${time}" timestamp="${ts}" status="ERROR">
      <properties><property name="tags" value="needs-key"/></properties>
      <failure>${text}</failure>
    </testcase>`;
const report = (...cases) => `<?xml version='1.0' encoding='UTF-8'?>\n<testsuites>\n  <testsuite name="Test Suite" tests="${cases.length}">\n    ${cases.join('\n    ')}\n  </testsuite>\n</testsuites>\n`;

// 42872308399 attempt 3 (#476): all three journeys failed on the driver.
const ALL = report(
  fail(J3, '2026-11-10T19:50:07', '85.747', UNREACHABLE('deviceInfo')),
  fail(J2, '2026-11-10T19:51:33', '109.408', UNREACHABLE('setPermissions')),
  fail(J0, '2026-11-10T19:53:22', '28.647', UNREACHABLE('setPermissions')),
);
// 42887110283 attempt 1 (#481): journey 3 passed, then the driver dropped in journey 2.
const AFTER_PASS = report(
  pass(J3, '2026-11-10T19:46:39', '117.175'),
  fail(J2, '2026-11-10T19:48:36', '123.909', UNREACHABLE('deviceInfo')),
  fail(J0, '2026-11-10T19:50:40', '118.775', UNREACHABLE('setPermissions')),
);
// 42872308399 attempt 2: the link-open fault ("Unknown error") beside an unreachable one: not this fault alone.
const MIXED = report(
  pass(J3, '2026-11-10T19:33:48', '112.262'),
  fail(J2, '2026-11-10T19:35:40', '64.071', 'Unknown error'),
  fail(J0, '2026-11-10T19:36:44', '54.552', UNREACHABLE('deviceInfo')),
);
const NONE = report(pass(J3, '2026-11-10T20:00:52', '60.203'), pass(J2, '2026-11-10T20:01:53', '65.829'));

test('every failure DeviceUnreachableException: a second attempt, naming where the driver dropped', () => {
  const d = decide(ALL);
  assert.equal(d.rerun, true);
  assert.deepEqual(d.point, { journey: J3, seconds: 86, call: 'deviceInfo', step: null });
  assert.equal(d.line, `Maestro lost the simulator's driver (DeviceUnreachableException) in "${J3}", 86 s in, during the driver's deviceInfo; 3 journeys failed on it and nothing else. The journeys run once more on new test people: a green after this is not a clean green.`);
  const after = decide(AFTER_PASS);
  assert.equal(after.rerun, true);
  assert.equal(after.point.journey, J2, 'the first journey to fail on it, not the first in the report');
});

test('a mixed report, none failed, or an empty, unreadable or missing report.xml: no second attempt', () => {
  assert.deepEqual(decide(MIXED), { rerun: false, point: null, line: "Maestro lost the simulator's driver, but 1 journey also failed for another reason: no second attempt." });
  assert.deepEqual(decide(report(pass(J3, 't', '1'), fail(J2, '2026-11-10T19:35:40', '64', 'Unknown error'))), { rerun: false, point: null, line: null });
  assert.deepEqual(decide(NONE), { rerun: false, point: null, line: null });
  for (const bad of ['', '<testsuites></testsuites>', 'not xml', null]) {
    assert.deepEqual(decide(bad), { rerun: false, point: null, line: "No readable report.xml: Maestro's failure stands, no second attempt." }, String(bad));
  }
});

test('the unreachable_fault input re-runs whatever happened, and says it is simulated and not merge evidence', () => {
  assert.deepEqual(decide(NONE, { forced: true }), { rerun: true, point: null, line: 'Simulated by the unreachable_fault input: the journeys run once more on new test people. Not merge evidence.' });
  assert.match(decide(ALL, { forced: true }).line, /^Simulated by the unreachable_fault input: .*\(Maestro did lose the driver: "New message/);
});

test("a driver call or command kind outside the fixed lists prints as unknown, and no command's text is printed", () => {
  const odd = report(fail(J3, '2026-11-10T19:50:07', '10', UNREACHABLE('somethingNew')));
  assert.equal(journeys(odd)[0].call, 'unknown');
  const cmds = JSON.stringify([
    { command: { launchAppCommand: { appId: 'com.salik.homecookd' } }, metadata: { status: 'COMPLETED' } },
    { command: { openLinkCommand: { link: 'homecookd://e2e/sign-in?key=SECRETKEY123' } }, metadata: { status: 'FAILED' } },
    { command: { tapOnElement: { selector: { textRegex: 'Open' } } }, metadata: { status: 'PENDING' } },
  ]);
  assert.deepEqual(stopStep(cmds), { step: 2, of: 3, kind: 'openLinkCommand' });
  assert.deepEqual(stopStep(JSON.stringify([{ command: { brandNewCommand: { text: 'homecookd://i?t=TOKEN' } }, metadata: { status: 'FAILED' } }])), { step: 1, of: 1, kind: 'unknown' });
  assert.equal(stopStep('{not json'), null);
  const line = describe({ journey: J3, seconds: 12, call: 'deviceInfo', step: stopStep(cmds) });
  assert.equal(line, `"${J3}", 12 s in, step 2 of 3 (openLinkCommand), during the driver's deviceInfo`);
  assert.doesNotMatch(line, /SECRET|homecookd:|key=/);
});

test('the same point twice: the same journey and step, or with no step known, within 10 s of the same time in', () => {
  const p = (journey, seconds, step) => ({ journey, seconds, call: 'deviceInfo', step: step ? { step, of: 40, kind: 'tapOnElement' } : null });
  assert.equal(samePoint(p(J3, 86, 12), p(J3, 120, 12)), true);
  assert.equal(samePoint(p(J3, 86, 12), p(J3, 86, 13)), false);
  assert.equal(samePoint(p(J3, 86), p(J3, 95)), true);
  assert.equal(samePoint(p(J3, 86), p(J3, 97)), false);
  assert.equal(samePoint(p(J3, 86, 12), p(J2, 86, 12)), false);
  assert.equal(samePoint(null, p(J3, 86)), false);
});

/** A Maestro output folder with this report.xml and, optionally, a journey's commands.json. */
function out(xml, commands) {
  const dir = mkdtempSync(path.join(tmpdir(), 'unreach-'));
  if (xml !== undefined) writeFileSync(path.join(dir, 'report.xml'), xml);
  if (commands) {
    const d = path.join(dir, '2026-11-10_194924', commands.journey);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'commands.json'), commands.json);
  }
  return dir;
}

test('the CLI: decide prints the line and writes rerun= to $GITHUB_OUTPUT; again fails on the same point twice', () => {
  const steps = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ command: { assertConditionCommand: {} }, metadata: { status: i === 11 ? 'FAILED' : 'COMPLETED' } })));
  const one = out(ALL, { journey: J3, json: steps });
  const ghOut = path.join(one, 'gh-output');
  writeFileSync(ghOut, '');
  const r = spawnSync(process.execPath, [SCRIPT, 'decide', one], { env: { ...process.env, GITHUB_OUTPUT: ghOut }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /in "New message, Add family, Copy link", 86 s in, step 12 of 30 \(assertConditionCommand\), during the driver's deviceInfo;/);
  assert.equal(readFileSync(ghOut, 'utf8'), 'rerun=true\n');
  const missing = out(undefined);
  writeFileSync(ghOut, '');
  spawnSync(process.execPath, [SCRIPT, 'decide', missing], { env: { ...process.env, GITHUB_OUTPUT: ghOut }, encoding: 'utf8' });
  assert.equal(readFileSync(ghOut, 'utf8'), 'rerun=false\n');

  const twice = spawnSync(process.execPath, [SCRIPT, 'again', one, out(ALL, { journey: J3, json: steps })], { encoding: 'utf8' });
  assert.equal(twice.status, 1);
  assert.match(twice.stdout, /at the same point in both attempts: "New message, Add family, Copy link", 86 s in, step 12 of 30/);
  const elsewhere = spawnSync(process.execPath, [SCRIPT, 'again', one, out(AFTER_PASS)], { encoding: 'utf8' });
  assert.equal(elsewhere.status, 0);
  assert.equal(elsewhere.stdout, '');
  assert.equal(spawnSync(process.execPath, [SCRIPT, 'again', one, out(NONE)], { encoding: 'utf8' }).status, 0);
});
