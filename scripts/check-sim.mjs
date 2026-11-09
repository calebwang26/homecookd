#!/usr/bin/env node
// The simulator gate for production-aws (safe-eas-update.sh runs it before a 1.1.1 publish from main): the app code it
// publishes has already passed the iOS journeys on a simulator (.github/workflows/ios-journeys.yml,
// docs/build/IOS-JOURNEYS.md). Allowed when both hold:
//   (a) app/ in this working tree has no change against HEAD, since the working tree is what gets exported;
//   (b) a passing ios-journeys run, on this repo (not a fork), was on a commit whose app/ is the same tree as HEAD's.
//       A PR's head and its merge commit match when nothing else in app/ landed in between; when something did, main's
//       own run after the merge covers it.
// Exit 0: allowed. Exit 1: refused, with the reasons and how to get a run. Reads git and GitHub (gh) only.
//
//   node scripts/check-sim.mjs
// Tests only: SIM_GH (a command instead of `gh`), SIM_ROOT (another repo).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = 'ios-journeys.yml';
const ROOT = process.env.SIM_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const gitOk = (args) => {
  try {
    return git(args);
  } catch {
    return null;
  }
};

function gh(args) {
  const out = execFileSync(process.env.SIM_GH ?? 'gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out);
}

const pt = (d) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(d) + ' PT';

/** app/ files that differ from HEAD in this working tree (staged, unstaged, untracked). safe-eas-update's own export folder doesn't count. */
function dirtyAppFiles() {
  const changed = git(['diff', '--name-only', '--no-renames', 'HEAD', '--', 'app']).split('\n');
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'app']).split('\n');
  return [...new Set([...changed, ...untracked].filter(Boolean))].filter((f) => !f.startsWith('app/.safe-export.')).sort();
}

/** The tree id of app/ at `commit`, fetching the commit if this clone doesn't have it; null if it can't be had. */
function appTree(commit) {
  const tree = gitOk(['rev-parse', '-q', '--verify', `${commit}:app`]);
  if (tree) return tree;
  if (gitOk(['fetch', '-q', 'origin', commit]) === null) return null;
  return gitOk(['rev-parse', '-q', '--verify', `${commit}:app`]);
}

export function main() {
  const head = git(['rev-parse', 'HEAD']);
  const want = git(['rev-parse', 'HEAD:app']);
  const reasons = [];

  const dirty = dirtyAppFiles();
  if (dirty.length) {
    const shown = dirty.slice(0, 5).join(', ') + (dirty.length > 5 ? `, and ${dirty.length - 5} more` : '');
    reasons.push(`app/ has changes that aren't committed (${shown}): no simulator ran them. Commit them, or check out a clean tree`);
  }

  const { workflow_runs: runs = [] } = gh(['api', `repos/{owner}/{repo}/actions/workflows/${WORKFLOW}/runs?status=success&per_page=50`]);
  const ours = runs.filter((r) => r.head_repository?.full_name === r.repository?.full_name);
  const seen = new Set();
  let match = null;
  for (const r of ours) {
    if (seen.has(r.head_sha)) continue;
    seen.add(r.head_sha);
    if (appTree(r.head_sha) === want) {
      match = r;
      break;
    }
  }
  if (match) {
    const same = match.head_sha === head ? 'HEAD itself' : `the same app/ as HEAD ${head.slice(0, 10)}`;
    console.log(`Simulator: the journeys passed on ${match.head_sha.slice(0, 10)} (${same}), ${pt(new Date(match.updated_at))}: ${match.html_url}`);
  } else {
    reasons.push(
      `no passing ${WORKFLOW} run has HEAD's app/ (${head.slice(0, 10)}; ${seen.size} passing run(s) checked). ` +
        `A PR with this app/ runs it, and so does main after a merge; or: gh workflow run ${WORKFLOW} --ref <this branch>`,
    );
  }

  if (!reasons.length) return 0;
  console.log(`Simulator: REFUSED for now:\n${reasons.map((r) => `  - ${r}`).join('\n')}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.log(`Simulator: couldn't check (${e.message.split('\n')[0]}), so it's refused.`);
    process.exitCode = 1;
  }
}
