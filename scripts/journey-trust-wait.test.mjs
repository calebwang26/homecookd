// journey-trust-wait.mjs on the real runs' numbers: node --test scripts/journey-trust-wait.test.mjs
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BUDGET_MS, decide, HOLD_MS, label, openUpdate, server, WATCH_MAX_MS } from './journey-trust-wait.mjs';
import { trustd } from './journey-trust.mjs';

const line = (t, msg) => `2026-11-11 ${t}000+0000  localhost trustd[32021]: ${msg}`;
const EVAL = (t) => line(t, '[com.apple.securityd:policy] cert[0]: IntermediateMarkerOid =(path)[force]> 0');
const UPDATE = (t) => line(t, '[com.apple.securityd:pinningDb] Pinning database should update from version 121 to version 131');
const at = (t) => Date.parse(`2026-11-11T${t}Z`);

// 42939750084 (#488): the rebuild began at 01:50:21; trustd still checked until 01:50:39, then nothing in 01:51.
const STALL_488 = [EVAL('01:50:10.000'), UPDATE('01:50:21.000'), EVAL('01:50:30.000'), EVAL('01:50:39.000')].join('\n');
// The two seen to end: 1 m 54 s (42926262894, from 00:12:02) and 6 m 20 s (42938280153, from 01:37:07).
const ENDED_1 = [EVAL('00:11:47.000'), UPDATE('00:12:02.000'), EVAL('00:13:55.000')].join('\n');
const ENDED_2 = [EVAL('01:37:05.000'), UPDATE('01:37:07.000'), EVAL('01:43:27.000')].join('\n');

test('a rebuild stays open until trustd checks something 60 s or more after it began', () => {
  assert.equal(openUpdate(trustd(STALL_488), at('01:51:00')).ms, at('01:50:21'), 'checks 18 s in don\'t close it');
  assert.equal(openUpdate(trustd(ENDED_1), at('00:13:00')).ms, at('00:12:02'));
  assert.equal(openUpdate(trustd(ENDED_1), at('00:14:00')), null, 'checking again at 00:13:55');
  assert.equal(openUpdate(trustd(ENDED_2), at('01:43:30')), null);
  assert.equal(openUpdate(trustd(EVAL('01:00:00.000')), at('01:10:00')), null, 'no rebuild at all');
});

test('no stream: "ready" at once, saying it couldn\'t tell; no rebuild open: "ready" at once, nothing logged', () => {
  assert.deepEqual(decide(null, at('01:51:00'), { why: 'a fresh launch' }), { answer: 'ready', line: "trustd wait (a fresh launch): no trustd stream, so it couldn't tell whether trustd was rebuilding; not waited" });
  assert.deepEqual(decide(ENDED_1, at('00:14:00')), { answer: 'ready' });
  assert.deepEqual(decide('', at('00:14:00')), { answer: 'ready' }, 'an empty stream has no rebuild in it');
});

test('a rebuild open: wait; launch mode provokes a check, watch mode only watches', () => {
  assert.deepEqual(decide(STALL_488, at('01:51:00'), { mode: 'launch' }), { answer: 'wait', probe: true });
  assert.deepEqual(decide(STALL_488, at('01:51:00'), { mode: 'watch' }), { answer: 'wait', probe: false });
});

test('when the rebuild ends, the wait says how long it held and when trustd checked again', () => {
  const t = trustd(ENDED_1);
  const wait = { start: at('00:12:30'), update: openUpdate(t, at('00:12:30')) };
  assert.deepEqual(decide(ENDED_1, at('00:14:00'), { why: 'a fresh launch', wait }), {
    answer: 'ready',
    line: 'trustd wait (a fresh launch): held 1 m 30 s for a pinning database update (121 → 131) from 00:12:02; trustd checked again at 00:13:55',
  });
  const wait2 = { start: at('01:37:40'), update: openUpdate(trustd(ENDED_2), at('01:37:40')) };
  assert.match(decide(ENDED_2, at('01:43:30'), { why: "journey 4's I'm done", wait: wait2 }).line, /held 5 m 50 s .* checked again at 01:43:27$/);
});

test("one budget for the job: spent, it goes on and says so", () => {
  const wait = { start: at('01:51:00') };
  const d = decide(STALL_488, at('01:51:00') + 60_000, { why: 'a fresh launch', wait, spent: BUDGET_MS - 60_000 });
  assert.equal(d.answer, 'ready');
  assert.match(d.line, /^trustd wait \(a fresh launch\): held 1 m 0 s for a pinning database update \(121 → 131\) from 01:50:21, then went on: the job's 12 m 0 s of waiting is spent$/);
  assert.equal(decide(STALL_488, at('01:51:00') + 60_000, { wait, spent: BUDGET_MS - 61_000 }).answer, 'wait');
});

test('watch mode stops waiting on a rebuild 10 minutes old (it can\'t provoke a check mid-journey)', () => {
  const late = at('01:50:21') + WATCH_MAX_MS;
  assert.equal(decide(STALL_488, late, { mode: 'launch' }).answer, 'wait');
  const d = decide(STALL_488, late, { mode: 'watch', why: 'x' });
  assert.equal(d.answer, 'ready');
  assert.match(d.line, /with no check for 10 m 0 s; went on after holding 0 s \(it can't be provoked mid-journey\)$/);
});

test('the label a flow sends is cut to plain words, 40 characters at most', () => {
  assert.equal(label("journey 4's I'm done"), "journey 4's I'm done");
  assert.equal(label('x'.repeat(60)), 'x'.repeat(40));
  assert.equal(label('a <b>https://x.test/?key=SECRET&t=1</b>'), 'a bhttpsx.testkeySECRETt1b');
  assert.equal(label(''), 'a journey');
});

/** A server on a free port, with a fake clock that moves only when the server sleeps. */
async function start(streamText, opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'trustd-wait-'));
  const stream = path.join(dir, 'stream.log');
  if (streamText !== null) writeFileSync(stream, streamText);
  const log = path.join(dir, 'wait.log');
  const budget = path.join(dir, 'budget.json');
  let clock = opts.now ?? at('01:51:00');
  const probes = [];
  const settled = [];
  const settle = opts.settle ?? (async () => {});
  const s = server({ stream, log, budget, probe: () => probes.push(clock), settle: () => { settled.push(clock); return settle(); }, now: () => clock, sleep: async (ms) => { clock += ms; if (opts.onSleep) opts.onSleep(clock, stream); } });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const ask = async (q) => (await fetch(`http://127.0.0.1:${s.address().port}/trustd-ready?${q}`)).text();
  return { s, ask, log, budget, probes, settled, dir, setClock: (ms) => { clock = ms; } };
}

test('the server listens on 127.0.0.1 only, and answers "ready" at once with no stream, logging that once', async () => {
  const w = await start(null);
  try {
    assert.equal(w.s.address().address, '127.0.0.1');
    assert.equal(await w.ask('mode=launch&why=a%20fresh%20launch'), 'ready');
    assert.equal(await w.ask('mode=launch&why=a%20fresh%20launch'), 'ready');
    assert.equal(readFileSync(w.log, 'utf8'), "trustd wait (a fresh launch): no trustd stream, so it couldn't tell whether trustd was rebuilding; not waited\n");
  } finally { w.s.close(); }
});

test('in a stall it holds each request at most HOLD_MS, probing in launch mode only, then logs the wait and its time once it ends', async () => {
  // A host and key in the stream must never reach the log: only fixed words and numbers do.
  const stream = `${STALL_488}\n${line('01:50:40.000', 'evaluating d2zh46br3dalyf.cloudfront.net key=SECRET')}`;
  const w = await start(stream);
  try {
    assert.equal(await w.ask('mode=launch&why=a%20fresh%20launch'), 'wait');
    assert.equal(w.probes.length, 1, 'launch mode provoked a check');
    assert.equal(await w.ask('mode=watch&why=watching'), 'wait');
    assert.equal(w.probes.length, 1, 'watch mode never probes; and launch mode not again within 15 s');
    // trustd checks again at 01:52:30 (more than 60 s after the rebuild began): the next ask is "ready".
    writeFileSync(path.join(w.dir, 'stream.log'), `${stream}\n${EVAL('01:52:30.000')}`);
    w.setClock(at('01:52:40'));
    assert.equal(await w.ask('mode=launch&why=a%20fresh%20launch'), 'ready');
    const logged = readFileSync(w.log, 'utf8');
    assert.match(logged, /^trustd wait \(a fresh launch\): held 1 m 40 s for a pinning database update \(121 → 131\) from 01:50:21; trustd checked again at 01:52:30\n$/);
    assert.doesNotMatch(logged, /cloudfront|SECRET|key=/);
    assert.ok(JSON.parse(readFileSync(w.budget, 'utf8')).spentMs >= 100_000, 'the wait is taken off the job\'s budget');
    assert.equal(w.settled.length, 1, 'Safari closed once more as the probing wait ended');
    // The watch wait ends too, with no probe of its own: Safari isn't touched again for it.
    assert.equal(await w.ask('mode=watch&why=watching'), 'ready');
    assert.equal(w.settled.length, 1);
  } finally { w.s.close(); }
});

test('"ready" goes out only after Safari is closed: a slow settle holds the answer until it finishes', async () => {
  // Answering first would let the flow launch the app while Safari still sits over it.
  let closeSafari;
  const closed = new Promise((r) => { closeSafari = r; });
  const w = await start(STALL_488, { settle: () => closed });
  try {
    assert.equal(await w.ask('mode=launch&why=a%20fresh%20launch'), 'wait');
    assert.equal(w.probes.length, 1);
    writeFileSync(path.join(w.dir, 'stream.log'), `${STALL_488}\n${EVAL('01:52:30.000')}`);
    w.setClock(at('01:52:40'));
    let answered = null;
    const asked = w.ask('mode=launch&why=a%20fresh%20launch').then((a) => { answered = a; return a; });
    const waitFor = async (ok) => { for (let i = 0; i < 200 && !ok(); i += 1) await new Promise((r) => setTimeout(r, 10)); };
    await waitFor(() => w.settled.length === 1);
    assert.equal(w.settled.length, 1, 'the wait ended and began closing Safari');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(answered, null, 'no answer while Safari is still closing');
    closeSafari();
    assert.equal(await asked, 'ready');
  } finally { w.s.close(); }
});

test('a held request answers "wait" within HOLD_MS, and an unknown path is a 404', async () => {
  const w = await start(STALL_488);
  try {
    const t0 = at('01:51:00');
    assert.equal(await w.ask('mode=watch&why=x'), 'wait');
    const res = await fetch(`http://127.0.0.1:${w.s.address().port}/other`);
    assert.equal(res.status, 404);
    assert.ok(HOLD_MS <= 5000, "under Maestro's http read timeout");
    assert.ok(!existsSync(w.log) || readFileSync(w.log, 'utf8') === '', 'nothing logged while it still waits');
    void t0;
  } finally { w.s.close(); }
});

test('the real CLI listens on 127.0.0.1 only, and a missing stream answers "ready" at once', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trustd-wait-cli-'));
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'journey-trust-wait.mjs');
  const child = spawn(process.execPath, [script, 'serve', '--stream', path.join(dir, 'none.log'), '--log', path.join(dir, 'wait.log'), '--budget', path.join(dir, 'b.json'), '--port', '0'], { env: { ...process.env, UDID: '', EXPO_PUBLIC_AWS_URL: '' } });
  try {
    const said = await new Promise((resolve, reject) => {
      child.stdout.on('data', (b) => resolve(String(b)));
      child.on('exit', (c) => reject(new Error(`exited ${c}`)));
    });
    const m = /^trustd wait: listening on (\S+):(\d+)/.exec(said);
    assert.ok(m, said);
    assert.equal(m[1], '127.0.0.1');
    assert.equal(await (await fetch(`http://127.0.0.1:${m[2]}/trustd-ready?mode=launch&why=x`)).text(), 'ready');
    assert.match(readFileSync(path.join(dir, 'wait.log'), 'utf8'), /no trustd stream/);
  } finally {
    child.kill();
  }
});

test('a request that hits an error answers "ready" and says it didn\'t wait, instead of leaving the flow hanging', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trustd-wait-err-'));
  const log = path.join(dir, 'wait.log');
  // A clock that throws stands for anything going wrong inside.
  const s = server({ stream: path.join(dir, 'none'), log, budget: path.join(dir, 'b.json'), now: () => { throw new Error('boom'); } });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${s.address().port}/trustd-ready?mode=launch&why=x`)).text(), 'ready');
    assert.match(readFileSync(log, 'utf8'), /hit an error, so it answered "ready" without waiting/);
  } finally { s.close(); }
});
