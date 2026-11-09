// check-canary.mjs against a throwaway git repo and a fake eas: node --test scripts/check-canary.test.mjs
import { strict as assert } from 'node:assert';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-canary.mjs');
// A made-up identity for the throwaway repo's commits (no git config is written).
const ID = { GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
const HOUR = 3600_000;

/**
 * A repo with build 18's commit (a.ts, b.ts) and a 1.1.1 commit that changes a.ts and deletes b.ts; the working tree is
 * the 1.1.0 checkout, left at build 18 for each test to change.
 */
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'canary-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...ID }, encoding: 'utf8' }).trim();
  const put = (f, text) => {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  };
  g('init', '-q', '-b', 'main');
  put('app/app.json', '{}');
  put('app/src/a.ts', 'a1\n');
  put('app/src/b.ts', 'b1\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'build 18');
  const base = g('rev-parse', 'HEAD');
  put('app/src/a.ts', 'a2\n');
  rmSync(path.join(dir, 'app/src/b.ts'));
  g('add', '-A');
  g('commit', '-q', '-m', '1.1.1');
  const canary = g('rev-parse', 'HEAD');
  g('checkout', '-q', base);
  return { dir, put, rm: (f) => rmSync(path.join(dir, f)), base, canary };
}

/** Runs check-canary with EAS answering `groups` (newest first) and `view` for update:view. */
function run(repo, { groups, view, args = [] }) {
  const fake = path.join(repo.dir, 'fake-eas.mjs');
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const [cmd] = process.argv.slice(2);
if (cmd === 'update:list') console.log(JSON.stringify({ currentPage: ${JSON.stringify(groups)} }));
else if (cmd === 'update:view') console.log(JSON.stringify([${JSON.stringify(view ?? {})}]));
else process.exit(9);
`,
  );
  chmodSync(fake, 0o755);
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, CANARY_EAS: fake, CANARY_ROOT: repo.dir, CANARY_BASE: repo.base, CANARY_HOURS: '' },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

const group = (runtimeVersion, extra = {}) => ({ group: `g-${runtimeVersion}`, runtimeVersion, isRollBackToEmbedded: false, ...extra });
const ago = (ms) => new Date(Date.now() - ms).toISOString();

test('allowed: the 1.1.1 group is 3 h old and has the same files', () => {
  const repo = setup();
  repo.put('app/src/a.ts', 'a2\n');
  repo.rm('app/src/b.ts');
  const r = run(repo, { groups: [group('1.1.0'), group('1.1.1')], view: { createdAt: ago(3 * HOUR), gitCommitHash: repo.canary } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /group g-1\.1\.1/);
  assert.match(r.out, /all 2 app\/src files changed since build 18 are the same/);
});

test('refused while the 1.1.1 group is younger than 2 h (an empty CANARY_HOURS is the default), with the allowed time', () => {
  const repo = setup();
  repo.put('app/src/a.ts', 'a2\n');
  repo.rm('app/src/b.ts');
  const r = run(repo, { groups: [group('1.1.1')], view: { createdAt: ago(HOUR / 2), gitCommitHash: repo.canary } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /younger than 2 h: 1\.1\.0 is allowed from .+ PT \(\d{4}-\d\d-\d\dT/);
});

test('--hours 0 skips the wait (the files still match)', () => {
  const repo = setup();
  repo.put('app/src/a.ts', 'a2\n');
  repo.rm('app/src/b.ts');
  const r = run(repo, { groups: [group('1.1.1')], view: { createdAt: ago(60_000), gitCommitHash: repo.canary }, args: ['--hours', '0'] });
  assert.equal(r.code, 0, r.out);
});

test('refused when a changed file differs from the 1.1.1 group, and the file is named', () => {
  const repo = setup();
  repo.put('app/src/a.ts', 'a3\n');
  repo.rm('app/src/b.ts');
  const r = run(repo, { groups: [group('1.1.1')], view: { createdAt: ago(3 * HOUR), gitCommitHash: repo.canary } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /1 of the 2 app\/src files .* differ/);
  assert.match(r.out, /app\/src\/a\.ts/);
});

test('a file deleted here but kept in 1.1.1, or a new untracked one it lacks, differs', () => {
  const repo = setup();
  repo.put('app/src/a.ts', 'a2\n'); // b.ts stays here, and 1.1.1 deleted it
  const r = run(repo, { groups: [group('1.1.1')], view: { createdAt: ago(3 * HOUR), gitCommitHash: repo.canary } });
  assert.equal(r.code, 0, `b.ts unchanged since build 18 is not part of this change: ${r.out}`);
  repo.rm('app/src/b.ts');
  repo.put('app/src/new.ts', 'new\n');
  const r2 = run(repo, { groups: [group('1.1.1')], view: { createdAt: ago(3 * HOUR), gitCommitHash: repo.canary } });
  assert.equal(r2.code, 1, r2.out);
  assert.match(r2.out, /app\/src\/new\.ts/);
  assert.doesNotMatch(r2.out, /app\/src\/b\.ts/);
});

test('refused with no 1.1.1 group, or when the newest one is a roll-back', () => {
  const repo = setup();
  const none = run(repo, { groups: [group('1.1.0')] });
  assert.equal(none.code, 1);
  assert.match(none.out, /no 1\.1\.1 group on production-aws yet/);
  const back = run(repo, { groups: [group('1.1.1', { isRollBackToEmbedded: true }), group('1.1.1', { group: 'older' })] });
  assert.equal(back.code, 1);
  assert.match(back.out, /roll-back to the build's own JS/);
});

test("refused when the group's commit isn't in the repo", () => {
  const repo = setup();
  const r = run(repo, { groups: [group('1.1.1')], view: { createdAt: ago(3 * HOUR), gitCommitHash: 'f'.repeat(40) } });
  assert.equal(r.code, 1);
  assert.match(r.out, /isn't in this repo/);
});

test('an eas that fails is a refusal, never a pass', () => {
  const repo = setup();
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, CANARY_EAS: '/bin/false', CANARY_ROOT: repo.dir, CANARY_BASE: repo.base },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /couldn't check/);
});
