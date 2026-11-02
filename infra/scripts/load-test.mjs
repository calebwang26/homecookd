#!/usr/bin/env node
// The api's load test (SYSTEM-DESIGN.md: 50 RPS for 15 minutes on a realistic mix, p95 under 300 ms, p99 under 1 s, under 0.1% errors), then a burst that runs the
// database pool dry (AWS-MIGRATION.md, "A production gate: overload"): a full pool must answer 503 with retry-after, never a 500.
//   node infra/scripts/load-test.mjs <api url> [--rps 50] [--minutes 15] [--burst 300] [--cards 4]
// Staging only, on fake models (DISH_FAKE_AI=1): it makes a few made-up cards ("LOADTEST …") through the kid's page's own routes, then reads them as the kid's page
// and Mom's page poll, with a few edits. One machine's address, so it stays inside the per-address limits: cards are made once, and only reads and edits repeat.
// Times here include the trip from this machine. The load balancer's own p95 and p99 are what the targets mean, and it prints how to read them.

const args = process.argv.slice(2);
const base = (args[0] ?? '').replace(/\/+$/, '');
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? Number(args[i + 1]) : fallback;
};
const RPS = flag('rps', 50);
const MINUTES = flag('minutes', 15);
const BURST = flag('burst', 300);
const CARDS = Math.min(flag('cards', 4), 6); // the per-address limit is 6 cards in 10 minutes
if (!/^https?:\/\//.test(base) || /homecookd\.app|production/.test(base) || ![RPS, MINUTES, BURST, CARDS].every((n) => Number.isFinite(n) && n >= 0)) {
  console.error('usage: load-test.mjs <staging api url> [--rps 50] [--minutes 15] [--burst 300] [--cards 4]   (never production)');
  process.exit(2);
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
for (let i = 0; i < CARDS; i += 1) {
  const made = await call('/dish/cards', { dish: `LOADTEST poha ${i + 1}`, relation: 'mom', kidName: 'Load Test' });
  if (made.status !== 201) {
    console.error(`Making a card answered ${made.status} ${made.data?.code ?? ''}: is this staging, on fake models, with the address under its card limit?`);
    process.exit(1);
  }
  kids.push(made.data.kidToken);
  const asked = await call('/dish/cards/ask', { kidToken: made.data.kidToken, questions: [{ id: null, text: 'LOADTEST how much salt?' }] });
  const askUrl = asked.data?.card?.askUrl;
  if (asked.status === 200 && askUrl) moms.push(new URL(askUrl).searchParams.get('t'));
}
if (!moms.length) console.log("No card could ask Mom, so the mix has no Mom's page reads.");
report(`Setup: ${kids.length} cards, ${moms.length} asked`);

// ---- Steady: 50 a second, spread evenly, for 15 minutes. Polls are most of it, as LIVE-UPDATES.md expects.
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

console.log(`\nSteady: ${RPS} a second for ${MINUTES} minutes`);
const startedAt = new Date();
const inFlight = new Set();
const end = Date.now() + MINUTES * 60_000;
let next = Date.now();
while (Date.now() < end) {
  const p = one().finally(() => inFlight.delete(p));
  inFlight.add(p);
  next += 1000 / RPS;
  const wait = next - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (Date.now() % 60_000 < 1000 / RPS) console.log(`  ${new Date().toISOString().slice(11, 19)} ${inFlight.size} in flight`);
}
await Promise.all(inFlight);
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
process.exit(steady.total && steady.bad / steady.total < 0.001 && fiveHundreds === 0 ? 0 : 1);
