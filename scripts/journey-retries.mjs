#!/usr/bin/env node
// Which iOS journeys needed open-link.yaml's "Try again" (app/e2e/flows/open-link.yaml), for ios-journeys' job summary:
// a green run that only passed after one says so, so a real api outage can't hide behind it.
//   node scripts/journey-retries.mjs <maestro test-output dir>
// Prints one line per journey that tapped Try again, nothing when none did. A tap saves takeScreenshot/try-again-N.png
// in the journey's own folder (<dir>/<run>/<journey name>/), and report.xml (JUnit) says whether the journey passed.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const unescape = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Journey name -> passed (true), failed (false), from Maestro's JUnit report. */
export function results(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1]);
    if (!name) continue;
    const status = /\bstatus="([^"]*)"/.exec(m[1])?.[1];
    const failed = /<(failure|error)\b/.test(m[3] ?? '') || (status !== undefined && status !== 'SUCCESS');
    out.set(unescape(name[1]), !failed);
  }
  return out;
}

/** Journey name -> how many Try again taps (try-again-N screenshots) it made. */
export function taps(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const run of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const flow of readdirSync(path.join(dir, run.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const shots = path.join(dir, run.name, flow.name, 'takeScreenshot');
      if (!existsSync(shots)) continue;
      const n = readdirSync(shots).filter((f) => /^try-again-\d+\.png$/.test(f)).length;
      if (n) out.set(flow.name, (out.get(flow.name) ?? 0) + n);
    }
  }
  return out;
}

export function lines(dir) {
  const xml = path.join(dir, 'report.xml');
  const passed = existsSync(xml) ? results(readFileSync(xml, 'utf8')) : new Map();
  return [...taps(dir)].sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => {
    const retries = `${n} "Try again" ${n === 1 ? 'retry' : 'retries'}`;
    if (passed.get(name) === true) return `${name}: passed after ${retries}, trust-check stall (if it repeats, check the staging api)`;
    if (passed.get(name) === false) return `${name}: failed after ${retries}: "We can't reach homecookd." stayed up`;
    return `${name}: ${retries} (no result in report.xml)`;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/journey-retries.mjs <maestro test-output dir>');
    process.exit(2);
  }
  for (const line of lines(dir)) console.log(line);
}
