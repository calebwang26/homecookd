// journey-openurl.mjs and journey-xcrun.sh (ios-journeys' xcrun for Maestro), with a stand-in for the real xcrun:
//   node --test scripts/journey-openurl.test.mjs
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { decide, events, LAND_S } from './journey-openurl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIM = path.join(HERE, 'journey-xcrun.sh');

// Real lines from run 42851642925's kept device-simulator.log (journey 4): the open at 16:25:23.887, lsd giving up at
// +10.0 s, the app receiving the link at +16.4 s. The CoreSimulatorBridge line (which holds the link) never matches.
const OPEN = Date.parse('2026-11-10T16:25:23.887Z');
const GAVE_UP = '2026-11-10 16:25:33.927548+0000  localhost lsd[1545]: (CoreServices) [com.apple.launchservices:default] LaunchServices: [Perform] not launching application - result = Error Domain=NSPOSIXErrorDomain Code=60 "Operation timed out" UserInfo={_LSFile=LSDispatchUtils.mm, _LSLine=147, _LSFunction=_LSDispatchWithTimeout}';
const BRIDGE = '2026-11-10 16:25:33.938409+0000  localhost CoreSimulatorBridge[1514]: Failed to open URL (homecookd://e2e/sign-in?key=***) with com.salik.homecookd: Error Domain=NSPOSIXErrorDomain Code=60 "Operation timed out" UserInfo={_LSFile=LSDispatchUtils.mm, _LSLine=147, _LSFunction=_LSDispatchWithTimeout}';
const SPRINGBOARD = '2026-11-10 16:25:40.286146+0000  localhost SpringBoard[1482]: (FrontBoard) [com.apple.FrontBoard:Scene] [(FBSceneManager):sceneID:com.salik.homecookd-default] Sending action(s) in update: UIOpenURLAction';
const LANDED = '2026-11-10 16:25:40.315841+0000  localhost homecookd[24691]: (FrontBoardServices) [com.apple.FrontBoard:SceneClient] [(FBSceneManager):sceneID:com.salik.homecookd-default] Received action(s) in scene-update: UIOpenURLAction';
const HEADER = 'Filtering the log data using "(process == "lsd" AND eventMessage CONTAINS "_LSDispatchWithTimeout") OR (process == "homecookd" AND eventMessage CONTAINS "UIOpenURLAction")"';
const REAL = [HEADER, GAVE_UP, BRIDGE, SPRINGBOARD, LANDED].join('\n');

test("only lsd's timeout and the app's own received link count, not the header, the bridge or SpringBoard", () => {
  assert.deepEqual(events(REAL), [
    { ms: Date.parse('2026-11-10T16:25:33.927Z'), kind: 'gaveUp' },
    { ms: Date.parse('2026-11-10T16:25:40.315Z'), kind: 'landed' },
  ]);
});

test('run 42851642925: iOS gave up after 10.0 s and the link reached the app at 16.4 s, so it passes', () => {
  assert.deepEqual(decide(REAL, OPEN), { gaveUpS: 10, landedS: 16.4, passed: true });
});

test('a link that reached the app after the wait fails (42847823481 attempt 1: 53.0 s)', () => {
  assert.deepEqual(decide(REAL, OPEN, { wait: 15 }), { gaveUpS: 10, landedS: null, passed: false });
  const at53 = [HEADER, GAVE_UP, LANDED.replace('16:25:40.315841', '16:26:16.887000')].join('\n');
  assert.deepEqual(decide(at53, OPEN), { gaveUpS: 10, landedS: null, passed: false });
});

test("the 45 s limit is on the app's own line, counted from the open: 30.3 s passes (42939750084 attempt 2), 45.2 s fails, 53.0 s still fails", () => {
  const at = (s) => [HEADER, GAVE_UP, LANDED.replace('16:25:40.315841', new Date(OPEN + s * 1000).toISOString().slice(11, 23) + '000')].join('\n');
  assert.equal(LAND_S, 45);
  assert.deepEqual(decide(at(30.3), OPEN), { gaveUpS: 10, landedS: 30.3, passed: true });
  assert.deepEqual(decide(at(45.2), OPEN), { gaveUpS: 10, landedS: null, passed: false });
  assert.deepEqual(decide(at(53.0), OPEN), { gaveUpS: 10, landedS: null, passed: false });
});

test("only an open iOS gave up on gets the 45 s: a landing at 30.3 s with no lsd timeout isn't excused", () => {
  const text = [HEADER, LANDED.replace('16:25:40.315841', new Date(OPEN + 30_300).toISOString().slice(11, 23) + '000')].join('\n');
  assert.deepEqual(decide(text, OPEN), { gaveUpS: null, landedS: 30.3, passed: false });
});

test("a link that landed with no lsd timeout isn't this fault: it fails as before, unless simulated", () => {
  const text = [HEADER, LANDED].join('\n');
  assert.deepEqual(decide(text, OPEN), { gaveUpS: null, landedS: 16.4, passed: false });
  assert.deepEqual(decide(text, OPEN, { simulated: true }), { gaveUpS: null, landedS: 16.4, passed: true });
});

test('lines from before the open (an earlier open) are ignored', () => {
  assert.deepEqual(decide(REAL, Date.parse('2026-11-10T16:25:35Z')), { gaveUpS: null, landedS: 5.3, passed: false });
});

test('another time zone offset in the log still lines up', () => {
  const text = LANDED.replace('16:25:40.315841+0000', '08:25:40.315841-0800') + '\n' + GAVE_UP;
  assert.deepEqual(decide(text, OPEN), { gaveUpS: 10, landedS: 16.4, passed: true });
});

/** A folder with a fake xcrun that records its arguments, a log stream file and the stand-in linked as `xcrun`. */
function setup(fake) {
  const dir = mkdtempSync(path.join(tmpdir(), 'journey-xcrun-'));
  const real = path.join(dir, 'real-xcrun');
  writeFileSync(real, `#!/usr/bin/env node\n${fake}\n`);
  chmodSync(real, 0o755);
  const bin = path.join(dir, 'bin');
  spawnSync('mkdir', [bin]);
  symlinkSync(SHIM, path.join(bin, 'xcrun'));
  const stream = path.join(dir, 'stream.log');
  writeFileSync(stream, HEADER + '\n');
  const log = path.join(dir, 'openurl.jsonl');
  const env = { ...process.env, XCRUN_REAL: real, JOURNEY_OPENURL_STREAM: stream, JOURNEY_OPENURL_LOG: log, JOURNEY_OPENURL_WAIT_S: '3' };
  return { dir, xcrun: path.join(bin, 'xcrun'), stream, log, env };
}

// The fake xcrun writes syslog lines stamped now (+ an offset in ms) to the stream, as the simulator's log would.
const STAMP = `const stamp = (ms) => new Date(Date.now() + ms).toISOString().replace('T', ' ').replace('Z', '000+0000');`;
const gaveUpLine = `stamp(40) + '  localhost lsd[1545]: (CoreServices) [com.apple.launchservices:default] LaunchServices: [Perform] not launching application - result = Error Domain=NSPOSIXErrorDomain Code=60 "Operation timed out" UserInfo={_LSFunction=_LSDispatchWithTimeout}'`;
const landedLine = `stamp(80) + '  localhost homecookd[24691]: (FrontBoardServices) [com.apple.FrontBoard:SceneClient] Received action(s) in scene-update: UIOpenURLAction'`;

test('every other xcrun call goes straight through: arguments, output and exit code', () => {
  const s = setup(`console.log(JSON.stringify(process.argv.slice(2))); process.exit(7);`);
  const r = spawnSync(s.xcrun, ['simctl', 'spawn', 'X', 'log', 'stream', '--style', 'syslog'], { env: s.env, encoding: 'utf8' });
  assert.equal(r.status, 7);
  assert.deepEqual(JSON.parse(r.stdout), ['simctl', 'spawn', 'X', 'log', 'stream', '--style', 'syslog']);
  assert.equal(existsSync(s.log), false);
});

test('a link open that works goes straight through, with one line saying how long simctl took (no link)', () => {
  const s = setup(`setTimeout(() => process.exit(0), 600);`);
  const r = spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://e2e/sign-in?key=SECRET'], { env: s.env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const log = readFileSync(s.log, 'utf8');
  assert.doesNotMatch(log, /SECRET|homecookd:/);
  const rec = JSON.parse(log);
  assert.equal(rec.exit, 0);
  assert.equal(rec.passed, true);
  assert.equal(rec.gaveUpS, null);
  assert.ok(rec.simctlS >= 0.6 && rec.simctlS < 5, JSON.stringify(rec));
});

test('a timed-out open whose link lands passes, says nothing to Maestro, and writes one line without the link', () => {
  const s = setup(`${STAMP}
const fs = require('node:fs');
fs.appendFileSync(process.env.JOURNEY_OPENURL_STREAM, ${gaveUpLine} + '\\n' + ${landedLine} + '\\n');
console.error('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=60): ' + process.argv[5]);
process.exit(60);`);
  const r = spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://e2e/sign-in?key=SECRET'], { env: s.env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const log = readFileSync(s.log, 'utf8');
  assert.doesNotMatch(log, /SECRET|homecookd:/);
  const rec = JSON.parse(log);
  assert.equal(rec.passed, true);
  assert.equal(rec.exit, 60);
  assert.ok(rec.gaveUpS !== null && rec.landedS >= rec.gaveUpS, JSON.stringify(rec));
});

test("a timed-out open whose link never lands fails as before: simctl's exit code and its own error", () => {
  const s = setup(`${STAMP}
require('node:fs').appendFileSync(process.env.JOURNEY_OPENURL_STREAM, ${gaveUpLine} + '\\n');
console.error('code=60: gave up');
process.exit(60);`);
  const t0 = Date.now();
  const r = spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://x'], { env: s.env, encoding: 'utf8' });
  assert.equal(r.status, 60);
  assert.equal(r.stderr, 'code=60: gave up\n');
  assert.ok(Date.now() - t0 >= 3000, 'it waits out JOURNEY_OPENURL_WAIT_S');
  assert.deepEqual(JSON.parse(readFileSync(s.log, 'utf8')).passed, false);
});

test("any other failure (no lsd timeout) fails as before, without waiting out the 30 s", () => {
  const s = setup(`console.error('Invalid device: UDID'); process.exit(148);`);
  const env = { ...s.env, JOURNEY_OPENURL_WAIT_S: '30' };
  const t0 = Date.now();
  const r = spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://x'], { env, encoding: 'utf8' });
  assert.equal(r.status, 148);
  assert.equal(r.stderr, 'Invalid device: UDID\n');
  assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0} ms`);
  const rec = JSON.parse(readFileSync(s.log, 'utf8'));
  assert.equal(rec.passed, false);
  assert.equal(rec.gaveUpS, null);
});

test('a link that lands while the check is already waiting still counts', async () => {
  const s = setup(`${STAMP}
require('node:fs').appendFileSync(process.env.JOURNEY_OPENURL_STREAM, ${gaveUpLine} + '\\n');
process.exit(60);`);
  const child = spawn(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://x'], { env: s.env });
  setTimeout(() => {
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '000+0000');
    writeFileSync(s.stream, `${now}  localhost homecookd[1]: (FrontBoardServices) Received action(s) in scene-update: UIOpenURLAction\n`, { flag: 'a' });
  }, 1200);
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0);
  assert.equal(JSON.parse(readFileSync(s.log, 'utf8')).passed, true);
});

test('openurl_fault (JOURNEY_OPENURL_FAKE=first) treats only the first open the app got on its own as one iOS gave up on', () => {
  const s = setup(`${STAMP}
require('node:fs').appendFileSync(process.env.JOURNEY_OPENURL_STREAM, ${landedLine} + '\\n');
process.exit(0);`);
  const env = { ...s.env, JOURNEY_OPENURL_FAKE: 'first' };
  assert.equal(spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://x'], { env }).status, 0);
  assert.equal(spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://x'], { env }).status, 0);
  const recs = readFileSync(s.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(recs.length, 2);
  assert.equal(recs[0].simulated, true);
  assert.equal(recs[0].passed, true);
  assert.deepEqual([recs[1].simulated, recs[1].exit, recs[1].passed], [false, 0, true]);
});

test("openurl_fault skips an open waiting on iOS's Open dialog (no link yet): it goes through, and the next open is faked", () => {
  // Dispatch 42889278704: the faked open was one iOS asked about, so its link could only land after Maestro's tap on
  // Open, which can't come while the stand-in holds openLink; the dialog then blocked the journeys after it.
  const s = setup(`${STAMP}
const fs = require('node:fs');
const n = process.env.JOURNEY_OPENURL_LOG + '.calls';
const call = fs.existsSync(n) ? Number(fs.readFileSync(n, 'utf8')) + 1 : 1;
fs.writeFileSync(n, String(call));
if (call === 2) fs.appendFileSync(process.env.JOURNEY_OPENURL_STREAM, ${landedLine} + '\\n');
process.exit(0);`);
  const env = { ...s.env, JOURNEY_OPENURL_FAKE: 'first' };
  const t0 = Date.now();
  assert.equal(spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://x'], { env }).status, 0);
  assert.ok(Date.now() - t0 >= 3000, 'it gave the link 3 s to land on its own');
  assert.equal(spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://x'], { env }).status, 0);
  const recs = readFileSync(s.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(recs.map((r) => [r.exit, r.simulated, r.passed]), [[0, false, true], [1, true, true]]);
});

test('without JOURNEY_OPENURL_STREAM (outside the Journeys step) even openurl goes straight through', () => {
  const s = setup(`process.exit(60);`);
  const env = { ...s.env, JOURNEY_OPENURL_STREAM: '' };
  assert.equal(spawnSync(s.xcrun, ['simctl', 'openurl', 'UDID', 'homecookd://x'], { env }).status, 60);
  assert.equal(existsSync(s.log), false);
});
