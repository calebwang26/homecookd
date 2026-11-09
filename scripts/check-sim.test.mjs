// check-sim.mjs against a throwaway git repo (with its own "origin") and a fake gh: node --test scripts/check-sim.test.mjs
import { strict as assert } from 'node:assert';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-sim.mjs');
// A made-up identity for the throwaway repo's commits (no git config is written).
const ID = { GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
const REPO = 'owner/homecookd';

/**
 * An "origin" with three commits on main: `tested` (app/a.ts = a1), `docs` (only docs/ changed, so the same app/) and
 * `other` (app/a.ts = a2), plus `unfetched`, a commit only origin has (same app/ as `tested`). The clone sits at `docs`.
 */
function setup() {
  const top = mkdtempSync(path.join(tmpdir(), 'sim-'));
  const origin = path.join(top, 'origin');
  const dir = path.join(top, 'clone');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, env: { ...process.env, ...ID }, encoding: 'utf8' }).trim();
  const put = (root, f, text) => {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), text);
  };
  mkdirSync(origin);
  g(origin, 'init', '-q', '-b', 'main');
  put(origin, 'app/a.ts', 'a1\n');
  g(origin, 'add', '-A');
  g(origin, 'commit', '-q', '-m', 'tested');
  const tested = g(origin, 'rev-parse', 'HEAD');
  put(origin, 'docs/x.md', 'x\n');
  g(origin, 'add', '-A');
  g(origin, 'commit', '-q', '-m', 'docs');
  const docs = g(origin, 'rev-parse', 'HEAD');
  g(origin, 'clone', '-q', origin, dir);
  g(dir, 'checkout', '-q', docs);
  // Commits the clone never saw: one with a different app/, one (on a PR-like ref) with the tested app/.
  put(origin, 'app/a.ts', 'a2\n');
  g(origin, 'commit', '-q', '-am', 'other');
  const other = g(origin, 'rev-parse', 'HEAD');
  g(origin, 'checkout', '-q', '-b', 'pr', docs);
  put(origin, 'docs/y.md', 'y\n');
  g(origin, 'add', '-A');
  g(origin, 'commit', '-q', '-m', 'unfetched');
  const unfetched = g(origin, 'rev-parse', 'HEAD');
  g(origin, 'checkout', '-q', 'main');
  // The clone's own view of origin stops at `docs`, so `other` and `unfetched` need a fetch.
  return { dir, put: (f, text) => put(dir, f, text), tested, docs, other, unfetched };
}

const runOf = (sha, repo = REPO) => ({
  head_sha: sha,
  head_repository: { full_name: repo },
  repository: { full_name: REPO },
  updated_at: '2026-11-09T07:00:00Z',
  html_url: `https://github.com/${REPO}/actions/runs/1`,
});

/** Runs check-sim with GitHub answering `runs` (newest first), or failing when `runs` is null. */
function run(repo, runs) {
  const fake = path.join(repo.dir, '..', 'fake-gh.mjs');
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (${JSON.stringify(runs)} === null) process.exit(4);
if (args[0] !== 'api' || !/^repos\\/\\{owner\\}\\/\\{repo\\}\\/actions\\/workflows\\/ios-journeys\\.yml\\/runs\\?status=success/.test(args[1])) process.exit(9);
console.log(JSON.stringify({ workflow_runs: ${JSON.stringify(runs)} }));
`,
  );
  chmodSync(fake, 0o755);
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, SIM_GH: fake, SIM_ROOT: repo.dir }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('a passing run on HEAD itself allows it', () => {
  const repo = setup();
  const r = run(repo, [runOf(repo.docs)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /HEAD itself/);
});

test('a passing run on another commit with the same app/ allows it (only docs changed since)', () => {
  const repo = setup();
  const r = run(repo, [runOf(repo.tested)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`passed on ${repo.tested.slice(0, 10)} \\(the same app/ as HEAD ${repo.docs.slice(0, 10)}\\)`));
});

test('a run on a commit with a different app/ is refused, even fetched from origin', () => {
  const repo = setup();
  const r = run(repo, [runOf(repo.other)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /no passing ios-journeys\.yml run has HEAD's app\//);
  assert.match(r.out, /gh workflow run ios-journeys\.yml/);
});

test("a commit this clone hasn't fetched yet is fetched, and counts when its app/ matches", () => {
  const repo = setup();
  const r = run(repo, [runOf(repo.other), runOf(repo.unfetched)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`passed on ${repo.unfetched.slice(0, 10)}`));
});

test("a fork's run never counts", () => {
  const repo = setup();
  const r = run(repo, [runOf(repo.docs, 'someone/homecookd')]);
  assert.equal(r.code, 1);
  assert.match(r.out, /0 passing run\(s\) checked/);
});

test('uncommitted app/ changes are refused even with a matching run; the export folder is ignored', () => {
  const repo = setup();
  repo.put('app/.safe-export.abc/bundle.js', 'x');
  assert.equal(run(repo, [runOf(repo.docs)]).code, 0);
  repo.put('app/a.ts', 'changed\n');
  repo.put('app/new.ts', 'new\n');
  const r = run(repo, [runOf(repo.docs)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /app\/ has changes that aren't committed \(app\/a\.ts, app\/new\.ts\)/);
});

test("when GitHub can't be read, it's refused", () => {
  const repo = setup();
  const r = run(repo, null);
  assert.equal(r.code, 1);
  assert.match(r.out, /couldn't check/);
});
