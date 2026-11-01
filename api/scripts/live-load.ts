// A small load test of GET /v1/live/jobs against a local api and a local throwaway Postgres. It wipes that database, so it refuses
// any host but this machine. The numbers are for comparing and for finding limits; they aren't AWS numbers.
//
//   TEST_DATABASE_URL=postgres://postgres:t@localhost:15461/t npx tsx scripts/live-load.ts --phones 500 --seconds 60
//
// --phones N      phones polling, two to a family (50)            --seconds N   how long (30)
// --every-ms N    ignore the server's pace: poll every N ms; 0 asks again the moment an answer comes (the server's pace)
// --active F      share of families with a job moving (0.1)       --jobs N      finished jobs per family (5)
// --write-ms N    how often each moving job is written (7000)
// --sync          no spreading: every phone polls at the same moment, the worst case
// --restart-at S  stop the api with SIGTERM S seconds in and start it again at once, as a one-task deploy would
// --pg-restart-at S --pg-container NAME   restart that local Postgres container S seconds in
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { hashToken } from "../src/auth.js";
import { migrate } from "../src/migrate.js";

const { values: arg } = parseArgs({
  options: {
    phones: { type: "string", default: "50" },
    seconds: { type: "string", default: "30" },
    "every-ms": { type: "string" },
    active: { type: "string", default: "0.1" },
    jobs: { type: "string", default: "5" },
    "write-ms": { type: "string", default: "7000" },
    sync: { type: "boolean", default: false },
    "restart-at": { type: "string" },
    "pg-restart-at": { type: "string" },
    "pg-container": { type: "string" },
    port: { type: "string" },
  },
});

/** A port nothing here is using, so runs side by side don't meet. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

const url = process.env.TEST_DATABASE_URL ?? "";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url || "http://none").hostname)) {
  throw new Error("TEST_DATABASE_URL must be a throwaway database on this machine: this script wipes it");
}

const phoneCount = Number(arg.phones);
const seconds = Number(arg.seconds);
const everyMs = arg["every-ms"] === undefined ? null : Number(arg["every-ms"]);
const port = arg.port ? Number(arg.port) : await freePort();
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const admin = new pg.Pool({ connectionString: url, max: 3 });
admin.on("error", () => {}); // a planned restart drops these

// ---- Seeding ----
await admin.query("drop schema public cascade; create schema public");
await migrate(admin);
type Phone = { token: string; family: number; version: string; failures: number };
const phones: Phone[] = [];
const families: { id: string; cook: string; moving: string | null }[] = [];
for (let f = 0; f < Math.ceil(phoneCount / 2); f += 1) {
  const { rows: [family] } = await admin.query("insert into families (name) values ($1) returning id", [`Load ${f}`]);
  const { rows: [cook] } = await admin.query("insert into people (family_id, name, role) values ($1, 'Cook', 'cook') returning id", [family.id]);
  await admin.query(
    `insert into jobs (family_id, cook_id, upload_key, source, stage, progress, title)
     select $1, $2, 'up-' || gen_random_uuid() || '/', 'phone', 'done', 1, 'A dish with an ordinary length of title' from generate_series(1, $3)`,
    [family.id, cook.id, Number(arg.jobs)],
  );
  const moving = f < Math.round(Number(arg.active) * Math.ceil(phoneCount / 2))
    ? (await admin.query(
        `insert into jobs (family_id, cook_id, upload_key, source, stage, progress, title)
         values ($1, $2, 'up-' || gen_random_uuid() || '/', 'phone', 'understanding', 0, 'A dish being made') returning id`,
        [family.id, cook.id],
      )).rows[0].id
    : null;
  families.push({ id: family.id, cook: cook.id, moving });
  for (let p = 0; p < 2 && phones.length < phoneCount; p += 1) {
    const token = randomBytes(32).toString("base64url");
    await admin.query("insert into sessions (token_hash, family_id, person_id, expires_at) values ($1, $2, $3, now() + interval '1 day')", [hashToken(token), family.id, cook.id]);
    phones.push({ token, family: f, version: "", failures: 0 });
  }
}
await admin.query("analyze");

// ---- The api, in its own process, so this script's own work doesn't count against it ----
const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
let api!: ChildProcess;
let cpuBefore = 0; // what earlier api processes used
function startApi(): void {
  api = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: apiDir,
    stdio: ["ignore", "ignore", "inherit"],
    env: { PATH: process.env.PATH, DATABASE_URL: url, PORT: String(port), LOG_LEVEL: "warn", LIVE_PERSON_PER_MIN: "1000000" },
  });
}
const cpuSeconds = (): number => {
  try {
    const parts = execFileSync("ps", ["-o", "time=", "-p", String(api.pid)]).toString().trim().split(":").map(Number);
    return parts.reduce((total, part) => total * 60 + part, 0);
  } catch {
    return 0;
  }
};
const rssMb = (): number => {
  try {
    return Number(execFileSync("ps", ["-o", "rss=", "-p", String(api.pid)]).toString().trim()) / 1024;
  } catch {
    return 0;
  }
};
async function waitForApi(): Promise<number> {
  const started = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) return Date.now() - started;
    } catch { /* not up yet */ }
    if (Date.now() - started > 30_000) throw new Error("The api didn't start");
    await sleep(20);
  }
}
startApi();
await waitForApi();

// ---- The run ----
const latencies: number[] = [];
const statuses: Record<string, number> = {};
const seenAfterMs: number[] = [];
const written = new Map<string, number>(); // "<job id>:<progress>" -> when the write committed
let stopping = false;
let startedAt = 0;
let afterStop = { firstOkMs: null as number | null };
let stopAt: number | null = null;

// Five seconds at a time, because a whole-run percentile hides a cold start or a recovery.
type Bucket = { polls: number; shed: number; network: number; latencies: number[] };
const buckets: Bucket[] = [];
const bucketFor = (): Bucket => {
  const i = Math.floor((Date.now() - startedAt) / 5_000);
  return (buckets[i] ??= { polls: 0, shed: 0, network: 0, latencies: [] });
};

async function runPhone(phone: Phone): Promise<void> {
  if (!arg.sync) await sleep(Math.random() * (everyMs ?? 5_000));
  while (!stopping) {
    const asked = performance.now();
    let waitMs: number;
    try {
      const res = await fetch(`${base}/v1/live/jobs?since=${phone.version}`, {
        headers: { authorization: `Bearer ${phone.token}` },
        signal: AbortSignal.timeout(8_000),
      });
      const took = performance.now() - asked;
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      const bucket = bucketFor();
      bucket.polls += 1;
      if (res.status === 503) bucket.shed += 1;
      if (res.status === 200) {
        latencies.push(took);
        bucket.latencies.push(took);
        if (stopAt && afterStop.firstOkMs === null) afterStop.firstOkMs = Date.now() - stopAt;
        const body = (await res.json()) as { changed: boolean; version: string; pollAfterMs: number; data?: { _id: string; progress: number }[] };
        if (body.changed) {
          phone.version = body.version;
          for (const job of body.data ?? []) {
            const when = written.get(`${job._id}:${job.progress}`);
            if (when) seenAfterMs.push(Date.now() - when);
          }
        }
        phone.failures = 0;
        waitMs = everyMs ?? body.pollAfterMs;
      } else {
        await res.arrayBuffer();
        phone.failures += 1;
        waitMs = Number(res.headers.get("retry-after") ?? 5) * 1000;
      }
    } catch {
      statuses.network = (statuses.network ?? 0) + 1;
      bucketFor().network += 1;
      phone.failures += 1;
      waitMs = Math.min(60_000, 5_000 * 2 ** (phone.failures - 1)) * (0.5 + Math.random() / 2);
    }
    if (waitMs > 0) await sleep(waitMs);
  }
}

const stat = async () => (await admin.query(
  `select xact_commit::bigint as commits, tup_returned::bigint as returned, tup_fetched::bigint as fetched, blks_read::bigint as disk, blks_hit::bigint as cache
     from pg_stat_database where datname = current_database()`,
)).rows[0];

let peakBackends = 0;
let peakActive = 0;
let pgAway = false;
const sampler = setInterval(() => {
  if (pgAway) return;
  admin.query(
    `select count(*)::int as all, count(*) filter (where state = 'active')::int - 1 as active
       from pg_stat_activity where datname = current_database() and backend_type = 'client backend'`,
  ).then(({ rows }) => {
    peakBackends = Math.max(peakBackends, rows[0].all - 1); // not counting this script's own
    peakActive = Math.max(peakActive, rows[0].active);
  }).catch(() => {});
}, 250);

// One write per moving job on this beat. The worker's fastest is one every 2 s (TICK_S in pipeline/queue_worker.py), but real stages
// last far longer. A beat slower than the polls is what makes "seen after" mean anything: a phone must see each write.
let tick = 0;
const writer = setInterval(() => {
  if (pgAway) return;
  tick += 1;
  const progress = Math.round((tick * 0.001 + 0.2) * 1000) / 1000;
  for (const family of families) {
    if (!family.moving) continue;
    const id = family.moving;
    admin.query("update jobs set progress = $2, updated_at = now() where id = $1", [id, progress])
      .then(() => written.set(`${id}:${progress}`, Date.now()))
      .catch(() => {});
  }
}, Number(arg["write-ms"]));

const before = await stat();
const cpuAtStart = cpuSeconds();
startedAt = Date.now();
const running = phones.map(runPhone);

if (arg["restart-at"]) {
  await sleep(Number(arg["restart-at"]) * 1000);
  cpuBefore += cpuSeconds();
  const stopAsked = Date.now();
  const gone = new Promise((resolve) => api.once("exit", resolve));
  api.kill("SIGTERM");
  await gone;
  console.log(`api stopped gracefully in ${Date.now() - stopAsked} ms`);
  stopAt = Date.now();
  startApi();
  console.log(`new api answered /health after ${await waitForApi()} ms`);
}
if (arg["pg-restart-at"] && arg["pg-container"]) {
  await sleep(Number(arg["pg-restart-at"]) * 1000);
  pgAway = true;
  stopAt = Date.now();
  execFileSync("docker", ["restart", "-t", "1", arg["pg-container"]]);
  console.log(`postgres restarted in ${Date.now() - stopAt} ms`);
  pgAway = false;
}

await sleep(Math.max(0, startedAt + seconds * 1000 - Date.now()));
const elapsed = (Date.now() - startedAt) / 1000;
const cpuUsed = cpuBefore + cpuSeconds() - cpuAtStart;
const after = await stat();
const memory = rssMb();
stopping = true;
clearInterval(writer);
clearInterval(sampler);
await Promise.all(running);

// ---- The answer ----
const percentile = (list: number[], p: number) => {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 10) / 10;
};
const answered = Object.values(statuses).reduce((a, b) => a + b, 0);
const warm = buckets.slice(2).flatMap((bucket) => bucket?.latencies ?? []); // after the first 10 s
const { rows: plan } = await admin.query(
  `explain (analyze, buffers, costs off, timing off)
   select id, upload_key, source, stage, progress, error, recipe_id, title, created_at, updated_at, cancelled_at
     from jobs where family_id = $1 order by created_at desc, id desc limit 20`,
  [families[0].id],
);
console.log(JSON.stringify({
  phones: phoneCount,
  seconds: Math.round(elapsed),
  everyMs,
  sync: arg.sync,
  pollsPerSecond: Math.round((answered / elapsed) * 10) / 10,
  statuses,
  latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), p99: percentile(latencies, 99), max: percentile(latencies, 100) },
  afterFirst10sMs: { p50: percentile(warm, 50), p95: percentile(warm, 95), p99: percentile(warm, 99) },
  writeSeenAfterMs: { p50: percentile(seenAfterMs, 50), p95: percentile(seenAfterMs, 95), max: percentile(seenAfterMs, 100) },
  every5s: Array.from(buckets, (bucket) => (bucket
    ? `${bucket.polls} polls, ${bucket.shed} shed, ${bucket.network} net, p95 ${percentile(bucket.latencies, 95)}`
    : "none")),
  postgres: {
    commitsPerSecond: Math.round((after.commits - before.commits) / elapsed),
    rowsFetchedPerSecond: Math.round((after.fetched - before.fetched) / elapsed),
    diskBlocksRead: Number(after.disk - before.disk),
    peakConnections: peakBackends,
    peakActive,
  },
  api: {
    cpuPercentOfOneCore: Math.round((cpuUsed / elapsed) * 1000) / 10,
    cpuMsPerPoll: Math.round((cpuUsed / answered) * 10000) / 10,
    rssMb: Math.round(memory),
    firstGoodPollAfterStopMs: afterStop.firstOkMs,
  },
}, null, 1));
console.log(plan.map((row) => row["QUERY PLAN"]).join("\n"));
api!.kill("SIGTERM");
await admin.end();
process.exit(0);
