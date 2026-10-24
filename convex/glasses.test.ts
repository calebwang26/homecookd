import { beforeEach, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { type Backend, newBackend } from "./test.helpers";

beforeEach(() => {
  process.env.GLASSES_SECRET = "glasses-secret-for-tests";
});

const post = (t: Backend, path: string, body: unknown, secret = "glasses-secret-for-tests") =>
  t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-glasses-secret": secret },
    body: JSON.stringify(body),
  });

type Status = "intro" | "recording" | "wrapping_up" | "ended" | "abandoned";

async function family(t: Backend) {
  return await t.run(async (ctx) => {
    const familyId = await ctx.db.insert("families", { name: "The Pawars", supabaseFamilyId: "fam-pawar" });
    const cookId = await ctx.db.insert("people", {
      familyId,
      supabaseProfileId: "p-rajani",
      name: "Rajani",
      role: "cook",
      language: "mr",
      relation: "Rajani Aaji",
    });
    const kidId = await ctx.db.insert("people", { familyId, supabaseProfileId: "p-shreya", name: "Shreya", role: "kid" });
    return { familyId, cookId, kidId };
  });
}

async function recording(t: Backend, f: Awaited<ReturnType<typeof family>>, status: Status, source = "glasses") {
  return await t.run(async (ctx) =>
    ctx.db.insert("recordings", {
      familyId: f.familyId,
      cookId: f.cookId,
      forKidId: f.kidId,
      dish: "Varan bhaat",
      language: "mr",
      source: source as "glasses" | "phone",
      status,
      startedAt: status === "intro" ? undefined : 1_000,
      updatedAt: Date.now(),
    }),
  );
}

const setStatus = (t: Backend, id: Id<"recordings">, status: Status) =>
  t.run(async (ctx) => ctx.db.patch(id, { status }));

test("both routes need the glasses secret", async () => {
  const t = newBackend();
  expect((await post(t, "/glasses/active", {}, "wrong")).status).toBe(401);
  expect((await post(t, "/glasses/finished", {}, "wrong")).status).toBe(401);
});

test("/glasses/active reports the newest glasses recording that isn't over", async () => {
  const t = newBackend();
  const f = await family(t);
  expect((await post(t, "/glasses/active", {})).status).toBe(204);

  await recording(t, f, "recording", "phone");
  expect((await post(t, "/glasses/active", {})).status).toBe(204);

  const older = await recording(t, f, "recording");
  const newer = await recording(t, f, "intro");
  let res = await post(t, "/glasses/active", {});
  expect(await res.json()).toEqual({ recordingId: newer, status: "intro" });

  await setStatus(t, newer, "abandoned");
  res = await post(t, "/glasses/active", {});
  expect(await res.json()).toEqual({ recordingId: older, status: "recording", startedAt: 1_000 });

  await setStatus(t, older, "ended");
  expect((await post(t, "/glasses/active", {})).status).toBe(204);

  // Asking about one recording reports it in any status, so the VM can tell ended from abandoned.
  res = await post(t, "/glasses/active", { recordingId: older });
  expect(await res.json()).toEqual({ recordingId: older, status: "ended", startedAt: 1_000 });
  expect((await post(t, "/glasses/active", { recordingId: "nope" })).status).toBe(404);
});

test("/glasses/finished creates the card and job once, from the recording", async () => {
  const t = newBackend();
  const f = await family(t);
  const rec = await recording(t, f, "ended");
  const body = { recordingId: rec, uploadPath: `glasses-${rec}/`, videoStartedAt: 1_700_000_000_000, durationS: 312.4 };

  const res = await post(t, "/glasses/finished", body);
  expect(res.status).toBe(200);
  const { jobId, recipeId } = await res.json();

  const again = await post(t, "/glasses/finished", body);
  expect(await again.json()).toEqual({ jobId, recipeId });

  const { job, recipe, row, jobs } = await t.run(async (ctx) => ({
    job: await ctx.db.get(jobId as Id<"jobs">),
    recipe: await ctx.db.get(recipeId as Id<"recipes">),
    row: await ctx.db.get(rec),
    jobs: await ctx.db.query("jobs").collect(),
  }));
  expect(jobs).toHaveLength(1);
  expect(job).toMatchObject({
    familyId: f.familyId,
    cookId: f.cookId,
    recipeId,
    uploadPath: `glasses-${rec}/`,
    source: "glasses",
    title: "Varan bhaat",
    language: "mr",
    forKidId: f.kidId,
    recordingId: rec,
    stage: "queued",
    progress: 0,
  });
  expect(recipe).toMatchObject({ title: "Varan bhaat", status: "processing", cookId: f.cookId });
  expect(row).toMatchObject({ videoStartedAt: 1_700_000_000_000, jobId });
});

test("/glasses/finished refuses bad bodies, other recordings and abandoned ones", async () => {
  const t = newBackend();
  const f = await family(t);
  const rec = await recording(t, f, "ended");
  const ok = { recordingId: rec, uploadPath: `glasses-${rec}/`, videoStartedAt: 1_700_000_000_000, durationS: 10 };

  for (const bad of [
    { ...ok, uploadPath: "../other-family/" },
    { ...ok, uploadPath: "/abs" },
    { ...ok, uploadPath: "  " },
    { ...ok, videoStartedAt: "soon" },
    { ...ok, durationS: 0 },
    { ...ok, recordingId: 42 },
  ]) {
    expect((await post(t, "/glasses/finished", bad)).status).toBe(400);
  }
  expect((await post(t, "/glasses/finished", { ...ok, recordingId: "nope" })).status).toBe(404);

  const phone = await recording(t, f, "ended", "phone");
  expect((await post(t, "/glasses/finished", { ...ok, recordingId: phone })).status).toBe(404);

  await setStatus(t, rec, "abandoned");
  expect((await post(t, "/glasses/finished", ok)).status).toBe(400);
  expect(await t.run(async (ctx) => ctx.db.query("jobs").collect())).toHaveLength(0);
});
