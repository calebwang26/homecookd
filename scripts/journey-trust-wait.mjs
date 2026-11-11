#!/usr/bin/env node
// A host-side wait for the iOS journeys (the Master's conditions, Nov 10): a flow asks, before a journey's fresh launch
// and before journey 4's "I'm done", whether the simulator's trustd is in the middle of rebuilding its pinning database.
// While it is, trustd checks no certificate at all, and every handshake fails (journey 4 in 42939750084 lost its clip
// download that way: the rebuild began at 01:50:21, trustd's last check was 01:50:39, the journey failed at 01:51).
// Two rebuilds have been seen to end: 1 m 54 s (42926262894) and 6 m 20 s (42938280153).
//   node scripts/journey-trust-wait.mjs serve --stream <trustd stream> --log <wait log> --budget <file> [--port <n>]
// GET /trustd-ready?mode=launch|watch&why=<words> answers "ready" or "wait" within HOLD_MS (Maestro's http client has a
// short read timeout, so the flow asks again until "ready"):
// - "ready" at once with no stream (a run without one can't tell, and says so in the log: never read as "ready"), and
//   with no rebuild open: no "Pinning database should update" line, or trustd has checked something SETTLED_MS or more
//   after the latest one began.
// - launch mode (before the app is up) provokes a check, as the readiness gate does: Safari opens the api's address
//   every PROBE_EVERY_MS and is closed again 4 s later, and once more when the wait ends, so a healthy but idle trustd
//   shows it is checking and Safari isn't left over the app.
// - watch mode (inside a journey: Safari would take the app's place) only watches, and stops waiting on a rebuild
//   WATCH_MAX_MS old.
// - One budget for the whole job (BUDGET_MS, kept in --budget across steps), so the worst case stays inside the job's
//   timeout; spent, it answers "ready" and says so.
// Each wait that held writes one line to --log (fixed words and numbers, never a line of the stream); the stall step
// prints each as a warning. The server listens on 127.0.0.1 only.
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { openUpdate, SETTLED_MS, trustd } from './journey-trust.mjs';

export { openUpdate, SETTLED_MS };
export const PORT = 47231;
export const HOLD_MS = 5000;
export const WATCH_MAX_MS = 10 * 60_000;
export const BUDGET_MS = 12 * 60_000;
export const PROBE_EVERY_MS = 15_000;

const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const ago = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`;
};

/**
 * One answer. `stream` is the trustd stream's text (null: no stream); `wait` is this wait so far ({ start } when it
 * already held); `spent` is the job's budget used before this wait.
 * Returns { answer: 'ready'|'wait', line?: what to log when a wait ends, probe?: whether to provoke a check now }.
 */
export function decide(stream, now, { mode = 'launch', why = 'a journey', wait = null, spent = 0 } = {}) {
  if (stream === null) return { answer: 'ready', line: `trustd wait (${why}): no trustd stream, so it couldn't tell whether trustd was rebuilding; not waited` };
  const t = trustd(stream);
  const u = openUpdate(t, now);
  const held = wait ? now - wait.start : 0;
  const what = (x) => `a pinning database update (${x.from} → ${x.to}) from ${hms(x.ms)}`;
  if (!u) {
    if (!wait) return { answer: 'ready' };
    const back = t.evals.find((ms) => ms >= (wait.update?.ms ?? 0) + SETTLED_MS);
    return { answer: 'ready', line: `trustd wait (${why}): held ${ago(held)} for ${wait.update ? what(wait.update) : 'a pinning database update'}; trustd checked again at ${back ? hms(back) : hms(now)}` };
  }
  if (spent + held >= BUDGET_MS) {
    return { answer: 'ready', line: `trustd wait (${why}): held ${ago(held)} for ${what(u)}, then went on: the job's ${ago(BUDGET_MS)} of waiting is spent` };
  }
  if (mode === 'watch' && now - u.ms >= WATCH_MAX_MS) {
    return { answer: 'ready', line: `trustd wait (${why}): ${what(u)} with no check for ${ago(now - u.ms)}; went on after holding ${ago(held)} (it can't be provoked mid-journey)` };
  }
  return { answer: 'wait', probe: mode === 'launch' };
}

/** A label safe to print: letters, digits, spaces and a few marks, at most 40 characters. */
export const label = (s) => (String(s ?? '').replace(/[^A-Za-z0-9 '",.-]/g, '').slice(0, 40) || 'a journey');

/**
 * The server. `probe` provokes a check (Safari to the api); `settle` closes Safari once more when a wait that probed ends
 * (a probe's open can land late, the same fault as the link opens, and Safari would then sit over the app); `now` and
 * `sleep` are injectable for tests.
 */
export function server({ stream, log, budget, probe = () => {}, settle = async () => {}, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const waits = new Map();
  let lastProbe = 0;
  let saidNoStream = false;
  const read = () => (stream && existsSync(stream) ? readFileSync(stream, 'utf8') : null);
  const spent = () => {
    try { return JSON.parse(readFileSync(budget, 'utf8')).spentMs || 0; } catch { return 0; }
  };
  const write = (line) => line && appendFileSync(log, `${line}\n`);
  return http.createServer(async (req, res) => {
    // Never leave a flow hanging: anything that throws answers "ready" and says it didn't wait.
    try {
      await answer(req, res);
    } catch {
      write('trustd wait: it hit an error, so it answered "ready" without waiting');
      if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/plain' }).end('ready');
    }
  });

  async function answer(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/trustd-ready') { res.writeHead(404).end(); return; }
    const mode = url.searchParams.get('mode') === 'watch' ? 'watch' : 'launch';
    const why = label(url.searchParams.get('why'));
    const until = now() + HOLD_MS;
    for (;;) {
      const text = read();
      const wait = waits.get(why) ?? null;
      const d = decide(text, now(), { mode, why, wait, spent: spent() });
      if (d.answer === 'ready') {
        if (text === null) {
          if (!saidNoStream) write(d.line);
          saidNoStream = true;
        } else write(d.line);
        if (wait) {
          writeFileSync(budget, JSON.stringify({ spentMs: spent() + (now() - wait.start) }));
          waits.delete(why);
          if (wait.probed) await settle();
        }
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ready');
        return;
      }
      if (!wait) waits.set(why, { start: now(), update: openUpdate(trustd(text), now()) });
      if (d.probe && now() - lastProbe >= PROBE_EVERY_MS) {
        lastProbe = now();
        waits.get(why).probed = true;
        probe();
      }
      if (now() >= until) { res.writeHead(200, { 'content-type': 'text/plain' }).end('wait'); return; }
      await sleep(500);
    }
  }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname && process.argv[2] === 'serve') {
  const host = (process.env.EXPO_PUBLIC_AWS_URL || '').replace(/^https:\/\//, '').split('/')[0];
  const udid = process.env.UDID;
  // The readiness gate's probe: Safari opens the api's address (a certificate check), and is closed 4 s later.
  const probe = () => {
    if (!udid || !host) return;
    execFile('/usr/bin/xcrun', ['simctl', 'openurl', udid, `https://${host}/?trustd-wait=${Date.now()}`], () => {});
    setTimeout(() => execFile('/usr/bin/xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], () => {}), 4000);
  };
  // Safari closed once more as a wait that probed ends, before the flow launches the app.
  const settle = () => new Promise((r) => {
    if (!udid) return r();
    execFile('/usr/bin/xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], () => r());
  });
  const s = server({ stream: arg('stream'), log: arg('log', '/dev/null'), budget: arg('budget', '/dev/null'), probe, settle });
  s.listen(Number(arg('port', PORT)), '127.0.0.1', () => console.log(`trustd wait: listening on ${s.address().address}:${s.address().port}`));
}
