#!/usr/bin/env node
// Is merging aws-migration into main safe? "Safe" means the merge changes nothing live until someone flips a switch (docs/build/CUTOVER.md).
// CI runs this on PRs into aws-migration and on the PR into main (.github/workflows/ci.yml, job merge-safe).
//
//   node scripts/check-merge-safe.mjs                     trial merge, the reviewed list, the workflows
//   node scripts/check-merge-safe.mjs --strict-conflicts  a conflict with main fails (the PR into main) instead of warning
//   node scripts/check-merge-safe.mjs --bundle web/out    a build made with no NEXT_PUBLIC_* set still is today's site
//   node scripts/check-merge-safe.mjs --fingerprints      prints the list with today's fingerprints, to paste after reviewing a change
//   flags: --base <ref> (default origin/main), --head <ref> (default HEAD)
//
// It reads text. A change it can't see: docs/build/CUTOVER.md, "What the merge check can't catch".
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = path.join(ROOT, 'scripts', 'merge-safe-list.json');

// Paths that deploy on their own after a merge, or run on the laptop or in phones.
const WATCHED = ['web/', 'pipeline/', 'convex/', 'supabase/', 'app/', 'voice/', 'cloud/', 'glasses/', 'edible-glasses/'];
const WATCHED_FILES = ['package.json', 'package-lock.json', 'convex.json'];
// Under those, but nothing live builds or imports them: tests, and queue mode, which the worker's own test proves stays out of worker.py.
const NOT_LIVE = [/^web\/scripts\/qa\//, /^convex\/.*\.test\.ts$/, /^pipeline\/test_[^/]+\.py$/, /^pipeline\/queue_[^/]+\.py$/, /^pipeline\/requirements-queue\.txt$/];

// In a build with the switches off. `absent` holds only what the new flow or a new address would add.
const BUNDLE = {
  present: ['grand-dragon-649.convex.site', '/dish/files?kind=', '/dish/ask/answer?', 'X-Dish-Token'],
  absent: ['/dish/files/confirm', '/dish/ask/answer/upload', 'uploadHeaders', 'amazonaws.com', 'cloudfront.net', 'api.homecookd.app', 'media.homecookd.app'],
};

// What a workflow may be started by, and text that deploys something live if a workflow ever runs it.
const SAFE_EVENTS = new Set(['pull_request', 'workflow_dispatch', 'workflow_call', 'push']);
const LIVE_COMMANDS = [/terraform\s+apply/, /convex\s+deploy/, /eas(-cli)?\s+(update|build|submit)/, /vercel\s+(deploy|--prod)/, /gcloud\s+run\s+deploy/, /deploy-signer\.sh/, /voice\/deploy\.sh/, /environment:\s*production/];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const BASE = value('base', 'origin/main');
const HEAD = value('head', 'HEAD');

const failures = [];
const warnings = [];
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** What this branch itself changes in a file: the added and removed lines, without line numbers, so main moving doesn't change it. */
function fingerprint(file) {
  const lines = git('diff', '-U0', '--no-color', '--no-renames', `${BASE}...${HEAD}`, '--', file)
    .split('\n')
    .filter((l) => /^[-+]/.test(l) && !/^(\+\+\+ |--- )/.test(l));
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12);
}

const changedFiles = () => git('diff', '--name-only', '--no-renames', `${BASE}...${HEAD}`).split('\n').filter(Boolean);
const watched = (f) => (WATCHED.some((p) => f.startsWith(p)) || WATCHED_FILES.includes(f)) && !NOT_LIVE.some((r) => r.test(f));

function trialMerge() {
  const run = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', BASE, HEAD], { cwd: ROOT, encoding: 'utf8' });
  if (run.status === 0) return console.log(`Trial merge with ${BASE}: clean`);
  if (run.status !== 1) return failures.push(`The trial merge didn't run: ${run.stderr.trim()}`);
  const files = run.stdout.split('\n').slice(1).filter(Boolean);
  const message = `Trial merge with ${BASE}: ${files.length} conflict(s): ${files.join(', ')}`;
  (flag('strict-conflicts') ? failures : warnings).push(message);
}

function reviewedList() {
  const { files: list } = JSON.parse(readFileSync(LIST, 'utf8'));
  const changed = changedFiles().filter(watched);
  for (const file of changed) {
    const entry = list[file];
    if (!entry) failures.push(`${file}: changed compared to main, and not on scripts/merge-safe-list.json. Put it behind a switch, then list it with the switch's name.`);
    else if (!entry.switch) failures.push(`${file}: on the list with no switch named.`);
    else if (entry.fingerprint !== fingerprint(file)) failures.push(`${file}: changed since its review (${entry.switch}). Check it still does nothing with the switch off, then update its fingerprint (--fingerprints).`);
  }
  for (const file of Object.keys(list)) if (!changed.includes(file)) warnings.push(`${file}: on the list, but no longer changed compared to main. Take it off.`);
  console.log(`Reviewed list: ${changed.length} live file(s) changed compared to main, ${Object.keys(list).length} listed`);
}

/** The events under a workflow's `on:`, each with its own lines. Every workflow here writes `on:` as a block. */
function triggers(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^"?on"?:/.test(l));
  if (start < 0 || lines[start].replace(/#.*/, '').trim() !== 'on:') return null;
  const events = {};
  let event = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    const top = line.match(/^ {2}([a-z_]+):/);
    if (top) events[(event = top[1])] = [];
    else if (event) events[event].push(line);
  }
  return events;
}

function workflows() {
  const dir = path.join(ROOT, '.github', 'workflows');
  const names = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  for (const name of names) {
    const yaml = readFileSync(path.join(dir, name), 'utf8');
    const events = triggers(yaml);
    if (!events) {
      failures.push(`${name}: can't read its "on:" block, so nothing says it's safe on main.`);
      continue;
    }
    for (const [event, lines] of Object.entries(events)) {
      if (!SAFE_EVENTS.has(event)) failures.push(`${name}: starts on "${event}", which runs by itself after a merge.`);
      if (event !== 'push') continue;
      const text = lines.join('\n');
      if (!/branches:/.test(text)) failures.push(`${name}: starts on every push, so it would run on main.`);
      else if (/\bmain\b|\bmaster\b/.test(text)) failures.push(`${name}: starts on a push to main.`);
    }
    for (const command of LIVE_COMMANDS) if (command.test(yaml)) failures.push(`${name}: contains ${command}, which deploys something live.`);
  }
  console.log(`Workflows: ${names.length} read`);
}

function scripts(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...scripts(full));
    else if (/\.(js|html)$/.test(name)) out.push(full);
  }
  return out;
}

function bundle(out) {
  const dir = path.resolve(ROOT, out);
  if (!existsSync(path.join(dir, '_next', 'static'))) return failures.push(`--bundle: no build at ${dir}`);
  const code = [...scripts(path.join(dir, '_next', 'static')), ...readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, f))]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  for (const text of BUNDLE.present) if (!code.includes(text)) failures.push(`The built site no longer has "${text}": with the switches off it must still send raw files to Convex.`);
  for (const text of BUNDLE.absent) if (code.includes(text)) failures.push(`The built site has "${text}": a build with the switches off must hold none of the new flow or new addresses.`);
  console.log(`Built site: ${BUNDLE.present.length} of today's strings looked for, ${BUNDLE.absent.length} of the new flow's`);
}

function printFingerprints() {
  const { files: list, ...rest } = JSON.parse(readFileSync(LIST, 'utf8'));
  const changed = changedFiles().filter(watched);
  const files = Object.fromEntries(changed.map((f) => [f, { switch: list[f]?.switch ?? '', why: list[f]?.why ?? '', fingerprint: fingerprint(f) }]));
  console.log(JSON.stringify({ ...rest, files }, null, 2));
}

if (flag('fingerprints')) {
  printFingerprints();
  process.exit(0);
}
if (flag('bundle')) bundle(value('bundle'));
else {
  trialMerge();
  reviewedList();
  workflows();
}
for (const w of warnings) console.log(`warning: ${w}`);
for (const f of failures) console.log(`FAILED: ${f}`);
if (process.env.GITHUB_ACTIONS) {
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const f of failures) console.log(`::error::${f}`);
}
console.log(failures.length ? `\nNot safe to merge: ${failures.length} problem(s).` : '\nNo problem found. What that doesn\'t prove: docs/build/CUTOVER.md.');
process.exit(failures.length ? 1 : 0);
