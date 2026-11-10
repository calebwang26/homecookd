#!/usr/bin/env node
// Did a link open that simctl reported as failed still reach the app? Asked by journey-xcrun.sh (ios-journeys' xcrun
// for Maestro) after `xcrun simctl openurl` fails, from the simulator log the Journeys step streams: `log stream --style
// syslog`, only lsd's "_LSDispatchWithTimeout" lines (iOS giving up on an open after 10 s, Code=60) and the app's
// "UIOpenURLAction" lines (the app receiving a link). Neither kind holds the link.
//   node scripts/journey-openurl.mjs --since <ms> --stream <file> [--log <file>] [--exit <code>] [--wait <s>] [--simulated]
//   node scripts/journey-openurl.mjs --since <ms> --stream <file> --landed-within <s>
// Exits 0 when iOS gave up on the open and the app still received a link within --wait s (30: what open-link.yaml waits
// for its screen anyway) of --since, the moment the open started; else 1. The 30 s are counted to the app's own line,
// not to simctl returning. Either way it adds one JSON line to --log for the job summary (journey-retries.mjs):
// { at, exit, simctlS, gaveUpS, landedS, passed, simulated, wait }.
// --exit 0 (an open that worked) only adds its line, with how long simctl took, and exits 0 at once: the Times step reads
// when the app got that link from the same stream, so a slow open shows even when nothing failed.
// --simulated (the openurl_fault input) skips lsd's line: the open didn't really time out, the check of the landing did.
// --landed-within <s> only asks whether the app received a link within <s> s from now (exit 0) or not (1), and writes
// nothing: journey-xcrun.sh fakes the fault only on an open the app got on its own, never one waiting on iOS's dialog.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const LAND_S = 30;
// How long to wait for lsd's line after simctl failed, before calling it some other failure.
const GAVE_UP_GRACE_MS = 3000;

// syslog style, the format Maestro's own device-simulator.log uses:
// 2026-11-10 16:25:33.927548+0000  localhost lsd[1545]: (CoreServices) [com.apple.launchservices:default] LaunchServices: …
// Only a real line counts (it starts with a date): log stream's first line repeats the predicate's words.
const LINE = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d+)([+-]\d\d)(\d\d)\s+\S+\s+([^\s[]+)\[\d+\]: (.*)$/;

/** The stream's lsd timeouts and the app's received links, each with its time in ms. */
export function events(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const ms = Date.parse(`${m[1]}T${m[2].slice(0, 12)}${m[3]}:${m[4]}`);
    if (Number.isNaN(ms)) continue;
    if (m[5] === 'lsd' && /_LSDispatchWithTimeout/.test(m[6]) && /Code=60\b/.test(m[6])) out.push({ ms, kind: 'gaveUp' });
    else if (m[5] === 'homecookd' && /Received action\(s\)[^:]*:.*\bUIOpenURLAction\b/.test(m[6])) out.push({ ms, kind: 'landed' });
  }
  return out;
}

/** What the stream says about the open that started at `since` (ms), so far. */
export function decide(text, since, { wait = LAND_S, simulated = false } = {}) {
  const ev = events(text).filter((e) => e.ms >= since);
  const gaveUp = ev.find((e) => e.kind === 'gaveUp');
  const landed = ev.find((e) => e.kind === 'landed' && e.ms <= since + wait * 1000);
  const s = (e) => (e ? Math.round((e.ms - since) / 100) / 10 : null);
  return { gaveUpS: s(gaveUp), landedS: s(landed), passed: Boolean(landed && (gaveUp || simulated)) };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

async function main() {
  const since = Number(arg('since'));
  const stream = arg('stream');
  if (!Number.isFinite(since) || !stream) {
    console.error('usage: node scripts/journey-openurl.mjs --since <ms> --stream <file> [--log <file>] [--exit <code>] [--wait <s>] [--simulated] | --landed-within <s>');
    process.exit(2);
  }
  const within = arg('landed-within');
  if (within !== undefined) {
    const until = Date.now() + Number(within) * 1000;
    for (;;) {
      const text = existsSync(stream) ? readFileSync(stream, 'utf8') : '';
      if (events(text).some((e) => e.kind === 'landed' && e.ms >= since)) process.exit(0);
      if (Date.now() > until) process.exit(1);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const wait = Number(arg('wait', LAND_S));
  const simulated = process.argv.includes('--simulated');
  const exit = Number(arg('exit', 1));
  const log = arg('log');
  const started = Date.now();
  const simctlS = Math.round((started - since) / 100) / 10;
  const write = (d) => log && appendFileSync(log, `${JSON.stringify({ at: new Date(since).toISOString(), exit, simctlS, ...d, simulated, wait })}\n`);
  if (exit === 0 && !simulated) {
    write({ gaveUpS: null, landedS: null, passed: true });
    process.exit(0);
  }
  let d;
  for (;;) {
    d = decide(existsSync(stream) ? readFileSync(stream, 'utf8') : '', since, { wait, simulated });
    const now = Date.now();
    if (d.passed) break;
    if (!simulated && d.gaveUpS === null && now - started > GAVE_UP_GRACE_MS) break; // not iOS's timeout: fail as before
    if (now > since + wait * 1000 + 1000) break; // the link didn't land in time (1 s for the stream to catch up)
    await new Promise((r) => setTimeout(r, 250));
  }
  write(d);
  process.exit(d.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
