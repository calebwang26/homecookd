#!/usr/bin/env node
// Names a certificate stall in ios-journeys (the Master's order, Nov 10). The simulator's certificate service (trustd)
// sometimes stops evaluating anything, and every TLS handshake on the simulator then fails: the app shows "We can't reach
// homecookd." and the journey fails for a reason outside the app. In 42898927696 trustd's last evaluation was 21:09:08,
// it logged "Pinning database should update from version 121 to version 131" at 21:09:10 (58 s after the simulator
// check passed), evaluated nothing for the six minutes left, and logged "database is locked" at 21:14:22.
//   node scripts/journey-trust.mjs <maestro test-output dir> <trustd stream> [<gate passed, epoch s>] [--summary <file>]
// The trustd stream is the simulator's `log stream --style syslog` of trustd alone, from boot (it stays on the runner).
// Prints one line per journey whose app had a certificate check fail, saying whether trustd had stopped (quiet for at
// least STALL_GAP_MS before the first failure and through them: the simulator), or kept evaluating while only the app
// failed (the api's certificate), or that there's no trustd log to tell by; and one line on trustd's pinning
// database whenever it updated or locked. --summary writes the kept file: times, pids, versions and per-minute counts,
// built from fixed words only, never a line's own text, so it can't hold a hostname, a link or a key.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { results, windows } from './journey-retries.mjs';

// syslog style: 2026-11-10 21:09:10.190123+0000  localhost trustd[25642]: [com.apple.securityd:pinningDb] Pinning …
const LINE = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d+)([+-]\d\d)(\d\d)\s+\S+\s+([^\s[]+)\[(\d+)\]: (.*)$/;
const APP = 'homecookd';

/** Each real log line's time (ms), process, pid and message. */
export function parse(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const ms = Date.parse(`${m[1]}T${m[2].slice(0, 12)}${m[3]}:${m[4]}`);
    if (!Number.isNaN(ms)) out.push({ ms, proc: m[5], pid: Number(m[6]), msg: m[7] });
  }
  return out;
}

/** What trustd did: its pids (first and last line), evaluations, pinning database updates and locked reads. */
export function trustd(text) {
  const pids = new Map();
  const evals = [];
  const updates = [];
  const locked = [];
  for (const l of parse(text)) {
    if (l.proc !== 'trustd') continue;
    const p = pids.get(l.pid) ?? { first: l.ms, last: l.ms };
    p.first = Math.min(p.first, l.ms);
    p.last = Math.max(p.last, l.ms);
    pids.set(l.pid, p);
    if (/\[com\.apple\.securityd:policy\]|Description: SecKeyVerifySignature/.test(l.msg)) evals.push(l.ms);
    const u = /Pinning database should update from version (\d+) to version (\d+)/.exec(l.msg);
    if (u) updates.push({ ms: l.ms, pid: l.pid, from: Number(u[1]), to: Number(u[2]) });
    if (/database is locked/.test(l.msg)) locked.push(l.ms);
  }
  const byTime = (a, b) => a - b;
  return { pids, evals: evals.sort(byTime), updates: updates.sort((a, b) => a.ms - b.ms), locked: locked.sort(byTime) };
}

/** Every certificate check's outcome, by process: boringssl's "Returning from external verify block with result". */
export function verdicts(text) {
  return parse(text).flatMap((l) => {
    const m = /Returning from external verify block with result: (true|false)/.exec(l.msg);
    return m ? [{ ms: l.ms, proc: l.proc, ok: m[1] === 'true' }] : [];
  });
}

// A stall needs trustd quiet this long before the app's first failure (and through its failures). When the api's own
// certificate fails, trustd's evaluation is the check that failed, well under a second before it; in 42898927696
// trustd's last evaluation was 24 s before the app's first failure, in 42887110283 attempt 2, 55 s.
export const STALL_GAP_MS = 5000;

const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const ago = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`);
const after = (ms, gate) => {
  if (!gate) return '';
  const s = Math.round((ms - gate) / 1000);
  return s >= 0 ? ` (${ago(s)} after the simulator check passed)` : ` (${ago(-s)} before the simulator check passed)`;
};

/**
 * One line per journey whose app had a certificate check fail. `journeys`: [{ name, log }] (each journey's own
 * device-simulator.log); `t`: trustd() of the whole run's stream; `gate`: when the simulator check passed (ms).
 */
export function journeyLines(journeys, t, gate) {
  const out = [];
  for (const { name, log, passed } of journeys) {
    // "Re-run the job" only when this journey failed; one that got through the stall says so (run 42926262894).
    const end = passed === true ? '; the journey got through it' : ' (re-run the job)';
    const v = verdicts(log);
    const failed = v.filter((x) => x.proc === APP && !x.ok);
    if (!failed.length) continue;
    const first = failed[0].ms;
    const last = failed[failed.length - 1].ms;
    const others = v.filter((x) => x.proc !== APP);
    const otherFailed = others.filter((x) => !x.ok).length;
    const own = trustd(log);
    const seen = t.pids.size > 0 || own.pids.size > 0; // any trustd line at all, in the stream or this journey's log
    const evals = [...t.evals, ...own.evals].sort((a, b) => a - b);
    const before = evals.filter((ms) => ms < first);
    const during = evals.filter((ms) => ms >= first && ms <= last).length;
    const stop = before[before.length - 1];
    let line = `${name}: the app's certificate checks failed ${failed.length} ${failed.length === 1 ? 'time' : 'times'}, ${hms(first)}–${hms(last)} UTC (other processes: ${otherFailed} failed, ${others.length - otherFailed} passed)`;
    if (!seen) {
      line += "; there's no trustd log for this run, so it can't tell whether the simulator stopped checking certificates";
    } else if (stop !== undefined && !during && first - stop >= STALL_GAP_MS) {
      const update = [...t.updates].reverse().find((u) => u.ms <= last);
      const locked = t.locked.filter((ms) => ms >= stop && ms <= last).length;
      line += `; trustd evaluated nothing after ${hms(stop)}${after(stop, gate)}`;
      if (update && update.ms >= stop - 60_000) line += `, and started a pinning database update (${update.from} → ${update.to}) at ${hms(update.ms)}`;
      if (locked) line += `; its pinning database was locked ${locked} ${locked === 1 ? 'time' : 'times'}`;
      line += `: the simulator stopped checking certificates, not the app${end}`;
    } else if (!evals.length) {
      line += `; trustd logged but evaluated nothing in this run: the simulator, not the app${end}`;
    } else if (otherFailed) {
      line += `; other processes failed too: the simulator, not the app${passed === true ? end : ''}`;
    } else {
      line += "; trustd kept evaluating and only the app's checks failed: look at the api's certificate";
    }
    out.push(line);
  }
  return out;
}

/** One line on each pinning database update or lock in the run, and when trustd evaluated again after it. */
export function pinningLines(t, gate) {
  const out = [];
  for (const u of t.updates) {
    const next = t.evals.find((ms) => ms > u.ms);
    const end = Math.max(...[...t.pids.values()].map((p) => p.last));
    out.push(`trustd (pid ${u.pid}) started a pinning database update (${u.from} → ${u.to}) at ${hms(u.ms)}${after(u.ms, gate)}; `
      + (next ? `it evaluated again at ${hms(next)}, ${ago(Math.round((next - u.ms) / 1000))} later` : `it evaluated nothing after it before the stream ended (${hms(end)})`));
  }
  if (t.locked.length) out.push(`trustd's pinning database was locked ${t.locked.length} ${t.locked.length === 1 ? 'time' : 'times'}, ${hms(t.locked[0])}–${hms(t.locked[t.locked.length - 1])}`);
  return out;
}

/** The kept file: fixed words with times, pids, versions and counts only. */
export function summary(t, journeys, gate) {
  const lines = ['trustd and certificate checks in this run (times UTC; counts only: no line of the logs is copied here)'];
  if (gate) lines.push(`simulator check passed: ${hms(gate)}`);
  for (const [pid, p] of [...t.pids].sort((a, b) => a[1].first - b[1].first)) lines.push(`trustd pid ${pid}: ${hms(p.first)}–${hms(p.last)}`);
  for (const u of t.updates) lines.push(`${hms(u.ms)} trustd pid ${u.pid}: pinning database update ${u.from} -> ${u.to}`);
  const minutes = new Map();
  const row = (ms) => {
    const k = hms(ms).slice(0, 5);
    if (!minutes.has(k)) minutes.set(k, { evals: 0, locked: 0, appOk: 0, appFailed: 0, otherOk: 0, otherFailed: 0 });
    return minutes.get(k);
  };
  for (const ms of t.evals) row(ms).evals += 1;
  for (const ms of t.locked) row(ms).locked += 1;
  for (const { log } of journeys) {
    for (const v of verdicts(log)) row(v.ms)[`${v.proc === APP ? 'app' : 'other'}${v.ok ? 'Ok' : 'Failed'}`] += 1;
  }
  lines.push('per minute: trustd evaluations, locked reads; certificate checks passed/failed by the app and by other processes');
  for (const [k, r] of [...minutes].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${k} evaluations ${r.evals}, locked ${r.locked}; app ${r.appOk}/${r.appFailed}, others ${r.otherOk}/${r.otherFailed}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Each journey's name, its own device-simulator.log and whether it passed (report.xml), in report.xml's order. */
export function journeyLogs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const xml = path.join(dir, 'report.xml');
  const report = existsSync(xml) ? readFileSync(xml, 'utf8') : '';
  const order = [...windows(report).keys()];
  const passed = results(report);
  for (const run of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const flow of readdirSync(path.join(dir, run.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const f = path.join(dir, run.name, flow.name, 'logs', 'device-simulator.log');
      if (existsSync(f)) out.push({ name: flow.name, log: readFileSync(f, 'utf8'), passed: passed.get(flow.name) });
    }
  }
  return out.sort((a, b) => (order.indexOf(a.name) + 1 || Infinity) - (order.indexOf(b.name) + 1 || Infinity));
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--summary');
  const out = i >= 0 ? args.splice(i, 2)[1] : null;
  const [dir, stream, gateS] = args;
  if (!dir) {
    console.error('usage: node scripts/journey-trust.mjs <maestro test-output dir> <trustd stream> [<gate passed, epoch s>] [--summary <file>]');
    process.exit(2);
  }
  const t = trustd(stream && existsSync(stream) ? readFileSync(stream, 'utf8') : '');
  const gate = Number(gateS) > 0 ? Number(gateS) * 1000 : null;
  const journeys = journeyLogs(dir);
  for (const line of [...journeyLines(journeys, t, gate), ...pinningLines(t, gate)]) console.log(line);
  if (out) writeFileSync(out, summary(t, journeys, gate));
}

