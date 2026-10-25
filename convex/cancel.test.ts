// Stopping a recipe that's still being made (Caleb, Oct 24: "let me actually cancel these uploads"):
// jobs.cancel by job id and jobs.cancelUpload by the upload's folder, at every stage, and what a worker
// mid-way can still do with a stopped job (nothing).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import chili from "../data/synthetic/dad-sunday-chili.json";
import { type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));

beforeEach(() => {
  vi.useFakeTimers();
  process.env.WORKER_SECRET = "worker-secret-for-tests";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Stage = Doc<"jobs">["stage"];
const UNFINISHED: Stage[] = ["uploading", "queued", "preparing", "understanding", "writing", "indexing"];

const worker = (t: Backend, path: string, body: object = {}) =>
  t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-worker-secret": "worker-secret-for-tests" }, body: JSON.stringify(body) });

async function family() {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  return { t, dad, leo };
}

/** A job of Dad's at `stage`, from the upload folder "<upload>/", with its processing recipe. */
function addJob(t: Backend, dad: { familyId: Id<"families">; personId: Id<"people"> }, stage: Stage, upload = `up-${stage}`) {
  return t.run(async (ctx) => {
    const recipeId = await ctx.db.insert("recipes", { familyId: dad.familyId, cookId: dad.personId, title: "Poha", status: "processing", steps: [], memories: [], memoriesOptIn: false });
    const jobId = await ctx.db.insert("jobs", { familyId: dad.familyId, cookId: dad.personId, recipeId, uploadPath: `${upload}/`, source: "phone", stage, progress: 0.3 });
    return { jobId, recipeId };
  });
}

const read = (t: Backend, ids: { jobId: Id<"jobs">; recipeId: Id<"recipes"> }) =>
  t.run(async (ctx) => ({ job: await ctx.db.get(ids.jobId), recipe: await ctx.db.get(ids.recipeId) }));

test("jobs.cancel stops a job at every unfinished stage, and a worker mid-way can't bring it back", async () => {
  const { t, dad } = await family();
  for (const stage of UNFINISHED) {
    const ids = await addJob(t, dad, stage);
    expect(await t.mutation(api.jobs.cancel, { sessionToken: dad.sessionToken, jobId: ids.jobId }), stage).toBe(true);
    expect(await read(t, ids), stage).toMatchObject({ job: { stage: "failed", error: "Cancelled.", progress: 0 }, recipe: { status: "failed" } });

    // A worker that had it is told to stop (409) by its next report, its release and its publish,
    // and none of them changes anything.
    const report = await worker(t, "/worker/progress", { jobId: ids.jobId, stage: "writing", progress: 0.8 });
    expect(report.status, stage).toBe(409);
    expect((await worker(t, "/worker/release", { jobId: ids.jobId })).status, stage).toBe(409);
    const published = await worker(t, "/worker/published", { jobId: ids.jobId, recipe: chili });
    expect(published.status, stage).toBe(409);
    vi.advanceTimersByTime(60_000);
    expect(await read(t, ids), stage).toMatchObject({ job: { stage: "failed", error: "Cancelled." }, recipe: { status: "failed", steps: [] } });
    // Stopping it again is a no-op.
    expect(await t.mutation(api.jobs.cancel, { sessionToken: dad.sessionToken, jobId: ids.jobId }), stage).toBe(false);
  }
  // Nothing left for a worker to take.
  expect((await worker(t, "/worker/claim")).status).toBe(204);
});

test("a finished job can't be cancelled, nor can a kid or another family stop one", async () => {
  const { t, dad, leo } = await family();
  for (const stage of ["done", "failed"] as const) {
    const ids = await addJob(t, dad, stage);
    expect(await t.mutation(api.jobs.cancel, { sessionToken: dad.sessionToken, jobId: ids.jobId })).toBe(false);
    expect((await read(t, ids)).job?.stage).toBe(stage);
  }
  const queued = await addJob(t, dad, "queued");
  await expect(t.mutation(api.jobs.cancel, { sessionToken: leo.sessionToken, jobId: queued.jobId })).rejects.toThrow("Only the cook");
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const sam = await signIn(t, "q-1");
  expect(await t.mutation(api.jobs.cancel, { sessionToken: sam.sessionToken, jobId: queued.jobId })).toBe(false);
  expect(await t.mutation(api.jobs.cancelUpload, { sessionToken: sam.sessionToken, uploadId: "up-queued" })).toBe(false);
  expect((await read(t, queued)).job?.stage).toBe("queued");
});

test("jobs.cancelUpload stops the job made from a phone's upload folder, at every unfinished stage", async () => {
  const { t, dad, leo } = await family();
  const stop = (uploadId: string) => t.mutation(api.jobs.cancelUpload, { sessionToken: dad.sessionToken, uploadId });
  for (const stage of UNFINISHED) {
    const ids = await addJob(t, dad, stage, `phone-${stage}`);
    expect(await stop(`phone-${stage}`), stage).toBe(true);
    expect((await read(t, ids)).job, stage).toMatchObject({ stage: "failed", error: "Cancelled." });
    expect(await stop(`phone-${stage}`), stage).toBe(false); // already stopped
  }
  // An upload Convex has no job for yet (jobs.create hasn't run): nothing to stop, and no error.
  expect(await stop("not-made-yet")).toBe(false);
  // Only that exact folder: a folder that starts the same isn't it.
  const other = await addJob(t, dad, "queued", "phone-queued-2");
  expect(await stop("phone-queued")).toBe(false);
  expect((await read(t, other)).job?.stage).toBe("queued");
  for (const bad of ["", "a/b", "x".repeat(101)]) expect(await stop(bad)).toBe(false);
  await expect(t.mutation(api.jobs.cancelUpload, { sessionToken: leo.sessionToken, uploadId: "phone-queued-2" })).rejects.toThrow("Only the cook");
});

test("a job can't use another family's upload folder (a worker would read, and on a stop delete, its videos)", async () => {
  const { t, dad } = await family();
  await addJob(t, dad, "queued", "dad-poha-ab12cd");
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const sam = await signIn(t, "q-1");
  await expect(
    t.mutation(api.jobs.create, { sessionToken: sam.sessionToken, uploadPath: "dad-poha-ab12cd/", source: "phone" }),
  ).rejects.toThrow("Upload the video");
});

test("jobs.create is idempotent per upload folder: the phone's retries never make a second recipe", async () => {
  const { t, dad } = await family();
  const create = () => t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "dad-poha-ab12cd/", source: "phone", title: "Poha" });
  const first = await create();
  expect(await create()).toEqual(first);
  const count = () => t.run(async (ctx) => ({ jobs: (await ctx.db.query("jobs").collect()).length, recipes: (await ctx.db.query("recipes").collect()).length }));
  expect(await count()).toEqual({ jobs: 1, recipes: 1 });
  // Stopped meanwhile: a late retry gets the stopped job back, it doesn't start the recipe again.
  await t.mutation(api.jobs.cancel, { sessionToken: dad.sessionToken, jobId: first.jobId });
  expect(await create()).toEqual(first);
  expect((await t.run((ctx) => ctx.db.get(first.jobId)))?.error).toBe("Cancelled.");
  expect(await count()).toEqual({ jobs: 1, recipes: 1 });
  // Another folder is another recipe.
  const other = await t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "dad-dal-ef34ab/", source: "phone" });
  expect(other.jobId).not.toBe(first.jobId);
});

test("the upload signer still recognises a stopped job as hers (its cancel marker is best-effort)", async () => {
  const { t, dad } = await family();
  const ids = await addJob(t, dad, "understanding", "sig-1");
  await t.mutation(api.jobs.cancel, { sessionToken: dad.sessionToken, jobId: ids.jobId });
  expect(await t.query(api.signer.owns, { sessionToken: dad.sessionToken, kind: "job", id: "sig-1" })).toBe(true);
  // An upload with no Convex job: the signer refuses (403) and the app carries on without it.
  expect(await t.query(api.signer.owns, { sessionToken: dad.sessionToken, kind: "job", id: "never-made" })).toBe(false);
});
