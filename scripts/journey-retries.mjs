#!/usr/bin/env node
// Which iOS journeys needed open-link.yaml's "Try again" (app/e2e/flows/open-link.yaml), for ios-journeys' job summary:
// a green run that only passed after one says so, so a real api outage can't hide behind it.
//   node scripts/journey-retries.mjs [--table] <maestro test-output dir> [<journey-xcrun.sh's open log> [<its stream>]]
// The open log has one JSON line per link open (journey-openurl.mjs), and the stream is the Journeys step's log stream,
// where the app's own line says when it received each link. Every open simctl failed becomes a line too, on the journey
// that was running then (report.xml's timestamp and time), whether the link still landed or not, and so does an open that
// worked but whose link reached the app more than 30 s after it. --table prints, instead, the job summary's table of
// every open: how long simctl took and when the app got the link.
// Prints one line per journey that needed a retry, nothing when none did. A Try again tap saves
// takeScreenshot/try-again-N.png on "We can't reach homecookd." and try-again-kitchen-N.png on "We can't reach your
// kitchen." (a family that didn't load after a sign-in); opening the link again with no card to tap saves
// open-again-N.png (#467's run 42811383192 passed after one, and nothing said so). A fresh launch that had to answer
// a camera or microphone prompt an earlier journey left up saves leftover-prompt-N.png, and gets its own line. All in
// the journey's own folder (<dir>/<run>/<journey name>/). report.xml (JUnit) says whether the journey passed.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { events, LAND_S, SLOW_S } from './journey-openurl.mjs';

const unescape = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Journey name -> [start, end] in ms, from Maestro's JUnit report (timestamp is UTC, to the second). */
export function windows(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>)/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1])?.[1];
    const ts = /\btimestamp="([^"]*)"/.exec(m[1])?.[1];
    const time = Number(/\btime="([^"]*)"/.exec(m[1])?.[1]);
    const start = ts ? Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`) : NaN;
    if (name && Number.isFinite(start) && Number.isFinite(time)) out.set(unescape(name), [start, start + (time + 1) * 1000]);
  }
  return out;
}

/**
 * Each open with gotS: seconds from the open to the app's first "received a link" line in the stream before the next
 * open (null when there's none, as for a link that starts the app: it arrives at launch, without that line). Unlike the
 * check's own landedS, it isn't cut off at 30 s.
 */
export function landings(records, stream = '') {
  const got = events(stream).filter((e) => e.kind === 'landed');
  const starts = records.filter((r) => !r.unreadable).map((r) => Date.parse(r.at)).sort((a, b) => a - b);
  return records.map((r) => {
    if (r.unreadable) return r;
    const at = Date.parse(r.at);
    const next = starts.find((t) => t > at) ?? Infinity;
    const e = got.find((x) => x.ms >= at && x.ms < next);
    return { ...r, gotS: e ? Math.round((e.ms - at) / 100) / 10 : null };
  });
}

const journeyAt = (win, at) => win.find(([, [a, b]]) => at >= a && at <= b)?.[0] ?? 'A journey (no report.xml entry for its time)';

/**
 * One line per link open simctl failed (journey-xcrun.sh), on the journey that was running then, and per open that
 * worked but reached the app more than 30 s later.
 */
export function opens(records, xml) {
  const win = [...windows(xml)];
  return records.flatMap((r) => {
    if (r.unreadable) return ['A journey: a link open failed, and its line in the open log can’t be read'];
    const name = journeyAt(win, Date.parse(r.at));
    if (r.exit === 0 && !r.simulated) {
      return r.gotS > SLOW_S ? [`${name}: the link opened, but the app received it only ${r.gotS} s after the open (more than ${SLOW_S} s)`] : [];
    }
    const why = r.simulated ? 'simulated by the openurl_fault input' : r.gaveUpS !== null ? `iOS gave up on it after ${r.gaveUpS} s, Code=60` : `simctl exit ${r.exit}, not iOS's 10 s timeout`;
    if (r.passed) return [`${name}: the link open threw (${why}), but the app received the link ${r.landedS} s after the open, so the journey went on to check its screen`];
    const late = r.gotS !== null && r.gotS !== undefined ? ` (it got it ${r.gotS} s after)` : '';
    if (r.gaveUpS !== null || r.simulated) return [`${name}: the link open threw (${why}), and the app hadn’t received the link ${r.wait ?? LAND_S} s after the open${late}: the journey failed on it`];
    return [`${name}: the link open failed (${why}): the journey failed on it`];
  });
}

/** The job summary's table of every link open: when, how simctl did, and when the app got the link. */
export function table(records, xml) {
  const rows = records.filter((r) => !r.unreadable);
  if (!rows.length) return [];
  const win = [...windows(xml)];
  const s = (n) => (typeof n === 'number' ? `${n} s` : '?');
  return [
    `### Link opens: from the open to the app's own "received a link" line (iOS's Open dialog and Maestro's tap on it included, when iOS asked); more than ${SLOW_S} s is a warning`,
    '| Journey | Open (UTC) | simctl | App got the link |',
    '|---|---|---|---|',
    ...rows.map((r) => {
      const how = r.simulated
        ? `worked in ${s(r.simctlS)}, treated as failed (openurl_fault)`
        : r.exit === 0
          ? `opened in ${s(r.simctlS)}`
          : r.gaveUpS !== null
            ? `failed after ${s(r.simctlS)}: iOS gave up at ${r.gaveUpS} s (Code=60)`
            : `failed after ${s(r.simctlS)}: exit ${r.exit}`;
      const got = r.gotS ?? r.landedS;
      const gotText = got === null || got === undefined ? 'not in the log' : `${got} s${got > SLOW_S ? ' ⚠️' : ''}`;
      return `| ${journeyAt(win, Date.parse(r.at)).replace(/\|/g, '\\|')} | ${r.at.slice(11, 19)} | ${how} | ${gotText} |`;
    }),
  ];
}

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

/** Journey name -> Try again taps on each card ({api, kitchen}) and re-opens of the link, from the screenshots. */
export function taps(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const run of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const flow of readdirSync(path.join(dir, run.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const shots = path.join(dir, run.name, flow.name, 'takeScreenshot');
      if (!existsSync(shots)) continue;
      for (const f of readdirSync(shots)) {
        const m = /^(?:try-again-(kitchen-)?|(open-again-)|(leftover-prompt-))\d+\.png$/.exec(f);
        if (!m) continue;
        const t = out.get(flow.name) ?? { api: 0, kitchen: 0, reopens: 0, leftovers: 0 };
        t[m[3] ? 'leftovers' : m[2] ? 'reopens' : m[1] ? 'kitchen' : 'api'] += 1;
        out.set(flow.name, t);
      }
    }
  }
  return out;
}

function read(dir, openLog, stream) {
  const xml = path.join(dir, 'report.xml');
  const report = existsSync(xml) ? readFileSync(xml, 'utf8') : '';
  const records = openLog && existsSync(openLog)
    ? readFileSync(openLog, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l); } catch { return { unreadable: true }; }
    })
    : [];
  return { report, records: landings(records, stream && existsSync(stream) ? readFileSync(stream, 'utf8') : '') };
}

export function lines(dir, openLog, stream) {
  const { report, records } = read(dir, openLog, stream);
  return [...retries(dir, results(report)), ...opens(records, report)];
}

export function tableFor(dir, openLog, stream) {
  const { report, records } = read(dir, openLog, stream);
  return table(records, report);
}

function retries(dir, passed) {
  const out = [];
  for (const [name, t] of [...taps(dir)].sort(([a], [b]) => a.localeCompare(b))) {
    if (t.leftovers) {
      out.push(`${name}: started by answering ${t.leftovers} camera/microphone ${t.leftovers === 1 ? 'prompt' : 'prompts'} an earlier journey left up (that journey stopped on it)`);
    }
    if (t.api + t.kitchen + t.reopens) out.push(retryLine(name, t, passed));
  }
  return out;
}

function retryLine(name, t, passed) {
  const n = t.api + t.kitchen;
  const cards = Object.keys(CARDS).filter((c) => t[c]);
  const on = cards.length > 1 ? ` (${cards.map((c) => `${t[c]} on ${CARDS[c]}`).join(', ')})` : cards.length ? ` on ${CARDS[cards[0]]}` : '';
  const what = [
    n ? `${n} "Try again" ${n === 1 ? 'retry' : 'retries'}${on}` : '',
    t.reopens ? `${t.reopens} ${t.reopens === 1 ? 're-open' : 're-opens'} of the link` : '',
  ].filter(Boolean).join(' and ');
  // A tap means the card was up: the api didn't answer. A re-open alone proves less (iOS's Open dialog can close
  // without handing the link over, open-link.yaml's first reason), so it names both and where to look.
  const why = n ? 'trust-check stall (if it repeats, check the staging api)' : '';
  const unsure = 'the link didn’t land or the app stalled (the kept simulator log says which)';
  if (passed.get(name) === true) return n ? `${name}: passed after ${what}, ${why}` : `${name}: passed after ${what}: ${unsure}`;
  if (passed.get(name) === false) return n ? `${name}: failed after ${what}: the card stayed up` : `${name}: failed after ${what}: ${unsure}`;
  return `${name}: ${what} (no result in report.xml)`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const asTable = process.argv[2] === '--table';
  const [dir, openLog, stream] = process.argv.slice(asTable ? 3 : 2);
  if (!dir) {
    console.error('usage: node scripts/journey-retries.mjs [--table] <maestro test-output dir> [<open log> [<stream>]]');
    process.exit(2);
  }
  for (const line of (asTable ? tableFor : lines)(dir, openLog, stream)) console.log(line);
}
