import { beforeEach, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashToken } from "./lib/auth";
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
    { ...ok, uploadPath: undefined },
    // Only the VM's own folder for this recording: never another family's signer folder or another recording's.
    { ...ok, uploadPath: "pawars-a1b2c3/" },
    { ...ok, uploadPath: "glasses-other/" },
    { ...ok, uploadPath: `glasses-${rec}` },
    { ...ok, uploadPath: ` glasses-${rec}/` },
    { ...ok, uploadPath: `glasses-${rec}/../pawars-a1b2c3/` },
    { ...ok, videoStartedAt: "soon" },
    { ...ok, durationS: 0 },
    { ...ok, recordingId: 42 },
  ]) {
    expect((await post(t, "/glasses/finished", bad)).status).toBe(400);
  }
  const nope = { ...ok, recordingId: "nope", uploadPath: "glasses-nope/" };
  expect((await post(t, "/glasses/finished", nope)).status).toBe(404);

  const phone = await recording(t, f, "ended", "phone");
  const phoneBody = { ...ok, recordingId: phone, uploadPath: `glasses-${phone}/` };
  expect((await post(t, "/glasses/finished", phoneBody)).status).toBe(404);

  await setStatus(t, rec, "abandoned");
  expect((await post(t, "/glasses/finished", ok)).status).toBe(400);
  expect(await t.run(async (ctx) => ctx.db.query("jobs").collect())).toHaveLength(0);
});

// ---- the laptop bridge (glasses/BRIDGE.md) ----

const window = (rec: string, over: Record<string, unknown> = {}) => ({
  recordingId: rec,
  sessionId: "a1b2c3d4e5f60718",
  sessionStartedAt: 1_700_000_000_000,
  windowStartS: 30,
  windowEndS: 60,
  ok: true,
  events: [
    { kind: "marker", atS: 31, title: "step marker", text: "", confidence: 1 },
    { kind: "step", atS: 32.5, endS: 50, title: "Fry the onions", text: "Fry until golden.", confidence: 0.8 },
    { kind: "ingredient", atS: 33, title: "salt", text: "~1 tsp", saidAs: "thoda sa", confidence: 0.8 },
  ],
  ...over,
});

test("/glasses/live-events needs the secret and a well-formed window", async () => {
  const t = newBackend();
  const f = await family(t);
  const rec = await recording(t, f, "recording");
  expect((await post(t, "/glasses/live-events", window(rec), "wrong")).status).toBe(401);
  for (const bad of [
    window(rec, { recordingId: 7 }),
    window(rec, { sessionStartedAt: "now" }),
    window(rec, { windowEndS: 10 }),
    window(rec, { ok: "yes" }),
    window(rec, { events: "none" }),
    window(rec, { events: [{ kind: "rumour", atS: 1, title: "", text: "", confidence: 1 }] }),
    window(rec, { events: [{ kind: "step", atS: "soon", title: "", text: "", confidence: 1 }] }),
    window(rec, { events: [{ kind: "step", atS: 1, title: "x", confidence: 1 }] }),
    window(rec, { events: Array.from({ length: 101 }, () => ({ kind: "step", atS: 1, title: "x", text: "", confidence: 1 })) }),
  ]) {
    expect((await post(t, "/glasses/live-events", bad)).status).toBe(400);
  }
  expect((await post(t, "/glasses/live-events", window("nope"))).status).toBe(404);
  const phone = await recording(t, f, "recording", "phone");
  expect((await post(t, "/glasses/live-events", window(phone))).status).toBe(404);
  await setStatus(t, rec, "abandoned");
  expect((await post(t, "/glasses/live-events", window(rec))).status).toBe(400);
  expect(await t.run(async (ctx) => ctx.db.query("liveEvents").collect())).toHaveLength(0);
});

test("live events reach the app live and the worker on the video's clock, with the missed spans", async () => {
  process.env.WORKER_SECRET = "worker-secret-for-tests";
  const t = newBackend();
  const f = await family(t);
  const rec = await recording(t, f, "recording");

  expect(await (await post(t, "/glasses/live-events", window(rec))).json()).toEqual({ events: 3 });
  const failed = window(rec, { windowStartS: 55, windowEndS: 85, ok: false, reason: "analysis behind", events: [] });
  expect((await post(t, "/glasses/live-events", failed)).status).toBe(200);

  // The video starts 20 s into the glasses session (the cook paired the recording late, say).
  await setStatus(t, rec, "ended");
  const done = await post(t, "/glasses/finished", {
    recordingId: rec,
    uploadPath: `glasses-${rec}/`,
    videoStartedAt: 1_700_000_020_000,
    durationS: 100,
    videoGaps: [{ startS: 70, endS: 75 }],
  });
  expect(done.status).toBe(200);
  const { jobId } = await done.json();

  // The VM learns the job exists, so it doesn't upload its own copy.
  const active = await (await post(t, "/glasses/active", { recordingId: rec })).json();
  expect(active).toMatchObject({ status: "ended", jobId });

  const claimed = await (
    await t.fetch("/worker/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "worker-secret-for-tests" },
      body: "{}",
    })
  ).json();
  expect(claimed.jobId).toBe(jobId);
  expect(claimed.liveLog.map((e: { kind: string; atS: number }) => [e.kind, e.atS])).toEqual([
    ["marker", 11],
    ["step", 12.5],
    ["ingredient", 13],
  ]);
  expect(claimed.liveLog[1]).toMatchObject({ endS: 30, title: "Fry the onions", confidence: 0.8 });
  expect(claimed.liveLog[2]).toMatchObject({ saidAs: "thoda sa" });
  expect(claimed.liveGaps).toEqual([{ startS: 35, endS: 65 }]);
  expect(claimed.videoGaps).toEqual([{ startS: 70, endS: 75 }]);
});

test("/glasses/finished refuses malformed videoGaps", async () => {
  const t = newBackend();
  const f = await family(t);
  const rec = await recording(t, f, "ended");
  const ok = { recordingId: rec, uploadPath: `glasses-${rec}/`, videoStartedAt: 1_700_000_000_000, durationS: 10 };
  for (const videoGaps of ["none", [{ startS: 5, endS: 1 }], [{ startS: "a", endS: 1 }]]) {
    expect((await post(t, "/glasses/finished", { ...ok, videoGaps })).status).toBe(400);
  }
});

// ---- live frames for the recording screen ----

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const postFrame = (t: Backend, rec: string, body: BodyInit = JPEG, secret = "glasses-secret-for-tests") =>
  t.fetch(`/glasses/frame?recordingId=${rec}`, { method: "POST", headers: { "x-glasses-secret": secret, "Content-Type": "image/jpeg" }, body });

async function sessionFor(t: Backend, familyId: Id<"families">, personId: Id<"people">) {
  const token = `test-session-token-${familyId}-${personId}`;
  const tokenHash = await hashToken(token);
  await t.run(async (ctx) => ctx.db.insert("sessions", { tokenHash, familyId, personId, expiresAt: Date.now() + 3_600_000 }));
  return token;
}

test("/glasses/frame keeps the newest frame of a live glasses recording, for its family only", async () => {
  const t = newBackend();
  const f = await family(t);
  const rec = await recording(t, f, "recording");
  expect((await postFrame(t, rec, JPEG, "wrong")).status).toBe(401);
  expect((await postFrame(t, rec, new Uint8Array([1, 2, 3, 4]))).status).toBe(400);
  expect((await postFrame(t, rec, new Uint8Array(600 * 1024).fill(0xff))).status).toBe(400);
  expect((await postFrame(t, "nope")).status).toBe(404);

  const token = await sessionFor(t, f.familyId, f.cookId);
  expect(await t.query(api.liveEvents.frame, { sessionToken: token, recordingId: rec })).toBeNull();

  expect((await postFrame(t, rec)).status).toBe(200);
  const first = await t.run(async (ctx) => ctx.db.query("liveFrames").unique());
  expect((await postFrame(t, rec)).status).toBe(200);
  const rows = await t.run(async (ctx) => ctx.db.query("liveFrames").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].storageId).not.toBe(first!.storageId);
  expect(await t.run(async (ctx) => ctx.storage.getUrl(first!.storageId))).toBeNull(); // the old file is gone

  const shown = await t.query(api.liveEvents.frame, { sessionToken: token, recordingId: rec });
  expect(shown?.url).toMatch(/^https?:/);
  expect(shown?.at).toBe(rows[0].at);

  const other = await t.run(async (ctx) => {
    const familyId = await ctx.db.insert("families", { name: "Others", supabaseFamilyId: "fam-other" });
    const personId = await ctx.db.insert("people", { familyId, supabaseProfileId: "p-o", name: "O", role: "cook" });
    return { familyId, personId };
  });
  const stranger = await sessionFor(t, other.familyId, other.personId);
  expect(await t.query(api.liveEvents.frame, { sessionToken: stranger, recordingId: rec })).toBeNull();

  await setStatus(t, rec, "ended");
  expect((await postFrame(t, rec)).status).toBe(400);
  const phone = await recording(t, f, "recording", "phone");
  expect((await postFrame(t, phone)).status).toBe(404);
});

test("/glasses/frame keeps the newest frame when uploads land out of order", async () => {
  const t = newBackend();
  const f = await family(t);
  const rec = await recording(t, f, "recording");
  const send = (query: string) =>
    t.fetch(`/glasses/frame?recordingId=${rec}&${query}`, {
      method: "POST",
      headers: { "x-glasses-secret": "glasses-secret-for-tests", "Content-Type": "image/jpeg" },
      body: JPEG,
    });
  expect((await send("session=s1&t=2000")).status).toBe(200);
  const newest = await t.run(async (ctx) => ctx.db.query("liveFrames").unique());
  expect((await send("session=s1&t=1500")).status).toBe(200); // older, arrived late
  const kept = await t.run(async (ctx) => ctx.db.query("liveFrames").unique());
  expect(kept?.storageId).toBe(newest?.storageId);
  expect(kept?.t).toBe(2000);
  expect((await send("session=s2&t=100")).status).toBe(200); // the glasses rebooted: a new session's clock
  expect((await t.run(async (ctx) => ctx.db.query("liveFrames").unique()))?.t).toBe(100);
  expect((await send("session=s2&t=soon")).status).toBe(400);
});
