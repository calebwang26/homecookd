// journey-trust.mjs on made-up logs in the shapes the simulator really writes (run 42898927696):
//   node --test scripts/journey-trust.test.mjs
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { journeyLines, pinningLines, STALL_GAP_MS, summary, trustd, verdicts } from './journey-trust.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'journey-trust.mjs');
const at = (t) => `2026-11-10 ${t}000+0000  localhost`;
const EVAL = (t) => `${at(t)} trustd[25642]: [com.apple.securityd:policy] cert[0]: IntermediateMarkerOid =(path)[force]> 0`;
const SIGN = (t) => `${at(t)} trustd[25642]: (Security) Created Activity ID: 0x34ab3, Description: SecKeyVerifySignature`;
const UPDATE = (t) => `${at(t)} trustd[25642]: [com.apple.securityd:pinningDb] Pinning database should update from version 121 to version 131`;
const LOCKED = (t) => `${at(t)} trustd[25642]: [com.apple.securityd:SecError] SecPinningDb: error querying DB for policyName: Error Domain=com.apple.utilities.sqlite3 Code=5 "finalize: 0x106814ca0: [5] database is locked"`;
const XPC = (t) => `${at(t)} trustd[25642]: (libxpc.dylib) [com.apple.xpc:connection] [0x106124280] activating connection: mach=false listener=false peer=true name=com.apple.trustd.peer[30427].0x106124280`;
const CHECK = (t, proc, ok) => `${at(t)} ${proc}[30427]: (libboringssl.dylib) [com.apple.network:boringssl] boringssl_context_evaluate_trust_async_external_block_invoke_3(2112) [C1.1.1.2:2][0x11fbc6360] Returning from external verify block with result: ${ok}`;
const GATE = Date.parse('2026-11-10T21:08:12Z');

// 42898927696: trustd evaluates until 21:09:08, starts its pinning database update at 21:09:10, then evaluates nothing.
const STREAM = [EVAL('21:08:30.100'), SIGN('21:09:08.274'), UPDATE('21:09:10.190'), XPC('21:09:23.044'), XPC('21:11:01.157'), LOCKED('21:14:22.599')].join('\n');
const J3 = [CHECK('21:09:08.279', 'nsurlsessiond', true), CHECK('21:09:32.114', 'homecookd', false), CHECK('21:09:58.958', 'nsurlsessiond', false), CHECK('21:11:11.000', 'homecookd', false)].join('\n');

test("trustd's evaluations, its pinning database update and its locked reads are read from its own lines only", () => {
  const t = trustd(`${STREAM}\n${CHECK('21:09:40.000', 'homecookd', false)}\nFiltering the log data using "process == trustd"`);
  assert.deepEqual(t.evals.map((ms) => new Date(ms).toISOString().slice(11, 23)), ['21:08:30.100', '21:09:08.274']);
  assert.deepEqual(t.updates.map((u) => [u.pid, u.from, u.to]), [[25642, 121, 131]]);
  assert.equal(t.locked.length, 1);
  assert.deepEqual([...t.pids.keys()], [25642]);
  assert.deepEqual(verdicts(J3).map((v) => [v.proc, v.ok]), [['nsurlsessiond', true], ['homecookd', false], ['nsurlsessiond', false], ['homecookd', false]]);
});

test('42898927696: trustd stopped after the gate, so the journey names the simulator, the stop and the update', () => {
  assert.deepEqual(journeyLines([{ name: 'New message, Add family, Copy link', log: J3 }], trustd(STREAM), GATE), [
    "New message, Add family, Copy link: the app's certificate checks failed 2 times, 21:09:32–21:11:11 UTC (other processes: 1 failed, 1 passed); "
    + 'trustd evaluated nothing after 21:09:08 (56 s after the simulator check passed), and started a pinning database update (121 → 131) at 21:09:10: '
    + 'the simulator stopped checking certificates, not the app (re-run the job)',
  ]);
});

test('a journey that got through the stall says so, with no re-run advice (run 42926262894: it passed)', () => {
  const [passedLine] = journeyLines([{ name: 'New message, Add family, Copy link', log: J3, passed: true }], trustd(STREAM), GATE);
  assert.match(passedLine, /: the simulator stopped checking certificates, not the app; the journey got through it$/);
  assert.doesNotMatch(passedLine, /re-run/);
  const [failedLine] = journeyLines([{ name: 'New message, Add family, Copy link', log: J3, passed: false }], trustd(STREAM), GATE);
  assert.match(failedLine, /not the app \(re-run the job\)$/);
});

// 42939750084 (#488): the rebuild began at 01:50:21, trustd still checked until 01:50:39, then nothing; journey 4's clip
// download hung (no failed check counted) and it failed at 01:51:20.
const STALL_488 = [EVAL('01:50:10.000'), UPDATE('01:50:21.000'), SIGN('01:50:30.000'), EVAL('01:50:39.000'), XPC('01:51:05.000')].join('\n');
const atMs = (t) => Date.parse(`2026-11-10T${t}Z`);

test("a failed journey with no failed check counted is named by its failure time in a stall (42939750084's journey 4)", () => {
  // Other processes' checks failed in the quiet gap (01:51 had others 0/2): a check was wanted and not given.
  const log = [CHECK('01:49:50.000', 'homecookd', true), CHECK('01:50:55.000', 'nsurlsessiond', false), CHECK('01:51:10.000', 'nsurlsessiond', false)].join('\n');
  const j4 = { name: 'Record, film, send', log, passed: false, endMs: atMs('01:51:20') };
  assert.deepEqual(journeyLines([j4], trustd(STALL_488), atMs('01:49:20')), [
    "Record, film, send: failed at 01:51:20 with no failed check of its own counted; trustd had checked nothing for 41 s (since 01:50:39 (1 m 19 s after the simulator check passed)), during a pinning database update (121 → 131) from 01:50:21; other processes' checks in that gap: 2 failed, 0 passed: the simulator stopped checking certificates, not the app (re-run the job)",
  ]);
});

test('a quiet gap with no failed check from anyone only hedges: it may be the stall, and the same step failing again is the app', () => {
  // The Master's point: 5 quiet seconds is normal for an app making no requests, and a rebuild is "open" for its first
  // 60 s whatever trustd does, so a real failure there mustn't read as the simulator.
  const j = { name: 'J', log: CHECK('01:51:00.000', 'nsurlsessiond', true).replace('result: true', 'result: true'), passed: false, endMs: atMs('01:51:20') };
  const [line] = journeyLines([j], trustd(STALL_488), null);
  assert.equal(line, "J: failed at 01:51:20 with no failed check of its own counted; trustd had checked nothing for 41 s (since 01:50:39), during a pinning database update (121 → 131) from 01:50:21; other processes' checks in that gap: 0 failed, 1 passed. It may be the stall: re-run once, and if the same step fails again, it's the app");
  assert.doesNotMatch(line, /not the app|re-run the job/);
});

test('no such line for a journey that passed, one that failed after trustd checked again, or one with no end time', () => {
  const j = (o) => ({ name: 'J', log: '', ...o });
  assert.deepEqual(journeyLines([j({ passed: true, endMs: atMs('01:51:20') })], trustd(STALL_488), null), []);
  const settled = `${STALL_488}\n${EVAL('01:51:25.000')}\n${EVAL('01:52:10.000')}`; // checking again 109 s after the rebuild began
  assert.deepEqual(journeyLines([j({ passed: false, endMs: atMs('01:52:30') })], trustd(settled), null), []);
  assert.deepEqual(journeyLines([j({ passed: false, endMs: atMs('01:50:41') })], trustd(STALL_488), null), [], 'only 2 s after the last check');
  assert.deepEqual(journeyLines([j({ passed: false })], trustd(STALL_488), null), []);
  assert.deepEqual(journeyLines([j({ passed: false, endMs: atMs('01:51:20') })], trustd(EVAL('01:50:10.000')), null), [], 'no rebuild at all');
});

test("trustd evaluating while only the app fails points at the api's certificate, not the simulator", () => {
  const stream = [EVAL('21:09:00.000'), EVAL('21:09:40.000'), EVAL('21:10:30.000')].join('\n');
  const log = [CHECK('21:09:30.000', 'homecookd', false), CHECK('21:09:45.000', 'nsurlsessiond', true), CHECK('21:10:40.000', 'homecookd', false)].join('\n');
  assert.deepEqual(journeyLines([{ name: 'J', log }], trustd(stream), GATE), [
    "J: the app's certificate checks failed 2 times, 21:09:30–21:10:40 UTC (other processes: 0 failed, 1 passed); trustd kept evaluating and only the app's checks failed: look at the api's certificate",
  ]);
  const othersToo = `${log}\n${CHECK('21:10:00.000', 'nsurlsessiond', false)}`;
  assert.match(journeyLines([{ name: 'J', log: othersToo }], trustd(stream), GATE)[0], /other processes failed too: the simulator, not the app$/);
});

test('one app failure while trustd keeps evaluating is the api, not a stall (the check that failed was 0.1 s before)', () => {
  const stream = [EVAL('21:00:00.000'), EVAL('21:00:05.900'), EVAL('21:00:07.000'), EVAL('21:00:08.000')].join('\n');
  assert.deepEqual(journeyLines([{ name: 'J', log: CHECK('21:00:06.000', 'homecookd', false) }], trustd(stream), GATE), [
    "J: the app's certificate checks failed 1 time, 21:00:06–21:00:06 UTC (other processes: 0 failed, 0 passed); trustd kept evaluating and only the app's checks failed: look at the api's certificate",
  ]);
});

test("no trustd line anywhere can't tell: no stall named, no re-run advice", () => {
  const log = [CHECK('21:00:06.000', 'homecookd', false), CHECK('21:00:07.000', 'homecookd', false), CHECK('21:00:09.000', 'homecookd', false), CHECK('21:00:08.000', 'nsurlsessiond', true)].join('\n');
  const [line] = journeyLines([{ name: 'J', log }], trustd(''), GATE);
  assert.equal(line, "J: the app's certificate checks failed 3 times, 21:00:06–21:00:09 UTC (other processes: 0 failed, 1 passed); there's no trustd log for this run, so it can't tell whether the simulator stopped checking certificates");
  assert.doesNotMatch(line, /re-run|the simulator,/);
});

test("an empty stream (it didn't start) but trustd lines in the journey's own log still reads them, not \"no trustd log\"", () => {
  const log = [EVAL('21:00:00.000'), EVAL('21:00:05.900'), CHECK('21:00:06.000', 'homecookd', false), EVAL('21:00:07.000')].join('\n');
  const [line] = journeyLines([{ name: 'J', log }], trustd(''), GATE);
  assert.doesNotMatch(line, /no trustd log/);
  assert.match(line, /trustd kept evaluating and only the app's checks failed: look at the api's certificate$/);
});

test('trustd lines with no evaluation among them still read as the simulator', () => {
  const stream = [XPC('21:09:23.044'), XPC('21:11:01.157')].join('\n');
  assert.match(journeyLines([{ name: 'J', log: CHECK('21:09:32.114', 'homecookd', false) }], trustd(stream), GATE)[0],
    /; trustd logged but evaluated nothing in this run: the simulator, not the app \(re-run the job\)$/);
});

test('a stall that began mid-run, before the gate is known, and a journey with no failed check', () => {
  const stream = [EVAL('20:27:07.000'), LOCKED('20:27:50.000')].join('\n');
  const log = CHECK('20:28:02.000', 'homecookd', false);
  assert.deepEqual(journeyLines([{ name: 'J2', log }, { name: 'J3', log: CHECK('20:27:00.000', 'homecookd', true) }], trustd(stream), null), [
    "J2: the app's certificate checks failed 1 time, 20:28:02–20:28:02 UTC (other processes: 0 failed, 0 passed); trustd evaluated nothing after 20:27:07; its pinning database was locked 1 time: the simulator stopped checking certificates, not the app (re-run the job)",
  ]);
});

test('the stall gap is the 5 s the docs and the workflow state', () => {
  assert.equal(STALL_GAP_MS, 5000);
});

test("pinning lines: the update, when trustd evaluated again (or that it didn't), and the locked reads", () => {
  assert.deepEqual(pinningLines(trustd(STREAM), GATE), [
    'trustd (pid 25642) started a pinning database update (121 → 131) at 21:09:10 (58 s after the simulator check passed); it evaluated nothing after it before the stream ended (21:14:22)',
    "trustd's pinning database was locked 1 time, 21:14:22–21:14:22",
  ]);
  assert.deepEqual(pinningLines(trustd(`${STREAM}\n${EVAL('21:16:40.000')}`), GATE)[0].split('; ')[1], 'it evaluated again at 21:16:40, 7 m 30 s later');
  assert.deepEqual(pinningLines(trustd(EVAL('21:00:00.000')), GATE), []);
});

test('the kept summary holds no hostname, link or key from the lines it reads: fixed words, times and counts only', () => {
  const leaky = [
    `${at('21:09:01.000')} trustd[25642]: [com.apple.securityd:policy] SSL hostname d2zh46br3dalyf.cloudfront.net https://api.example.test/i?t=FAMILYTOKEN key=DEVICEKEY0123`,
    `${at('21:09:02.000')} trustd[25642]: [com.apple.securityd:ocsp] fetching http://ocsp.example.test/MEQwQjBAMD4wPDAJBgUrDgMCGgUABBQ X-Amz-Credential=ASIASECRET`,
    `${at('21:09:03.000')} trustd[25642]: [com.apple.securityd:pinningDb] Pinning database should update from version 121 to version 131 at https://evil.example.test/?key=SECRET2`,
    `${at('21:09:04.000')} trustd[25642]: (Network) [C2 Hostname#06e5be5c:443 quic-connection, bundle id: com.apple.assistant.assistantd] database is locked for api.example.test`,
  ].join('\n');
  const journeys = [{ name: 'J', log: CHECK('21:09:05.000', 'homecookd', false).replace('[C1.1.1.2:2]', '[C1 api.example.test https://x.test/?key=SECRET3]') }];
  const out = summary(trustd(leaky), journeys, GATE);
  assert.doesNotMatch(out, /example|cloudfront|https?:|key=|SECRET|TOKEN|DEVICEKEY|ASIA|X-Amz|Hostname|bundle id|assistantd|ocsp/i);
  assert.equal(out, [
    'trustd and certificate checks in this run (times UTC; counts only: no line of the logs is copied here)',
    'simulator check passed: 21:08:12',
    'trustd pid 25642: 21:09:01–21:09:04',
    '21:09:03 trustd pid 25642: pinning database update 121 -> 131',
    'per minute: trustd evaluations, locked reads; certificate checks passed/failed by the app and by other processes',
    '21:09 evaluations 1, locked 1; app 0/1, others 0/0',
    '',
  ].join('\n'));
});

/** A Maestro output folder: report.xml plus each journey's device-simulator.log. */
function out(journeys) {
  const dir = mkdtempSync(path.join(tmpdir(), 'trust-'));
  const cases = journeys.map(([name, ts]) => `<testcase id="${name}" name="${name}" classname="${name}" time="100" timestamp="${ts}" status="ERROR"><failure>x</failure></testcase>`).join('');
  writeFileSync(path.join(dir, 'report.xml'), `<testsuites><testsuite>${cases}</testsuite></testsuites>`);
  for (const [name, , log] of journeys) {
    const d = path.join(dir, '2026-11-10_210817', name, 'logs');
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'device-simulator.log'), log);
  }
  return dir;
}

test('the CLI prints a line per stalled journey in report.xml order, then the pinning lines, and writes the summary', () => {
  const dir = out([
    ['New message, Add family, Copy link', '2026-11-10T21:09:01', J3],
    ['Family link, name, sign in', '2026-11-10T21:11:16', CHECK('21:11:45.000', 'homecookd', false)],
  ]);
  const stream = path.join(dir, 'trustd.log');
  writeFileSync(stream, STREAM);
  const sum = path.join(dir, 'trustd-summary.txt');
  const r = spawnSync(process.execPath, [SCRIPT, dir, stream, String(GATE / 1000), '--summary', sum], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.map((l) => l.split(':')[0]), ['New message, Add family, Copy link', 'Family link, name, sign in', 'trustd (pid 25642) started a pinning database update (121 → 131) at 21', "trustd's pinning database was locked 1 time, 21"]);
  assert.match(readFileSync(sum, 'utf8'), /^21:09 evaluations 1, locked 0; app 0\/1, others 1\/1$/m);
  const none = spawnSync(process.execPath, [SCRIPT, path.join(tmpdir(), 'no-such-out'), path.join(tmpdir(), 'no-such-stream')], { encoding: 'utf8' });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, '');
});
