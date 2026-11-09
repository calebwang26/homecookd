#!/usr/bin/env node
// Canary order for production-aws (safe-eas-update.sh runs it before a runtime 1.1.0 publish). An update reaches 1.1.1
// first (build 21+, TestFlight internal), and 1.1.0 (build 18, every App Store phone) only after the same change has run
// there for a while. Allowed when both hold:
//   (a) the newest 1.1.1 group on branch production-aws is at least CANARY_HOURS old (default 2);
//   (b) it carries this change: every app/src file this checkout changed since build 18's commit (working tree included,
//       since that is what gets exported) is byte-identical in that group's git commit (same blob id, or deleted in both).
// Exit 0: allowed. Exit 1: refused, with the reasons and the time it becomes allowed. Reads EAS and git only.
//
//   node scripts/check-canary.mjs [--hours N]
// Tests only: CANARY_EAS (a command instead of `npx eas-cli`), CANARY_ROOT (another repo), CANARY_BASE (another build commit).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Build 18 (1.1.0, the App Store's): EAS built it from this commit. */
export const BUILD_18_COMMIT = process.env.CANARY_BASE ?? '8d4430d0a0';
const CANARY_RUNTIME = '1.1.1';
const BRANCH = 'production-aws';

const ROOT = process.env.CANARY_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function eas(args) {
  const [cmd, ...pre] = process.env.CANARY_EAS ? [process.env.CANARY_EAS] : ['npx', 'eas-cli'];
  const out = execFileSync(cmd, [...pre, ...args], { cwd: path.join(ROOT, 'app'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out);
}

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
const gitOk = (args) => {
  try {
    return git(args);
  } catch {
    return null;
  }
};

const pt = (d) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(d) + ' PT';

/** app/src files this checkout changed since `base`: tracked (staged or not) and untracked. */
function changedFiles(base) {
  const tracked = git(['diff', '--name-only', '--no-renames', base, '--', 'app/src']).split('\n');
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'app/src']).split('\n');
  return [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
}

/** The paths whose content differs between this working tree and `commit` (a file missing on both sides matches). */
function differing(files, commit) {
  return files.filter((f) => {
    const here = existsSync(path.join(ROOT, f)) ? git(['hash-object', '--', f]) : null;
    const there = gitOk(['rev-parse', '-q', '--verify', `${commit}:${f}`]);
    return here !== there;
  });
}

export function main(argv = process.argv.slice(2), now = Date.now()) {
  const i = argv.indexOf('--hours');
  const raw = i >= 0 ? argv[i + 1] : process.env.CANARY_HOURS;
  const hours = raw === undefined || raw === '' ? 2 : Number(raw); // an empty CANARY_HOURS is the default, never 0
  if (!(hours >= 0)) throw new Error(`the canary wait must be a number of hours, got ${raw}`);

  const list = eas(['update:list', '--branch', BRANCH, '--json', '--non-interactive', '--limit', '25']);
  const newest = (list.currentPage ?? []).find((g) => g.runtimeVersion === CANARY_RUNTIME);
  if (!newest) return refuse([`no ${CANARY_RUNTIME} group on ${BRANCH} yet: publish this change to ${CANARY_RUNTIME} first (from main)`]);
  if (newest.isRollBackToEmbedded) {
    return refuse([`the newest ${CANARY_RUNTIME} group (${newest.group}) is a roll-back to the build's own JS: no change is running there`]);
  }
  const [view] = eas(['update:view', newest.group, '--json']);
  const at = new Date(view.createdAt);
  const commit = view.gitCommitHash;
  console.log(`Canary: ${CANARY_RUNTIME} group ${newest.group}, published ${pt(at)}, commit ${String(commit).slice(0, 10)}`);

  const reasons = [];
  const allowedAt = new Date(at.getTime() + hours * 3600_000);
  if (now < allowedAt.getTime()) {
    reasons.push(`it is younger than ${hours} h: 1.1.0 is allowed from ${pt(allowedAt)} (${allowedAt.toISOString()})`);
  }

  const present = () => gitOk(['cat-file', '-e', `${commit}^{commit}`]) !== null;
  if (!present()) gitOk(['fetch', '-q', 'origin', commit]);
  if (!present()) {
    reasons.push(`its commit ${commit} isn't in this repo (not pushed?), so its files can't be compared`);
    return refuse(reasons);
  }
  const files = changedFiles(BUILD_18_COMMIT);
  const off = differing(files, commit);
  if (off.length) {
    reasons.push(`${off.length} of the ${files.length} app/src files this checkout changed since build 18 differ in that group:`);
    for (const f of off) reasons.push(`  ${f}`);
  } else {
    console.log(`Canary: all ${files.length} app/src files changed since build 18 are the same in that group.`);
  }
  return reasons.length ? refuse(reasons) : 0;
}

function refuse(reasons) {
  console.log(`Canary: not yet for 1.1.0:\n${reasons.map((r) => `  ${r}`).join('\n')}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.log(`Canary: couldn't check (${e.message.split('\n')[0]})`);
    process.exitCode = 1;
  }
}
