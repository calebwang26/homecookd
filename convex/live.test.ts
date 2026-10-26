// homie while a cook records: live.startRecording / live.recording for the app, and the /live/* routes the
// voice service calls with the cook's own session token (lib/liveRoutes.ts).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addRecipe, type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));

beforeEach(() => {
  vi.useFakeTimers();
  // Before the times the tests set: convex-test's clock never goes back.
  vi.setSystemTime(new Date("2026-10-25T16:00:00Z"));
  process.env.VOICE_SECRET = "voice-secret-for-tests";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const asVoice = { "x-voice-secret": "voice-secret-for-tests" };
const post = (t: Backend, path: string, body: unknown, secret: Record<string, string> = asVoice) =>
  t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...secret }, body: JSON.stringify(body) });

async function family() {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  return { t, dad, leo };
}

test("only a cook starts a recording, for a kid in her own family, in a real language code", async () => {
  const { t, dad, leo } = await family();
  await expect(t.mutation(api.live.startRecording, { sessionToken: leo.sessionToken, source: "phone" })).rejects.toThrow("Only the cook");
  await expect(
    t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone", forKidId: dad.personId as never }),
  ).rejects.toThrow("isn't in this family");
  await expect(
    t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone", language: "Marathi" }),
  ).rejects.toThrow("language must be a code");

  const { recordingId } = await t.mutation(api.live.startRecording, {
    sessionToken: dad.sessionToken,
    source: "glasses",
    dish: "  Masale Bhaat ",
    forKidId: leo.personId as never,
    language: "MR",
  });
  expect(await t.query(api.live.recording, { sessionToken: dad.sessionToken, recordingId })).toMatchObject({
    status: "intro",
    language: "mr",
    dish: "Masale Bhaat",
    source: "glasses",
    forKidId: leo.personId,
  });
  // Unset language falls back to the cook's own, then English.
  const plain = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone" });
  expect(await t.query(api.live.recording, { sessionToken: dad.sessionToken, recordingId: plain.recordingId })).toMatchObject({ language: "en" });

  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const other = await signIn(t, "q-1");
  expect(await t.query(api.live.recording, { sessionToken: other.sessionToken, recordingId })).toBeNull();
});

test("the voice service reads the person and the cook's own recording, behind the secret", async () => {
  const { t, dad, leo } = await family();
  const { recordingId } = await t.mutation(api.live.startRecording, {
    sessionToken: dad.sessionToken,
    source: "phone",
    dish: "Chili",
    forKidId: leo.personId as never,
  });

  expect((await post(t, "/live/person", { sessionToken: dad.sessionToken }, {})).status).toBe(401);
  expect((await post(t, "/live/person", { sessionToken: "x".repeat(43) })).status).toBe(401);
  expect((await post(t, "/live/person", {})).status).toBe(400);
  expect(await (await post(t, "/live/person", { sessionToken: leo.sessionToken })).json()).toEqual({
    personId: leo.personId,
    familyId: leo.familyId,
    name: "Leo",
    role: "kid",
    language: "en",
  });

  expect((await post(t, "/live/session", { sessionToken: dad.sessionToken })).status).toBe(400);
  expect((await post(t, "/live/session", { sessionToken: dad.sessionToken, recordingId: "nope" })).status).toBe(404);
  expect((await post(t, "/live/session", { sessionToken: leo.sessionToken, recordingId })).status).toBe(404); // not hers
  expect((await post(t, "/live/session", { sessionToken: "x".repeat(43), recordingId })).status).toBe(401);
  const view = await (await post(t, "/live/session", { sessionToken: dad.sessionToken, recordingId })).json();
  expect(view).toMatchObject({
    recording: { _id: recordingId, status: "intro", language: "en" },
    cook: { name: "Dad", language: "en" },
    kid: { name: "Leo" },
    dish: "Chili",
    metBefore: false,
  });
});

test("metBefore: homie has met her once another of her recordings started filming", async () => {
  const { t, dad } = await family();
  const view = async (sessionToken: string, recordingId: string) =>
    (await (await post(t, "/live/session", { sessionToken, recordingId })).json()).metBefore;
  const first = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone" });
  // A recording left at the hello (never filmed) doesn't count.
  const unfilmed = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone" });
  expect(await view(dad.sessionToken, first.recordingId)).toBe(false);
  expect(await view(dad.sessionToken, unfilmed.recordingId)).toBe(false);

  await post(t, "/live/status", { sessionToken: dad.sessionToken, recordingId: first.recordingId, status: "recording" });
  // Her own filming isn't meeting her before (a reconnect mid-recording).
  expect(await view(dad.sessionToken, first.recordingId)).toBe(false);
  expect(await view(dad.sessionToken, unfilmed.recordingId)).toBe(true);
  const next = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "glasses" });
  expect(await view(dad.sessionToken, next.recordingId)).toBe(true);

  // Another cook is still new to homie.
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const sam = await signIn(t, "q-1");
  const hers = await t.mutation(api.live.startRecording, { sessionToken: sam.sessionToken, source: "phone" });
  expect(await view(sam.sessionToken, hers.recordingId)).toBe(false);
});

test("status, prompts, answers and the stories opt-in, on the recording's own clock", async () => {
  const { t, dad } = await family();
  const { recordingId } = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone", language: "mr" });
  const s = { sessionToken: dad.sessionToken, recordingId };

  expect((await post(t, "/live/status", { ...s, status: "intro" })).status).toBe(400);
  vi.setSystemTime(new Date("2026-10-25T17:00:00Z"));
  const started = await (await post(t, "/live/status", { ...s, status: "recording" })).json();
  expect(started).toEqual({ ok: true, startedAt: Date.parse("2026-10-25T17:00:00Z") });
  vi.setSystemTime(new Date("2026-10-25T17:05:00Z"));
  // A reconnect moves to recording again without restarting the clock.
  expect(await (await post(t, "/live/status", { ...s, status: "recording" })).json()).toEqual(started);

  expect((await post(t, "/live/prompt", { ...s, kind: "joke", text: "x", textEn: "x", atS: 1 })).status).toBe(400);
  expect((await post(t, "/live/prompt", { ...s, kind: "amount", text: "किती मीठ?", atS: 1 })).status).toBe(400);
  const { promptId } = await (
    await post(t, "/live/prompt", { ...s, kind: "amount", text: "किती मीठ घातलं?", textEn: "How much salt was that?", atS: 300 })
  ).json();
  expect(promptId).toBeTypeOf("string");

  const update = { sessionToken: dad.sessionToken, promptId };
  expect((await post(t, "/live/prompt-update", { ...update, status: "answered", answer: { transcript: "एक चमचा" } })).status).toBe(400);
  expect((await post(t, "/live/prompt-update", { sessionToken: dad.sessionToken, promptId: "nope", status: "ignored" })).status).toBe(404);
  const answer = { transcript: "साधारण एक छोटा चमचा.", transcriptEn: "About one small spoon.", atS: 304, endS: 307.5 };
  expect(await (await post(t, "/live/prompt-update", { ...update, status: "answered", answer })).json()).toEqual({ ok: true });

  expect((await post(t, "/live/optin", { ...s, optIn: "yes" })).status).toBe(400);
  expect(await (await post(t, "/live/optin", { ...s, optIn: true })).json()).toEqual({ ok: true });

  expect((await post(t, "/live/status", { ...s, status: "wrapping_up" })).status).toBe(200);
  expect((await post(t, "/live/status", { ...s, status: "ended" })).status).toBe(200);
  expect((await post(t, "/live/status", { ...s, status: "recording" })).status).toBe(400); // already ended
  // A prompt can still be logged after the end (the goodbye races the status write).
  expect((await post(t, "/live/prompt", { ...s, kind: "closing", text: "x", textEn: "That's a wrap.", atS: 900 })).status).toBe(200);

  const row = await t.query(api.live.recording, s as never);
  expect(row).toMatchObject({ status: "ended", startedAt: started.startedAt, memoriesOptIn: true });
  expect(row!.endedAt! - Date.parse("2026-10-25T17:05:00Z")).toBeLessThan(1000);
  const prompts = await t.run((ctx) => ctx.db.query("homiePrompts").collect());
  expect(prompts.map((p) => [p.kind, p.status, p.answer?.transcriptEn])).toEqual([
    ["amount", "answered", "About one small spoon."],
    ["closing", "spoken", undefined],
  ]);
  expect(prompts[0]).toMatchObject({ familyId: dad.familyId, recordingId, textEn: "How much salt was that?", atS: 300 });

  // Another family's cook can't touch it.
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const other = await signIn(t, "q-1");
  expect((await post(t, "/live/prompt-update", { sessionToken: other.sessionToken, promptId, status: "ignored" })).status).toBe(404);
  expect((await post(t, "/live/optin", { sessionToken: other.sessionToken, recordingId, optIn: false })).status).toBe(404);
});

test("the stop button ends the cook's own recording without the voice service, and again is fine", async () => {
  const { t, dad, leo } = await family();
  const sessionToken = dad.sessionToken;
  vi.setSystemTime(new Date("2026-10-25T17:00:00Z"));
  const start = () => t.mutation(api.live.startRecording, { sessionToken, source: "glasses" });
  const end = (token: string, recordingId: Id<"recordings">) => t.mutation(api.live.endRecording, { sessionToken: token, recordingId });
  const row = (recordingId: Id<"recordings">) => t.query(api.live.recording, { sessionToken, recordingId });
  const status = (recordingId: Id<"recordings">, s: string) => post(t, "/live/status", { sessionToken, recordingId, status: s });

  // Still at the hello: nothing filmed yet, nothing to end.
  const hello = await start();
  expect(await end(sessionToken, hello.recordingId)).toEqual({ ok: false });
  expect((await row(hello.recordingId))?.status).toBe("intro");

  const { recordingId } = await start();
  expect((await status(recordingId, "recording")).status).toBe(200);
  // Only her: not the kid, not another family's cook.
  await expect(end(leo.sessionToken, recordingId)).rejects.toThrow("Only the cook");
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const other = await signIn(t, "q-1");
  await expect(end(other.sessionToken, recordingId)).rejects.toThrow("isn't yours");
  const cooking = await row(recordingId);
  expect(cooking?.status).toBe("recording");

  vi.setSystemTime(new Date("2026-10-25T17:40:00Z"));
  expect(await end(sessionToken, recordingId)).toEqual({ ok: true });
  expect(await row(recordingId)).toMatchObject({ status: "ended", startedAt: cooking!.startedAt, endedAt: Date.parse("2026-10-25T17:40:00Z") });
  // A second tap or a retry: still ok, and nothing moves.
  vi.setSystemTime(new Date("2026-10-25T17:41:00Z"));
  expect(await end(sessionToken, recordingId)).toEqual({ ok: true });
  expect((await row(recordingId))?.endedAt).toBe(Date.parse("2026-10-25T17:40:00Z"));

  // The glasses VM sees it ended (so it uploads); a voice service still serving it is refused from here on,
  // except for the goodbye.
  process.env.GLASSES_SECRET = "glasses-secret-for-tests";
  const glasses = await post(t, "/glasses/active", { recordingId }, { "x-glasses-secret": "glasses-secret-for-tests" });
  expect(await glasses.json()).toMatchObject({ recordingId, status: "ended" });
  expect((await post(t, "/live/status", { sessionToken, recordingId, touch: true })).status).toBe(400);
  expect((await status(recordingId, "wrapping_up")).status).toBe(400);
  const late = await post(t, "/live/prompt", { sessionToken, recordingId, kind: "amount", text: "x", textEn: "How much salt?", atS: 2400 });
  expect([late.status, await late.json()]).toEqual([400, { error: "recording already ended" }]);
  expect((await post(t, "/live/prompt", { sessionToken, recordingId, kind: "closing", text: "x", textEn: "Bye!", atS: 2401 })).status).toBe(200);

  // From wrapping_up too. An abandoned one stays abandoned.
  const wrapping = await start();
  await status(wrapping.recordingId, "recording");
  await status(wrapping.recordingId, "wrapping_up");
  expect(await end(sessionToken, wrapping.recordingId)).toEqual({ ok: true });
  expect((await row(wrapping.recordingId))?.status).toBe("ended");
  const left = await start();
  await t.run((ctx) => ctx.db.patch("recordings", left.recordingId, { status: "abandoned" }));
  expect(await end(sessionToken, left.recordingId)).toEqual({ ok: false });
  expect((await row(left.recordingId))?.status).toBe("abandoned");
  expect((await post(t, "/live/prompt", { sessionToken, recordingId: left.recordingId, kind: "closing", text: "x", textEn: "Bye!", atS: 1 })).status).toBe(400);
});

test("a recording nobody touched for 2 hours is abandoned; the voice service's heartbeat keeps a long cook live", async () => {
  const { t, dad, leo } = await family();
  const sessionToken = dad.sessionToken;
  vi.setSystemTime(new Date("2026-10-25T17:00:00Z"));
  const old = await t.mutation(api.live.startRecording, { sessionToken, source: "phone" });
  const cooking = await t.mutation(api.live.startRecording, { sessionToken, source: "phone" });
  expect((await post(t, "/live/status", { sessionToken, recordingId: cooking.recordingId, status: "recording" })).status).toBe(200);
  vi.setSystemTime(new Date("2026-10-25T18:30:00Z"));
  const fresh = await t.mutation(api.live.startRecording, { sessionToken, source: "phone" });
  // The heartbeat only marks the recording as in use; a bad one, or someone else's, is refused.
  expect(await (await post(t, "/live/status", { sessionToken, recordingId: cooking.recordingId, touch: true })).json()).toEqual({ ok: true });
  expect((await post(t, "/live/status", { sessionToken, recordingId: cooking.recordingId, touch: "yes" })).status).toBe(400);
  expect((await post(t, "/live/status", { sessionToken: leo.sessionToken, recordingId: cooking.recordingId, touch: true })).status).toBe(404);
  vi.setSystemTime(new Date("2026-10-25T19:01:00Z"));
  await t.mutation(internal.live.abandonIdle, {});
  const row = (recordingId: typeof old.recordingId) => t.query(api.live.recording, { sessionToken, recordingId });
  expect((await row(old.recordingId))?.status).toBe("abandoned");
  expect((await row(fresh.recordingId))?.status).toBe("intro");
  const cook = await row(cooking.recordingId);
  expect(cook?.status).toBe("recording");
  expect(cook!.startedAt! - Date.parse("2026-10-25T17:00:00Z")).toBeLessThan(1000);
  // A heartbeat can't bring an abandoned recording back.
  expect((await post(t, "/live/status", { sessionToken, recordingId: old.recordingId, touch: true })).status).toBe(400);
  expect((await row(old.recordingId))?.status).toBe("abandoned");
});

test("the kid's /voice/session carries the cook's language (absent when unknown) and which step each story belongs to", async () => {
  const { t, dad, leo } = await family();
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const recipe = async () => (await (await post(t, "/voice/session", { sessionToken: leo.sessionToken, recipeId })).json()).recipe;
  // Neither the cook nor the recipe has a language: absent, not "en", so the voice still says her clips in English.
  expect(await recipe()).not.toHaveProperty("cookLanguage");
  await t.run((ctx) => ctx.db.patch("recipes", recipeId, { language: "hi" }));
  expect((await recipe()).cookLanguage).toBe("hi");
  await t.mutation(internal.seed.language, { personId: dad.personId as never, language: "mr" });
  const view = await recipe();
  expect(view).toMatchObject({ cookName: "Dad", cookLanguage: "mr" });
  // The story (130–230 s) was told during step 1 (60–330 s).
  expect(view.memories).toEqual([{ kind: "story", text: "My first apartment had one pot.", moment: { startS: 130, endS: 230 }, stepOrder: 1 }]);
});

test("in-app filming: show and plate questions, when homie's voice played, and the plate photo as the cover", async () => {
  const { t, dad, leo } = await family();
  process.env.WORKER_SECRET = "worker-secret-for-tests";
  const { recordingId } = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone" });
  const s = { sessionToken: dad.sessionToken, recordingId };
  await post(t, "/live/status", { ...s, status: "recording" });

  // A reaction is logged after it is said, with its span; a question before, then marked when it played.
  const said = { atS: 61.2, endS: 63.4 };
  expect((await post(t, "/live/prompt", { ...s, kind: "reaction", text: "x", textEn: "Oh, I love that.", atS: 61, said: { atS: 5, endS: 2 } })).status).toBe(400);
  expect((await post(t, "/live/prompt", { ...s, kind: "reaction", text: "x", textEn: "Oh, I love that.", atS: 61, said })).status).toBe(200);
  const { promptId } = await (await post(t, "/live/prompt", { ...s, kind: "show", text: "x", textEn: "Can you hold up the spice?", atS: 120 })).json();
  expect((await post(t, "/live/prompt-said", { sessionToken: dad.sessionToken, promptId })).status).toBe(400);
  expect(await (await post(t, "/live/prompt-said", { sessionToken: dad.sessionToken, promptId, said: { atS: 120.3, endS: 122.9 } })).json()).toEqual({ ok: true });
  expect((await post(t, "/live/prompt", { ...s, kind: "plate", text: "x", textEn: "Show me the plate!", atS: 900 })).status).toBe(200);

  // Only her own recording takes a cover; a second photo replaces the first and deletes its file.
  const first = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "image/jpeg" })));
  const second = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "image/jpeg" })));
  await expect(t.mutation(api.live.setCover, { sessionToken: leo.sessionToken, recordingId, storageId: first })).rejects.toThrow();
  expect(await t.mutation(api.live.setCover, { ...s, storageId: first })).toEqual({ ok: true });
  expect(await t.mutation(api.live.setCover, { ...s, storageId: second })).toEqual({ ok: true });
  expect(await t.run((ctx) => ctx.storage.getUrl(first))).toBeNull();

  // The worker's claim carries the cover and homie's spans, on the video's clock.
  await t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "chili-1a2b3c/", source: "phone", recordingId });
  const claimed = await (await post(t, "/worker/claim", {}, { "x-worker-secret": "worker-secret-for-tests" })).json();
  expect(claimed.coverUrl).toBeTypeOf("string");
  expect(claimed.homieLog.map((p: { kind: string; said?: object }) => [p.kind, p.said])).toEqual([
    ["reaction", said],
    ["show", { atS: 120.3, endS: 122.9 }],
    ["plate", undefined],
  ]);
});
