#!/usr/bin/env node
// Which iOS journeys needed open-link.yaml's "Try again" (app/e2e/flows/open-link.yaml), for ios-journeys' job summary:
// a green run that only passed after one says so, so a real api outage can't hide behind it.
//   node scripts/journey-retries.mjs <maestro test-output dir>
// Prints one line per journey that tapped Try again, nothing when none did, and names the card: a tap saves
// takeScreenshot/try-again-N.png on "We can't reach homecookd." and try-again-kitchen-N.png on "We can't reach your
// kitchen." (a family that didn't load after a sign-in), in the journey's own folder (<dir>/<run>/<journey name>/).
// report.xml (JUnit) says whether the journey passed.
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

export const CARDS = { api: '"We can\'t reach homecookd."', kitchen: '"We can\'t reach your kitchen."' };

/** Journey name -> Try again taps on each card ({api, kitchen}), from the try-again screenshots. */
export function taps(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const run of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const flow of readdirSync(path.join(dir, run.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const shots = path.join(dir, run.name, flow.name, 'takeScreenshot');
      if (!existsSync(shots)) continue;
      for (const f of readdirSync(shots)) {
        const m = /^try-again-(kitchen-)?\d+\.png$/.exec(f);
        if (!m) continue;
        const t = out.get(flow.name) ?? { api: 0, kitchen: 0 };
        t[m[1] ? 'kitchen' : 'api'] += 1;
        out.set(flow.name, t);
      }
    }
  }
  return out;
}

export function lines(dir) {
  const xml = path.join(dir, 'report.xml');
  const passed = existsSync(xml) ? results(readFileSync(xml, 'utf8')) : new Map();
  return [...taps(dir)].sort(([a], [b]) => a.localeCompare(b)).map(([name, t]) => {
    const n = t.api + t.kitchen;
    const cards = Object.keys(CARDS).filter((c) => t[c]);
    const on = cards.length > 1 ? ` (${cards.map((c) => `${t[c]} on ${CARDS[c]}`).join(', ')})` : ` on ${CARDS[cards[0]]}`;
    const retries = `${n} "Try again" ${n === 1 ? 'retry' : 'retries'}${on}`;
    if (passed.get(name) === true) return `${name}: passed after ${retries}, trust-check stall (if it repeats, check the staging api)`;
    if (passed.get(name) === false) return `${name}: failed after ${retries}: the card stayed up`;
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
