#!/usr/bin/env node
// A state machine's table changed without its test changing: fail the PR (docs/agents/STATE-MACHINES.md). A machine file
// names its test in a header line, within its first 40 lines:
//   // state-machine-test: questionMachine.test.ts           (TS/JS; a bare name is next to the file)
//   # state-machine-test: pipeline/test_claude.py            (Python; a path with a slash is from the repo root)
// For every file the PR changed that carries the line, the named test must exist and be changed in the same PR.
//   node scripts/check-machine-tests.mjs [base]   base defaults to origin/main; CI passes origin/$GITHUB_BASE_REF
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MARKER = /^\s*(?:\/\/|#)\s*state-machine-test:\s*(\S+)\s*$/m;
const HEADER_LINES = 40;

/** The test a machine file names, as a repo-relative path, or null when the file isn't a machine. */
export function namedTest(file, text) {
  const head = text.split('\n').slice(0, HEADER_LINES).join('\n');
  const m = head.match(MARKER);
  if (!m) return null;
  const name = m[1];
  return name.includes('/') && !name.startsWith('./') ? path.normalize(name) : path.normalize(path.join(path.dirname(file), name));
}

/** Problems for a set of changed files: `read(file)` gives a file's text in the PR (null if deleted), `exists(file)` whether it's there. */
export function check(changed, read, exists) {
  const touched = new Set(changed.map((f) => path.normalize(f)));
  const problems = [];
  for (const file of changed) {
    const text = read(file);
    if (text == null) continue; // deleted: nothing to keep in step
    const test = namedTest(file, text);
    if (!test) continue;
    if (!exists(test)) problems.push(`${file} names ${test}, which doesn't exist.`);
    else if (!touched.has(test)) problems.push(`${file} changed without ${test}: change the test with the table (STATE-MACHINES.md).`);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? 'origin/main';
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const read = (f) => (existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), 'utf8') : null);
  const exists = (f) => existsSync(path.join(root, f));
  const problems = check(changed, read, exists);
  const machines = changed.filter((f) => { const t = read(f); return t != null && namedTest(f, t); });
  for (const p of problems) console.error(`REFUSED: ${p}`);
  if (problems.length) process.exit(1);
  console.log(machines.length ? `State machines changed with their tests: ${machines.join(', ')}` : 'No state machine changed.');
}
