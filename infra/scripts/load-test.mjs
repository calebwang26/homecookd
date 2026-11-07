#!/usr/bin/env node
// The api's load test (SYSTEM-DESIGN.md: 50 RPS for 15 minutes on a realistic mix, p95 under 300 ms, p99 under 1 s, under 0.1% errors), then a burst that runs the
// database pool dry (AWS-MIGRATION.md, "A production gate: overload"): a full pool must answer 503 with retry-after, never a 500.
//   node infra/scripts/load-test.mjs <api url> [--rps 50] [--ramp 2] [--minutes 15] [--burst 300] [--cards 4]
// Staging only, on fake models (DISH_FAKE_AI=1): it makes a few made-up cards ("LOADTEST …") through the kid's page's own routes, then reads them as the kid's page
// and Mom's page poll, with a few edits. One machine's address, so it stays inside the per-address limits: cards are made once, and only reads and edits repeat.
// Times here include the trip from this machine. The load balancer's own p95 and p99 are what the targets mean, and it prints how to read them.
//
// Production (CUTOVER.md step 6's gate):
//   LOAD_TEST_PRODUCTION=yes node infra/scripts/load-test.mjs https://api.homecookd.app --production --cards 2 [--rps 200] [--ramp 2] [--minutes 12] [--burst 1500]
// The ramp climbs from 0 to --rps over --ramp minutes and is reported but not scored: real traffic grows, it doesn't jump from 0 (Caleb, Nov 7, after the
// first production run's misses all came in its first 15 s, while 2 tasks met 200 a second cold; infra/README.md, "Production before launch", step 7).
// - Both keys, HTTPS, and only that address (load-test-args.mjs). It prints its plan and waits 10 s, so Ctrl-C stops it before anything is made.
// - Production ignores DISH_FAKE_AI, so making a card is one real Claude guess (Haiku, about $0.001). Only the setup makes cards, and --cards must be said:
//   nothing after it reaches a model. Mom's page is read without `lang`, because a peek with one translates her page on Opus (up to about $0.30).
// - The load balancer sees this machine's own address, so the per-address limits are real: 6 cards in 10 minutes and 30 a day, 30 asks in 10 minutes.
//   The steady mix and the burst have no per-address limit, so the only 429 to expect is making cards again too soon.
// - The cards stay: no route or task deletes an anonymous card. They're drafts nobody else can see (no account, no family, never sent), and it prints each
//   one's kid_token_hash, which is all a deletion needs (infra/README.md, "Production before launch", step 7).
import { createHash } from 'node:crypto';
import { settings } from './load-test-args.mjs';

const s = settings(process.argv.slice(2), process.env);
if (s.error) {
  console.error(s.error);
  process.exit(2);
}
const { base, production } = s;
const RPS = s.rps;
const MINUTES = s.minutes;
const RAMP = s.ramp;
const BURST = s.burst;
const CARDS = s.cards;

if (production) {
  console.log(`PRODUCTION: ${base}. ${CARDS} made-up cards (${CARDS} Claude guesses, about $${(CARDS * 0.001).toFixed(3)}), then a ${RAMP}-minute climb to ${RPS} a second and ${MINUTES} minutes there, ` +
    `then ${BURST} at once. The cards stay until they're deleted. Starting in 10 s; Ctrl-C stops it.`);
  await new Promise((r) => setTimeout(r, 10_000));
}

const results = new Map(); // route -> { ms: number[], status: Map<string, number> }
const record = (route, ms, status) => {
  const r = results.get(route) ?? { ms: [], status: new Map() };
  r.ms.push(ms);
  r.status.set(status, (r.status.get(status) ?? 0) + 1);
  results.set(route, r);
};

async function call(route, body) {
  const started = performance.now();
  try {
    const res = await fetch(`${base}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const status = res.status === 503 ? `503${res.headers.get('retry-after') ? ' retry-after' : ' no retry-after'}` : String(res.status);
    record(route, performance.now() - started, status);
    return { status: res.status, data: text.startsWith('{') ? JSON.parse(text) : null };
  } catch (error) {
    record(route, performance.now() - started, error.name === 'TimeoutError' ? 'timeout' : 'network');
    return { status: 0, data: null };
  }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
function report(title) {
  console.log(`\n${title}`);
  let total = 0;
  let bad = 0;
  for (const [route, r] of [...results].sort()) {
    const ms = [...r.ms].sort((a, b) => a - b);
    total += ms.length;
    for (const [s, n] of r.status) if (!/^2/.test(s)) bad += n;
    const statuses = [...r.status].map(([s, n]) => `${s}×${n}`).join(' ');
    console.log(`  ${route.padEnd(18)} ${String(ms.length).padStart(6)} req  p50 ${pct(ms, 50).toFixed(0)} ms  p95 ${pct(ms, 95).toFixed(0)} ms  p99 ${pct(ms, 99).toFixed(0)} ms  ${statuses}`);
  }
  console.log(`  ${total} requests, ${bad} not 2xx (${total ? ((100 * bad) / total).toFixed(3) : 0}%)`);
  results.clear();
  return { total, bad };
}

// ---- Setup: the kid makes cards and asks Mom, as the site does.
const kids = [];
const moms = [];
/** On production, what deleting this run's cards needs: the database keeps only each kid token's sha256, and a hash opens nothing. */
function leftBehind() {
  if (!production || !kids.length) return;
  console.log(`\nThese ${kids.length} made-up cards stay on production until they're deleted (infra/README.md, "Production before launch", step 7). kid_token_hash:`);
  for (const t of kids) console.log(`  ${createHash('sha256').update(t).digest('hex')}`);
}
for (let i = 0; i < CARDS; i += 1) {
  const made = await call('/dish/cards', { dish: `LOADTEST poha ${i + 1}`, relation: 'mom', kidName: 'Load Test' });
  if (made.status !== 201) {
    const where = production ? "production, with its Claude key set and the day's dish budget left," : 'staging, on fake models,';
    console.error(`Making a card answered ${made.status} ${made.data?.error ?? ''}: is this ${where} with the address under its card limit${production ? ' (6 in 10 minutes, 30 a day)' : ''}?`);
    leftBehind();
    process.exit(1);
  }
  kids.push(made.data.kidToken);
  const asked = await call('/dish/cards/ask', { kidToken: made.data.kidToken, questions: [{ id: null, text: 'LOADTEST how much salt?' }] });
  const askUrl = asked.data?.card?.askUrl;
  if (asked.status === 200 && askUrl) moms.push(new URL(askUrl).searchParams.get('t'));
}
if (!moms.length) console.log("No card could ask Mom, so the mix has no Mom's page reads.");
report(`Setup: ${kids.length} cards, ${moms.length} asked`);
leftBehind();

// ---- Steady: 50 a second, spread evenly, for 15 minutes. Polls are most of it, as LIVE-UPDATES.md expects.
// None of it reaches a model, on production too: a card read starts no merge while nobody has answered, Mom's page has no `lang`, and an edit is a row write.
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const MIX = [
  [45, () => call('/dish/cards/get', { kidToken: pick(kids) })],
  [25, () => (moms.length ? call('/dish/ask/peek', { askToken: pick(moms) }) : call('/dish/cards/get', { kidToken: pick(kids) }))],
  [15, () => call('/ready')],
  [10, () => call('/health')],
  [5, () => call('/dish/cards/update', { kidToken: pick(kids), message: `LOADTEST note ${Date.now() % 1000}` })],
];
const weights = MIX.reduce((n, [w]) => n + w, 0);
const one = () => {
  let r = Math.random() * weights;
  for (const [w, run] of MIX) if ((r -= w) < 0) return run();
  return MIX[0][1]();
};

const inFlight = new Set();
/** Sends at `rate(elapsed ms)` a second until `ms` have passed, then waits for what's in flight. */
async function drive(ms, rate) {
  const started = Date.now();
  let next = started;
  while (Date.now() - started < ms) {
    const p = one().finally(() => inFlight.delete(p));
    inFlight.add(p);
    const now = rate(Date.now() - started);
    next += 1000 / now;
    const wait = next - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (Date.now() % 60_000 < 1000 / now) console.log(`  ${new Date().toISOString().slice(11, 19)} ${Math.round(now)} a second, ${inFlight.size} in flight`);
  }
  await Promise.all(inFlight);
}

if (RAMP > 0) {
  console.log(`\nRamp: 0 to ${RPS} a second over ${RAMP} minutes (reported, not scored)`);
  // From a twentieth of the rate, so the first gap isn't seconds long.
  await drive(RAMP * 60_000, (t) => RPS * Math.max(0.05, Math.min(1, t / (RAMP * 60_000))));
  report('Ramp (not scored)');
}
console.log(`\nSteady: ${RPS} a second for ${MINUTES} minutes`);
const startedAt = new Date();
await drive(MINUTES * 60_000, () => RPS);
const steady = report('Steady');
const endedAt = new Date();

// ---- Burst: every request at once, each a database read, against a pool of 10 per task.
await call('/ready');
results.clear();
await Promise.all(Array.from({ length: BURST }, (_, i) => (i % 2 ? call('/ready') : call('/dish/cards/get', { kidToken: pick(kids) }))));
const burstStatuses = new Map();
for (const r of results.values()) for (const [s, n] of r.status) burstStatuses.set(s, (burstStatuses.get(s) ?? 0) + n);
report(`Burst: ${BURST} at once`);
const fiveHundreds = [...burstStatuses].filter(([s]) => /^5/.test(s) && !s.startsWith('503 retry-after')).reduce((n, [, c]) => n + c, 0);

console.log(`\nSteady window: ${startedAt.toISOString()} to ${endedAt.toISOString()}`);
console.log(`Steady errors: ${steady.total ? ((100 * steady.bad) / steady.total).toFixed(3) : 0}% (target under 0.1%)`);
console.log(`Burst: ${fiveHundreds} answers that were a 5xx other than a 503 with retry-after (target 0)`);
console.log('The load balancer\'s own p95/p99 for the steady window: aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB --metric-name TargetResponseTime ' +
  `--dimensions Name=LoadBalancer,Value=<app/…> --start-time ${startedAt.toISOString()} --end-time ${endedAt.toISOString()} --period 60 --extended-statistics p95 p99`);
if (production) {
  console.log('Autoscaling should come back to 2 tasks about 25 minutes after the load: aws ecs describe-services --profile homecookd --region us-west-2 ' +
    "--cluster homecookd-production --services api --query 'services[0].[desiredCount,runningCount]'");
  leftBehind();
}
process.exit(steady.total && steady.bad / steady.total < 0.001 && fiveHundreds === 0 ? 0 : 1);
