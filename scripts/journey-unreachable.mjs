#!/usr/bin/env node
// When Maestro loses the simulator's driver (DeviceUnreachableException) and nothing else failed, ios-journeys runs
// the journeys once more, on new test people (the Master's six conditions, Nov 10; docs/build/IOS-JOURNEYS.md).
// Four runs on Nov 9-10 (42751395869, 42825898600, 42887110283 attempt 1, 42872308399 attempt 3): the driver's
// screenshot request timed out, and every journey after it failed on its first device call. Not the app.
//   node scripts/journey-unreachable.mjs decide <maestro test-output dir> [--forced]
//     Re-run only when report.xml has at least one failure and every failure is DeviceUnreachableException; a missing,
//     unreadable or empty report.xml, a mixed one, or none failed, never (--forced, the unreachable_fault input, re-runs
//     whatever happened, marked simulated). Prints the warning line; with $GITHUB_OUTPUT set, writes rerun=.
//   node scripts/journey-unreachable.mjs again <attempt 1 dir> <attempt 2 dir>
//     After the second attempt: exit 1 with a line naming the point when the driver dropped at the same point twice.
//   node scripts/journey-unreachable.mjs verdict <first> <rerun> <second> <same> [--forced]
//     The job's last step: exit 0 (green) or 1, with a line, from the steps' outcomes (success, failure, skipped or
//     empty). A forced run is green only when the first round passed by itself and the second passed too, so it can't
//     turn a real failure green, and its green is stronger than a normal one.
// Only fixed words, numbers and journey names are printed: the step's command kind comes from a fixed list of Maestro
// command names ("unknown" otherwise), so no text from commands.json (which echoes keys and links) reaches a log.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const unescape = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const UNREACHABLE = /^\s*maestro\.DeviceUnreachableException\b/;

// The driver calls the exception names ("Device became unreachable during deviceInfo"), and the command kinds of
// Maestro's commands.json, that may be printed. Anything else prints as "unknown".
export const DRIVER_CALLS = ['deviceInfo', 'setPermissions', 'tap', 'contentDescriptor', 'viewHierarchy', 'takeScreenshot', 'launchApp', 'stopApp', 'clearAppState', 'inputText', 'pressKey', 'swipe', 'openLink', 'isScreenStatic', 'waitForAppToSettle', 'eraseText', 'hideKeyboard'];
export const COMMAND_KINDS = [
  'tapOnElement', 'tapOnPoint', 'tapOnPointV2Command', 'backPressCommand', 'scrollCommand', 'scrollUntilVisible', 'swipeCommand',
  'assertCommand', 'assertConditionCommand', 'assertNoDefectsWithAICommand', 'assertWithAICommand', 'inputTextCommand',
  'inputRandomTextCommand', 'launchAppCommand', 'openLinkCommand', 'pressKeyCommand', 'eraseTextCommand', 'hideKeyboardCommand',
  'takeScreenshotCommand', 'stopAppCommand', 'killAppCommand', 'clearStateCommand', 'clearKeychainCommand', 'runFlowCommand',
  'setLocationCommand', 'repeatCommand', 'retryCommand', 'copyTextCommand', 'pasteTextCommand', 'defineVariablesCommand',
  'runScriptCommand', 'waitForAnimationToEndCommand', 'evalScriptCommand', 'applyConfigurationCommand', 'travelCommand',
  'startRecordingCommand', 'stopRecordingCommand', 'addMediaCommand', 'setAirplaneModeCommand', 'toggleAirplaneModeCommand',
];

/** report.xml's journeys: name, start (ms), seconds, and whether it failed and how. null when it can't be read. */
export function journeys(xml) {
  if (typeof xml !== 'string' || !/<testsuites?\b/.test(xml)) return null;
  const out = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attr = (k) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1];
    const fail = /<(failure|error)\b[^>]*>([\s\S]*?)<\/\1>/.exec(m[3] ?? '');
    const status = attr('status');
    const ts = attr('timestamp');
    out.push({
      name: unescape(attr('name') ?? ''),
      start: ts ? Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`) : NaN,
      seconds: Number(attr('time')),
      failed: Boolean(fail) || (status !== undefined && status !== 'SUCCESS'),
      unreachable: Boolean(fail && UNREACHABLE.test(unescape(fail[2]))),
      call: (() => {
        const c = fail && /became unreachable during ([A-Za-z]+)/.exec(fail[2])?.[1];
        return c ? (DRIVER_CALLS.includes(c) ? c : 'unknown') : null;
      })(),
    });
  }
  return out.length ? out : null;
}

/** The step a journey stopped at, from its commands.json on the runner: its number, of how many, and its kind. */
export function stopStep(commandsJson) {
  let list;
  try {
    list = JSON.parse(commandsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || !list.length) return null;
  const i = list.findIndex((c) => c?.metadata?.status === 'FAILED');
  const at = i >= 0 ? i : list.length - 1;
  const key = Object.keys(list[at]?.command ?? {})[0];
  return { step: at + 1, of: list.length, kind: COMMAND_KINDS.includes(key) ? key : 'unknown' };
}

/** Where the driver dropped: the first journey to fail on it (by start), how far in, and the step when known. */
export function dropPoint(dir, list) {
  const first = list.filter((j) => j.unreachable).sort((a, b) => a.start - b.start)[0];
  if (!first) return null;
  let step = null;
  if (dir && existsSync(dir)) {
    for (const run of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const f = path.join(dir, run.name, first.name, 'commands.json');
      if (existsSync(f)) step = stopStep(readFileSync(f, 'utf8'));
    }
  }
  return { journey: first.name, seconds: Math.round(first.seconds), call: first.call ?? 'unknown', step };
}

export const describe = (p) =>
  `"${p.journey}", ${p.seconds} s in${p.step ? `, step ${p.step.step} of ${p.step.of} (${p.step.kind})` : ''}, during the driver's ${p.call}`;

/** Re-run or not, and the line that says why. */
export function decide(xml, { dir = null, forced = false } = {}) {
  const list = journeys(xml);
  if (forced) {
    const p = (list && dropPoint(dir, list)) || null;
    return { rerun: true, point: p, line: `Simulated by the unreachable_fault input: the journeys run once more on new test people${p ? ` (Maestro did lose the driver: ${describe(p)})` : ''}. Not merge evidence.` };
  }
  if (!list) return { rerun: false, point: null, line: "No readable report.xml: Maestro's failure stands, no second attempt." };
  const failed = list.filter((j) => j.failed);
  if (!failed.length) return { rerun: false, point: null, line: null };
  if (!failed.every((j) => j.unreachable)) {
    const n = failed.filter((j) => !j.unreachable).length;
    return { rerun: false, point: null, line: failed.some((j) => j.unreachable) ? `Maestro lost the simulator's driver, but ${n} ${n === 1 ? 'journey' : 'journeys'} also failed for another reason: no second attempt.` : null };
  }
  const p = dropPoint(dir, list);
  return {
    rerun: true,
    point: p,
    line: `Maestro lost the simulator's driver (DeviceUnreachableException) in ${describe(p)}; ${failed.length} ${failed.length === 1 ? 'journey' : 'journeys'} failed on it and nothing else. The journeys run once more on new test people: a green after this is not a clean green.`,
  };
}

/** Same point twice: the same journey, and the same step when both are known, else within 10 s of the same time in. */
export function samePoint(a, b) {
  if (!a || !b || a.journey !== b.journey) return false;
  if (a.step && b.step) return a.step.step === b.step.step;
  return Math.abs(a.seconds - b.seconds) <= 10;
}

/** The job's verdict from the steps' outcomes: { ok, line }. */
export function verdict({ first, rerun, second, same, forced = false }) {
  if (forced) {
    if (first !== 'success') return { ok: false, line: `The first round failed by itself (${first || 'not run'}), and unreachable_fault can't make that green.` };
    if (same === 'failure') return { ok: false, line: null };
    if (second !== 'success') return { ok: false, line: `The forced second attempt failed (${second || 'not run'}).` };
    return { ok: true, line: 'Both rounds passed, the second forced by unreachable_fault.' };
  }
  if (rerun === 'true') {
    if (same === 'failure') return { ok: false, line: null };
    if (second === 'success') return { ok: true, line: 'Passed on the second attempt (the warning above says why): not a clean green.' };
    return { ok: false, line: 'The second attempt failed too.' };
  }
  if (first === 'success') return { ok: true, line: null };
  return { ok: false, line: 'The journeys failed (no second attempt: not only Maestro losing the simulator).' };
}

const read = (dir) => (dir && existsSync(path.join(dir, 'report.xml')) ? readFileSync(path.join(dir, 'report.xml'), 'utf8') : null);

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'decide' && a) {
    const d = decide(read(a), { dir: a, forced: process.argv.includes('--forced') });
    if (d.line) console.log(d.line);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `rerun=${d.rerun}\n`);
  } else if (cmd === 'again' && a && b) {
    const one = journeys(read(a));
    const two = journeys(read(b));
    const p1 = one && dropPoint(a, one);
    const p2 = two && dropPoint(b, two);
    if (samePoint(p1, p2)) {
      console.log(`Maestro lost the simulator's driver at the same point in both attempts: ${describe(p2)}. That is not chance: look at the app or the flow there.`);
      process.exit(1);
    }
  } else if (cmd === 'verdict') {
    const [first, rerun, second, same] = process.argv.slice(3, 7);
    const v = verdict({ first, rerun, second, same, forced: process.argv.includes('--forced') });
    if (v.line) console.log(v.ok ? v.line : `::error title=Journeys::${v.line}`);
    process.exit(v.ok ? 0 : 1);
  } else {
    console.error('usage: node scripts/journey-unreachable.mjs decide <dir> [--forced] | again <attempt 1 dir> <attempt 2 dir> | verdict <first> <rerun> <second> <same> [--forced]');
    process.exit(2);
  }
}
