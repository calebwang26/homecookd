// What the jobs, recipes and recordings tests share: real Postgres, the real routes through app.inject, and a fake S3 for each bucket. `families`, `people` and `recipes` are written straight to
// the tables, as the one-way sync will, and `advance` moves stored times back, since Postgres's clock can't be faked. Made-up data only.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { useObjectStore, useUploadStore } from "../src/storage.js";
import { fakeStore, type FakeStore } from "./dishHelpers.js";
import { family, freshDatabase, hasDatabase, person, session } from "./helpers.js";

export { hasDatabase, family, person, session, db, freshDatabase };

export type Who = { token: string; personId: string; familyId: string };
export type Res = { status: number; data: any; headers: Record<string, unknown>; body: string };

export const MEDIA = "https://media.test";

export function setUp(): { app: FastifyInstance; videos: FakeStore; privateFiles: FakeStore } {
  process.env.RATE_LIMIT_SALT = "test-salt-not-a-secret";
  process.env.MEDIA_BASE_URL = MEDIA;
  delete process.env.RECIPE_WRITES;
  const videos = fakeStore();
  const privateFiles = fakeStore();
  useUploadStore(videos);
  useObjectStore(privateFiles);
  return { app: buildApp({ logger: false }), videos, privateFiles };
}

export async function who(familyId: string, role: "cook" | "kid" = "cook"): Promise<Who> {
  const personId = await person(familyId, role);
  return { token: await session(familyId, personId), personId, familyId };
}

export async function call(app: FastifyInstance, by: Who | null, method: "GET" | "POST", url: string, payload?: object, headers: Record<string, string> = {}): Promise<Res> {
  const res = await app.inject({
    method,
    url,
    headers: { ...(by ? { authorization: `Bearer ${by.token}` } : {}), ...headers },
    ...(payload ? { payload } : {}),
  });
  let data: any = null;
  try {
    data = res.json();
  } catch {
    // no JSON: the test reads `status`
  }
  return { status: res.statusCode, data, headers: res.headers as Record<string, unknown>, body: res.body };
}

const key = () => randomBytes(12).toString("base64url");

/** A cook asks for links. Clears the limits: tests make many uploads, and jobsUploads.test.ts tests the limit itself. */
export async function askLinks(app: FastifyInstance, cook: Who, count = 2, idempotencyKey = key()): Promise<{ uploadId: string; keys: string[]; res: Res }> {
  await clearLimits();
  const videos = Array.from({ length: count }, () => ({ contentType: "video/quicktime", size: 5, durationS: 60 }));
  const res = await call(app, cook, "POST", "/v1/video-uploads", { videos }, { "idempotency-key": idempotencyKey });
  const keys = (res.data.uploads ?? []).map((u: { url: string }) => new URL(u.url).pathname.slice(1));
  return { uploadId: res.data.uploadId, keys, res };
}

/** S3 has the file: what a phone's PUT does. */
export function land(store: FakeStore, ...keys: string[]): void {
  for (const k of keys) store.objects.set(k, { bytes: new Uint8Array(5), contentType: "video/quicktime" });
}

export const newJob = (app: FastifyInstance, cook: Who, uploadId: string, extra: object = {}) => call(app, cook, "POST", "/v1/jobs", { uploadId, source: "phone", ...extra });

/** A job at any stage, with its "processing" recipe, from the folder "<upload>/": written straight to the tables, as a backfill or the worker would leave it. */
export async function addJob(cook: Who, stage: string, upload = `up-${randomBytes(4).toString("hex")}`, withRecipe = true): Promise<{ jobId: string; recipeId: string | null; upload: string }> {
  const recipeId = withRecipe
    ? (await db().query(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'Poha', 'processing') returning id`, [cook.familyId, cook.personId])).rows[0].id
    : null;
  const finished = stage === "done" || stage === "failed" ? "now()" : "null";
  const { rows } = await db().query(
    `insert into jobs (family_id, cook_id, recipe_id, upload_key, source, stage, progress, idempotency_key, finished_at)
     values ($1, $2, $3, $4::text, 'phone', $5, 0.3, $4::text, ${finished}) returning id`,
    [cook.familyId, cook.personId, recipeId, `${upload}/`, stage],
  );
  return { jobId: rows[0].id, recipeId, upload };
}

export const job = async (id: string) => (await db().query(`select * from jobs where id = $1`, [id])).rows[0];
export const recipe = async (id: string) => (await db().query(`select * from recipes where id = $1`, [id])).rows[0];

/** The jobs queue's rows for one job. */
export async function jobMessages(jobId: string): Promise<{ queue: string; payload: { jobId: string } }[]> {
  const { rows } = await db().query(`select queue, payload from outbox where queue = 'jobs' and payload->>'jobId' = $1 order by id`, [jobId]);
  return rows;
}

/** The sync's rule for a table that moved (SYNC-MIGRATION.md), and the flag. */
export async function openRecipeWrites(): Promise<void> {
  process.env.RECIPE_WRITES = "on";
  await db().query(`update sync_copies set moved_at = now() where table_name = 'recipes'`);
}

export async function closeRecipeWrites(): Promise<void> {
  delete process.env.RECIPE_WRITES;
  await db().query(`update sync_copies set moved_at = null, read_only = false where table_name = 'recipes'`);
}

/** What the first real run of the sync does. */
export const lockRecipeCopy = () => db().query(`update sync_copies set read_only = true, moved_at = null where table_name = 'recipes'`);

export const clearLimits = () => db().query(`delete from rate_hits`);

export const trace = { requestId: "req-test", log: { info: () => {}, warn: () => {}, error: () => {} } };

// ---------------------------------------------------------------------------------------------
// The worker's own code

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "queueWorkerDriver.py");
const PYTHON = process.env.PIPELINE_PYTHON ?? "python3";

/** Why the worker's side can't run here, or null. */
export function workerMissing(): string | null {
  if (!hasDatabase) return "TEST_DATABASE_URL isn't set";
  const probe = spawnSync(PYTHON, ["-c", "import psycopg, sentry_sdk"], { encoding: "utf8" });
  return probe.status === 0 ? null : `${PYTHON} can't import psycopg and sentry_sdk: set PIPELINE_PYTHON (pipeline/requirements-queue.txt)`;
}

export type WorkerOut = { results: any[]; log: string };

/** Runs ops in the real worker's code, against the database this test is using. */
export function worker(...ops: object[]): WorkerOut {
  const out = spawnSync(PYTHON, [DRIVER], { input: JSON.stringify({ dsn: process.env.TEST_DATABASE_URL, ops }), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`the worker's side failed: ${out.stderr}`);
  return JSON.parse(out.stdout);
}
