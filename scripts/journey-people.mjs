// The iOS journeys' test people on AWS staging (docs/build/IOS-JOURNEYS.md, "Test people"). Plain fetch, no packages, so
// the sweep runs without npm ci. TEST_SIGNIN_KEY comes from the environment and is never printed.
//   node scripts/journey-people.mjs setup <state>   a cook ("Asha (test)") and her family link; a kid ("Leo (test)") who
//                                                    joined by it. Masks, then writes FAMILY_LINK and KID_KEY to $GITHUB_ENV
//   node scripts/journey-people.mjs delete <state>  deletes both (if: always()); a missing state file is nothing to do
//   node scripts/journey-people.mjs sweep           deletes the people of any run in the last day whose own delete didn't
//                                                    finish (a runner that died), same day; needs GITHUB_TOKEN with actions: read
// Test ids are j<run id>-<attempt>-cook|kid, so a run's people can be found again from its id alone. <state> holds them
// from before the first sign-in; keep it under $RUNNER_TEMP, never /tmp (macOS clears it).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const API = process.env.EXPO_PUBLIC_AWS_URL || 'https://d2zh46br3dalyf.cloudfront.net';
export const PEOPLE = { cook: { name: 'Asha (test)', role: 'cook' }, kid: { name: 'Leo (test)', role: 'learner' } };
export const SEED_STEP = 'Seed the journey test people';
export const DELETE_STEP = 'Delete the journey test people';

export const idsFor = (runId, attempt) => ({ cook: `j${runId}-${attempt}-cook`, kid: `j${runId}-${attempt}-kid` });

/** The app's own form of a family link (https://homecookd.app/i?t=X → homecookd://i?t=X): a Release build without signing has no universal links. */
export function appLink(url) {
  const t = new URL(url).searchParams.get('t');
  if (!t) throw new Error('the family link has no t=');
  return `homecookd://i?t=${t}`;
}

async function call(path, { body = {}, headers = {} } = {}, f = fetch) {
  const res = await f(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON: the status says enough
  }
  return { status: res.status, json };
}

/** A key that's set but refused fails loudly: a rotated key must never look like a fork's skip. */
export async function signIn(key, testId, who, extra = {}, f = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const send = () => call('/v1/test/sign-in', { headers: { 'x-test-signin-key': key }, body: { test_id: testId, ...PEOPLE[who], ...extra } }, f);
  let r = await send();
  if (r.status === 429) {
    await wait(61_000); // staging allows 10 test sign-ins a minute from one address
    r = await send();
  }
  if (r.status === 401 || r.status === 404) throw new Error(`TEST_SIGNIN_KEY was refused by staging (${r.status}): rotated, or staging lost it. Set the repo secret again from .env.`);
  if (r.status !== 200 || !r.json?.device_key) throw new Error(`test sign-in for ${who} answered ${r.status}`);
  return r.json;
}

/** ::add-mask:: only means something in Actions; anywhere else it would print the very value. */
const maskInActions = (line) => process.env.GITHUB_ACTIONS === 'true' && console.log(line);

export async function setup(key, state, ids, f = fetch, mask = maskInActions) {
  writeFileSync(state, JSON.stringify(ids)); // before anything exists, so delete can always find them
  const cook = await signIn(key, ids.cook, 'cook', {}, f);
  mask(`::add-mask::${cook.device_key}`);
  const link = await call('/join-links', { headers: { 'x-device-key': cook.device_key, 'x-profile-id': cook.profile_id } }, f);
  if (link.status !== 200 || !link.json?.url) throw new Error(`join link answered ${link.status}`);
  const familyLink = appLink(link.json.url);
  mask(`::add-mask::${familyLink.split('t=')[1]}`);
  const kid = await signIn(key, ids.kid, 'kid', { join_token: familyLink.split('t=')[1] }, f);
  mask(`::add-mask::${kid.device_key}`);
  if (kid.family_name !== cook.family_name) throw new Error('the kid did not join the cook’s family');
  return { familyLink, kidKey: kid.device_key, familyName: cook.family_name };
}

/** Signs each one in again and deletes the account. Never throws: one that's already gone is fine. */
export async function remove(key, ids, f = fetch, log = console.log) {
  for (const who of ['kid', 'cook']) {
    if (!ids[who]) continue;
    try {
      const p = await signIn(key, ids[who], who, {}, f);
      const s = await call('/v1/sessions/start', { body: { deviceKey: p.device_key, profileId: p.profile_id } }, f);
      if (s.status !== 200 || !s.json?.sessionToken) throw new Error(`session answered ${s.status}`);
      const d = await call('/v1/account/delete', { headers: { authorization: `Bearer ${s.json.sessionToken}` } }, f);
      if (d.status !== 200) throw new Error(`delete answered ${d.status}`);
      log(`deleted ${PEOPLE[who].name}`);
    } catch (e) {
      log(`::warning title=Journey test people::could not delete ${PEOPLE[who].name}: ${e.message}`);
    }
  }
}

/**
 * Runs whose test people may still exist: in the last day, finished, with the seed step started and the delete step not
 * a success (a runner that died, or a delete that failed). `jobs` is each attempt's jobs, as the API lists them.
 */
export function leftovers(attempts) {
  const out = [];
  for (const { runId, attempt, jobs } of attempts) {
    const steps = jobs.flatMap((j) => j.steps ?? []);
    const seeded = steps.find((s) => s.name === SEED_STEP);
    const deleted = steps.find((s) => s.name === DELETE_STEP);
    // started counts: a runner that died mid-seed may have made one of them
    const started = seeded && seeded.status !== 'queued' && seeded.conclusion !== 'skipped';
    if (started && deleted?.conclusion !== 'success') out.push(idsFor(runId, attempt));
  }
  return out;
}

async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub ${path.split('?')[0]} answered ${res.status}`);
  return res.json();
}

async function sweep(key) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const runs = (await gh(`/actions/workflows/ios-journeys.yml/runs?status=completed&created=%3E%3D${since}&per_page=100`)).workflow_runs;
  const attempts = [];
  for (const run of runs) {
    for (let a = 1; a <= run.run_attempt; a++) attempts.push({ runId: run.id, attempt: a, jobs: (await gh(`/actions/runs/${run.id}/attempts/${a}/jobs`)).jobs });
  }
  const left = leftovers(attempts);
  console.log(`${runs.length} finished runs in the last day; ${left.length} left test people behind`);
  for (const ids of left) await remove(key, ids);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [step, state] = process.argv.slice(2);
  const key = process.env.TEST_SIGNIN_KEY?.trim();
  if (!['setup', 'delete', 'sweep'].includes(step) || (step !== 'sweep' && !state)) throw new Error('usage: journey-people.mjs setup|delete <state> | sweep');
  if (!key) {
    console.log('No TEST_SIGNIN_KEY (a fork’s PR gets no secrets): nothing to do.');
    process.exit(0);
  }
  if (step === 'setup') {
    const out = await setup(key, state, idsFor(process.env.GITHUB_RUN_ID ?? `local${Date.now()}`, process.env.GITHUB_RUN_ATTEMPT ?? '1'));
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `FAMILY_LINK=${out.familyLink}\nKID_KEY=${out.kidKey}\n`);
    console.log(`Seeded: a cook and a kid who joined her family by its link (${out.familyName}).`);
  } else if (step === 'delete') {
    if (existsSync(state)) await remove(key, JSON.parse(readFileSync(state, 'utf8')));
    else console.log('No test people were made.');
  } else {
    await sweep(key);
  }
}
