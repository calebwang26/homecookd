// The purge outside Convex (pipeline/account_purge.py): the worker takes each finished deletion through
// POST /worker/deletions/next and reports it to /worker/deletions/done, which marks it done or counts the
// failure, waits longer after each one and gives up after MAX_PURGE_ATTEMPTS.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_PURGE_ATTEMPTS } from "./worker";
import { type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));

const SECRET = "worker-secret-for-tests";
beforeEach(() => {
  vi.useFakeTimers();
  process.env.WORKER_SECRET = SECRET;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const post = (t: Backend, path: string, body: object = {}, secret = SECRET) =>
  t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-worker-secret": secret }, body: JSON.stringify(body) });
const next = async (t: Backend, exclude: string[] = []) => {
  const res = await post(t, "/worker/deletions/next", { exclude });
  return res.status === 204 ? null : await res.json();
};
const done = async (t: Backend, deletionId: string, body: object) => (await post(t, "/worker/deletions/done", { deletionId, ...body })).json();
const row = (t: Backend, id: Id<"accountDeletions">) => t.run((ctx) => ctx.db.get("accountDeletions", id));

/** Dad's family with one deletion per name, oldest first, each with its Convex purge finished unless `open`. */
async function deletions(...names: string[]) {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const ids: Id<"accountDeletions">[] = [];
  for (const name of names) {
    ids.push(
      await t.run((ctx) =>
        ctx.db.insert("accountDeletions", {
          familyId: dad.familyId, personId: dad.personId, supabaseProfileId: `p-${name}`, requestedAt: Date.now(),
          recipeIds: [], jobIds: [], uploadPaths: [`${name}-upload/`], mediaUrls: [], ...(name === "open" ? {} : { purgedAt: Date.now() }),
        }),
      ),
    );
  }
  return { t, dad, ids };
}

test("only the worker's secret opens the deletion routes", async () => {
  const { t, ids } = await deletions("dad");
  expect((await post(t, "/worker/deletions/next", {}, "wrong")).status).toBe(401);
  expect((await post(t, "/worker/deletions/done", { deletionId: ids[0], ok: true }, "wrong")).status).toBe(401);
  expect((await row(t, ids[0]))?.externalPurgedAt).toBeUndefined();
});

test("next: a deleted account's lists, the oldest first, once its Convex purge has finished", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  await t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "dad-upload/", source: "phone" });
  await t.mutation(api.account.deleteMe, { sessionToken: dad.sessionToken });
  expect(await next(t)).toBeNull(); // the purge hasn't run yet: a late recipe could still add to the lists
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const got = await next(t);
  const family = await t.run((ctx) => ctx.db.get("families", dad.familyId));
  expect(got).toMatchObject({ supabaseProfileId: "p-dad", supabaseFamilyId: family!.supabaseFamilyId, uploadPaths: ["dad-upload/"], attempts: 0 });
  expect(got.jobIds).toHaveLength(1);
  expect(await next(t, [got.deletionId])).toBeNull(); // already taken this pass
});

test("next skips a deletion still being purged in Convex, and the ones already taken this pass", async () => {
  const { t, ids } = await deletions("first", "open", "third");
  expect((await next(t)).deletionId).toBe(ids[0]);
  expect((await next(t, [ids[0]])).deletionId).toBe(ids[2]);
  expect(await next(t, [ids[0], ids[2]])).toBeNull();
  expect((await post(t, "/worker/deletions/next", { exclude: "all" })).status).toBe(400);
});

test("done: marked purged with its counts; a second report changes nothing", async () => {
  const { t, ids } = await deletions("dad");
  expect(await done(t, ids[0], { ok: true, counts: { gcsObjects: 4, supabaseRows: 12 } })).toEqual({ status: "done" });
  const first = await row(t, ids[0]);
  expect(first).toMatchObject({ externalCounts: { gcsObjects: 4, supabaseRows: 12 } });
  expect(first?.externalPurgedAt).toBeTypeOf("number");
  expect(await next(t)).toBeNull();

  vi.advanceTimersByTime(60_000);
  expect(await done(t, ids[0], { ok: false, error: "late" })).toEqual({ status: "done" });
  expect(await row(t, ids[0])).toEqual(first);
});

test("done refuses a bad report", async () => {
  const { t, ids } = await deletions("dad");
  expect((await post(t, "/worker/deletions/done", { deletionId: "nope", ok: true })).status).toBe(404);
  expect((await post(t, "/worker/deletions/done", { deletionId: ids[0] })).status).toBe(400);
  expect((await post(t, "/worker/deletions/done", { deletionId: ids[0], ok: true, counts: { gcs: -1 } })).status).toBe(400);
  expect((await post(t, "/worker/deletions/done", { deletionId: ids[0], ok: true, counts: { $bad: 1 } })).status).toBe(400);
  expect((await post(t, "/worker/deletions/done", { deletionId: ids[0], ok: false, error: 5 })).status).toBe(400);
  expect((await row(t, ids[0]))?.externalAttempts).toBeUndefined();
});

test("a failure is tried again later, each wait longer, and given up loudly after the last attempt", async () => {
  const { t, ids } = await deletions("dad");
  const loud = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await done(t, ids[0], { ok: false, error: "Supabase: HTTP 503" })).toEqual({ status: "retry" });
  expect(await row(t, ids[0])).toMatchObject({ externalAttempts: 1, externalError: "Supabase: HTTP 503" });
  expect(await next(t)).toBeNull(); // not again right away
  vi.advanceTimersByTime(11 * 60_000);
  expect((await next(t)).attempts).toBe(1);

  expect(await done(t, ids[0], { ok: false, error: "again" })).toEqual({ status: "retry" });
  vi.advanceTimersByTime(11 * 60_000);
  expect(await next(t)).toBeNull(); // the second wait is twice as long
  vi.advanceTimersByTime(10 * 60_000);
  expect(await next(t)).not.toBeNull();

  for (let i = 3; i < MAX_PURGE_ATTEMPTS; i++) expect(await done(t, ids[0], { ok: false, error: "again" })).toEqual({ status: "retry" });
  expect(loud).not.toHaveBeenCalled();
  expect(await done(t, ids[0], { ok: false, error: "x".repeat(900) })).toEqual({ status: "gave_up" });
  expect(loud).toHaveBeenCalledWith(expect.stringContaining("ACCOUNT PURGE GAVE UP"));
  expect((await row(t, ids[0]))?.externalError).toHaveLength(500);
  vi.advanceTimersByTime(30 * 86_400_000);
  expect(await next(t)).toBeNull();
  loud.mockRestore();
});
